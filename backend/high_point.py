"""High-point standings: posted placings turned into points (migration 147).

A show's leaderboard and a season circuit's are the same computation over a
different set of shows and a different chart, so both run through here.

The decisions, settled once so the two cannot disagree:

* **The chart is data.** `point_system_awards` says what a place earns in a
  class of a given size; the largest band at or below the class size applies,
  and a class smaller than the smallest band earns nothing. Nothing here knows
  any association's numbers.
* **Only posted classes count**, like every public results screen: a placing
  is not official until a human posts the class, and a leaderboard that moved
  on a half-typed card would move back.
* **Each judge's card counts on its own.** A three-judge class is three
  placings, which is how breed points are earned. This is not combining the
  cards into one result -- the app still does not decide who won the class.
* **Class size is the entries in the class**, withdrawn ones left out: the
  horses that could have been placed, which is what "a class of ten" means on
  an association chart.
* **A tie shares the place's points.** Two horses tied for second both earn
  second; nothing is split, because the chart gives no rule for splitting.
* **Only a placed card earns points** (`placings.is_placed`). A judge who
  disqualified an entry did not rank it, so it earns nothing from that card.
* **Standings are per division, per horse and rider.** Divisions are matched by
  name across a circuit's shows, since each show has its own division rows.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Iterable, Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Class, Division, Entry, Exhibitor, Horse, Result
from placings import is_placed

Chart = dict[int, dict[int, Decimal]]


def may_use_point_system(
    role: str,
    company_id: Optional[UUID],
    member_of: Iterable[UUID],
    show_id: Optional[UUID] = None,
) -> bool:
    """Whether a caller may see a points system in the library and choose it
    (migration 148).

    A GaitDesk admin may use every library system. Anybody else a system one of
    their own show companies owns -- one club's charts never appear in another
    club's pickers -- or a **GaitDesk standard** system, which no company owns:
    the associations' own charts (migration 151), which every show may score by.
    The public leaderboards still print whatever chart a show scores by; this
    is about who may pick one, not who may read it.

    **A show's own chart is not in the library at all** (migration 153), for an
    admin either. It has no company, so without this it would read as a
    standard system and turn up in every company's list; it is reached through
    its show, by whoever works that show, and nothing else may be scored by it.
    """
    if show_id is not None:
        return False
    if role == "ADMIN":
        return True
    return company_id is None or company_id in set(member_of)


def may_edit_point_system(
    role: str,
    company_id: Optional[UUID],
    member_of: Iterable[UUID],
    show_id: Optional[UUID] = None,
) -> bool:
    """Whether a caller may change or delete a library points system: its own
    company's people, or an admin. A standard system is every company's to use
    and only GaitDesk's to change -- a show that scores differently takes a copy
    of its own. A show's own chart is changed through its show, never here."""
    if show_id is not None:
        return False
    if role == "ADMIN":
        return True
    return company_id is not None and company_id in set(member_of)


def build_chart(awards: Iterable) -> Chart:
    """`{min_entries: {place: points}}` from award rows or dicts."""
    chart: Chart = {}
    for award in awards:
        get = award.get if isinstance(award, dict) else lambda k: getattr(award, k)
        chart.setdefault(int(get("min_entries")), {})[int(get("place"))] = Decimal(str(get("points")))
    return chart


def place_limits(minimums: Iterable[int]) -> dict[int, int]:
    """How many places each row of a chart may award, keyed on the row's first
    class size (migration 152).

    A row is a range of class sizes: it runs from its own size to one below the
    next row's, so rows starting at 3, 5 and 10 are 3-4, 5-9 and 10 or more. A
    bounded row may pay as many places as the **largest** class in its range --
    a 5-9 row can pay down to 9th, since a class of nine has a 9th place. The
    last row is open-ended and has only its first size to go by, so it may pay
    that many: "45 or more" pays at most 45.
    """
    ordered = sorted(set(minimums))
    return {
        size: (ordered[i + 1] - 1) if i + 1 < len(ordered) else size
        for i, size in enumerate(ordered)
    }


def range_label(minimum: int, limits: dict[int, int]) -> str:
    """"3-4" for a bounded row, "45 or more" for the last one."""
    later = sorted(size for size in limits if size > minimum)
    if not later:
        return f"{minimum} or more"
    top = later[0] - 1
    return str(minimum) if top == minimum else f"{minimum}-{top}"


def points_for(chart: Chart, place: Optional[int], class_size: int) -> Decimal:
    """What `place` earns in a class of `class_size` horses."""
    if place is None:
        return Decimal(0)
    bands = [minimum for minimum in chart if minimum <= class_size]
    if not bands:
        return Decimal(0)
    return chart[max(bands)].get(place, Decimal(0))


