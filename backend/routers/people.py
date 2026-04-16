from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, union
from sqlalchemy.exc import IntegrityError
from uuid import UUID
from typing import Optional
from pydantic import BaseModel

from database import get_db
from dependencies import require_admin
from models import User, Horse, Exhibitor, Entry, ExhibitorHorse
from schemas import UserCreate, UserOut, HorseCreate, HorseUpdate, HorseOut, ExhibitorCreate, ExhibitorUpdate, ExhibitorOut

# ── Users ──────────────────────────────────────────────────────────────────────

users_router = APIRouter(prefix="/users", tags=["Users"])

@users_router.get("/", response_model=list[UserOut], dependencies=[Depends(require_admin)])
async def list_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).order_by(User.full_name))
    return result.scalars().all()

@users_router.post("/", response_model=UserOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_user(body: UserCreate, db: AsyncSession = Depends(get_db)):
    user = User(**body.model_dump())
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user

@users_router.get("/{user_id}", response_model=UserOut, dependencies=[Depends(require_admin)])
async def get_user(user_id: UUID, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return user

@users_router.delete("/{user_id}", status_code=204, dependencies=[Depends(require_admin)])
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

@horses_router.post("/", response_model=HorseOut, status_code=201, dependencies=[Depends(require_admin)])
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

@horses_router.patch("/{horse_id}", response_model=HorseOut, dependencies=[Depends(require_admin)])
async def update_horse(horse_id: UUID, body: HorseUpdate, db: AsyncSession = Depends(get_db)):
    horse = await db.get(Horse, horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(horse, k, v)
    await db.commit()
    await db.refresh(horse)
    return horse

@horses_router.delete("/{horse_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_horse(horse_id: UUID, db: AsyncSession = Depends(get_db)):
    horse = await db.get(Horse, horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    await db.delete(horse)
    await db.commit()


# ── Exhibitors ─────────────────────────────────────────────────────────────────

class ExhibitorCreateWithUser(BaseModel):
    full_name: str
    user_id: Optional[UUID] = None

class ExhibitorLink(BaseModel):
    user_id: UUID

exhibitors_router = APIRouter(prefix="/exhibitors", tags=["Exhibitors"])

@exhibitors_router.get("/", response_model=list[ExhibitorOut])
async def list_exhibitors(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Exhibitor).order_by(Exhibitor.full_name))
    return result.scalars().all()

@exhibitors_router.post("/", response_model=ExhibitorOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_exhibitor(body: ExhibitorCreateWithUser, db: AsyncSession = Depends(get_db)):
    exhibitor = Exhibitor(**body.model_dump())
    db.add(exhibitor)
    await db.commit()
    await db.refresh(exhibitor)
    return exhibitor

@exhibitors_router.get("/{exhibitor_id}", response_model=ExhibitorOut)
async def get_exhibitor(exhibitor_id: UUID, db: AsyncSession = Depends(get_db)):
    exhibitor = await db.get(Exhibitor, exhibitor_id)
    if not exhibitor:
        raise HTTPException(404, "Exhibitor not found")
    return exhibitor

@exhibitors_router.patch("/{exhibitor_id}", response_model=ExhibitorOut, dependencies=[Depends(require_admin)])
async def update_exhibitor(exhibitor_id: UUID, body: ExhibitorUpdate, db: AsyncSession = Depends(get_db)):
    exhibitor = await db.get(Exhibitor, exhibitor_id)
    if not exhibitor:
        raise HTTPException(404, "Exhibitor not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(exhibitor, k, v)
    await db.commit()
    await db.refresh(exhibitor)
    return exhibitor

class ExhibitorHorseAttach(BaseModel):
    horse_id: UUID

@exhibitors_router.get("/{exhibitor_id}/horses", response_model=list[HorseOut])
async def get_exhibitor_horses(exhibitor_id: UUID, db: AsyncSession = Depends(get_db)):
    """Returns horses directly attached to this exhibitor, plus any from entries."""
    from_link = select(Horse.id).join(ExhibitorHorse, ExhibitorHorse.horse_id == Horse.id).where(ExhibitorHorse.exhibitor_id == exhibitor_id)
    from_entry = select(Horse.id).join(Entry, Entry.horse_id == Horse.id).where(Entry.exhibitor_id == exhibitor_id)
    combined = union(from_link, from_entry).subquery()
    result = await db.execute(
        select(Horse).where(Horse.id.in_(select(combined.c.id))).order_by(Horse.name)
    )
    return result.scalars().all()

@exhibitors_router.post("/{exhibitor_id}/horses", response_model=HorseOut, status_code=201, dependencies=[Depends(require_admin)])
async def attach_horse_to_exhibitor(exhibitor_id: UUID, body: ExhibitorHorseAttach, db: AsyncSession = Depends(get_db)):
    exhibitor = await db.get(Exhibitor, exhibitor_id)
    if not exhibitor:
        raise HTTPException(404, "Exhibitor not found")
    horse = await db.get(Horse, body.horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    link = ExhibitorHorse(exhibitor_id=exhibitor_id, horse_id=body.horse_id)
    db.add(link)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Horse is already attached to this exhibitor")
    return horse

@exhibitors_router.delete("/{exhibitor_id}/horses/{horse_id}", status_code=204, dependencies=[Depends(require_admin)])
async def detach_horse_from_exhibitor(exhibitor_id: UUID, horse_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ExhibitorHorse).where(ExhibitorHorse.exhibitor_id == exhibitor_id, ExhibitorHorse.horse_id == horse_id)
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Horse is not attached to this exhibitor")
    await db.delete(link)
    await db.commit()

@exhibitors_router.patch("/{exhibitor_id}/link", response_model=ExhibitorOut, dependencies=[Depends(require_admin)])
async def link_exhibitor(exhibitor_id: UUID, body: ExhibitorLink, db: AsyncSession = Depends(get_db)):
    exhibitor = await db.get(Exhibitor, exhibitor_id)
    if not exhibitor:
        raise HTTPException(404, "Exhibitor not found")
    exhibitor.user_id = body.user_id
    await db.commit()
    await db.refresh(exhibitor)
    return exhibitor

@exhibitors_router.delete("/{exhibitor_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_exhibitor(exhibitor_id: UUID, db: AsyncSession = Depends(get_db)):
    exhibitor = await db.get(Exhibitor, exhibitor_id)
    if not exhibitor:
        raise HTTPException(404, "Exhibitor not found")
    await db.delete(exhibitor)
    await db.commit()
