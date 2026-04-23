import logging
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from uuid import UUID
from datetime import date
from typing import Optional

from database import get_db
from dependencies import require_admin, require_admin_or_show_admin, INTERNAL_API_KEY
from models import Show, ShowSecretary
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


@router.get("/")
async def list_shows(
    x_api_key: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    x_user_role: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    await _auto_transition_statuses(db)
    query = select(Show).options(selectinload(Show.show_type)).order_by(Show.start_date)

    if x_api_key and x_api_key == INTERNAL_API_KEY and x_user_role == "SHOW_SECRETARY" and x_user_id:
        query = (
            select(Show)
            .options(selectinload(Show.show_type))
            .join(ShowSecretary, ShowSecretary.show_id == Show.id)
            .where(ShowSecretary.user_id == UUID(x_user_id))
            .order_by(Show.start_date)
        )

    result = await db.execute(query)
    return [_serialize(s) for s in result.scalars().all()]


@router.post("/", response_model=ShowOut, status_code=201)
async def create_show(
    body: ShowCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    if x_user_role not in ("ADMIN", "SHOW_SECRETARY"):
        raise HTTPException(403, "Admin or Show Secretary access required")

    show = Show(**body.model_dump(), created_by_user_id=UUID(x_user_id))
    db.add(show)
    await db.commit()

    if x_user_role == "SHOW_SECRETARY":
        db.add(ShowSecretary(show_id=show.id, user_id=UUID(x_user_id)))
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


async def _assert_show_access(show_id: UUID, x_api_key: str, x_user_id: str, x_user_role: str, db: AsyncSession):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    if x_user_role == "ADMIN":
        return
    if x_user_role == "SHOW_SECRETARY":
        row = await db.execute(
            select(ShowSecretary).where(ShowSecretary.show_id == show_id, ShowSecretary.user_id == UUID(x_user_id))
        )
        if row.scalar_one_or_none():
            return
    raise HTTPException(403, "Not authorized for this show")


@router.patch("/{show_id}", response_model=ShowOut)
async def update_show(
    show_id: UUID,
    body: ShowUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(show, k, v)
    await db.commit()
    show = await _get_show_with_type(db, show_id)
    return _serialize(show)


@router.delete("/{show_id}", status_code=204)
async def delete_show(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    await db.delete(show)
    await db.commit()
