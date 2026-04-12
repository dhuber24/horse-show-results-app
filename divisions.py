from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from database import get_db
from models import Division, Show
from schemas import DivisionCreate, DivisionOut

router = APIRouter(prefix="/shows/{show_id}/divisions", tags=["Divisions"])


async def _get_show_or_404(show_id: UUID, db: AsyncSession):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


@router.get("/", response_model=list[DivisionOut])
async def list_divisions(show_id: UUID, db: AsyncSession = Depends(get_db)):
    await _get_show_or_404(show_id, db)
    result = await db.execute(select(Division).where(Division.show_id == show_id))
    return result.scalars().all()


@router.post("/", response_model=DivisionOut, status_code=201)
async def create_division(show_id: UUID, body: DivisionCreate, db: AsyncSession = Depends(get_db)):
    await _get_show_or_404(show_id, db)
    division = Division(show_id=show_id, **body.model_dump())
    db.add(division)
    await db.commit()
    await db.refresh(division)
    return division


@router.delete("/{division_id}", status_code=204)
async def delete_division(show_id: UUID, division_id: UUID, db: AsyncSession = Depends(get_db)):
    division = await db.get(Division, division_id)
    if not division or division.show_id != show_id:
        raise HTTPException(404, "Division not found")
    await db.delete(division)
    await db.commit()
