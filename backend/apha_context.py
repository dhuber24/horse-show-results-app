"""Show-wide facts APHA's entry limits need, gathered once per request.

`rules/apha.py` is pure — it reads attributes off whatever it is handed and
never touches a session — but three of its rules are about the exhibitor's
*other* entries at the same show:

  * SC-185.F — at most five horses across the individual working events.
  * SC-185.F.1 — at most two in Longe Line, and two in In-Hand Trail.
  * AM-300.H — one horse may not be shown by two Amateur Walk-Trot exhibitors
    in the same event.

None of that is answerable from one entry, so the routers build it here and pass
it in the validation context. Shared between the show desk and the exhibitor's
own class registration for the same reason the rules are: a limit enforced at
one door is not a limit.
"""
from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Class, Discipline, Division, Entry


async def apha_entry_context(show_id: UUID, db: AsyncSession) -> dict:
    """`apha_disciplines` and `apha_entries` for one show.

    Both are read whole rather than filtered to one exhibitor, because the
    Walk-Trot rule asks about a *horse* across exhibitors and the horse caps ask
    about an exhibitor across classes — two different slices of the same set. One
    query each beats a query per rule.

    Withdrawn entries are excluded: a scratched horse is not one somebody is
    showing, and counting it would refuse the entry that replaces it.
    """
    # The bracket rides along on the same query. YP-075 caps a youth exhibitor's
    # age by the division they entered, and a class bracketed "13 & Under" caps it
    # tighter still -- but `Class.division` is not eager-loaded at either entry
    # door, and reading an unloaded relationship inside the rules engine is a
    # MissingGreenlet in an async request. One extra column here beats an eager
    # load two routers have to remember.
    class_rows = await db.execute(
        select(Class.id, Discipline.name, Division.name)
        .outerjoin(Discipline, Discipline.id == Class.discipline_id)
        .outerjoin(Division, Division.id == Class.division_id)
        .where(Class.show_id == show_id)
    )
    disciplines = {}
    brackets = {}
    for class_id, discipline_name, bracket_name in class_rows.all():
        disciplines[class_id] = discipline_name
        brackets[class_id] = bracket_name

    entry_rows = await db.execute(
        select(
            Entry.id,
            Entry.exhibitor_id,
            Entry.horse_id,
            Entry.class_id,
            Entry.apha_division,
        )
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id, Entry.status != "WITHDRAWN")
    )
    entries = [
        SimpleNamespace(
            id=row.id,
            exhibitor_id=row.exhibitor_id,
            horse_id=row.horse_id,
            class_id=row.class_id,
            apha_division=row.apha_division,
        )
        for row in entry_rows.all()
    ]

    return {
        "apha_disciplines": disciplines,
        "apha_brackets": brackets,
        "apha_entries": entries,
    }
