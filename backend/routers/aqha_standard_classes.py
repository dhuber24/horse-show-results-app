"""AQHA's approved class codes.

Kept at its own path because the AQHA picker, the class-code validation, and
the frontend proxy already point here. The rows now come from the shared
catalog view rather than a per-association table — see migration 114.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from schemas import AqhaStandardClassOut
import standard_classes

router = APIRouter(prefix="/aqha-standard-classes", tags=["AQHA Standard Classes"])

SHOW_TYPE_CODE = "AQHA"


async def _show_type_id(db: AsyncSession):
    show_type_id = await standard_classes.show_type_id_for(db, SHOW_TYPE_CODE)
    if show_type_id is None:
        raise HTTPException(404, "AQHA show type not found")
    return show_type_id


@router.get("/", response_model=list[AqhaStandardClassOut])
async def list_aqha_standard_classes(
    q: str | None = Query(default=None, description="Search code or name"),
    division: str | None = Query(default=None, description="Filter by division"),
    db: AsyncSession = Depends(get_db),
):
    return await standard_classes.list_classes(
        db, await _show_type_id(db), division=division, q=q
    )


@router.get("/divisions", response_model=list[str])
async def list_divisions(db: AsyncSession = Depends(get_db)):
    return await standard_classes.list_divisions(db, await _show_type_id(db))
