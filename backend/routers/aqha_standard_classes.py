from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import AqhaStandardClass
from schemas import AqhaStandardClassOut

router = APIRouter(prefix="/aqha-standard-classes", tags=["AQHA Standard Classes"])


@router.get("/", response_model=list[AqhaStandardClassOut])
async def list_aqha_standard_classes(
    q: str | None = Query(default=None, description="Search code or name"),
    division: str | None = Query(default=None, description="Filter by division"),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(AqhaStandardClass).order_by(AqhaStandardClass.division, AqhaStandardClass.sort_order)
    if division:
        stmt = stmt.where(AqhaStandardClass.division == division)
    result = await db.execute(stmt)
    rows = result.scalars().all()
    if q:
        q_lower = q.lower()
        rows = [r for r in rows if q_lower in r.code.lower() or q_lower in r.name.lower()]
    return rows


@router.get("/divisions", response_model=list[str])
async def list_divisions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AqhaStandardClass.division)
        .distinct()
        .order_by(AqhaStandardClass.division)
    )
    return [row[0] for row in result.all()]
