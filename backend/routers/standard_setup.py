"""Read-only lookup endpoints for the show setup picker.

Exposes curated lists of standard ring names and association-specific
division names. Standard divisions with show_type_id NULL are a generic
fallback used when no curated list exists for a given show type.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from uuid import UUID

from database import get_db
from models import StandardRing, StandardDivision
from schemas import StandardRingOut, StandardDivisionOut

router = APIRouter(prefix="/standard-setup", tags=["Standard Setup"])


@router.get("/rings", response_model=list[StandardRingOut])
async def list_standard_rings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(StandardRing).order_by(StandardRing.sort_order, StandardRing.name)
    )
    return result.scalars().all()


@router.get("/divisions", response_model=list[StandardDivisionOut])
async def list_standard_divisions(
    show_type_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Return divisions for the given show type, plus the generic fallback set.

    The frontend can deduplicate by name or display them as one merged list.
    """
    stmt = select(StandardDivision)
    if show_type_id is not None:
        stmt = stmt.where(
            or_(
                StandardDivision.show_type_id == show_type_id,
                StandardDivision.show_type_id.is_(None),
            )
        )
    stmt = stmt.order_by(StandardDivision.sort_order, StandardDivision.name)
    result = await db.execute(stmt)
    return result.scalars().all()
