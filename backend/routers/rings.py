from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID

from database import get_db
from models import Ring, Show, Class, VenueRing
from schemas import RingCreate, RingUpdate, RingOut, RingBulkCreate, VenueRingOut
from routers.shows import _assert_show_access
from venue_rings import (
    VenueRingRef,
    find_or_create_venue_ring,
    name_taken,
    next_show_ring_order,
    plan_rename,
    show_rings_of,
    shows_running,
    venue_rings_of,
)

router = APIRouter(prefix="/shows/{show_id}/rings", tags=["Rings"])


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _ring_with_count(ring: Ring, db: AsyncSession) -> RingOut:
    count = await db.execute(
        select(func.count()).select_from(Class).where(Class.ring_id == ring.id)
    )
    return RingOut(
        id=ring.id,
        show_id=ring.show_id,
        name=ring.name,
        sort_order=ring.sort_order,
        class_count=count.scalar_one(),
        venue_ring_id=ring.venue_ring_id,
    )


def _refuse_taken(name: str, rings: list[Ring], except_id: UUID | None = None) -> None:
    if name_taken(name, [r.name for r in rings if r.id != except_id]):
        raise HTTPException(409, f"This show already has a ring called “{name}”.")


@router.get("/", response_model=list[RingOut])
async def list_rings(show_id: UUID, db: AsyncSession = Depends(get_db)):
    await _get_show_or_404(show_id, db)
    rings = await show_rings_of(show_id, db)
    counts_res = await db.execute(
        select(Class.ring_id, func.count())
        .where(Class.show_id == show_id, Class.ring_id.is_not(None))
        .group_by(Class.ring_id)
    )
    counts = {row[0]: row[1] for row in counts_res.all()}
    return [
        RingOut(
            id=r.id,
            show_id=r.show_id,
            name=r.name,
            sort_order=r.sort_order,
            class_count=counts.get(r.id, 0),
            venue_ring_id=r.venue_ring_id,
        )
        for r in rings
    ]


