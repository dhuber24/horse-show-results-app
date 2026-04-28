from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from uuid import UUID

from database import get_db
from dependencies import require_admin
from models import HorseColor
from schemas import HorseColorCreate, HorseColorUpdate, HorseColorOut

router = APIRouter(prefix="/horse-colors", tags=["HorseColors"])


@router.get("/", response_model=list[HorseColorOut])
async def list_horse_colors(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(HorseColor).order_by(HorseColor.name))
    return result.scalars().all()


@router.post("/", response_model=HorseColorOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_horse_color(body: HorseColorCreate, db: AsyncSession = Depends(get_db)):
    color = HorseColor(**body.model_dump())
    db.add(color)
    try:
        await db.commit()
        await db.refresh(color)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "A color with that name already exists")
    return color


@router.get("/{color_id}", response_model=HorseColorOut)
async def get_horse_color(color_id: UUID, db: AsyncSession = Depends(get_db)):
    color = await db.get(HorseColor, color_id)
    if not color:
        raise HTTPException(404, "Horse color not found")
    return color


@router.patch("/{color_id}", response_model=HorseColorOut, dependencies=[Depends(require_admin)])
async def update_horse_color(color_id: UUID, body: HorseColorUpdate, db: AsyncSession = Depends(get_db)):
    color = await db.get(HorseColor, color_id)
    if not color:
        raise HTTPException(404, "Horse color not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(color, k, v)
    try:
        await db.commit()
        await db.refresh(color)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "A color with that name already exists")
    return color


@router.delete("/{color_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_horse_color(color_id: UUID, db: AsyncSession = Depends(get_db)):
    color = await db.get(HorseColor, color_id)
    if not color:
        raise HTTPException(404, "Horse color not found")
    await db.delete(color)
    await db.commit()
