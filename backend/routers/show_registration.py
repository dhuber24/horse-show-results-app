"""Exhibitor self-registration for a published show.

Registration is three steps, in order:

1. **Complete your profile** (`/profile-status`, read-only here; the fields are
   edited through `PATCH /exhibitors/{id}` as they always were). Contact
   details, date of birth, an emergency contact, and one horse. Enforced by
   `PUT /signup`, which is the first write in the flow — see
   `exhibitor_profile.py` for what blocks and what only prompts. The office
   used to reach a stall chart before it had the exhibitor's telephone number,
   and nobody goes back afterwards to fill that in.

2. **Sign up for the show** (`/signup`). Creates the `show_entries` row — the
   show-level record that carries the back number — and captures what the show
   office needs to run the grounds: stalls, bags of shavings, camping. Those
   are quantities against the show's own `show_fees` catalog, so the exhibitor
   only ever sees what the secretary configured, at the secretary's prices.

3. **Enter classes** (`POST /`). Requires a completed sign-up: an exhibitor
   whose `show_entries.registered_at` is NULL is turned away with a 409 rather
   than silently having a shell row created for them. That ordering is the
   point — the office wants stall counts *before* it has a ring full of horses.

**Cancelling** (`DELETE /signup`) undoes the lot, and only up to a fortnight
before the show — inside that window `cancellations.may_self_cancel` is False
and the exhibitor is sent to the show office, which cancels from the desk. The
row is marked, not deleted; see migration 126.

Each class entry creates one `entries` row per (class, horse) pair and runs the
same association validation as the secretary entry path.

Health paperwork does **not** gate any of this. A horse whose Coggins is
missing, undated, or lapsed by the show's last day is entered like any other and
shows up on the screen — and on the show office's health flags — as something to
sort out before shipping in.

The exhibitor is derived from the authenticated user — never trusted from the
request body — so a logged-in EXHIBITOR can only register themselves.

Once a show flips out of PUBLISHED (ACTIVE / COMPLETED / DRAFT), these
endpoints return 403 and the secretary must add late entries through the admin
flow.
"""
from datetime import date
from types import SimpleNamespace
from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, union
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from cancellations import (
    CancellationBlocked,
    cancel_registration,
    cancellation_window,
    is_on_roster,
    may_self_cancel,
)
from exhibitor_profile import missing_blocking, profile_checklist
from horse_eligibility import (
    effective_relationship,
    horse_registration_flags,
    owns_horse,
    registration_codes,
)
from billing import (
    build_bill,
    early_rate_is_open,
    fee_rate_cents,
    class_sanction_cents,
    office_charge_total_cents,
    reservable_fees,
    sanction_rates,
)
from database import get_db
from dependencies import INTERNAL_API_KEY, require_authenticated, safe_uuid
from models import (
    Association,
    Class,
    ClassAssociation,
    Entry,
    Exhibitor,
    ExhibitorHorse,
    Futurity,
    FuturityClass,
    FuturityEntry,
    Horse,
    HorseRegistration,
    Result,
    Show,
    ShowEntry,
    ShowEntryReservation,
    ShowFee,
)
from routers.futurities import load_billable_futurities, missing_horse_details
from routers.horse_documents import health_by_horse
from routers.shows import get_aqha_association_id
from rules import get_rules
from rules.apha import RELATIONSHIP_OPTIONS, divisions_for_bracket
from apha_context import apha_entry_context
from attestations import build_attestations
from schemas import EntryOut
import standard_classes

router = APIRouter(prefix="/shows/{show_id}/register", tags=["Show Registration"])


# ── Request / response schemas ────────────────────────────────────────────────

class ShowRegistrationItem(BaseModel):
    class_id: UUID
    horse_id: UUID
    apha_division: Optional[str] = Field(default=None, max_length=40)
    relationship_to_owner: Optional[str] = Field(default=None, max_length=200)
    # Which declarations the exhibitor is making. Names only — the wording lives
    # in `rules/apha.py` and is copied in server-side.
    attestations: list[str] = Field(default_factory=list)


class ShowRegistrationCreate(BaseModel):
    entries: list[ShowRegistrationItem] = Field(min_length=1)


class FeeBreakdownItem(BaseModel):
    class_id: UUID
    class_number: str
    class_name: str
    fee_cents: int
    sanction_cents: int = 0


class ShowRegistrationResult(BaseModel):
    show_entry_id: UUID
    created_entries: list[EntryOut]
    fee_breakdown: list[FeeBreakdownItem]
    subtotal_fee_cents: int
    sanction_total_cents: int = 0
    office_charge_total_cents: int = 0
    total_fee_cents: int


def _class_sanction_cents(show: Show, class_: Class) -> int:
    """The club sanction fees one entry in this class owes.

    Thin wrapper over `billing.class_sanction_cents` so this router keeps
    quoting the number the bill will actually charge rather than deriving a
    second one. It re-reads `sanction_rates` per call, which is fine for the
    handful of callers here; `build_bill` hoists it out of its loop.
    """
    return class_sanction_cents(class_, sanction_rates(show))


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _load_exhibitor_for_user(user_id: UUID, db: AsyncSession) -> Exhibitor:
    result = await db.execute(
        select(Exhibitor)
        .options(selectinload(Exhibitor.registrations))
        .where(Exhibitor.user_id == user_id)
    )
    exhibitor = result.scalar_one_or_none()
    if not exhibitor:
        raise HTTPException(403, "Only exhibitors can self-register for a show")
    return exhibitor


async def _load_published_show_or_403(show_id: UUID, db: AsyncSession) -> Show:
    result = await db.execute(
        select(Show)
        .options(
            selectinload(Show.show_type),
            # Needed by _class_sanction_cents: the per-class rate is read
            # off the show's club sanctioning rows.
            selectinload(Show.sanctioning),
            # Read by `billing.charge_lines` off the Show row, the same way
            # `office_charge_cents` is: the show's own per-horse and per-judge
            # charges, and the panel size they multiply by.
            selectinload(Show.fees),
            selectinload(Show.judges),
        )
        .where(Show.id == show_id)
    )
    show = result.scalar_one_or_none()
    if not show:
        raise HTTPException(404, "Show not found")
    if show.status != "PUBLISHED":
        raise HTTPException(
            403,
            "Self-registration is only available while the show is open for "
            f"registration (current status: {show.status}). "
            "Contact the show secretary to be added.",
        )
    return show


async def _exhibitor_horse_ids(exhibitor_id: UUID, db: AsyncSession) -> set[UUID]:
    """Horses on this exhibitor's profile — matches the /my-horses endpoint (created or linked).

    Intentionally excludes horses that only have owner_exhibitor_id set: those are
    invisible to the exhibitor in their profile UI and cannot be managed there, so they
    should not appear in the self-registration picker either. Use ExhibitorHorse to
    explicitly grant an exhibitor access to a horse they didn't create.
    """
    from_created = select(Horse.id).where(Horse.created_by_exhibitor_id == exhibitor_id)
    from_link = (
        select(Horse.id)
        .join(ExhibitorHorse, ExhibitorHorse.horse_id == Horse.id)
        .where(ExhibitorHorse.exhibitor_id == exhibitor_id)
    )
    combined = union(from_created, from_link).subquery()
    result = await db.execute(select(combined.c.id))
    return {row[0] for row in result.all()}


