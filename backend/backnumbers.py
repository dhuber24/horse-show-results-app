"""Where a competitor's back number actually lives.

A show numbers either its exhibitors or its horses (`shows.back_number_per`,
migration 161):

* **exhibitor** -- one number per exhibitor per show, on
  `show_entries.back_number` (unique per show). What every show did before
  migration 161, and still the default.
* **horse** -- one number per horse per show, on `show_horse_numbers`, as APHA
  SC-160.D requires. An exhibitor with three horses wears three numbers, and a
  horse shown by two exhibitors wears one.

`entries.back_number` is an older per-entry column that nothing writes any
more; it survives only so existing rows and the entry create/update payloads
keep working, and is the last fallback.

Every read path that shows a back number therefore has to resolve it, and they
must all resolve it the same way: load `back_numbers_for_show` once and ask it.
Reading `Entry.back_number` directly is the bug this module exists to prevent
-- it is silently NULL for every entry created since assignment moved to
`show_entries`, so the screen shows a dash and nobody sees an error. Reading
`ShowEntry.back_number` directly is the same bug at a horse-numbered show.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from models import Class, Entry, Show, ShowEntry, ShowHorseNumber

PER_EXHIBITOR = "exhibitor"
PER_HORSE = "horse"


@dataclass
class ShowBackNumbers:
    """Every back number at one show, answerable per entry or per exhibitor.

    Exhibitors and horses with no number assigned are absent rather than mapped
    to None, so a lookup can tell "not assigned" from "assigned nothing".
    """

    per_horse: bool = False
    by_exhibitor: dict[UUID, int] = field(default_factory=dict)
    by_horse: dict[UUID, int] = field(default_factory=dict)
    # horse_id -> the number asked for, where one was (horse-numbered shows).
    preferred_by_horse: dict[UUID, int] = field(default_factory=dict)
    # exhibitor_id -> the horses they have entered at this show. Only loaded at
    # a horse-numbered show, where it is what turns "this exhibitor's number"
    # into "this exhibitor's numbers".
    horses_by_exhibitor: dict[UUID, set[UUID]] = field(default_factory=dict)

    def resolve(
        self, exhibitor_id: UUID | None, horse_id: UUID | None, legacy: int | None = None
    ) -> int | None:
        """The number worn by this exhibitor on this horse."""
        if self.per_horse:
            resolved = self.by_horse.get(horse_id) if horse_id is not None else None
        else:
            resolved = self.by_exhibitor.get(exhibitor_id) if exhibitor_id is not None else None
        return resolved if resolved is not None else legacy

    def for_entry(self, entry) -> int | None:
        return self.resolve(entry.exhibitor_id, entry.horse_id, entry.back_number)

    def for_exhibitor(self, exhibitor_id: UUID | None) -> list[int]:
        """Every number this exhibitor wears at the show, lowest first: one at
        most at an exhibitor-numbered show, one per numbered horse otherwise."""
        if exhibitor_id is None:
            return []
        if not self.per_horse:
            number = self.by_exhibitor.get(exhibitor_id)
            return [] if number is None else [number]
        return sorted(
            self.by_horse[h]
            for h in self.horses_by_exhibitor.get(exhibitor_id, ())
            if h in self.by_horse
        )

    def first_for_exhibitor(self, exhibitor_id: UUID | None) -> int | None:
        """The lowest number an exhibitor wears -- for sorting an exhibitor-level
        list, and for the screens with room for one number only."""
        numbers = self.for_exhibitor(exhibitor_id)
        return numbers[0] if numbers else None

    def label_for_exhibitor(self, exhibitor_id: UUID | None) -> str | None:
        """Every number an exhibitor wears as one report cell: "112, 113"."""
        numbers = self.for_exhibitor(exhibitor_id)
        return ", ".join(str(n) for n in numbers) if numbers else None


async def show_numbers_per_horse(show_id: UUID, db: AsyncSession) -> bool:
    """Whether this show numbers horses rather than exhibitors."""
    mode = await db.scalar(select(Show.back_number_per).where(Show.id == show_id))
    return mode == PER_HORSE


async def back_numbers_for_show(show_id: UUID, db: AsyncSession) -> ShowBackNumbers:
    """Every assigned back number at one show, of whichever kind it uses."""
    if not await show_numbers_per_horse(show_id, db):
        rows = await db.execute(
            select(ShowEntry.exhibitor_id, ShowEntry.back_number).where(
                ShowEntry.show_id == show_id,
                ShowEntry.back_number.is_not(None),
            )
        )
        return ShowBackNumbers(
            per_horse=False,
            by_exhibitor={exhibitor_id: number for exhibitor_id, number in rows.all()},
        )

    numbers = (
        await db.execute(
            select(
                ShowHorseNumber.horse_id,
                ShowHorseNumber.back_number,
                ShowHorseNumber.preferred_back_number,
            ).where(ShowHorseNumber.show_id == show_id)
        )
    ).all()
    pairs = await db.execute(
        select(Entry.exhibitor_id, Entry.horse_id)
        .join(Class, Class.id == Entry.class_id)
        .where(Class.show_id == show_id, Entry.horse_id.is_not(None))
        .distinct()
    )
    horses_by_exhibitor: dict[UUID, set[UUID]] = {}
    for exhibitor_id, horse_id in pairs.all():
        horses_by_exhibitor.setdefault(exhibitor_id, set()).add(horse_id)
    return ShowBackNumbers(
        per_horse=True,
        by_horse={h: number for h, number, _ in numbers if number is not None},
        preferred_by_horse={h: asked for h, _, asked in numbers if asked is not None},
        horses_by_exhibitor=horses_by_exhibitor,
    )


def resolve_back_number(entry, numbers: ShowBackNumbers | None) -> int | None:
    """The number to display for one entry."""
    if numbers is None:
        return entry.back_number
    return numbers.for_entry(entry)


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
    the sign-up it rides on. Also None, doing nothing, at a show that numbers
    horses: there the numbers arrive with each horse entered
    (`assign_horse_number_if_missing`).
    """
    # Read from the database rather than off the instance: on a row created
    # earlier in this request the attribute may never have been loaded, and a
    # lazy load in an async session is a MissingGreenlet.
    show_id, show_entry_id = show_entry.show_id, show_entry.id
    if await show_numbers_per_horse(show_id, db):
        return None
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


