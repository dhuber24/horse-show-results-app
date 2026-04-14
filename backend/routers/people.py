from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from typing import Optional
from pydantic import BaseModel

from database import get_db
from models import User, Horse, Rider
from schemas import UserCreate, UserOut, HorseCreate, HorseOut, RiderCreate, RiderOut

# ── Users ──────────────────────────────────────────────────────────────────────

users_router = APIRouter(prefix="/users", tags=["Users"])

@users_router.get("/", response_model=list[UserOut])
async def list_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).order_by(User.full_name))
    return result.scalars().all()

@users_router.post("/", response_model=UserOut, status_code=201)
async def create_user(body: UserCreate, db: AsyncSession = Depends(get_db)):
    user = User(**body.model_dump())
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user

@users_router.get("/{user_id}", response_model=UserOut)
async def get_user(user_id: UUID, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return user

@users_router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: UUID, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    await db.delete(user)
    await db.commit()


# ── Horses ─────────────────────────────────────────────────────────────────────

horses_router = APIRouter(prefix="/horses", tags=["Horses"])

@horses_router.get("/", response_model=list[HorseOut])
async def list_horses(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Horse).order_by(Horse.name))
    return result.scalars().all()

@horses_router.post("/", response_model=HorseOut, status_code=201)
async def create_horse(body: HorseCreate, db: AsyncSession = Depends(get_db)):
    horse = Horse(**body.model_dump())
    db.add(horse)
    await db.commit()
    await db.refresh(horse)
    return horse

@horses_router.get("/{horse_id}", response_model=HorseOut)
async def get_horse(horse_id: UUID, db: AsyncSession = Depends(get_db)):
    horse = await db.get(Horse, horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    return horse

@horses_router.delete("/{horse_id}", status_code=204)
async def delete_horse(horse_id: UUID, db: AsyncSession = Depends(get_db)):
    horse = await db.get(Horse, horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    await db.delete(horse)
    await db.commit()


# ── Riders ─────────────────────────────────────────────────────────────────────

class RiderCreateWithUser(BaseModel):
    full_name: str
    user_id: Optional[UUID] = None

class RiderLink(BaseModel):
    user_id: UUID

riders_router = APIRouter(prefix="/riders", tags=["Riders"])

@riders_router.get("/", response_model=list[RiderOut])
async def list_riders(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Rider).order_by(Rider.full_name))
    return result.scalars().all()

@riders_router.post("/", response_model=RiderOut, status_code=201)
async def create_rider(body: RiderCreateWithUser, db: AsyncSession = Depends(get_db)):
    rider = Rider(**body.model_dump())
    db.add(rider)
    await db.commit()
    await db.refresh(rider)
    return rider

@riders_router.get("/{rider_id}", response_model=RiderOut)
async def get_rider(rider_id: UUID, db: AsyncSession = Depends(get_db)):
    rider = await db.get(Rider, rider_id)
    if not rider:
        raise HTTPException(404, "Rider not found")
    return rider

@riders_router.patch("/{rider_id}/link", response_model=RiderOut)
async def link_rider(rider_id: UUID, body: RiderLink, db: AsyncSession = Depends(get_db)):
    rider = await db.get(Rider, rider_id)
    if not rider:
        raise HTTPException(404, "Rider not found")
    rider.user_id = body.user_id
    await db.commit()
    await db.refresh(rider)
    return rider

@riders_router.delete("/{rider_id}", status_code=204)
async def delete_rider(rider_id: UUID, db: AsyncSession = Depends(get_db)):
    rider = await db.get(Rider, rider_id)
    if not rider:
        raise HTTPException(404, "Rider not found")
    await db.delete(rider)
    await db.commit()
