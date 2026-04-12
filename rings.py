from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from database import get_db
from models import Ring, Show
from schemas import RingCreate, RingOut

router = APIRouter(prefix="/shows/{show_id}/rings", tags=["Rings"])


async def _get_show_or_404(show_id: UUID, db: AsyncSession):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


@router.get("/", response_model=list[RingOut])
async def list_rings(show_id: UUID, db: AsyncSession = Depends(get_db)):
    await _get_show_or_404(show_id, db)
    result = await db.execute(select(Ring).where(Ring.show_id == show_id))
    return result.scalars().all()


@router.post("/", response_model=RingOut, status_code=201)
async def create_ring(show_id: UUID, body: RingCreate, db: AsyncSession = Depends(get_db)):
    await _get_show_or_404(show_id, db)
    ring = Ring(show_id=show_id, **body.model_dump())
    db.add(ring)
    await db.commit()
    await db.refresh(ring)
    return ring


@router.delete("/{ring_id}", status_code=204)
async def delete_ring(show_id: UUID, ring_id: UUID, db: AsyncSession = Depends(get_db)):
    ring = await db.get(Ring, ring_id)
    if not ring or ring.show_id != show_id:
        raise HTTPException(404, "Ring not found")
    await db.delete(ring)
    await db.commit()
