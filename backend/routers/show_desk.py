"""The registration desk: one exhibitor, everything the office does to them.

Entries, back numbers, and paperwork check-in used to be three screens, and the
work they describe is one conversation. Someone walks up to the desk; the
secretary finds them, gives them a number, writes down the classes they are
riding and on what, adds them to the jackpot if they want in, and looks at their
papers. Splitting that across three pages meant navigating away and searching
for the same person again at each step, and nothing on any one page could tell
you what was still missing from the other two.

This module assembles the whole desk in one read. It is deliberately thin on
logic of its own: everything here is already computed somewhere, and the point
is that the desk quotes those answers rather than growing a second opinion.

  * **Money comes from `_load_financials`.** Not a `SUM` over `entry_fee_cents`.
    The running total the desk reads out to an exhibitor has to be the same
    number they will see on My Shows, and the only way to guarantee that is to
    call the same builder — see the sharp edge in `Claude.md` about
    `build_bill`.

  * **Paperwork comes from `build_verification_checklist`.** "Verified",
    "changed since sign-off", and "nothing on file" are one definition, in
    `show_office.py`, with the health lines it derives from the documents on
    file. The desk embeds that per-exhibitor block whole.

  * **Nothing here mutates.** Every button on the desk screen posts to the
    endpoint that already owned that job — `POST .../classes/{id}/entries`,
    `PATCH .../back-numbers`, `POST .../side-pots/{id}/entries`,
    `POST .../verifications` — so association validation, back number
    uniqueness, and the settled-pot lock all still apply. The one exception is
    below, and it only creates the roster row those endpoints assume.

Access is the show-office tier — ADMIN, or the SHOW_SECRETARY / SHOW_MANAGER
assigned to *this* show. `SCRIBE` and `GATE_STEWARD` are show staff too and are
excluded, as they are on Financials: the desk carries every exhibitor's balance.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from cancellations import (
    CancellationBlocked,
    cancel_registration,
    is_on_roster,
)
from database import get_db
from dependencies import require_admin_or_show_admin, safe_uuid
from models import (
    Class,
    Entry,
    Exhibitor,
    Horse,
    Show,
    ShowEntry,
    SidePot,
)
from routers.show_financials import _load_financials
from routers.show_office import build_verification_checklist
from routers.shows import _assert_show_access
from schemas import ShowDeskExhibitorAdd, ShowDeskOut, ShowDeskRosterRow

router = APIRouter(
    prefix="/shows/{show_id}/desk",
    tags=["Show Desk"],
    dependencies=[Depends(require_admin_or_show_admin)],
)


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    """`select().populate_existing()` rather than `db.get(..., options=[...])`.

    `_load_financials` loads the same Show row in this request, and loader
    options are silently dropped when the instance is already in the session's
    identity map — whichever of the two ran second would get an unloaded
    relationship, a lazy load inside an async request, and a `MissingGreenlet`
    500 with an empty body. Forcing the options on makes the order irrelevant.
    """
    result = await db.execute(
        select(Show)
        .where(Show.id == show_id)
        .options(selectinload(Show.show_type))
        .execution_options(populate_existing=True)
    )
    show = result.scalar_one_or_none()
    if not show:
        raise HTTPException(404, "Show not found")
    return show


@router.get("", response_model=ShowDeskOut)
async def get_desk(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Everyone at this show, with everything the desk does to them.

    One read rather than one per panel: the desk is used at a counter with a
    queue behind it, and a screen that fetches five things per exhibitor as you
    click down the roster is a screen that feels broken on venue wifi.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)

    financials = await _load_financials(show_id, db)
    checklist = await build_verification_checklist(show_id, db)
    paperwork_by_exhibitor = {
        row["exhibitor_id"]: row for row in checklist["exhibitors"]
    }

    class_result = await db.execute(
        select(Class)
        .options(selectinload(Class.discipline), selectinload(Class.division))
        .where(Class.show_id == show_id)
        .order_by(Class.class_date, Class.sort_order.nullslast(), Class.class_number)
    )
    classes = list(class_result.scalars().all())
    # An exhibitor's classes read in the order the show runs them, which is the
    # order the query above already put the schedule in. Sorting the entries by
    # `class_number` instead would be a string sort — class 10 ahead of class 3.
    class_order = {cls.id: index for index, cls in enumerate(classes)}

    # Owner/sire/dam ride along because the desk's by-class view is the program
    # listing, and fetching them per class is what made the old Entries page
    # issue a request per class plus the whole horse and exhibitor tables.
    entry_result = await db.execute(
        select(Entry)
        .options(
            selectinload(Entry.class_),
            selectinload(Entry.horse).selectinload(Horse.owner_exhibitor),
        )
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id)
    )
    entries_by_exhibitor: dict[UUID, list[dict]] = {}
    entry_count_by_class: dict[UUID, int] = {}
    for entry in entry_result.scalars().all():
        entry_count_by_class[entry.class_id] = entry_count_by_class.get(entry.class_id, 0) + 1
        horse = entry.horse
        entries_by_exhibitor.setdefault(entry.exhibitor_id, []).append({
            "entry_id": entry.id,
            "class_id": entry.class_id,
            "class_number": entry.class_.class_number if entry.class_ else None,
            "class_name": entry.class_.class_name if entry.class_ else None,
            "class_date": entry.class_.class_date if entry.class_ else None,
            # Deleting a horse nulls entries.horse_id to preserve history, so an
            # entry with no horse is expected rather than a broken row.
            "horse_id": entry.horse_id,
            "horse_name": horse.name if horse else None,
            "barn_name": horse.barn_name if horse else None,
            # A linked owner wins over the free-text fallback, the same
            # precedence the public program listing uses.
            "owner_name": (
                (horse.owner_exhibitor.full_name if horse.owner_exhibitor else horse.owner_name)
                if horse
                else None
            ),
            "sire_name": horse.sire_name if horse else None,
            "dam_name": horse.dam_name if horse else None,
            "apha_division": entry.apha_division,
            "is_disqualified": entry.is_disqualified,
        })
    for rows in entries_by_exhibitor.values():
        rows.sort(key=lambda e: class_order.get(e["class_id"], len(class_order)))

    pot_result = await db.execute(
        select(SidePot)
        .options(selectinload(SidePot.pot_entries))
        .where(SidePot.show_id == show_id)
        .order_by(SidePot.created_at)
    )
    pots = list(pot_result.scalars().all())
    # Keyed by show_entry_id because that is what a pot entry points at — an
    # exhibitor with no roster row cannot be in a pot, which is why the desk
    # creates that row before offering the toggles.
    pot_ids_by_show_entry: dict[UUID, list[UUID]] = {}
    for pot in pots:
        for pot_entry in pot.pot_entries:
            pot_ids_by_show_entry.setdefault(pot_entry.show_entry_id, []).append(pot.id)

    exhibitors_out = []
    for account in financials["accounts"]:
        exhibitor_id = account["exhibitor_id"]
        paperwork = paperwork_by_exhibitor.get(exhibitor_id)
        exhibitors_out.append({
            "exhibitor_id": exhibitor_id,
            "exhibitor_name": account["exhibitor_name"],
            "show_entry_id": account["show_entry_id"],
            "back_number": account["back_number"],
            # What they asked for at registration. The desk shows it only when
            # it differs from what they hold, so a granted request is silent
            # and an overridden one is visible.
            "preferred_back_number": account["preferred_back_number"],
            "signed_up": account["signed_up"],
            # Set means this registration was called off. Kept on the roster
            # rather than filtered out of it: the office still has their
            # payments to settle, and a cancelled exhibitor who vanishes from
            # the desk is one nobody can refund.
            "cancelled_at": account["cancelled_at"],
            # Stabling requests, so whoever draws the stall chart can read them
            # off the roster instead of opening each registration. Kept apart
            # from the general notes because the two are read at different
            # moments -- see migration 128.
            "stall_request": account["stall_request"],
            "arrival_date": account["arrival_date"],
            "departure_date": account["departure_date"],
            "entries": entries_by_exhibitor.get(exhibitor_id, []),
            "side_pot_ids": pot_ids_by_show_entry.get(account["show_entry_id"], []),
            "memberships": paperwork["memberships"] if paperwork else [],
            "horses": paperwork["horses"] if paperwork else [],
            "waivers": paperwork["waivers"] if paperwork else [],
            "emergency_contact": (
                paperwork["emergency_contact"] if paperwork else {"status": "missing"}
            ),
            "paperwork_outstanding": paperwork["outstanding"] if paperwork else 0,
            "billed_cents": account["bill"]["total_cents"],
            "net_paid_cents": account["net_paid_cents"],
            "balance_cents": account["balance_cents"],
        })

    # Alphabetical, because the desk's question is "where is Susan Miller", not
    # "who owes the most" — that is what the Financials screen sorts for.
    exhibitors_out.sort(key=lambda e: (e["exhibitor_name"] or "").lower())

    # Counts the paperwork problem, not the sign-off: a lapsed Coggins is what
    # the office chases, and whether anyone has looked at it yet is a different
    # number (it is already inside paperwork_outstanding).
    health_alerts = sum(
        1
        for e in exhibitors_out
        for horse in e["horses"]
        for check in horse.get("health") or []
        if check["status"] != "valid"
    )

    return {
        "show_id": show.id,
        "show_name": show.name,
        "show_status": show.status,
        "show_type_code": show.show_type.code if show.show_type else None,
        "classes": [
            {
                "id": cls.id,
                "class_number": cls.class_number,
                "class_name": cls.class_name,
                "class_date": cls.class_date,
                "status": cls.status,
                "score_type": cls.score_type,
                "entry_fee_cents": cls.entry_fee_cents,
                "discipline_name": cls.discipline.name if cls.discipline else None,
                "division_name": cls.division.name if cls.division else None,
                "entry_count": entry_count_by_class.get(cls.id, 0),
            }
            for cls in classes
        ],
        "side_pots": [
            {
                "id": pot.id,
                "name": pot.name,
                "entry_fee_cents": pot.entry_fee_cents,
                "status": pot.status,
                "entry_count": len(pot.pot_entries),
            }
            for pot in pots
        ],
        "exhibitors": exhibitors_out,
        "totals": {
            "exhibitors": len(exhibitors_out),
            "entries": financials["registrations"]["entries"],
            "classes": financials["registrations"]["classes"],
            "no_back_number": sum(1 for e in exhibitors_out if e["back_number"] is None),
            "no_entries": sum(1 for e in exhibitors_out if not e["entries"]),
            "paperwork_outstanding": checklist["totals"]["stale"] + checklist["totals"]["unverified"],
            "health_alerts": health_alerts,
            "waivers_outstanding": checklist["totals"]["waivers_outstanding"],
            "contacts_missing": checklist["totals"]["contacts_missing"],
            # No show-wide money figure here on purpose. What one exhibitor owes
            # belongs at the desk — they are standing there and may be paying —
            # but "the show is owed $6,049" is a Financials question and is not
            # part of registering anybody.
        },
    }


@router.post("/exhibitors", response_model=ShowDeskRosterRow, status_code=201)
async def add_exhibitor_to_roster(
    show_id: UUID,
    body: ShowDeskExhibitorAdd,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Put an exhibitor on this show's roster before they have entered anything.

    A `show_entries` row is what a back number lives on and what a side pot
    entry points at, and until now the only things that created one were the
    exhibitor signing up themselves and the bulk back-number save. So the desk
    could not give a walk-up a number, or put them in the jackpot, until it had
    first invented a class entry for them.

    `registered_at` stays NULL: this is the shell row the schema already
    describes as "a secretary added them by hand", not a sign-up. The exhibitor
    still has to complete sign-up before they can self-register for classes —
    staff entering classes for them here is a separate path and always was.

    Idempotent. Two staff members adding the same walk-up at once is a normal
    Saturday, not an error worth showing anyone.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)

    exhibitor = await db.get(Exhibitor, body.exhibitor_id)
    if not exhibitor:
        raise HTTPException(404, "Exhibitor not found")

    existing_result = await db.execute(
        select(ShowEntry).where(
            ShowEntry.show_id == show_id,
            ShowEntry.exhibitor_id == body.exhibitor_id,
        )
    )
    show_entry = existing_result.scalar_one_or_none()
    if show_entry is None:
        show_entry = ShowEntry(show_id=show_id, exhibitor_id=body.exhibitor_id)
        db.add(show_entry)
        try:
            await db.commit()
        except IntegrityError:
            # The (show_id, exhibitor_id) unique constraint — someone else got
            # there first, which is the outcome we wanted anyway.
            await db.rollback()
            existing_result = await db.execute(
                select(ShowEntry).where(
                    ShowEntry.show_id == show_id,
                    ShowEntry.exhibitor_id == body.exhibitor_id,
                )
            )
            show_entry = existing_result.scalar_one()
        else:
            await db.refresh(show_entry)

    return {
        "show_entry_id": show_entry.id,
        "exhibitor_id": show_entry.exhibitor_id,
        "exhibitor_name": exhibitor.full_name,
        "back_number": show_entry.back_number,
        "signed_up": is_on_roster(show_entry),
    }


class ShowDeskCancelRegistration(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


@router.post("/exhibitors/{exhibitor_id}/cancel")
async def cancel_registration_from_desk(
    show_id: UUID,
    exhibitor_id: UUID,
    body: ShowDeskCancelRegistration = ShowDeskCancelRegistration(),
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Take an exhibitor out of the show when they cannot do it themselves.

    The other half of `DELETE /shows/{id}/register/signup`. An exhibitor may
    cancel their own registration up to a fortnight before the show; inside
    that window the office does it here, and the office is not on a clock —
    someone whose truck breaks down on the Friday still has to come off the
    stall chart.

    Runs the same `cancel_registration` the exhibitor's own door runs, so the
    two cannot disagree about what a cancellation leaves behind. Distinct from
    `DELETE /exhibitors/{id}` below, which is the undo for adding the wrong
    person and refuses the moment anything hangs off the row: this one is for a
    registration that was real.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)

    result = await db.execute(
        select(ShowEntry)
        .options(
            selectinload(ShowEntry.reservations),
            selectinload(ShowEntry.side_pot_entries),
        )
        .where(ShowEntry.show_id == show_id, ShowEntry.exhibitor_id == exhibitor_id)
    )
    show_entry = result.scalar_one_or_none()
    if not show_entry:
        raise HTTPException(404, "That exhibitor is not on this show's roster")
    if show_entry.cancelled_at is not None:
        raise HTTPException(409, "This registration has already been cancelled.")

    try:
        await cancel_registration(
            show_entry, show_id, safe_uuid(x_user_id), body.reason, db
        )
    except CancellationBlocked as blocked:
        raise HTTPException(409, {"code": blocked.code, "message": blocked.message}) from None

    return {
        "cancelled": True,
        "exhibitor_id": str(exhibitor_id),
        # The registration is off but the account is not: whatever they paid is
        # still sitting against a bill that is now nothing, and the desk needs
        # to be told to go and refund it.
        "note": (
            "Classes, stalls, side pots and futurity entries have been removed. "
            "Any payments recorded stay on their account — refund them with a "
            "negative payment on the Financials screen."
        ),
    }


@router.delete("/exhibitors/{exhibitor_id}", status_code=204)
async def remove_exhibitor_from_roster(
    show_id: UUID,
    exhibitor_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Undo adding the wrong person to the roster.

    Only ever an undo: refused once anything hangs off the row, because
    `show_entries` cascades to reservations, payments, and side pot entries and
    a mis-click should not be able to delete a recorded payment. Someone who has
    entered a class is removed by removing their entries first, which is the
    same order the office would do it on paper.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)

    result = await db.execute(
        select(ShowEntry)
        .options(
            selectinload(ShowEntry.reservations),
            selectinload(ShowEntry.payments),
            selectinload(ShowEntry.side_pot_entries),
        )
        .where(ShowEntry.show_id == show_id, ShowEntry.exhibitor_id == exhibitor_id)
    )
    show_entry = result.scalar_one_or_none()
    if not show_entry:
        raise HTTPException(404, "That exhibitor is not on this show's roster")

    if show_entry.registered_at is not None:
        raise HTTPException(
            409,
            "This exhibitor signed themselves up for the show; their registration "
            "cannot be removed from the desk.",
        )
    if show_entry.payments:
        raise HTTPException(409, "This exhibitor has payments recorded at this show.")
    if show_entry.reservations:
        raise HTTPException(409, "This exhibitor has stalls or camping reserved at this show.")
    if show_entry.side_pot_entries:
        raise HTTPException(409, "Take this exhibitor out of their side pots first.")

    entry_result = await db.execute(
        select(Entry.id)
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id, Entry.exhibitor_id == exhibitor_id)
        .limit(1)
    )
    if entry_result.scalar_one_or_none():
        raise HTTPException(409, "Remove this exhibitor's class entries first.")

    await db.delete(show_entry)
    await db.commit()