async def _load_show_entry(
    show_id: UUID, exhibitor_id: UUID, db: AsyncSession
) -> Optional[ShowEntry]:
    result = await db.execute(
        select(ShowEntry)
        .options(selectinload(ShowEntry.reservations).selectinload(ShowEntryReservation.show_fee))
        .where(ShowEntry.show_id == show_id, ShowEntry.exhibitor_id == exhibitor_id)
    )
    return result.scalar_one_or_none()


async def _load_reservable_fees(show_id: UUID, db: AsyncSession) -> list[ShowFee]:
    result = await db.execute(
        select(ShowFee).where(ShowFee.show_id == show_id).order_by(ShowFee.sort_order, ShowFee.label)
    )
    return reservable_fees(result.scalars().all())


def _fee_options_out(fees: list[ShowFee], show_entry: Optional[ShowEntry]) -> list[dict]:
    """The reservable fees, each priced for *this* exhibitor.

    `rate_cents` is what they will actually be charged, and is the only number
    the sign-up screen should multiply by a quantity — quoting `amount_cents`
    while `build_bill` charges the early rate is exactly the disagreement
    billing.py exists to prevent.

    Two rates can be in play at once on the same screen: a line they already
    booked keeps the rate it was booked at, while a line they have not booked
    is quoted at today's. `early_rate_open` is the second of those, so the
    screen can nudge someone to reserve before the deadline.
    """
    booked_on = {
        r.show_fee_id: r.reserved_at for r in (show_entry.reservations if show_entry else []) or []
    }
    return [
        {
            "id": str(f.id),
            "code": f.code,
            "label": f.label,
            "unit": f.unit,
            "amount_cents": f.amount_cents,
            "rate_cents": fee_rate_cents(f, booked_on.get(f.id)),
            "early_amount_cents": f.early_amount_cents,
            "early_deadline": f.early_deadline,
            "early_rate_open": early_rate_is_open(f),
            # The fewest of this line the exhibitor may book once they book any
            # (migration 128). Sent so the picker can start at the floor and
            # refuse to go under it, rather than letting somebody type 2 into a
            # show that requires 4 and find out on save.
            "min_quantity": f.min_quantity or 0,
            "notes": f.notes,
        }
        for f in fees
    ]


def _signup_out(show_entry: Optional[ShowEntry]) -> Optional[dict]:
    # A cancelled registration is not a sign-up. Every screen keys off this
    # being null to decide whether the exhibitor is in the show, so reading
    # `registered_at` alone would leave somebody who cancelled looking entered
    # right up to the gate. `cancellations.is_on_roster` is the one place that
    # rule is written.
    if not is_on_roster(show_entry):
        return None
    return {
        "show_entry_id": str(show_entry.id),
        "registered_at": show_entry.registered_at,
        "back_number": show_entry.back_number,
        # What they asked for, which is not always what they hold — the office
        # can renumber. The screen shows both when they differ.
        "preferred_back_number": show_entry.preferred_back_number,
        "arrival_date": show_entry.arrival_date,
        "departure_date": show_entry.departure_date,
        "notes": show_entry.registration_notes,
        # Stabling requests, apart from the general notes: the office reads
        # every one of these at once while drawing the stall chart, and reads
        # "arriving late Friday" at the gate.
        "stall_request": show_entry.stall_request,
        "reservations": [
            {
                "show_fee_id": str(r.show_fee_id),
                "quantity": r.quantity,
            }
            for r in (show_entry.reservations or [])
            if r.quantity > 0
        ],
    }


async def _show_associations(show: Show, db: AsyncSession) -> list[tuple]:
    """The bodies this show runs under, as `(association_id, code)` pairs.

    The breed body it is approved by and every club sanctioning it — the same
    two questions Show Details answers under "Approved by" and "Clubs". Read
    against `associations` rather than `show_types`, because a membership
    number is a property of the person and that is where those live (there is
    deliberately no `associations` row for OPEN, so an Open show with no clubs
    returns an empty list and the membership prompt is dropped entirely).
    """
    pairs: list[tuple] = []
    if show.show_type and show.show_type.code and show.show_type.code != "OPEN":
        breed = await db.execute(
            select(Association.id, Association.code).where(
                Association.code == show.show_type.code
            )
        )
        pairs.extend(breed.all())
    club_ids = [row.association_id for row in (show.sanctioning or [])]
    if club_ids:
        clubs = await db.execute(
            select(Association.id, Association.code).where(Association.id.in_(club_ids))
        )
        pairs.extend(clubs.all())
    seen: set = set()
    return [(aid, code) for aid, code in pairs if not (aid in seen or seen.add(aid))]


async def _profile_status(show: Show, exhibitor: Exhibitor, db: AsyncSession) -> dict:
    """Step one of registration, as data.

    Assembled here rather than on each screen so the checklist the exhibitor
    reads and the list `PUT /signup` refuses on are the same list — a form that
    says "you're done" over an endpoint that says otherwise is the disagreement
    this is shaped to prevent.
    """
    horse_ids = await _exhibitor_horse_ids(exhibitor.id, db)
    checklist = profile_checklist(
        exhibitor,
        horse_count=len(horse_ids),
        associations=await _show_associations(show, db),
        registered_association_ids={r.association_id for r in (exhibitor.registrations or [])},
    )
    missing = missing_blocking(checklist)
    return {
        "complete": not missing,
        "missing": missing,
        "checklist": checklist,
        # The values the inline form on the registration screen edits. Sent
        # back so that screen does not need a second round trip to
        # /exhibitors/{id} just to prefill the boxes it is about to gate on.
        "exhibitor": {
            "id": str(exhibitor.id),
            "full_name": exhibitor.full_name,
            "date_of_birth": exhibitor.date_of_birth,
            "phone": exhibitor.phone,
            "address": exhibitor.address,
            "city": exhibitor.city,
            "state": exhibitor.state,
            "zip": exhibitor.zip,
            "emergency_contact_name": exhibitor.emergency_contact_name,
            "emergency_contact_phone": exhibitor.emergency_contact_phone,
            "parent_guardian_name": exhibitor.parent_guardian_name,
            "parent_guardian_phone": exhibitor.parent_guardian_phone,
        },
    }


def _profile_incomplete(missing: list[str]) -> HTTPException:
    return HTTPException(
        409,
        {
            "code": "PROFILE_INCOMPLETE",
            "message": (
                "Finish your profile before signing up for this show. Still "
                "needed: " + ", ".join(missing).lower() + "."
            ),
            "missing": missing,
        },
    )


def _aqha_class_code(show: Show, class_: Class) -> str | None:
    for assoc in class_.associations or []:
        if assoc.show_type_id == show.show_type_id or (
            assoc.show_type and assoc.show_type.code == "AQHA"
        ):
            return assoc.association_class_code
    return None


