"""Coat patterns — the second axis of a horse's coat (migration 116).

Deliberately the same shape as `horse_colors`: it is the same kind of curated
lookup, edited by the same people on the same kind of screen. Patterns lived in
the colour list until 116, which meant a Bay Tobiano could be recorded as one or
the other and never both.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from uuid import UUID

from database import get_db
from dependencies import require_admin
from models import HorsePattern
from schemas import HorsePatternCreate, HorsePatternUpdate, HorsePatternOut

router = APIRouter(prefix="/horse-patterns", tags=["HorsePatterns"])


@router.get("/", response_model=list[HorsePatternOut])
async def list_horse_patterns(db: AsyncSession = Depends(get_db)):
    """Ordered by `sort_order`, not by name.

    The colours endpoint sorts alphabetically and gets away with it. Patterns
    have a shape a list can carry: the APHA ones seeded 1-7 are what a Paint show
    reaches for, and the Appaloosa ones sit at 100+ below them. Alphabetical
    would open the list on "Appaloosa - Blanket".
    """
    result = await db.execute(
        select(HorsePattern).order_by(HorsePattern.sort_order, HorsePattern.name)
    )
    return result.scalars().all()


@router.post("/", response_model=HorsePatternOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_horse_pattern(body: HorsePatternCreate, db: AsyncSession = Depends(get_db)):
    pattern = HorsePattern(**body.model_dump())
    db.add(pattern)
    try:
        await db.commit()
        await db.refresh(pattern)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "A pattern with that name already exists")
    return pattern


@router.get("/{pattern_id}", response_model=HorsePatternOut)
async def get_horse_pattern(pattern_id: UUID, db: AsyncSession = Depends(get_db)):
    pattern = await db.get(HorsePattern, pattern_id)
    if not pattern:
        raise HTTPException(404, "Horse pattern not found")
    return pattern


@router.patch("/{pattern_id}", response_model=HorsePatternOut, dependencies=[Depends(require_admin)])
async def update_horse_pattern(pattern_id: UUID, body: HorsePatternUpdate, db: AsyncSession = Depends(get_db)):
    pattern = await db.get(HorsePattern, pattern_id)
    if not pattern:
        raise HTTPException(404, "Horse pattern not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(pattern, k, v)
    try:
        await db.commit()
        await db.refresh(pattern)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "A pattern with that name already exists")
    return pattern


@router.delete("/{pattern_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_horse_pattern(pattern_id: UUID, db: AsyncSession = Depends(get_db)):
    pattern = await db.get(HorsePattern, pattern_id)
    if not pattern:
        raise HTTPException(404, "Horse pattern not found")
    await db.delete(pattern)
    await db.commit()