@router.get("/venue", response_model=list[VenueRingOut])
async def list_venue_rings(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The rings at the show's venue (migration 204), each with how many shows
    run it. Empty for a show with no venue."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)
    if show.venue_id is None:
        return []
    venue_rings = await venue_rings_of(show.venue_id, db)
    if not venue_rings:
        return []
    counts_res = await db.execute(
        select(Ring.venue_ring_id, func.count())
        .where(Ring.venue_ring_id.in_([v.id for v in venue_rings]))
        .group_by(Ring.venue_ring_id)
    )
    counts = {row[0]: row[1] for row in counts_res.all()}
    return [
        VenueRingOut(
            id=v.id,
            venue_id=v.venue_id,
            name=v.name,
            sort_order=v.sort_order,
            show_count=counts.get(v.id, 0),
        )
        for v in venue_rings
    ]


@router.delete("/venue/{venue_ring_id}", status_code=204)
async def remove_venue_ring(
    show_id: UUID,
    venue_ring_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Take a ring off the venue's list. Only one no show runs: the list is what
    later shows are offered, and a ring some show runs is that show's record."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)
    venue_ring = await db.get(VenueRing, venue_ring_id)
    if venue_ring is None or show.venue_id is None or venue_ring.venue_id != show.venue_id:
        raise HTTPException(404, "Ring not found at this show's venue")
    running = await shows_running(venue_ring_id, db)
    if running:
        raise HTTPException(
            409,
            f"{running} show{'s run' if running != 1 else ' runs'} “{venue_ring.name}”, so it stays on the venue's list.",
        )
    await db.delete(venue_ring)
    await db.commit()


@router.post("/", response_model=RingOut, status_code=201)
async def create_ring(
    show_id: UUID,
    body: RingCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """A ring for this show: one of the venue's by `venue_ring_id`, or a new one
    by `name`, which a show at a venue adds to the venue's list as well."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)
    rings = await show_rings_of(show_id, db)

    if body.venue_ring_id is not None:
        venue_ring = await db.get(VenueRing, body.venue_ring_id)
        if venue_ring is None or show.venue_id is None or venue_ring.venue_id != show.venue_id:
            raise HTTPException(404, "Ring not found at this show's venue")
        if any(r.venue_ring_id == venue_ring.id for r in rings):
            raise HTTPException(409, f"This show already runs “{venue_ring.name}”.")
        name = venue_ring.name
        _refuse_taken(name, rings)
        venue_ring_id = venue_ring.id
    else:
        name = (body.name or "").strip()
        if not name:
            raise HTTPException(422, "Give the ring a name.")
        _refuse_taken(name, rings)
        venue_ring_id = None
        if show.venue_id is not None:
            venue_ring_id = (await find_or_create_venue_ring(show.venue_id, name, db)).id

    sort_order = body.sort_order if body.sort_order is not None else await next_show_ring_order(show_id, db)
    ring = Ring(show_id=show_id, name=name, sort_order=sort_order, venue_ring_id=venue_ring_id)
    db.add(ring)
    await db.commit()
    await db.refresh(ring)
    return await _ring_with_count(ring, db)


@router.post("/bulk", response_model=list[RingOut], status_code=201)
async def bulk_create_rings(
    show_id: UUID,
    body: RingBulkCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)
    existing = [r.name for r in await show_rings_of(show_id, db)]
    sort_order = await next_show_ring_order(show_id, db)
    created: list[Ring] = []
    for raw in body.names:
        name = raw.strip()
        if not name or name_taken(name, existing):
            continue
        existing.append(name)
        venue_ring_id = None
        if show.venue_id is not None:
            venue_ring_id = (await find_or_create_venue_ring(show.venue_id, name, db)).id
        ring = Ring(show_id=show_id, name=name, sort_order=sort_order, venue_ring_id=venue_ring_id)
        sort_order += 10
        db.add(ring)
        created.append(ring)
    await db.commit()
    out: list[RingOut] = []
    for r in created:
        await db.refresh(r)
        out.append(await _ring_with_count(r, db))
    return out


@router.patch("/{ring_id}", response_model=RingOut)
async def update_ring(
    show_id: UUID,
    ring_id: UUID,
    body: RingUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Rename or reorder a show ring, or put one this show alone runs on the
    venue's list (`save_to_venue`).

    Renaming a ring that is on the venue's list keeps the list right: if only
    this show runs it, the venue's ring takes the new name (a typo fixed); if
    the venue already has a ring by the new name, this show points at that one;
    otherwise the venue gains the new name and the shows that ran the old one
    keep it. A show's ring is its record of where its classes ran, so another
    show's ring is never renamed from here.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)
    ring = await db.get(Ring, ring_id)
    if not ring or ring.show_id != show_id:
        raise HTTPException(404, "Ring not found")

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(422, "Give the ring a name.")
        _refuse_taken(name, await show_rings_of(show_id, db), except_id=ring.id)
        if ring.venue_ring_id is not None and show.venue_id is not None and name != ring.name:
            venue_rings = await venue_rings_of(show.venue_id, db)
            action = plan_rename(
                name,
                ring.venue_ring_id,
                [VenueRingRef(v.id, v.name) for v in venue_rings],
                await shows_running(ring.venue_ring_id, db, except_ring_id=ring.id),
            )
            if action.kind == "rename":
                venue_ring = await db.get(VenueRing, ring.venue_ring_id)
                if venue_ring is not None:
                    venue_ring.name = name
            elif action.kind == "relink":
                ring.venue_ring_id = action.venue_ring_id
            else:
                ring.venue_ring_id = (await find_or_create_venue_ring(show.venue_id, name, db)).id
        ring.name = name

    if body.sort_order is not None:
        ring.sort_order = body.sort_order

    if body.save_to_venue:
        if show.venue_id is None:
            raise HTTPException(400, "Pick the show's venue on Basics first, then save its rings to it.")
        if ring.venue_ring_id is None:
            ring.venue_ring_id = (await find_or_create_venue_ring(show.venue_id, ring.name, db)).id

    await db.commit()
    await db.refresh(ring)
    return await _ring_with_count(ring, db)


@router.delete("/{ring_id}", status_code=204)
async def delete_ring(
    show_id: UUID,
    ring_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Take a ring off this show. The venue keeps it for the next show there."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    ring = await db.get(Ring, ring_id)
    if not ring or ring.show_id != show_id:
        raise HTTPException(404, "Ring not found")
    in_use = await db.execute(
        select(func.count()).select_from(Class).where(Class.ring_id == ring_id)
    )
    count = in_use.scalar_one()
    if count > 0:
        raise HTTPException(
            409,
            f"{count} class{'es run' if count != 1 else ' runs'} in “{ring.name}”. "
            "Move them to another ring first.",
        )
    await db.delete(ring)
    await db.commit()