async def _association_validation_context(
    show: Show, class_: Class, db: AsyncSession, shared: Optional[dict] = None
):
    """Per-class validation context, on top of whatever is show-wide.

    `shared` carries the show-wide half — APHA's entry limits need every other
    entry at the show, which is one query, not one per class in a batch. It is
    also the batch's own running total: entries created earlier in this request
    are appended to it, because six horses submitted together are still six
    horses and the database has not seen any of them yet.
    """
    context: dict = dict(shared or {})
    if show.show_type and show.show_type.code == "AQHA":
        aqha_code = _aqha_class_code(show, class_)
        context["aqha_show_type_id"] = show.show_type_id
        context["aqha_association_id"] = await get_aqha_association_id(db)
        context["aqha_class_code"] = aqha_code
        context["aqha_class"] = await standard_classes.lookup(db, "AQHA", aqha_code)
    return context


# ── Sign-up ───────────────────────────────────────────────────────────────────

class ReservationItem(BaseModel):
    show_fee_id: UUID
    quantity: int = Field(ge=0, le=999)


class ShowSignupBody(BaseModel):
    reservations: list[ReservationItem] = Field(default_factory=list)
    arrival_date: Optional[date] = None
    departure_date: Optional[date] = None
    notes: Optional[str] = Field(default=None, max_length=1000)
    stall_request: Optional[str] = Field(default=None, max_length=1000)


@router.get("/profile-status")
async def get_profile_status(
    show_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Step one: is this exhibitor's profile good enough to enter this show?

    A read of the exhibitor's own record against the show's affiliations.
    Nothing here writes, and nothing here is a fact about the show — it is on
    this router because it is the first step of *this* flow, and because which
    memberships are worth prompting for depends on which bodies the show runs
    under.
    """
    show = await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(safe_uuid(user_id), db)
    return await _profile_status(show, exhibitor, db)


@router.get("/signup")
async def get_signup(
    show_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """The sign-up screen: what this show offers, and what the caller booked.

    `signup` is null until they complete it, which is also what the class
    registration screen keys off to decide whether to let them in.
    """
    show = await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(safe_uuid(user_id), db)
    show_entry = await _load_show_entry(show_id, exhibitor.id, db)
    fees = await _load_reservable_fees(show_id, db)

    return {
        "show": {
            "id": str(show.id),
            "name": show.name,
            "status": show.status,
            "start_date": show.start_date,
            "end_date": show.end_date,
            "office_charge_cents": show.office_charge_cents,
            "office_charge_basis": show.office_charge_basis,
            "shavings_ban_outside": show.shavings_ban_outside,
        },
        "exhibitor": {"id": str(exhibitor.id), "full_name": exhibitor.full_name},
        "fee_options": _fee_options_out(fees, show_entry),
        "signup": _signup_out(show_entry),
        # Step one, so the screen can lock this half rather than offering a
        # form the save is going to refuse.
        "profile": await _profile_status(show, exhibitor, db),
        # What the cancel control says and whether it is the exhibitor's to
        # press. Always sent, even before sign-up, because it costs nothing and
        # a screen that only learns the rule after signing up cannot warn
        # anybody about the deadline in advance.
        "cancellation": cancellation_window(show.start_date),
    }


@router.put("/signup")
async def save_signup(
    show_id: UUID,
    body: ShowSignupBody,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Complete or amend show sign-up.

    Idempotent by design — the exhibitor can come back and change their stall
    count while the show is still PUBLISHED, and the same call handles both the
    first sign-up and every edit after it. The body is the complete booking, so
    a fee the exhibitor removed disappears instead of lingering at its old
    quantity.

    Lines they still want are updated in place rather than deleted and
    recreated, because `reserved_at` is what decides whether they get the
    fee's early rate. Recreating the row would re-date it, so an exhibitor who
    reserved stalls in April would silently lose their early rate the moment
    they came back in July to change their arrival date.
    """
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")

    show = await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(safe_uuid(x_user_id), db)

    # Step one, and this is the first write in the flow — so this is where it
    # is enforced. Refused rather than flagged: unlike health paperwork, every
    # item on the blocking list is something only this caller holds and can
    # type in a minute, and nobody at the desk can produce their date of birth
    # for them. See `exhibitor_profile.py` for what blocks and what prompts.
    missing = missing_blocking(
        (await _profile_status(show, exhibitor, db))["checklist"]
    )
    if missing:
        raise _profile_incomplete(missing)

    if body.arrival_date and body.departure_date and body.departure_date < body.arrival_date:
        raise HTTPException(400, "Departure date cannot be before the arrival date")

    fees_by_id = {f.id: f for f in await _load_reservable_fees(show_id, db)}
    for item in body.reservations:
        if item.show_fee_id not in fees_by_id:
            raise HTTPException(400, "One or more selected options are not offered by this show")

    # A floor on a line the show requires (migration 128), checked against the
    # whole booking rather than line by line. A range check on the lines that
    # were sent cannot see the one that was left out, and leaving it out is the
    # easiest way to book none of something -- so "at least four bags" would
    # have been satisfied by sending no bags at all.
    #
    # Zero is not an escape hatch. A show sets this because it will not have
    # horses bedded on less, which is a statement about everybody who signs up;
    # a show that takes day-haul entries and does not want to charge them for
    # bedding leaves the minimum unset and says so in the fee's notes.
    requested = {item.show_fee_id: item.quantity for item in body.reservations}
    for fee in fees_by_id.values():
        floor = fee.min_quantity or 0
        if floor and requested.get(fee.id, 0) < floor:
            raise HTTPException(
                422,
                {
                    "code": "BELOW_MINIMUM_QUANTITY",
                    "message": (
                        f"This show requires at least {floor} of {fee.label}."
                    ),
                    "show_fee_id": str(fee.id),
                    "min_quantity": floor,
                },
            )

    show_entry = await _load_show_entry(show_id, exhibitor.id, db)
    if show_entry is None:
        show_entry = ShowEntry(show_id=show_id, exhibitor_id=exhibitor.id)
        # Initialize the collection before the flush makes the row persistent:
        # assigning to it afterwards would ask SQLAlchemy to diff against a
        # collection it has never loaded, which is a lazy load in an async
        # session (MissingGreenlet). The loaded path is safe because
        # _load_show_entry selectinloads it.
        show_entry.reservations = []
        db.add(show_entry)
        await db.flush()

    show_entry.registered_at = show_entry.registered_at or func.now()
    # Signing up again is the way back in after a cancellation — the same call,
    # the same row, so a back number and any payment history survive it.
    show_entry.cancelled_at = None
    show_entry.cancelled_by_user_id = None
    show_entry.cancellation_reason = None
    show_entry.arrival_date = body.arrival_date
    show_entry.departure_date = body.departure_date
    show_entry.registration_notes = body.notes
    show_entry.stall_request = body.stall_request

    wanted = {
        item.show_fee_id: item.quantity for item in body.reservations if item.quantity > 0
    }
    existing_by_fee = {r.show_fee_id: r for r in (show_entry.reservations or [])}
    for fee_id, quantity in wanted.items():
        row = existing_by_fee.get(fee_id)
        if row is None:
            # Set here rather than left to the column default: an unset
            # server-default column comes back expired after the INSERT, and
            # reading it below would be a lazy load in an async session.
            show_entry.reservations.append(
                ShowEntryReservation(
                    show_fee_id=fee_id, quantity=quantity, reserved_at=date.today()
                )
            )
        else:
            row.quantity = quantity
    for fee_id, row in existing_by_fee.items():
        if fee_id not in wanted:
            # delete-orphan on the relationship turns this into a DELETE.
            show_entry.reservations.remove(row)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "You have already signed up for this show")

    show_entry = await _load_show_entry(show_id, exhibitor.id, db)
    reservation_total = sum(
        fee_rate_cents(fees_by_id[r.show_fee_id], r.reserved_at) * r.quantity
        for r in (show_entry.reservations or [])
        if r.show_fee_id in fees_by_id
    )
    return {
        "signup": _signup_out(show_entry),
        "reservation_total_cents": reservation_total,
    }