async def assign_horse_number_if_missing(
    show_id: UUID, horse_id: UUID | None, db: AsyncSession, attempts: int = 5
) -> int | None:
    """Give a horse the lowest free number at a horse-numbered show, when it
    holds none (migration 161).

    Called wherever a horse is entered in a class: the horse-numbered
    counterpart of `assign_back_number_if_missing`, for the same reason --
    nobody should reach the gate without a number. A number the horse asked for
    (`preferred_back_number`) is its first choice when nobody holds it.

    Does nothing, returning None, at a show that numbers exhibitors or for an
    entry with no horse. Skips every number another horse holds or has asked
    for, and retries inside a savepoint on the unique constraints, as the
    exhibitor version does. The caller commits.
    """
    if horse_id is None or not await show_numbers_per_horse(show_id, db):
        return None
    for _ in range(attempts):
        rows = await db.execute(
            select(
                ShowHorseNumber.horse_id,
                ShowHorseNumber.back_number,
                ShowHorseNumber.preferred_back_number,
            ).where(ShowHorseNumber.show_id == show_id)
        )
        taken: set[int] = set()
        own_row = False
        own_request: int | None = None
        for row_horse_id, held, asked_for in rows.all():
            if row_horse_id == horse_id:
                if held is not None:
                    return held
                own_row, own_request = True, asked_for
                continue
            if held is not None:
                taken.add(held)
            if asked_for is not None:
                taken.add(asked_for)
        if own_request is not None and own_request not in taken:
            number = own_request
        else:
            number = lowest_free_number(taken)
        try:
            async with db.begin_nested():
                if own_row:
                    result = await db.execute(
                        update(ShowHorseNumber)
                        .where(
                            ShowHorseNumber.show_id == show_id,
                            ShowHorseNumber.horse_id == horse_id,
                            ShowHorseNumber.back_number.is_(None),
                        )
                        .values(back_number=number)
                        .execution_options(synchronize_session=False)
                    )
                    if result.rowcount == 0:
                        # Somebody numbered the horse in the meantime. Theirs stands.
                        return await db.scalar(
                            select(ShowHorseNumber.back_number).where(
                                ShowHorseNumber.show_id == show_id,
                                ShowHorseNumber.horse_id == horse_id,
                            )
                        )
                else:
                    db.add(ShowHorseNumber(show_id=show_id, horse_id=horse_id, back_number=number))
                    await db.flush()
        except IntegrityError:
            # The number, or the horse's own row, arrived from another request
            # in the meantime; the next pass reads both.
            continue
        return number
    return None


async def assign_missing_horse_numbers(show_id: UUID, db: AsyncSession) -> int:
    """Number every entered horse that holds no number yet.

    Run when a show is switched to numbering horses with entries already in, so
    the desk opens on numbered horses rather than a column of dashes, and by
    the desk's "number every horse". Never renumbers a horse that holds one; a
    horse's own request is granted when nobody holds it; everyone else gets the
    lowest free number, earliest entry first. The caller commits. Returns how
    many horses it numbered.
    """
    horse_ids = await _entered_horse_ids(show_id, db)
    existing = await db.execute(
        select(ShowHorseNumber).where(ShowHorseNumber.show_id == show_id)
    )
    rows = {row.horse_id: row for row in existing.scalars().all()}
    held = {row.back_number for row in rows.values() if row.back_number is not None}
    asked = {
        row.preferred_back_number
        for row in rows.values()
        if row.preferred_back_number is not None
    }

    todo = [h for h in horse_ids if rows.get(h) is None or rows[h].back_number is None]
    # Requests first, so a sequential fill never takes a number somebody asked
    # for out from under them.
    unassigned = []
    for horse_id in todo:
        row = rows.get(horse_id)
        wanted = row.preferred_back_number if row is not None else None
        if wanted is not None and wanted not in held:
            row.back_number = wanted
            held.add(wanted)
        else:
            unassigned.append(horse_id)
    for horse_id in unassigned:
        number = lowest_free_number(held | asked)
        held.add(number)
        row = rows.get(horse_id)
        if row is None:
            row = ShowHorseNumber(show_id=show_id, horse_id=horse_id)
            db.add(row)
            rows[horse_id] = row
        row.back_number = number
    await db.flush()
    return len(todo)


async def _entered_horse_ids(show_id: UUID, db: AsyncSession) -> list[UUID]:
    """Every horse entered in a class at this show, in the order first entered."""
    rows = await db.execute(
        select(Entry.horse_id)
        .join(Class, Class.id == Entry.class_id)
        .where(Class.show_id == show_id, Entry.horse_id.is_not(None))
        .order_by(Entry.created_at, Entry.id)
    )
    seen: dict[UUID, None] = {}
    for (horse_id,) in rows.all():
        seen.setdefault(horse_id, None)
    return list(seen)
