"""Where a competitor's back number actually lives.

A show numbers its exhibitors, its horses, or each exhibitor on each horse
(`shows.back_number_per`, migrations 161 and 178):

* **exhibitor** -- one number per exhibitor per show, on
  `show_entries.back_number` (unique per show). What every show did before
  migration 161, and still the default.
* **horse** -- one number per horse per show, on `show_horse_numbers`, as APHA
  SC-160.D requires. An exhibitor with three horses wears three numbers, and a
  horse shown by two exhibitors wears one.
* **pair** -- one number per exhibitor per horse, on `show_pair_numbers`
  (migration 178). An exhibitor with three horses wears three numbers, and a
  horse shown by two exhibitors wears two: the number belongs to the
  combination.

The last two are both a number beside each of an exhibitor's horses, and differ
only in what the number is keyed on -- the horse, or the exhibitor and horse
together. `NumberTable` is that difference, so every rule that hands one out or
changes one is written once for both.

`entries.back_number` is an older per-entry column that nothing writes any
more; it survives only so existing rows and the entry create/update payloads
keep working, and is the last fallback.

Every read path that shows a back number therefore has to resolve it, and they
must all resolve it the same way: load `back_numbers_for_show` once and ask it.
Reading `Entry.back_number` directly is the bug this module exists to prevent
-- it is silently NULL for every entry created since assignment moved to
`show_entries`, so the screen shows a dash and nobody sees an error. Reading
`ShowEntry.back_number` directly is the same bug at a horse- or pair-numbered
show.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from models import Class, Entry, Show, ShowEntry, ShowHorseNumber, ShowPairNumber

PER_EXHIBITOR = "exhibitor"
PER_HORSE = "horse"
PER_PAIR = "pair"


def number_kind(show) -> str:
    """Which kind of number this show issues. Unset reads as the default."""
    return show.back_number_per or PER_EXHIBITOR


@dataclass(frozen=True)
class NumberTable:
    """Where a show that numbers each horse an exhibitor shows keeps its
    numbers: by the horse alone (`show_horse_numbers`) or by the exhibitor and
    horse together (`show_pair_numbers`).

    A key is the tuple of `key_names` values -- `(horse_id,)` or
    `(exhibitor_id, horse_id)`. Both tables are unique on (show, key) and on
    (show, back_number), and carry `preferred_back_number` beside the number.
    """

    model: type
    key_names: tuple[str, ...]

    def key(self, exhibitor_id, horse_id) -> tuple | None:
        """The key of the number an entry by this exhibitor on this horse
        wears, or None when the entry lacks a part of it -- a horse deleted
        from under its entries, say -- and so wears no number."""
        given = {"exhibitor_id": exhibitor_id, "horse_id": horse_id}
        key = tuple(given[name] for name in self.key_names)
        return None if any(part is None for part in key) else key

    def key_of(self, row) -> tuple:
        return tuple(getattr(row, name) for name in self.key_names)

    def columns(self) -> list:
        return [getattr(self.model, name) for name in self.key_names]

    def matches(self, key: tuple) -> list:
        """WHERE clauses picking out the row with this key. A part of the key
        may be a column, which makes the clauses a join condition."""
        return [column == value for column, value in zip(self.columns(), key)]

    def is_one_of(self, keys) -> object:
        return or_(*(and_(*self.matches(key)) for key in keys))

    def new_row(self, show_id: UUID, key: tuple, **values):
        return self.model(show_id=show_id, **dict(zip(self.key_names, key)), **values)


HORSE_NUMBERS = NumberTable(ShowHorseNumber, ("horse_id",))
PAIR_NUMBERS = NumberTable(ShowPairNumber, ("exhibitor_id", "horse_id"))


def number_table(kind: str) -> NumberTable | None:
    """The table a show of this kind keeps its numbers in; None at a show that
    numbers exhibitors, whose numbers are on `show_entries`."""
    return {PER_HORSE: HORSE_NUMBERS, PER_PAIR: PAIR_NUMBERS}.get(kind)


@dataclass
class ShowBackNumbers:
    """Every back number at one show, answerable per entry or per exhibitor.

    Exhibitors and horses with no number assigned are absent rather than mapped
    to None, so a lookup can tell "not assigned" from "assigned nothing".
    """

    kind: str = PER_EXHIBITOR
    by_exhibitor: dict[UUID, int] = field(default_factory=dict)
    # At a show that numbers horses or pairs: each number, and each number asked
    # for, by its `NumberTable` key -- `(horse_id,)` or `(exhibitor_id, horse_id)`.
    by_key: dict[tuple, int] = field(default_factory=dict)
    preferred_by_key: dict[tuple, int] = field(default_factory=dict)
    # exhibitor_id -> the horses they have entered at this show. Only loaded at
    # a horse- or pair-numbered show, where it is what turns "this exhibitor's
    # number" into "this exhibitor's numbers".
    horses_by_exhibitor: dict[UUID, set[UUID]] = field(default_factory=dict)

    @property
    def per_exhibitor(self) -> bool:
        return self.kind == PER_EXHIBITOR

    @property
    def per_horse(self) -> bool:
        return self.kind == PER_HORSE

    @property
    def per_pair(self) -> bool:
        return self.kind == PER_PAIR

    def _key(self, exhibitor_id: UUID | None, horse_id: UUID | None) -> tuple | None:
        table = number_table(self.kind)
        return table.key(exhibitor_id, horse_id) if table is not None else None

    def horse_number(self, exhibitor_id: UUID | None, horse_id: UUID | None) -> int | None:
        """The number beside this horse in this exhibitor's list: the horse's,
        or theirs on it. None at a show that numbers exhibitors."""
        key = self._key(exhibitor_id, horse_id)
        return self.by_key.get(key) if key is not None else None

    def horse_preference(self, exhibitor_id: UUID | None, horse_id: UUID | None) -> int | None:
        """The number asked for beside this horse, where one was."""
        key = self._key(exhibitor_id, horse_id)
        return self.preferred_by_key.get(key) if key is not None else None

    def resolve(
        self, exhibitor_id: UUID | None, horse_id: UUID | None, legacy: int | None = None
    ) -> int | None:
        """The number worn by this exhibitor on this horse."""
        if self.per_exhibitor:
            resolved = self.by_exhibitor.get(exhibitor_id) if exhibitor_id is not None else None
        else:
            resolved = self.horse_number(exhibitor_id, horse_id)
        return resolved if resolved is not None else legacy

    def for_entry(self, entry) -> int | None:
        return self.resolve(entry.exhibitor_id, entry.horse_id, entry.back_number)

    def for_exhibitor(self, exhibitor_id: UUID | None) -> list[int]:
        """Every number this exhibitor wears at the show, lowest first: one at
        most at an exhibitor-numbered show, one per numbered horse otherwise."""
        if exhibitor_id is None:
            return []
        if self.per_exhibitor:
            number = self.by_exhibitor.get(exhibitor_id)
            return [] if number is None else [number]
        numbers = (
            self.horse_number(exhibitor_id, h)
            for h in self.horses_by_exhibitor.get(exhibitor_id, ())
        )
        return sorted(n for n in numbers if n is not None)

    def first_for_exhibitor(self, exhibitor_id: UUID | None) -> int | None:
        """The lowest number an exhibitor wears -- for sorting an exhibitor-level
        list, and for the screens with room for one number only."""
        numbers = self.for_exhibitor(exhibitor_id)
        return numbers[0] if numbers else None

    def label_for_exhibitor(self, exhibitor_id: UUID | None) -> str | None:
        """Every number an exhibitor wears as one report cell: "112, 113"."""
        numbers = self.for_exhibitor(exhibitor_id)
        return ", ".join(str(n) for n in numbers) if numbers else None

    def wearers_of(self, number: int) -> list[UUID]:
        """Every exhibitor who wears this number on a horse they have entered:
        one at most at a pair-numbered show, and at a horse-numbered show
        everybody who shows that horse. Empty at an exhibitor-numbered show,
        where `show_entries` answers the question directly."""
        return [
            exhibitor_id
            for exhibitor_id, horses in self.horses_by_exhibitor.items()
            if any(self.horse_number(exhibitor_id, h) == number for h in horses)
        ]


async def show_number_kind(show_id: UUID, db: AsyncSession) -> str:
    """Which kind of number this show issues."""
    kind = await db.scalar(select(Show.back_number_per).where(Show.id == show_id))
    return kind or PER_EXHIBITOR


async def back_numbers_for_show(show_id: UUID, db: AsyncSession) -> ShowBackNumbers:
    """Every assigned back number at one show, of whichever kind it uses."""
    kind = await show_number_kind(show_id, db)
    table = number_table(kind)
    if table is None:
        rows = await db.execute(
            select(ShowEntry.exhibitor_id, ShowEntry.back_number).where(
                ShowEntry.show_id == show_id,
                ShowEntry.back_number.is_not(None),
            )
        )
        return ShowBackNumbers(
            kind=PER_EXHIBITOR,
            by_exhibitor={exhibitor_id: number for exhibitor_id, number in rows.all()},
        )

    model = table.model
    numbers = await db.execute(
        select(*table.columns(), model.back_number, model.preferred_back_number).where(
            model.show_id == show_id
        )
    )
    by_key: dict[tuple, int] = {}
    preferred_by_key: dict[tuple, int] = {}
    for *key, number, asked in numbers.all():
        if number is not None:
            by_key[tuple(key)] = number
        if asked is not None:
            preferred_by_key[tuple(key)] = asked
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
        kind=kind,
        by_key=by_key,
        preferred_by_key=preferred_by_key,
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
    horses or pairs: there the numbers arrive with each horse entered
    (`assign_horse_number_if_missing`).
    """
    # Read from the database rather than off the instance: on a row created
    # earlier in this request the attribute may never have been loaded, and a
    # lazy load in an async session is a MissingGreenlet.
    show_id, show_entry_id = show_entry.show_id, show_entry.id
    if await show_number_kind(show_id, db) != PER_EXHIBITOR:
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
    show_id: UUID,
    exhibitor_id: UUID | None,
    horse_id: UUID | None,
    db: AsyncSession,
    attempts: int = 5,
) -> int | None:
    """Give an entered horse its number, when it holds none -- the horse's own
    at a horse-numbered show (migration 161), this exhibitor's on it at a
    pair-numbered one (migration 178).

    Called wherever a horse is entered in a class: the per-horse counterpart of
    `assign_back_number_if_missing`, for the same reason -- nobody should reach
    the gate without a number. A number asked for (`preferred_back_number`) is
    the first choice when nobody holds it.

    Does nothing, returning None, at a show that numbers exhibitors or for an
    entry with no horse. Skips every number another row holds or has asked
    for, and retries inside a savepoint on the unique constraints, as the
    exhibitor version does. The caller commits.
    """
    if horse_id is None:
        return None
    table = number_table(await show_number_kind(show_id, db))
    key = table.key(exhibitor_id, horse_id) if table is not None else None
    if key is None:
        return None
    model = table.model
    for _ in range(attempts):
        rows = await db.execute(
            select(*table.columns(), model.back_number, model.preferred_back_number).where(
                model.show_id == show_id
            )
        )
        taken: set[int] = set()
        own_row = False
        own_request: int | None = None
        for *row_key, held, asked_for in rows.all():
            if tuple(row_key) == key:
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
                        update(model)
                        .where(
                            model.show_id == show_id,
                            *table.matches(key),
                            model.back_number.is_(None),
                        )
                        .values(back_number=number)
                        .execution_options(synchronize_session=False)
                    )
                    if result.rowcount == 0:
                        # Somebody numbered it in the meantime. Theirs stands.
                        return await db.scalar(
                            select(model.back_number).where(
                                model.show_id == show_id, *table.matches(key)
                            )
                        )
                else:
                    db.add(table.new_row(show_id, key, back_number=number))
                    await db.flush()
        except IntegrityError:
            # The number, or this key's own row, arrived from another request
            # in the meantime; the next pass reads both.
            continue
        return number
    return None


