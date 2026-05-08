from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID

from database import get_db
from models import Ring, Show, Class
from schemas import RingCreate, RingUpdate, RingOut, RingBulkCreate
from routers.shows import _assert_show_access

router = APIRouter(prefix="/shows/{show_id}/rings", tags=["Rings"])


async def _get_show_or_404(show_id: UUID, db: AsyncSession):
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
    )


async def _next_sort_order(show_id: UUID, db: AsyncSession) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(Ring.sort_order), 0)).where(Ring.show_id == show_id)
    )
    return (result.scalar_one() or 0) + 10


@router.get("/", response_model=list[RingOut])
async def list_rings(show_id: UUID, db: AsyncSession = Depends(get_db)):
    await _get_show_or_404(show_id, db)
    rings_res = await db.execute(
        select(Ring).where(Ring.show_id == show_id).order_by(Ring.sort_order.nulls_last(), Ring.name)
    )
    rings = rings_res.scalars().all()
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
        )
        for r in rings
    ]


@router.post("/", response_model=RingOut, status_code=201)
async def create_ring(
    show_id: UUID,
    body: RingCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    sort_order = body.sort_order if body.sort_order is not None else await _next_sort_order(show_id, db)
    ring = Ring(show_id=show_id, name=body.name, sort_order=sort_order)
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
    await _get_show_or_404(show_id, db)
    existing_res = await db.execute(select(Ring.name).where(Ring.show_id == show_id))
    existing = {row[0] for row in existing_res.all()}
    sort_order = await _next_sort_order(show_id, db)
    created: list[Ring] = []
    for raw in body.names:
        name = raw.strip()
        if not name or name in existing:
            continue
        existing.add(name)
        ring = Ring(show_id=show_id, name=name, sort_order=sort_order)
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
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    ring = await db.get(Ring, ring_id)
    if not ring or ring.show_id != show_id:
        raise HTTPException(404, "Ring not found")
    if body.name is not None:
        ring.name = body.name
    if body.sort_order is not None:
        ring.sort_order = body.sort_order
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
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    ring = await db.get(Ring, ring_id)
    if not ring or ring.show_id != show_id:
        raise HTTPException(404, "Ring not found")
    in_use = await db.execute(
        select(func.count()).select_from(Class).where(Class.ring_id == ring_id)
    )
    if in_use.scalar_one() > 0:
        raise HTTPException(409, "Ring is assigned to one or more classes — reassign or remove those classes first.")
    await db.delete(ring)
    await db.commit()
