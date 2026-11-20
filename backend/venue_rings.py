"""The rings and arenas at a venue, and how a show takes them (migration 204).

A venue's rings do not change from one show to the next, so the show office
names them once and every later show at that venue starts with them. A show
still runs rings of its own (`rings`): classes point there, the gate runs one
class at a time in each, and a show's ring keeps the name it ran under. A show
ring's `venue_ring_id` says which of the venue's rings it is.

The rules, each applied where the show's rings or venue change:

- **A show at a venue starts with the venue's rings.** Copied when the show is
  created at a venue, when a venue is picked for a show that has no rings yet,
  and when the first class needs a ring (in place of the "Ring 1" default).
- **A ring added at a show with a venue is added to the venue too.** One the
  venue already has by that name is used rather than a second one made.
- **A ring this show alone runs stays this show's** until the office presses
  *Save to venue* -- the "Ring 1" a show made before it had a venue is not
  something to put on a fairground's list without asking.
- **Changing the venue does not move or delete a show's rings.** Each is
  matched by name to the new venue's list or left as the show's own.

Names compare as `lower(btrim(name))`, which is the unique index's expression,
so a clash found here is the clash the database would refuse.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Ring, VenueRing

SORT_STEP = 10


def ring_key(name: str) -> str:
    """How two ring names are compared: what SQL's `lower(btrim(...))` does."""
    return (name or "").strip().lower()


def name_taken(name: str, names: Iterable[str]) -> bool:
    key = ring_key(name)
    return any(ring_key(n) == key for n in names)


@dataclass(frozen=True)
class ShowRingRef:
    id: UUID
    name: str
    venue_ring_id: Optional[UUID]


@dataclass(frozen=True)
class VenueRingRef:
    id: UUID
    name: str


@dataclass(frozen=True)
class VenueChangePlan:
    """What picking a venue does to a show's rings.

    `adopt`: the show has no rings, so it takes all of the venue's.
    `links`: each existing show ring's `venue_ring_id` from now on.
    """
    adopt: bool
    links: dict[UUID, Optional[UUID]]


def plan_venue_change(
    show_rings: list[ShowRingRef],
    venue_rings: list[VenueRingRef],
    venue_set: bool,
) -> VenueChangePlan:
    """Match a show's rings to the venue it is now at.

    Nothing is created or deleted: a ring already pointing at one of this
    venue's rings keeps it, one with a name the venue has is matched to it, and
    the rest become the show's own. With no venue at all, every ring is the
    show's own.
    """
    if not venue_set:
        return VenueChangePlan(adopt=False, links={r.id: None for r in show_rings})
    if not show_rings:
        return VenueChangePlan(adopt=bool(venue_rings), links={})
    ids = {v.id for v in venue_rings}
    by_key = {ring_key(v.name): v.id for v in venue_rings}
    links: dict[UUID, Optional[UUID]] = {}
    for r in show_rings:
        if r.venue_ring_id in ids:
            links[r.id] = r.venue_ring_id
        else:
            links[r.id] = by_key.get(ring_key(r.name))
    return VenueChangePlan(adopt=False, links=links)


@dataclass(frozen=True)
class RenameAction:
    """What renaming a show ring does at its venue.

    `rename`: the venue ring takes the new name too -- only this show runs it,
    so this is somebody fixing what they typed.
    `relink`: the venue already has a ring by the new name; point at that one.
    `create`: other shows run the old venue ring under the old name, so the
    venue gains a ring by the new name and this show points at it.
    """
    kind: str  # "rename" | "relink" | "create"
    venue_ring_id: Optional[UUID] = None


def plan_rename(
    new_name: str,
    current_venue_ring_id: UUID,
    venue_rings: list[VenueRingRef],
    other_shows_running_it: int,
) -> RenameAction:
    key = ring_key(new_name)
    for v in venue_rings:
        if v.id != current_venue_ring_id and ring_key(v.name) == key:
            return RenameAction("relink", v.id)
    if other_shows_running_it == 0:
        return RenameAction("rename", current_venue_ring_id)
    return RenameAction("create")


# ── Database ─────────────────────────────────────────────────────────────────

async def venue_rings_of(venue_id: UUID, db: AsyncSession) -> list[VenueRing]:
    result = await db.execute(
        select(VenueRing)
        .where(VenueRing.venue_id == venue_id)
        .order_by(VenueRing.sort_order.nulls_last(), VenueRing.name)
    )
    return list(result.scalars().all())


async def show_rings_of(show_id: UUID, db: AsyncSession) -> list[Ring]:
    result = await db.execute(
        select(Ring)
        .where(Ring.show_id == show_id)
        .order_by(Ring.sort_order.nulls_last(), Ring.name)
    )
    return list(result.scalars().all())


async def next_show_ring_order(show_id: UUID, db: AsyncSession) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(Ring.sort_order), 0)).where(Ring.show_id == show_id)
    )
    return (result.scalar_one() or 0) + SORT_STEP


async def find_or_create_venue_ring(venue_id: UUID, name: str, db: AsyncSession) -> VenueRing:
    """The venue's ring by this name, made if the venue has none. Caller commits."""
    key = ring_key(name)
    for v in await venue_rings_of(venue_id, db):
        if ring_key(v.name) == key:
            return v
    result = await db.execute(
        select(func.coalesce(func.max(VenueRing.sort_order), 0)).where(VenueRing.venue_id == venue_id)
    )
    ring = VenueRing(
        venue_id=venue_id,
        name=name.strip(),
        sort_order=(result.scalar_one() or 0) + SORT_STEP,
    )
    db.add(ring)
    await db.flush()
    return ring


async def adopt_venue_rings(show_id: UUID, venue_id: UUID, db: AsyncSession) -> list[Ring]:
    """Give a show every ring its venue has, in the venue's order. Caller commits."""
    created: list[Ring] = []
    for i, v in enumerate(await venue_rings_of(venue_id, db), start=1):
        ring = Ring(show_id=show_id, name=v.name, sort_order=i * SORT_STEP, venue_ring_id=v.id)
        db.add(ring)
        created.append(ring)
    if created:
        await db.flush()
    return created


async def apply_venue_change(show_id: UUID, venue_id: Optional[UUID], db: AsyncSession) -> None:
    """Match the show's rings to the venue it is now at. Caller commits."""
    rings = await show_rings_of(show_id, db)
    venue_rings = await venue_rings_of(venue_id, db) if venue_id else []
    plan = plan_venue_change(
        [ShowRingRef(r.id, r.name, r.venue_ring_id) for r in rings],
        [VenueRingRef(v.id, v.name) for v in venue_rings],
        venue_set=venue_id is not None,
    )
    if plan.adopt and venue_id:
        await adopt_venue_rings(show_id, venue_id, db)
        return
    for r in rings:
        r.venue_ring_id = plan.links.get(r.id)


async def shows_running(venue_ring_id: UUID, db: AsyncSession, except_ring_id: Optional[UUID] = None) -> int:
    query = select(func.count()).select_from(Ring).where(Ring.venue_ring_id == venue_ring_id)
    if except_ring_id is not None:
        query = query.where(Ring.id != except_ring_id)
    return (await db.execute(query)).scalar_one()