async def assign_missing_horse_numbers(show_id: UUID, db: AsyncSession) -> int:
    """Number every entered horse that holds no number yet -- each horse, or
    each exhibitor on each horse, as the show numbers them.

    Run when a show is switched to numbering horses or pairs with entries
    already in, so the desk opens on numbers rather than a column of dashes,
    and by the desk's auto-assign. Never renumbers one that holds a number; a
    request is granted when nobody holds it; everyone else gets the lowest free
    number, earliest entry first. The caller commits. Returns how many it
    numbered; 0, doing nothing, at a show that numbers exhibitors.
    """
    table = number_table(await show_number_kind(show_id, db))
    if table is None:
        return 0
    keys = await _entered_keys(show_id, table, db)
    existing = await db.execute(select(table.model).where(table.model.show_id == show_id))
    rows = {table.key_of(row): row for row in existing.scalars().all()}
    held = {row.back_number for row in rows.values() if row.back_number is not None}
    asked = {
        row.preferred_back_number
        for row in rows.values()
        if row.preferred_back_number is not None
    }

    todo = [k for k in keys if rows.get(k) is None or rows[k].back_number is None]
    # Requests first, so a sequential fill never takes a number somebody asked
    # for out from under them.
    unassigned = []
    for key in todo:
        row = rows.get(key)
        wanted = row.preferred_back_number if row is not None else None
        if wanted is not None and wanted not in held:
            row.back_number = wanted
            held.add(wanted)
        else:
            unassigned.append(key)
    for key in unassigned:
        number = lowest_free_number(held | asked)
        held.add(number)
        row = rows.get(key)
        if row is None:
            row = table.new_row(show_id, key)
            db.add(row)
            rows[key] = row
        row.back_number = number
    await db.flush()
    return len(todo)


async def entered_keys(show_id: UUID, table: NumberTable, db: AsyncSession) -> set[tuple]:
    """Every key with an entry behind it at this show: each horse entered, or
    each exhibitor-and-horse pair."""
    return set(await _entered_keys(show_id, table, db))


async def _entered_keys(show_id: UUID, table: NumberTable, db: AsyncSession) -> list[tuple]:
    """Every key with an entry behind it, in the order first entered."""
    rows = await db.execute(
        select(Entry.exhibitor_id, Entry.horse_id)
        .join(Class, Class.id == Entry.class_id)
        .where(Class.show_id == show_id, Entry.horse_id.is_not(None))
        .order_by(Entry.created_at, Entry.id)
    )
    seen: dict[tuple, None] = {}
    for exhibitor_id, horse_id in rows.all():
        key = table.key(exhibitor_id, horse_id)
        if key is not None:
            seen.setdefault(key, None)
    return list(seen)
