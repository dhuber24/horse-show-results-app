"""Every show an exhibitor has been part of, with what it costs them.

Backs three surfaces from one query so they cannot drift:

  * **My Shows** — the current bill per show: class fees, NSBA sanction fees,
    the office charge, and the stalls/shavings/camping reserved at sign-up.
  * **My Show Entries** — the same shows, read for their classes and placings.
  * **Show History** on the profile — the past ones, linked back to the show.

A show appears here if the exhibitor signed up for it *or* has an entry in it.
Those are usually the same set, but a secretary adding a late entry by hand
creates the second without the first, and that show is still one the exhibitor
competed in.

Money is computed by `billing.build_bill`, shared with the registration screens,
so the total quoted at sign-up is the total shown here. The app never collects
payment — this is the show office's bill, reported back.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from billing import build_bill
from database import get_db
from dependencies import require_authenticated, safe_uuid
from models import (
    Class,
    Entry,
    Exhibitor,
    Result,
    Show,
    ShowEntry,
    ShowEntryReservation,
)

router = APIRouter(prefix="/my-shows", tags=["My Shows"])


@router.get("/")
async def list_my_shows(
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    exhibitor_result = await db.execute(
        select(Exhibitor).where(Exhibitor.user_id == safe_uuid(user_id))
    )
    exhibitor = exhibitor_result.scalar_one_or_none()
    if not exhibitor:
        # Not an exhibitor account — an empty list is the honest answer, and
        # keeps the page from 403-ing for staff who click through to it.
        return {"exhibitor": None, "shows": []}

    entries_result = await db.execute(
        select(Entry)
        .options(
            # venue_rel and sanctioning are both read below; a show reachable
            # only through an entry (staff-added, never signed up for) would
            # otherwise lazy-load them mid-serialization.
            selectinload(Entry.class_).selectinload(Class.show).selectinload(Show.sanctioning),
            selectinload(Entry.class_).selectinload(Class.show).selectinload(Show.venue_rel),
            selectinload(Entry.horse),
        )
        .join(Class, Entry.class_id == Class.id)
        .where(Entry.exhibitor_id == exhibitor.id)
        .order_by(Class.class_date, Class.sort_order.nullslast(), Class.class_number)
    )
    entries = list(entries_result.scalars().all())

    signups_result = await db.execute(
        select(ShowEntry)
        .options(
            selectinload(ShowEntry.show).selectinload(Show.sanctioning),
            selectinload(ShowEntry.show).selectinload(Show.venue_rel),
            selectinload(ShowEntry.reservations).selectinload(ShowEntryReservation.show_fee),
        )
        .where(ShowEntry.exhibitor_id == exhibitor.id)
    )
    signups = list(signups_result.scalars().all())

    # Placings, keyed by entry, so the history view can say how it went.
    entry_ids = [e.id for e in entries]
    results_by_entry: dict[UUID, Result] = {}
    if entry_ids:
        results_result = await db.execute(
            select(Result).where(Result.entry_id.in_(entry_ids))
        )
        for row in results_result.scalars().all():
            results_by_entry[row.entry_id] = row

    shows_by_id: dict[UUID, Show] = {}
    entries_by_show: dict[UUID, list[Entry]] = {}
    for entry in entries:
        cls = entry.class_
        if cls is None or cls.show is None:
            continue
        shows_by_id[cls.show_id] = cls.show
        entries_by_show.setdefault(cls.show_id, []).append(entry)

    signup_by_show: dict[UUID, ShowEntry] = {}
    for signup in signups:
        if signup.show is None:
            continue
        shows_by_id[signup.show_id] = signup.show
        signup_by_show[signup.show_id] = signup

    payload = []
    for show_id, show in shows_by_id.items():
        show_entries = entries_by_show.get(show_id, [])
        signup = signup_by_show.get(show_id)
        reservations = list(signup.reservations) if signup else []
        bill = build_bill(show, show_entries, reservations)

        placed = [
            results_by_entry[e.id]
            for e in show_entries
            if e.id in results_by_entry and results_by_entry[e.id].place is not None
        ]
        payload.append(
            {
                "show_id": str(show.id),
                "show_name": show.name,
                "show_status": show.status,
                "start_date": show.start_date,
                "end_date": show.end_date,
                "venue": show.venue_rel.name if show.venue_rel else None,
                "back_number": signup.back_number if signup else None,
                "registered_at": signup.registered_at if signup else None,
                "arrival_date": signup.arrival_date if signup else None,
                "departure_date": signup.departure_date if signup else None,
                "notes": signup.registration_notes if signup else None,
                "entry_count": len(show_entries),
                "placed_count": len(placed),
                "best_place": min((r.place for r in placed), default=None),
                "bill": bill,
            }
        )

    payload.sort(key=lambda s: (s["start_date"] or ""), reverse=True)
    return {
        "exhibitor": {"id": str(exhibitor.id), "full_name": exhibitor.full_name},
        "shows": payload,
    }


@router.get("/{show_id}")
async def my_standing_at_show(
    show_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Where the caller stands at one show: signed up, back number, classes in.

    What the show page needs to stop telling someone who has already signed up
    to sign up. Deliberately **not** status-scoped, unlike everything under
    `/shows/{id}/register`: those endpoints 403 once a show leaves PUBLISHED
    because they are about *changing* a registration, and this is about
    reporting one. "You are entered in 6 classes" is still the right thing to
    say on a show that has started.

    Always answers with a shape rather than 404-ing. A staff member or a
    signed-in visitor opening a show page is not an error, they simply have no
    standing at it — and the caller renders the same "not signed up" branch
    either way.
    """
    none_out = {
        "show_id": str(show_id),
        "signed_up": False,
        "registered_at": None,
        "back_number": None,
        "entry_count": 0,
        "arrival_date": None,
        "departure_date": None,
    }

    exhibitor_result = await db.execute(
        select(Exhibitor).where(Exhibitor.user_id == safe_uuid(user_id))
    )
    exhibitor = exhibitor_result.scalar_one_or_none()
    if not exhibitor:
        return none_out

    show_entry_result = await db.execute(
        select(ShowEntry).where(
            ShowEntry.show_id == show_id, ShowEntry.exhibitor_id == exhibitor.id
        )
    )
    show_entry = show_entry_result.scalar_one_or_none()

    count_result = await db.execute(
        select(func.count())
        .select_from(Entry)
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id, Entry.exhibitor_id == exhibitor.id)
    )

    return {
        "show_id": str(show_id),
        # A `show_entries` row with a NULL `registered_at` is the shell a
        # secretary creates while adding a late entry by hand — the office has
        # no stall or shavings numbers for this person, so they have not signed
        # up and the screen should still ask them to.
        "signed_up": bool(show_entry and show_entry.registered_at is not None),
        "registered_at": show_entry.registered_at if show_entry else None,
        "back_number": show_entry.back_number if show_entry else None,
        "entry_count": count_result.scalar_one(),
        "arrival_date": show_entry.arrival_date if show_entry else None,
        "departure_date": show_entry.departure_date if show_entry else None,
    }