class CancelSignupBody(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


@router.delete("/signup")
async def cancel_signup(
    show_id: UUID,
    body: CancelSignupBody = CancelSignupBody(),
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Cancel your own registration, up to a fortnight before the show.

    Inside the notice window this returns `CANCELLATION_WINDOW_CLOSED` and the
    exhibitor telephones the office, which cancels from the desk. The cut-off
    is not caution about mis-clicks — it is that by two weeks out the stall
    chart is drawn, the entries are in the program and somebody has to decide
    what happens to the money, and none of those are decisions the person
    leaving gets to make on their own.

    Not a DELETE of the row. See `cancellations.cancel_registration` for what
    goes and what stays, and migration 126 for why the row survives.
    """
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")

    user_uuid = safe_uuid(x_user_id)
    show = await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(user_uuid, db)

    show_entry = await db.execute(
        select(ShowEntry)
        .options(
            selectinload(ShowEntry.reservations),
            selectinload(ShowEntry.side_pot_entries),
        )
        .where(ShowEntry.show_id == show_id, ShowEntry.exhibitor_id == exhibitor.id)
    )
    show_entry = show_entry.scalar_one_or_none()
    if not is_on_roster(show_entry):
        raise HTTPException(404, "You are not registered for this show")

    if not may_self_cancel(show.start_date):
        window = cancellation_window(show.start_date)
        raise HTTPException(
            409,
            {
                "code": "CANCELLATION_WINDOW_CLOSED",
                "message": (
                    f"This show starts in {window['days_until_show']} days. "
                    f"Inside {window['notice_days']} days the show office has "
                    "to cancel a registration — message them and they will "
                    "take it off."
                ),
                "cancellation": {
                    "notice_days": window["notice_days"],
                    "deadline": window["deadline"].isoformat()
                    if window["deadline"]
                    else None,
                    "days_until_show": window["days_until_show"],
                },
            },
        )

    try:
        await cancel_registration(show_entry, show_id, user_uuid, body.reason, db)
    except CancellationBlocked as blocked:
        raise HTTPException(409, {"code": blocked.code, "message": blocked.message}) from None

    return {"cancelled": True, "show_id": str(show_id)}


# ── How this exhibitor may show this horse ────────────────────────────────────
#
# APHA's ownership rule (AM-300.E, YP-015) needs the exhibitor's relationship to
# the horse's owner on every Amateur and Youth entry. It was asked on the entry
# form, per class, from a list of twenty-five -- so entering eight classes on
# your own horse meant answering "Self" eight times, and answering it
# differently on the eighth was a data error nothing would catch.
#
# It is a fact about the person and the horse, not about the class. Asked once
# on the wizard's horses step and copied onto every entry from there.

class HorseRelationshipBody(BaseModel):
    relationship_to_owner: Optional[str] = Field(default=None, max_length=200)


@router.put("/horses/{horse_id}/relationship")
async def set_horse_relationship(
    show_id: UUID,
    horse_id: UUID,
    body: HorseRelationshipBody,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Record how the caller is entitled to show one of their own horses.

    Scoped to the caller's own profile, not to the show -- the show is only in
    the path because this is where the question gets asked, the same way the
    profile checklist is served from this router. The value it writes is read
    back by every entry the caller makes, at this show and any other.

    The horse must already be on their profile. That is what makes upserting
    the `exhibitor_horses` row safe: a horse reaches a profile either through
    that table or through `horses.created_by_exhibitor_id`, and creating the
    link row for the second kind asserts nothing that was not already true.
    """
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")

    await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(safe_uuid(x_user_id), db)

    if horse_id not in await _exhibitor_horse_ids(exhibitor.id, db):
        raise HTTPException(404, "That horse is not on your profile.")

    value = (body.relationship_to_owner or "").strip() or None
    if value is not None and value not in RELATIONSHIP_OPTIONS:
        # Checked against the same list the picker offers, for the reason a
        # paperwork verification never takes its value from the client: the
        # relationship goes onto an entry APHA reads, and free text there is a
        # relationship nobody can report against.
        raise HTTPException(422, "That is not one of the recognised relationships.")

    result = await db.execute(
        select(ExhibitorHorse).where(
            ExhibitorHorse.exhibitor_id == exhibitor.id,
            ExhibitorHorse.horse_id == horse_id,
        )
    )
    link = result.scalar_one_or_none()
    if link is None:
        link = ExhibitorHorse(exhibitor_id=exhibitor.id, horse_id=horse_id)
        db.add(link)
    link.relationship_to_owner = value
    await db.commit()

    return {"horse_id": str(horse_id), "relationship_to_owner": value}


# ── Back number ──────────────────────────────────────────────

class BackNumberRequestBody(BaseModel):
    """`null` clears the request. Bounded because a back number is worn on a
    person's back — four digits is already generous for a cloth number."""

    preferred_back_number: Optional[int] = Field(default=None, ge=1, le=9999)


def _back_number_taken(wanted: int) -> HTTPException:
    return HTTPException(
        409,
        {
            "code": "BACK_NUMBER_TAKEN",
            "message": (
                f"Back number {wanted} is already taken at this show. "
                "Pick a different one."
            ),
        },
    )


@router.put("/back-number")
async def request_back_number(
    show_id: UUID,
    body: BackNumberRequestBody,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Ask for a back number, and get it when nothing else at the show holds it.

    This grants outright rather than queueing a request for the office to
    approve. A number nobody else wants is not a decision anyone needs to make,
    and a "preference" that still leaves the exhibitor waiting on a secretary
    is the workflow this replaces, with an extra table. The office keeps every
    power it had: the desk can renumber anyone, and `preferred_back_number`
    survives that so staff can still see what was asked for.

    Only while the show is PUBLISHED. `_load_published_show_or_403` closes this
    the moment the show goes ACTIVE, which is the right boundary — by then
    numbers are printed, hanging on backs, and written on the judge's cards.

    Clearing (`null`) drops the *wish*, never the number already issued. Giving
    a number back is not something anyone asks for at a horse show, and
    releasing an assignment the office may have made independently would be a
    surprising thing for an empty text box to do.
    """
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")

    show = await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(safe_uuid(x_user_id), db)

    show_entry = await _load_show_entry(show.id, exhibitor.id, db)
    if not is_on_roster(show_entry):
        raise HTTPException(
            409,
            {
                "code": "SHOW_SIGNUP_REQUIRED",
                "message": (
                    "Sign up for this show before choosing a back number."
                ),
            },
        )

    wanted = body.preferred_back_number

    if wanted is not None and wanted != show_entry.back_number:
        # Checked before writing so the common collision gets a message naming
        # the number, rather than an IntegrityError we can only report vaguely.
        # The constraint is still what makes it safe — see the except below.
        clash = await db.execute(
            select(ShowEntry.id).where(
                ShowEntry.show_id == show.id,
                ShowEntry.back_number == wanted,
                ShowEntry.id != show_entry.id,
            )
        )
        if clash.first() is not None:
            raise _back_number_taken(wanted)

    show_entry.preferred_back_number = wanted
    if wanted is not None:
        show_entry.back_number = wanted

    try:
        await db.commit()
    except IntegrityError:
        # Two exhibitors asking for the same free number in the same instant.
        # The unique constraint on (show_id, back_number) is the real guard,
        # and this is it firing. Only reachable when a number was written:
        # clearing the wish touches no constrained column.
        await db.rollback()
        raise _back_number_taken(wanted) from None

    show_entry = await _load_show_entry(show.id, exhibitor.id, db)
    return {"signup": _signup_out(show_entry)}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/preview")
async def preview_registration(
    show_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Return the published-show classes the caller can register for, along
    with the horses on their exhibitor profile and existing entries.

    The frontend uses this to render the registration form: a horse picker per
    class, with already-entered (class, horse) combinations preselected.
    """
    show = await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(safe_uuid(user_id), db)
    is_apha = bool(show.show_type and show.show_type.code == "APHA")
    # The bodies this show runs under. The same list the membership checklist
    # is built from, so the exhibitor's card and the horse's papers are judged
    # against one set of associations rather than two that can drift apart.
    show_associations = await _show_associations(show, db)

    classes_result = await db.execute(
        select(Class)
        .options(
            selectinload(Class.associations).selectinload(ClassAssociation.show_type),
            # The bracket, which is what says which APHA divisions this class is
            # actually run for. Eager-loaded because the payload below reads it
            # per class, and a lazy relationship in an async request is a
            # MissingGreenlet rather than a slow query.
            selectinload(Class.division),
        )
        .where(Class.show_id == show_id, Class.status != "CLOSED")
        .order_by(Class.class_date, Class.sort_order.nullslast(), Class.class_number)
    )
    classes = classes_result.scalars().all()

    horse_ids = await _exhibitor_horse_ids(exhibitor.id, db)
    horses: list[Horse] = []
    # Advisory only. This used to decide whether the horse could be entered at
    # all; it now tells the exhibitor what to sort out before they ship in, and
    # the same evaluation reaches the show office through the desk and
    # `GET /shows/{id}/health-flags` so staff can chase it. Shared with the
    # office so the two can never disagree about a horse — same documents, same
    # requirements, same deadline.
    health_by_horse_id: dict[UUID, list[dict]] = {}
    registrations_by_horse: dict[UUID, list] = {}
    relationship_by_horse: dict[UUID, Optional[str]] = {}
    if horse_ids:
        horses_result = await db.execute(
            select(Horse).where(Horse.id.in_(horse_ids)).order_by(Horse.name)
        )
        horses = horses_result.scalars().all()
        health_by_horse_id = await health_by_horse(list(horse_ids), show, db)

        # Which associations each horse holds papers with. One query for every
        # horse rather than a relationship read per horse, and it feeds two
        # things at once: what the picker prints beside a horse, and the
        # warnings `horse_registration_flags` derives from the gap between that
        # and what the show runs under.
        reg_rows = await db.execute(
            select(HorseRegistration)
            .options(selectinload(HorseRegistration.association))
            .where(HorseRegistration.horse_id.in_(horse_ids))
        )
        for row in reg_rows.scalars().all():
            registrations_by_horse.setdefault(row.horse_id, []).append(row)

        # How this exhibitor is entitled to show each horse (migration 128).
        # Answered once on the horses step and copied onto every entry, so the
        # class form never asks -- see `_relationship_for_horse`.
        link_rows = await db.execute(
            select(ExhibitorHorse.horse_id, ExhibitorHorse.relationship_to_owner).where(
                ExhibitorHorse.exhibitor_id == exhibitor.id,
                ExhibitorHorse.horse_id.in_(horse_ids),
            )
        )
        relationship_by_horse = {
            horse_id: relationship for horse_id, relationship in link_rows.all()
        }

    # `class_` and `horse` come along because `build_bill` reads both. The
    # screen's entered-class table *is* the bill's class lines, so the fee shown
    # beside a class is the fee the office will collect. Not filtered to open
    # classes: a class that closed after the entry went in is still owed for,
    # and dropping it here would quietly shrink the total.
    existing_result = await db.execute(
        select(Entry)
        .join(Class, Entry.class_id == Class.id)
        .options(selectinload(Entry.class_), selectinload(Entry.horse))
        .where(Class.show_id == show_id, Entry.exhibitor_id == exhibitor.id)
    )
    existing = existing_result.scalars().all()

    show_entry = await _load_show_entry(show_id, exhibitor.id, db)

    return {
        # Null until show sign-up is done. The screen reads this to send the
        # exhibitor to sign-up first rather than letting them fill in a class
        # picker the POST would reject.
        "signup": _signup_out(show_entry),
        # Step one. The screen locks the stalls half on this, the same way it
        # locks the classes half on `signup` — and `PUT /signup` refuses on the
        # identical list, so the lock and the refusal cannot disagree.
        "profile": await _profile_status(show, exhibitor, db),
        # Whether cancelling is still the exhibitor's to do, and by when.
        "cancellation": cancellation_window(show.start_date),
        "show": {
            "id": str(show.id),
            "name": show.name,
            "status": show.status,
            "start_date": show.start_date,
            "end_date": show.end_date,
            "show_type_code": show.show_type.code if show.show_type else None,
            "office_charge_cents": show.office_charge_cents,
            "office_charge_basis": show.office_charge_basis,
        },
        "exhibitor": {
            "id": str(exhibitor.id),
            "full_name": exhibitor.full_name,
        },
        "classes": [
            {
                "id": str(c.id),
                "class_number": c.class_number,
                "class_name": c.class_name,
                "class_date": c.class_date,
                # The screen needs this to know where a second horse is
                # allowed: a pattern class is judged run by run, so one
                # exhibitor may show two horses in it. Everything else is
                # once per exhibitor and the POST enforces that.
                "score_type": c.score_type,
                "entry_fee_cents": c.entry_fee_cents,
                # Which APHA divisions this class is actually run for, read off
                # its bracket. None means the class does not say, and every
                # division stays on offer -- see `divisions_for_bracket`, which
                # narrows and never assigns. Only sent at an APHA show, because
                # nowhere else asks the question.
                "apha_divisions": (
                    divisions_for_bracket(
                        c.division.name if c.division else None, c.class_name
                    )
                    if is_apha
                    else None
                ),
                # Which clubs sanction this class, and what that adds to the
                # entry — not every class at a sanctioned show carries a
                # sanction fee (migration 113).
                "sanctioning_codes": [
                    row.association.code
                    for row in (c.sanctioning or [])
                    if row.association is not None
                ],
                "sanction_cents": _class_sanction_cents(show, c),
            }
            for c in classes
        ],
        # `health` is a warning, never a gate: every horse on the profile can be
        # entered. The show office sees the same flags and follows up.
        "horses": [
            {
                "id": str(h.id),
                "name": h.name,
                # Only meaningful at an APHA show, where a Solid Paint-Bred
                # horse may not go in an Open division class — the same guard
                # the desk's entry form applies, so the two forms refuse the
                # same combination rather than one of them finding out later.
                "is_solid_paint_bred": h.is_solid_paint_bred,
                # What this horse is registered with, and what the show would
                # ask for that is not there. Warnings only: refusing the entry
                # would not register the horse, a number can be typed in from
                # the phone in somebody's hand, and whether the papers describe
                # this animal is a question only the desk can answer. Same
                # reasoning as health paperwork -- see `horse_eligibility.py`.
                "registrations": registration_codes(
                    registrations_by_horse.get(h.id, [])
                ),
                "registration_flags": horse_registration_flags(
                    h,
                    show_associations,
                    {
                        r.association_id
                        for r in registrations_by_horse.get(h.id, [])
                    },
                ),
                # How this exhibitor is entitled to show this horse. Derived
                # from ownership wherever it can be -- somebody showing their
                # own horse is "Self" and there is nothing to ask -- and only
                # stored for a horse somebody else owns, where no record
                # anywhere says how the two are related.
                "relationship_to_owner": effective_relationship(
                    h, exhibitor.id, relationship_by_horse.get(h.id)
                ),
                # True when the answer came from the horse's own record rather
                # than from an answer somebody typed. The screen states it
                # instead of offering a picker.
                "owns_horse": owns_horse(h, exhibitor.id),
                # Who the relationship is being asked *about*, so the question
                # names a person rather than "this horse's owner". Only the
                # free-text column: the owning exhibitor's own name would mean
                # a join to serve a label, and a horse whose owner has an
                # account is one the exhibitor was given access to by that
                # person, who they can therefore name themselves.
                "owner_name": h.owner_name,
                # `file_snapshot` is the desk's staleness bookkeeping and
                # means nothing to an exhibitor. The staff endpoints drop it via
                # their response_model; this one has none, so it is dropped here.
                "health": [
                    {k: v for k, v in check.items() if k != "file_snapshot"}
                    for check in health_by_horse_id.get(h.id, [])
                ],
            }
            for h in horses
        ],
        # Which (class, horse) pairs are already taken. Display comes from
        # `bill.class_lines`; this list is what the pickers filter against.
        "existing_entries": [
            {
                "id": str(e.id),
                "class_id": str(e.class_id),
                "horse_id": str(e.horse_id) if e.horse_id else None,
            }
            for e in existing
        ],
        # What this show costs so far, straight from `billing.build_bill` — the
        # same call behind the My Shows bill and the office's account screen.
        # Entries commit one at a time now, so there is always a real bill to
        # quote; the batch form this replaced had to add the fees up in the
        # browser, which is the disagreement billing.py exists to prevent.
        "bill": build_bill(
            show,
            existing,
            show_entry.reservations if show_entry else [],
            await load_billable_futurities(
                show_id, [show_entry.id] if show_entry else [], db
            ),
        ),
    }


@router.post("/", response_model=ShowRegistrationResult, status_code=201)
async def register_for_show(
    show_id: UUID,
    body: ShowRegistrationCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")

    user_uuid = safe_uuid(x_user_id)
    show = await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(user_uuid, db)

    # Verify each horse belongs to this exhibitor before we touch the DB.
    requested_horse_ids = {item.horse_id for item in body.entries}
    allowed_horse_ids = await _exhibitor_horse_ids(exhibitor.id, db)
    not_yours = requested_horse_ids - allowed_horse_ids
    if not_yours:
        raise HTTPException(
            403,
            "One or more horses are not on your profile. Add them to your "
            "profile first before registering.",
        )

    # Resolve classes once, with association data for validation rules.
    requested_class_ids = {item.class_id for item in body.entries}
    classes_result = await db.execute(
        select(Class)
        .options(
            selectinload(Class.associations).selectinload(ClassAssociation.show_type)
        )
        .where(Class.id.in_(requested_class_ids))
    )
    classes_by_id = {c.id: c for c in classes_result.scalars().all()}
    for class_id in requested_class_ids:
        cls = classes_by_id.get(class_id)
        if not cls or cls.show_id != show_id:
            raise HTTPException(400, "One or more classes do not belong to this show")
        if cls.status == "CLOSED":
            raise HTTPException(
                400,
                f"Class {cls.class_number} ({cls.class_name}) is closed and not "
                "accepting entries.",
            )

    # Sign-up comes first. A missing (or unfinished) show_entries row means the
    # office has no stall/shavings/camping numbers for this exhibitor, so we
    # refuse rather than quietly creating the shell row this used to create.
    show_entry = await _load_show_entry(show_id, exhibitor.id, db)
    if not is_on_roster(show_entry):
        raise HTTPException(
            409,
            {
                "code": "SHOW_SIGNUP_REQUIRED",
                "message": (
                    "Sign up for this show before entering classes — the office "
                    "needs your stall, shavings, and camping numbers first."
                ),
            },
        )

    # Eager-load horse registration data once per requested horse so the rules
    # engine can read it without lazy loads.
    horses_result = await db.execute(
        select(Horse)
        .options(selectinload(Horse.registrations))
        .where(Horse.id.in_(requested_horse_ids))
    )
    horses_by_id = {h.id: h for h in horses_result.scalars().all()}

    # How this exhibitor is entitled to show each horse. Derived from ownership
    # where it can be -- almost every entry ever made is somebody showing their
    # own horse, and `horses.owner_exhibitor_id` already says so -- and read
    # from `exhibitor_horses` where it cannot, which is only a horse somebody
    # else owns. The entry form used to ask this per class from a list of
    # twenty-five, so entering eight classes on your own horse meant answering
    # "Self" eight times and could produce a different answer on the eighth.
    # A value on the request still wins, because the show office's own entry
    # form legitimately types one in for a walk-up.
    relationship_rows = await db.execute(
        select(ExhibitorHorse.horse_id, ExhibitorHorse.relationship_to_owner).where(
            ExhibitorHorse.exhibitor_id == exhibitor.id,
            ExhibitorHorse.horse_id.in_(requested_horse_ids),
        )
    )
    relationship_by_horse = {
        horse_id: relationship for horse_id, relationship in relationship_rows.all()
    }

    rules = get_rules(show.show_type.code if show.show_type else None)

    # APHA's horse caps and its Walk-Trot shared-horse rule are about the
    # exhibitor's *other* entries at this show, which one entry cannot answer.
    # Built once for the whole request rather than per class, and added to as the
    # batch goes so entries submitted together count against each other.
    shared_context: dict = {}
    if show.show_type and show.show_type.code == "APHA":
        shared_context = await apha_entry_context(show.id, db)

    # Pull all of this exhibitor's existing entries for the requested classes
    # so we can pre-check "exhibitor already in this non-pattern class" rules
    # and reject duplicates inside the submitted batch too.
    existing_entries_result = await db.execute(
        select(Entry.class_id).where(
            Entry.exhibitor_id == exhibitor.id,
            Entry.class_id.in_(requested_class_ids),
        )
    )
    existing_non_pattern_classes: set[UUID] = {
        cid for (cid,) in existing_entries_result.all()
        if classes_by_id[cid].score_type != "pattern"
    }
    batch_non_pattern_classes: set[UUID] = set()

    created: list[Entry] = []
    fee_breakdown: list[FeeBreakdownItem] = []
    subtotal = 0
    sanction_total = 0
    horses_charged: set[UUID] = set()

    for item in body.entries:
        cls = classes_by_id[item.class_id]
        horse = horses_by_id.get(item.horse_id)
        if not horse:
            raise HTTPException(404, "Horse not found")

        if cls.score_type != "pattern":
            if cls.id in existing_non_pattern_classes or cls.id in batch_non_pattern_classes:
                raise HTTPException(
                    409,
                    f"You can only enter class {cls.class_number} "
                    f"({cls.class_name}) once.",
                )
            batch_non_pattern_classes.add(cls.id)

        entry = Entry(
            class_id=item.class_id,
            exhibitor_id=exhibitor.id,
            horse_id=item.horse_id,
            # Explicit, not left to the column default: that default is applied
            # at flush, and validate_entry runs before this is ever flushed. An
            # unset status reads as None and short-circuits every association
            # rule, silently skipping validation.
            status="ENTERED",
            apha_division=item.apha_division,
            relationship_to_owner=(
                item.relationship_to_owner
                or effective_relationship(
                    horse, exhibitor.id, relationship_by_horse.get(item.horse_id)
                )
            ),
        )
        # Wire relationships so validate_entry can read them without lazy loads.
        entry.class_ = cls
        entry.horse = horse
        entry.exhibitor = exhibitor
        # Same as the desk path: assigned before validation so the rules engine
        # sees the declaration on an entry that has not been flushed, and before
        # commit so the cascade writes it.
        entry.attestations = await build_attestations(item.attestations, x_user_id, db)

        issues = rules.validate_entry(
            entry,
            show,
            cls,
            await _association_validation_context(show, cls, db, shared_context),
        )
        errors = [i for i in issues if i.get("severity") == "error"]
        if errors:
            raise HTTPException(
                422,
                {
                    "code": "ASSOCIATION_VALIDATION_FAILED",
                    "message": (
                        f"Entry for class {cls.class_number} ({cls.class_name}) "
                        "fails validation"
                    ),
                    "issues": issues,
                },
            )

        db.add(entry)
        created.append(entry)
        # Count this one against the rest of the batch. Nothing is flushed until
        # the end, so without this six horses submitted in one request would each
        # be validated against a show that has none of the other five in it.
        if "apha_entries" in shared_context:
            shared_context["apha_entries"].append(SimpleNamespace(
                id=entry.id,
                exhibitor_id=exhibitor.id,
                horse_id=item.horse_id,
                class_id=item.class_id,
                apha_division=item.apha_division,
            ))
        sanction_cents = _class_sanction_cents(show, cls)
        fee_breakdown.append(
            FeeBreakdownItem(
                class_id=cls.id,
                class_number=cls.class_number,
                class_name=cls.class_name,
                fee_cents=cls.entry_fee_cents,
                sanction_cents=sanction_cents,
            )
        )
        subtotal += cls.entry_fee_cents
        sanction_total += sanction_cents
        horses_charged.add(item.horse_id)

    office_charge_total = office_charge_total_cents(show, len(horses_charged), bool(created))
    total_fee = subtotal + sanction_total + office_charge_total

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        msg = str(exc.orig) if exc.orig is not None else ""
        if "entries_class_horse_uniq" in msg:
            raise HTTPException(
                409,
                "One of the selected horses is already entered in that class.",
            )
        raise HTTPException(
            409,
            "One or more selections conflict with an existing entry.",
        )

    for entry in created:
        await db.refresh(entry)

    return ShowRegistrationResult(
        show_entry_id=show_entry.id,
        created_entries=[EntryOut.model_validate(e) for e in created],
        fee_breakdown=fee_breakdown,
        subtotal_fee_cents=subtotal,
        sanction_total_cents=sanction_total,
        office_charge_total_cents=office_charge_total,
        total_fee_cents=total_fee,
    )


@router.delete("/entries/{entry_id}", status_code=204)
async def withdraw_entry(
    show_id: UUID,
    entry_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Exhibitor-self withdraw of a single entry.

    Allowed while the show is PUBLISHED and the calling user owns the entry's
    exhibitor profile. Blocked once a result has been recorded — at that point
    the secretary handles edits through the admin flow.
    """
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")

    await _load_published_show_or_403(show_id, db)  # asserts PUBLISHED status
    exhibitor = await _load_exhibitor_for_user(safe_uuid(x_user_id), db)

    entry_result = await db.execute(
        select(Entry)
        .options(selectinload(Entry.class_))
        .where(Entry.id == entry_id)
    )
    entry = entry_result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Entry not found")
    if entry.exhibitor_id != exhibitor.id:
        raise HTTPException(403, "You can only withdraw your own entries")
    if not entry.class_ or entry.class_.show_id != show_id:
        raise HTTPException(404, "Entry not found in this show")

    # Defensive: results shouldn't exist during PUBLISHED, but if a class was
    # scored before being reverted, refuse to silently wipe historical results.
    result_exists = await db.execute(
        select(Result.id).where(Result.entry_id == entry_id).limit(1)
    )
    if result_exists.scalar_one_or_none():
        raise HTTPException(
            409,
            "This entry already has a result recorded and cannot be withdrawn. "
            "Contact the show secretary.",
        )

    await db.delete(entry)
    await db.commit()


# ── Futurities, exhibitor side ────────────────────────────────────────────────
#
# The office manages a futurity at /admin/shows/{id}/futurities. These three
# endpoints are the exhibitor's own door into the same tables: which futurities
# the show runs, which of their horses are in one, and enrolling or withdrawing
# a horse they own.
#
# Deliberately narrower than the staff endpoints. An exhibitor may only enroll a
# horse on their own profile, only against their own `show_entries` row, and
# only while the show is PUBLISHED — after that the numbers are printed and the
# office takes over, exactly as with class entries.


async def _load_futurity_for_show(show_id: UUID, futurity_id: UUID, db: AsyncSession):
    result = await db.execute(
        select(Futurity)
        .where(Futurity.id == futurity_id, Futurity.show_id == show_id)
        .options(
            selectinload(Futurity.fee_tiers),
            selectinload(Futurity.membership_options),
            selectinload(Futurity.futurity_classes),
        )
    )
    futurity = result.scalar_one_or_none()
    if not futurity:
        raise HTTPException(404, "Futurity not found")
    return futurity


@router.get("/futurities")
async def list_futurities_for_exhibitor(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The show's futurities, with the caller's own enrollments marked.

    Not status-gated on read: somebody who entered while the show was PUBLISHED
    still needs to see what they entered once it goes ACTIVE. Writing is gated
    below.
    """
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    exhibitor = await _load_exhibitor_for_user(safe_uuid(x_user_id), db)
    show_entry = await _load_show_entry(show_id, exhibitor.id, db)

    futurities = (
        await db.execute(
            select(Futurity)
            .where(Futurity.show_id == show_id)
            .options(
                selectinload(Futurity.fee_tiers),
                selectinload(Futurity.membership_options),
                selectinload(Futurity.futurity_classes).selectinload(FuturityClass.class_),
            )
            .order_by(Futurity.created_at)
        )
    ).scalars().all()
    if not futurities:
        return []

    mine = []
    if show_entry is not None:
        mine = (
            await db.execute(
                select(FuturityEntry)
                .where(
                    FuturityEntry.show_entry_id == show_entry.id,
                    FuturityEntry.futurity_id.in_([f.id for f in futurities]),
                )
                .options(
                    selectinload(FuturityEntry.horse),
                    selectinload(FuturityEntry.fee_tier),
                    selectinload(FuturityEntry.membership_option),
                )
            )
        ).scalars().all()

    by_futurity: dict[UUID, list] = {}
    for enrollment in mine:
        by_futurity.setdefault(enrollment.futurity_id, []).append(enrollment)

    today = date.today()
    return [
        {
            "id": str(f.id),
            "name": f.name,
            "description": f.description,
            "entry_deadline": f.entry_deadline,
            "entry_deadline_time": (
                f.entry_deadline_time.isoformat() if f.entry_deadline_time else None
            ),
            "entry_deadline_timezone": f.entry_deadline_timezone,
            "late_fee_cents": f.late_fee_cents,
            "office_fee_member_cents": f.office_fee_member_cents,
            "office_fee_nonmember_cents": f.office_fee_nonmember_cents,
            # The words on the entry form. An exhibitor entering here is filling
            # in the same form the show prints, so it has to say the same things
            # — which categories exist, what is won, what happens to the money.
            "entry_instructions": f.entry_instructions,
            "award_notice": f.award_notice,
            "rules_notice": f.rules_notice,
            "refund_policy": f.refund_policy,
            "requires_horse_pedigree": f.requires_horse_pedigree,
            # Quoted, so the screen can warn before someone enters rather than
            # after the bill arrives. What an existing enrollment is actually
            # charged is settled by its own `entered_at`.
            "is_past_deadline": f.entry_deadline is not None and today > f.entry_deadline,
            "classes": [
                {
                    "class_id": str(fc.class_id),
                    "class_number": fc.class_.class_number if fc.class_ else None,
                    "class_name": fc.class_.class_name if fc.class_ else None,
                }
                for fc in f.futurity_classes
                if fc.class_ is not None
            ],
            "fee_tiers": [
                {
                    "id": str(t.id),
                    "name": t.name,
                    "description": t.description,
                    "amount_cents": t.amount_cents,
                }
                for t in sorted(f.fee_tiers, key=lambda t: (t.sort_order, t.name))
            ],
            "membership_options": [
                {
                    "id": str(m.id),
                    "name": m.name,
                    "description": m.description,
                    "amount_cents": m.amount_cents,
                }
                for m in sorted(
                    f.membership_options, key=lambda m: (m.sort_order, m.name)
                )
            ],
            "my_entries": [
                {
                    "id": str(e.id),
                    "horse_id": str(e.horse_id) if e.horse_id else None,
                    "horse_name": e.horse.name if e.horse else None,
                    "fee_tier_id": str(e.fee_tier_id) if e.fee_tier_id else None,
                    "fee_tier_name": e.fee_tier.name if e.fee_tier else None,
                    "membership_option_id": (
                        str(e.membership_option_id) if e.membership_option_id else None
                    ),
                    "membership_option_name": (
                        e.membership_option.name if e.membership_option else None
                    ),
                    "is_member": e.is_member,
                    "shown_by_name": e.shown_by_name,
                    "entered_at": e.entered_at,
                }
                for e in by_futurity.get(f.id, [])
            ],
        }
        for f in futurities
    ]


class FuturityEnrollRequest(BaseModel):
    futurity_id: UUID
    horse_id: UUID
    fee_tier_id: Optional[UUID] = None
    membership_option_id: Optional[UUID] = None
    is_member: bool = False
    shown_by_name: Optional[str] = None


@router.post("/futurities", status_code=201)
async def enroll_in_futurity(
    show_id: UUID,
    body: FuturityEnrollRequest,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Enroll one of the caller's own horses in a futurity."""
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")

    await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(safe_uuid(x_user_id), db)

    show_entry = await _load_show_entry(show_id, exhibitor.id, db)
    # Same rule as class self-registration: sign-up is what creates the roster
    # row a back number, a pot entry and now a futurity entry all hang off.
    if not is_on_roster(show_entry):
        raise HTTPException(409, "SHOW_SIGNUP_REQUIRED")

    futurity = await _load_futurity_for_show(show_id, body.futurity_id, db)

    if body.horse_id not in await _exhibitor_horse_ids(exhibitor.id, db):
        raise HTTPException(403, "You can only enter a horse on your own profile")

    if futurity.fee_tiers:
        if body.fee_tier_id is None:
            raise HTTPException(422, "Pick an entry category.")
        if not any(t.id == body.fee_tier_id for t in futurity.fee_tiers):
            raise HTTPException(422, "That category does not belong to this futurity.")

    if body.membership_option_id is not None and not any(
        m.id == body.membership_option_id for m in futurity.membership_options
    ):
        raise HTTPException(422, "That membership does not belong to this futurity.")

    # The entry form asks for foaling date, sire and dam, and a futurity judged
    # in age divisions cannot do without them. Refused here and only here: the
    # values live on a horse record this caller owns and can fix in a minute,
    # where the office taking a paper entry across the counter has no such
    # option and gets the same shortfall reported as a flag instead.
    horse = await db.get(Horse, body.horse_id)
    missing = missing_horse_details(futurity, horse)
    if missing:
        raise HTTPException(
            422,
            f"This futurity needs the horse's {', '.join(missing)}. Add "
            "it on the horse's profile, then enter.",
        )

    clash = (
        await db.execute(
            select(FuturityEntry.id).where(
                FuturityEntry.futurity_id == futurity.id,
                FuturityEntry.horse_id == body.horse_id,
            )
        )
    ).scalars().first()
    if clash:
        raise HTTPException(409, "That horse is already entered in this futurity.")

    enrollment = FuturityEntry(
        futurity_id=futurity.id,
        show_entry_id=show_entry.id,
        horse_id=body.horse_id,
        fee_tier_id=body.fee_tier_id,
        membership_option_id=body.membership_option_id,
        is_member=body.is_member,
        shown_by_name=(body.shown_by_name or "").strip() or None,
        entered_at=date.today(),
    )
    db.add(enrollment)
    await db.commit()
    return {"id": str(enrollment.id)}


@router.delete("/futurities/{entry_id}", status_code=204)
async def withdraw_from_futurity(
    show_id: UUID,
    entry_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Withdraw one of the caller's own futurity enrollments."""
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")

    await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(safe_uuid(x_user_id), db)
    show_entry = await _load_show_entry(show_id, exhibitor.id, db)
    if show_entry is None:
        raise HTTPException(404, "Futurity entry not found")

    enrollment = await db.get(FuturityEntry, entry_id)
    if enrollment is None or enrollment.show_entry_id != show_entry.id:
        raise HTTPException(404, "Futurity entry not found")

    await db.delete(enrollment)
    await db.commit()
