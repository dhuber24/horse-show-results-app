from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from database import get_db
from dependencies import INTERNAL_API_KEY, safe_uuid
from models import Venue
from schemas import VenueCreate, VenueUpdate, VenueOut

router = APIRouter(prefix="/venues", tags=["Venues"])


@router.get("/", response_model=list[VenueOut])
async def list_venues(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Venue).order_by(Venue.name))
    return result.scalars().all()


@router.post("/", response_model=VenueOut, status_code=201)
async def create_venue(
    body: VenueCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    if x_user_role not in ("ADMIN", "SHOW_MANAGER"):
        raise HTTPException(403, "Admin or Show Manager access required")
    venue = Venue(**body.model_dump(), created_by_user_id=safe_uuid(x_user_id))
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


@router.patch("/{venue_id}", response_model=VenueOut)
async def update_venue(
    venue_id: UUID,
    body: VenueUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    venue = await db.get(Venue, venue_id)
    if not venue:
        raise HTTPException(404, "Venue not found")
    if x_user_role == "ADMIN":
        pass
    elif x_user_role == "SHOW_MANAGER" and venue.created_by_user_id == safe_uuid(x_user_id):
        pass
    else:
        raise HTTPException(403, "Not authorized to edit this venue")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(venue, k, v)
    await db.commit()
    await db.refresh(venue)
    return venue


@router.delete("/{venue_id}", status_code=204)
async def delete_venue(
    venue_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    venue = await db.get(Venue, venue_id)
    if not venue:
        raise HTTPException(404, "Venue not found")
    if x_user_role == "ADMIN":
        pass
    elif x_user_role == "SHOW_MANAGER" and venue.created_by_user_id == safe_uuid(x_user_id):
        pass
    else:
        raise HTTPException(403, "Not authorized to delete this venue")
    await db.delete(venue)
    await db.commit()
