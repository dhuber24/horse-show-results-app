from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from typing import Optional

from database import get_db
from dependencies import require_admin, INTERNAL_API_KEY
from models import Venue, VenueAdmin, User
from schemas import VenueCreate, VenueUpdate, VenueOut

router = APIRouter(prefix="/venues", tags=["Venues"])


@router.get("/", response_model=list[VenueOut])
async def list_venues(
    x_api_key: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    x_user_role: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    if x_api_key and x_api_key == INTERNAL_API_KEY and x_user_role == "SHOW_ADMIN" and x_user_id:
        result = await db.execute(
            select(Venue)
            .join(VenueAdmin, VenueAdmin.venue_id == Venue.id)
            .where(VenueAdmin.user_id == UUID(x_user_id))
            .order_by(Venue.name)
        )
    else:
        result = await db.execute(select(Venue).order_by(Venue.name))
    return result.scalars().all()


@router.post("/", response_model=VenueOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_venue(body: VenueCreate, db: AsyncSession = Depends(get_db)):
    venue = Venue(**body.model_dump())
    db.add(venue)
    await db.commit()
    await db.refresh(venue)
    return venue


@router.get("/{venue_id}", response_model=VenueOut)
async def get_venue(venue_id: UUID, db: AsyncSession = Depends(get_db)):
    venue = await db.get(Venue, venue_id)
    if not venue:
        raise HTTPException(404, "Venue not found")
    return venue


@router.patch("/{venue_id}", response_model=VenueOut, dependencies=[Depends(require_admin)])
async def update_venue(venue_id: UUID, body: VenueUpdate, db: AsyncSession = Depends(get_db)):
    venue = await db.get(Venue, venue_id)
    if not venue:
        raise HTTPException(404, "Venue not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(venue, k, v)
    await db.commit()
    await db.refresh(venue)
    return venue


@router.delete("/{venue_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_venue(venue_id: UUID, db: AsyncSession = Depends(get_db)):
    venue = await db.get(Venue, venue_id)
    if not venue:
        raise HTTPException(404, "Venue not found")
    await db.delete(venue)
    await db.commit()


# ── Venue Admins (ADMIN only) ──────────────────────────────────────────────────

from schemas import UserOut

@router.get("/{venue_id}/admins", response_model=list[UserOut], dependencies=[Depends(require_admin)])
async def list_venue_admins(venue_id: UUID, db: AsyncSession = Depends(get_db)):
    if not await db.get(Venue, venue_id):
        raise HTTPException(404, "Venue not found")
    result = await db.execute(
        select(User)
        .join(VenueAdmin, VenueAdmin.user_id == User.id)
        .where(VenueAdmin.venue_id == venue_id)
        .order_by(User.full_name)
    )
    return result.scalars().all()


@router.post("/{venue_id}/admins", response_model=UserOut, status_code=201, dependencies=[Depends(require_admin)])
async def add_venue_admin(venue_id: UUID, body: dict, db: AsyncSession = Depends(get_db)):
    user_id = body.get("user_id")
    if not user_id:
        raise HTTPException(400, "user_id required")
    if not await db.get(Venue, venue_id):
        raise HTTPException(404, "Venue not found")
    user = await db.get(User, UUID(user_id))
    if not user:
        raise HTTPException(404, "User not found")
    if user.role != "SHOW_ADMIN":
        raise HTTPException(400, "User must have SHOW_ADMIN role")
    existing = await db.execute(
        select(VenueAdmin).where(VenueAdmin.venue_id == venue_id, VenueAdmin.user_id == user.id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "User is already an admin of this venue")
    db.add(VenueAdmin(venue_id=venue_id, user_id=user.id))
    await db.commit()
    return user


@router.delete("/{venue_id}/admins/{user_id}", status_code=204, dependencies=[Depends(require_admin)])
async def remove_venue_admin(venue_id: UUID, user_id: UUID, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        select(VenueAdmin).where(VenueAdmin.venue_id == venue_id, VenueAdmin.user_id == user_id)
    )
    entry = row.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Venue admin assignment not found")
    await db.delete(entry)
    await db.commit()
