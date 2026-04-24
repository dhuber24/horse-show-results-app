from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from uuid import UUID

from database import get_db
from dependencies import require_admin
from models import Breed
from schemas import BreedCreate, BreedUpdate, BreedOut

router = APIRouter(prefix="/breeds", tags=["Breeds"])


@router.get("/", response_model=list[BreedOut])
async def list_breeds(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Breed).order_by(Breed.name))
    return result.scalars().all()


@router.post("/", response_model=BreedOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_breed(body: BreedCreate, db: AsyncSession = Depends(get_db)):
    breed = Breed(**body.model_dump())
    db.add(breed)
    try:
        await db.commit()
        await db.refresh(breed)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "A breed with that name already exists")
    return breed


@router.get("/{breed_id}", response_model=BreedOut)
async def get_breed(breed_id: UUID, db: AsyncSession = Depends(get_db)):
    breed = await db.get(Breed, breed_id)
    if not breed:
        raise HTTPException(404, "Breed not found")
    return breed


@router.patch("/{breed_id}", response_model=BreedOut, dependencies=[Depends(require_admin)])
async def update_breed(breed_id: UUID, body: BreedUpdate, db: AsyncSession = Depends(get_db)):
    breed = await db.get(Breed, breed_id)
    if not breed:
        raise HTTPException(404, "Breed not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(breed, k, v)
    try:
        await db.commit()
        await db.refresh(breed)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "A breed with that name already exists")
    return breed


@router.delete("/{breed_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_breed(breed_id: UUID, db: AsyncSession = Depends(get_db)):
    breed = await db.get(Breed, breed_id)
    if not breed:
        raise HTTPException(404, "Breed not found")
    await db.delete(breed)
    await db.commit()
