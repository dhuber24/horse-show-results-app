import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from uuid import UUID
from datetime import date

from database import get_db
from dependencies import require_admin
from models import Show
from schemas import ShowCreate, ShowUpdate, ShowOut

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/shows", tags=["Shows"])


def _serialize(show: Show) -> dict:
    return {
        "id": show.id,
        "name": show.name,
        "venue": show.venue,
        "venue_id": show.venue_id,
        "show_type_id": show.show_type_id,
        "show_type_code": show.show_type.code if show.show_type else None,
        "show_type_name": show.show_type.name if show.show_type else None,
        "start_date": show.start_date,
        "end_date": show.end_date,
        "status": show.status,
        "created_at": show.created_at,
    }


async def _auto_transition_statuses(db: AsyncSession):
    """Transition PUBLISHED→ACTIVE on start_date, ACTIVE→COMPLETED after end_date."""
    try:
        today = date.today()
        result = await db.execute(
            select(Show).where(Show.status.in_(["PUBLISHED", "ACTIVE"]))
        )
        changed = False
        for show in result.scalars().all():
            if show.status == "PUBLISHED" and today >= show.start_date:
                show.status = "ACTIVE"
                changed = True
            elif show.status == "ACTIVE" and today > show.end_date:
                show.status = "COMPLETED"
                changed = True
        if changed:
            await db.commit()
    except Exception:
        logger.exception("auto_transition_statuses failed")
        await db.rollback()


async def _get_show_with_type(db: AsyncSession, show_id: UUID) -> Show | None:
    result = await db.execute(
        select(Show).options(selectinload(Show.show_type)).where(Show.id == show_id)
    )
    return result.scalar_one_or_none()


@router.get("/", response_model=list[ShowOut])
async def list_shows(db: AsyncSession = Depends(get_db)):
    await _auto_transition_statuses(db)
    result = await db.execute(
        select(Show).options(selectinload(Show.show_type)).order_by(Show.start_date)
    )
    return [_serialize(s) for s in result.scalars().all()]


@router.post("/", response_model=ShowOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_show(body: ShowCreate, db: AsyncSession = Depends(get_db)):
    show = Show(**body.model_dump())
    db.add(show)
    await db.commit()
    show = await _get_show_with_type(db, show.id)
    return _serialize(show)


@router.get("/{show_id}", response_model=ShowOut)
async def get_show(show_id: UUID, db: AsyncSession = Depends(get_db)):
    await _auto_transition_statuses(db)
    show = await _get_show_with_type(db, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return _serialize(show)


@router.patch("/{show_id}", response_model=ShowOut, dependencies=[Depends(require_admin)])
async def update_show(show_id: UUID, body: ShowUpdate, db: AsyncSession = Depends(get_db)):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(show, k, v)
    await db.commit()
    show = await _get_show_with_type(db, show_id)
    return _serialize(show)


@router.delete("/{show_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_show(show_id: UUID, db: AsyncSession = Depends(get_db)):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    await db.delete(show)
    await db.commit()
