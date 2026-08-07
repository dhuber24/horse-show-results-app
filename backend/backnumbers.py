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

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
