from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from database import get_db
from dependencies import require_admin
from models import Show
from schemas import ShowCreate, ShowUpdate, ShowOut

router = APIRouter(prefix="/shows", tags=["Shows"])


@router.get("/", response_model=list[ShowOut])
async def list_shows(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Show).order_by(Show.start_date))
    return result.scalars().all()


@router.post("/", response_model=ShowOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_show(body: ShowCreate, db: AsyncSession = Depends(get_db)):
    show = Show(**body.model_dump())
    db.add(show)
    await db.commit()
    await db.refresh(show)
    return show


@router.get("/{show_id}", response_model=ShowOut)
async def get_show(show_id: UUID, db: AsyncSession = Depends(get_db)):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


@router.patch("/{show_id}", response_model=ShowOut, dependencies=[Depends(require_admin)])
async def update_show(show_id: UUID, body: ShowUpdate, db: AsyncSession = Depends(get_db)):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(show, k, v)
    await db.commit()
    await db.refresh(show)
    return show


@router.delete("/{show_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_show(show_id: UUID, db: AsyncSession = Depends(get_db)):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    await db.delete(show)
    await db.commit()
