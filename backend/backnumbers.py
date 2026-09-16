"""Where a competitor's back number actually lives.

A back number is assigned once per exhibitor per show and stored on
`show_entries.back_number` — that is what the back-number screen writes and
what `ShowEntry`'s unique constraint protects. `entries.back_number` is an
older per-entry column that nothing writes any more; it survives only so
existing rows and the entry create/update payloads keep working.

Every read path that shows a back number therefore has to resolve it, and they
must all resolve it the same way: prefer the show-level number, fall back to
the legacy per-entry column. Reading `Entry.back_number` directly is the bug
this module exists to prevent — it is silently NULL for every entry created
since assignment moved to `show_entries`, so the screen shows a dash and
nobody sees an error.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from models import ShowEntry


async def back_numbers_for_show(show_id: UUID, db: AsyncSession) -> dict[UUID, int]:
    """exhibitor_id -> assigned back number, for one show.

    Exhibitors with no number assigned are absent rather than mapped to None,
    so `resolve_back_number` can tell "not assigned" from "assigned nothing".
    """
    rows = await db.execute(
        select(ShowEntry.exhibitor_id, ShowEntry.back_number).where(
            ShowEntry.show_id == show_id,
            ShowEntry.back_number.is_not(None),
        )
    )
    return {exhibitor_id: back_number for exhibitor_id, back_number in rows.all()}


def resolve_back_number(entry, by_exhibitor: dict[UUID, int]) -> int | None:
    """The number to display for one entry. Mirrors the same precedence the
    program index applies in `routers/shows.py`."""
    resolved = by_exhibitor.get(entry.exhibitor_id)
    return resolved if resolved is not None else entry.back_number


def sort_key(back_number: int | None) -> tuple[int, int]:
    """Ascending by back number, unassigned last."""
    return (1, 0) if back_number is None else (0, back_number)


def lowest_free_number(taken: set[int]) -> int:
    """The smallest back number from 1 that nothing in `taken` holds."""
    number = 1
    while number in taken:
        number += 1
    return number


async def assign_back_number_if_missing(
    show_entry: ShowEntry, db: AsyncSession, attempts: int = 5
) -> int | None:
    """Give a roster row the lowest free number, when it holds none.

    The exhibitor may ask for a number (`PUT .../register/back-number`) and the
    office may renumber anyone, but somebody who did neither used to reach the
    gate with no number at all -- the registration screen told them "leave it
    and one will be assigned", and nothing assigned one. This is that promise.

    Skips every number another row at the show holds **or has asked for**, so a
    sequential fill never takes a number somebody requested out from under
    them, which is the same courtesy `POST .../back-numbers/auto-assign` pays.

    Written with a Core UPDATE inside a savepoint, retried on the
    `(show_id, back_number)` unique constraint: two sign-ups landing in the same
    instant both compute the same lowest number, and the loser simply takes the
    next one. `WHERE back_number IS NULL` keeps a number the office assigned
    between the read and the write. The caller commits.

    Returns the number assigned, the one already held, or None when every
    attempt collided -- which leaves the row for the desk rather than failing
    the sign-up it rides on.
    """
    # Read from the database rather than off the instance: on a row created
    # earlier in this request the attribute may never have been loaded, and a
    # lazy load in an async session is a MissingGreenlet.
    show_id, show_entry_id = show_entry.show_id, show_entry.id
    for _ in range(attempts):
        rows = await db.execute(
            select(
                ShowEntry.id, ShowEntry.back_number, ShowEntry.preferred_back_number
            ).where(ShowEntry.show_id == show_id)
        )
        taken: set[int] = set()
        for row_id, held, asked_for in rows.all():
            if row_id == show_entry_id:
                if held is not None:
                    set_committed_value(show_entry, "back_number", held)
                    return held
                continue
            if held is not None:
                taken.add(held)
            if asked_for is not None:
                taken.add(asked_for)
        number = lowest_free_number(taken)
        try:
            async with db.begin_nested():
                result = await db.execute(
                    update(ShowEntry)
                    .where(ShowEntry.id == show_entry_id, ShowEntry.back_number.is_(None))
                    .values(back_number=number)
                    .execution_options(synchronize_session=False)
                )
        except IntegrityError:
            continue
        if result.rowcount == 0:
            # Somebody numbered this row in the meantime. Theirs stands.
            current = await db.execute(
                select(ShowEntry.back_number).where(ShowEntry.id == show_entry_id)
            )
            number = current.scalar_one_or_none()
        # Set on the loaded instance without marking it dirty: the session does
        # not expire on commit, so a later read of this row in the same request
        # would otherwise report the NULL it was loaded with.
        set_committed_value(show_entry, "back_number", number)
        return number
    return None