@dataclass(frozen=True)
class Card:
    """One judge's placing of one entry in a posted class."""

    show_id: UUID
    class_id: UUID
    division_name: str
    division_sort: int
    exhibitor_id: UUID
    exhibitor_name: str
    horse_id: Optional[UUID]
    horse_name: Optional[str]
    place: Optional[int]
    outcome: str
    class_size: int


@dataclass
class _Pair:
    exhibitor_id: UUID
    exhibitor_name: str
    horse_id: Optional[UUID]
    horse_name: Optional[str]
    points: Decimal = Decimal(0)
    class_ids: set = field(default_factory=set)
    show_ids: set = field(default_factory=set)


def _division_key(name: str) -> str:
    return " ".join((name or "").split()).lower()


def rank(points: list[Decimal]) -> list[int]:
    """Competition ranks for points already sorted high to low: 10, 8, 8, 5
    ranks 1, 2, 2, 4."""
    ranks: list[int] = []
    for index, value in enumerate(points):
        ranks.append(ranks[-1] if index and value == points[index - 1] else index + 1)
    return ranks


def tally(cards: Iterable[Card], chart: Chart) -> list[dict]:
    """Standings per division, each ranked by points, highest first."""
    divisions: dict[str, dict] = {}
    for card in cards:
        if not is_placed(card):
            continue
        earned = points_for(chart, card.place, card.class_size)
        if earned <= 0:
            continue
        key = _division_key(card.division_name)
        division = divisions.setdefault(
            key, {"name": card.division_name, "sort": card.division_sort, "pairs": {}}
        )
        division["sort"] = min(division["sort"], card.division_sort)
        pair = division["pairs"].setdefault(
            (card.exhibitor_id, card.horse_id),
            _Pair(card.exhibitor_id, card.exhibitor_name, card.horse_id, card.horse_name),
        )
        pair.points += earned
        pair.class_ids.add(card.class_id)
        pair.show_ids.add(card.show_id)

    out = []
    for division in sorted(divisions.values(), key=lambda d: (d["sort"], d["name"].lower())):
        pairs = sorted(
            division["pairs"].values(),
            key=lambda p: (-p.points, p.exhibitor_name.lower(), (p.horse_name or "").lower()),
        )
        ranks = rank([p.points for p in pairs])
        out.append({
            "name": division["name"],
            "standings": [
                {
                    "rank": r,
                    "exhibitor_id": str(p.exhibitor_id),
                    "exhibitor_name": p.exhibitor_name,
                    "horse_id": str(p.horse_id) if p.horse_id else None,
                    "horse_name": p.horse_name,
                    "points": float(p.points),
                    "class_count": len(p.class_ids),
                    "show_count": len(p.show_ids),
                }
                for r, p in zip(ranks, pairs)
            ],
        })
    return out


# A division with no sort order sorts after every one that has one.
_UNSORTED = 10**6


async def load_cards(db: AsyncSession, show_ids: list[UUID]) -> tuple[list[Card], int]:
    """Every placed-or-not card in the shows' posted classes, and how many
    posted classes there were."""
    if not show_ids:
        return [], 0

    posted = (
        Class.show_id.in_(show_ids),
        Class.status != "DRAFT",
        Class.results_published_at.isnot(None),
    )

    size_rows = await db.execute(
        select(Class.id, func.count(Entry.id))
        .outerjoin(Entry, (Entry.class_id == Class.id) & (Entry.status != "WITHDRAWN"))
        .where(*posted)
        .group_by(Class.id)
    )
    sizes = {class_id: count for class_id, count in size_rows.all()}

    rows = await db.execute(
        select(
            Class.show_id,
            Class.id,
            Division.name,
            Division.sort_order,
            Entry.exhibitor_id,
            Exhibitor.full_name,
            Entry.horse_id,
            Horse.name,
            Result.place,
            Result.outcome,
        )
        .join(Result, Result.class_id == Class.id)
        .join(Entry, Entry.id == Result.entry_id)
        .join(Exhibitor, Exhibitor.id == Entry.exhibitor_id)
        .join(Division, Division.id == Class.division_id)
        .outerjoin(Horse, Horse.id == Entry.horse_id)
        .where(*posted, Entry.status != "WITHDRAWN")
    )
    cards = [
        Card(
            show_id=show_id,
            class_id=class_id,
            division_name=division_name,
            division_sort=_UNSORTED if division_sort is None else division_sort,
            exhibitor_id=exhibitor_id,
            exhibitor_name=exhibitor_name or "",
            horse_id=horse_id,
            horse_name=horse_name,
            place=place,
            outcome=outcome or "placed",
            class_size=sizes.get(class_id, 0),
        )
        for (
            show_id, class_id, division_name, division_sort, exhibitor_id,
            exhibitor_name, horse_id, horse_name, place, outcome,
        ) in rows.all()
    ]
    return cards, len(sizes)
