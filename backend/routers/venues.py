from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from database import get_db
from dependencies import require_admin
from models import Venue
from schemas import VenueCreate, VenueUpdate, VenueOut

router = APIRouter(prefix="/venues", tags=["Venues"])


@router.get("/", response_model=list[VenueOut])
async def list_venues(db: AsyncSession = Depends(get_db)):
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
