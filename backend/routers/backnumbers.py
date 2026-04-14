from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from pydantic import BaseModel
from typing import Optional

from database import get_db
from models import ShowEntry, Entry, Rider, Show

router = APIRouter(prefix="/shows/{show_id}/back-numbers", tags=["Back Numbers"])


class BackNumberAssignment(BaseModel):
    rider_id: UUID
    back_number: Optional[int] = None


class BulkBackNumberUpdate(BaseModel):
    assignments: list[BackNumberAssignment]


@router.get("/")
async def get_back_numbers(show_id: UUID, db: AsyncSession = Depends(get_db)):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")

    result = await db.execute(
        select(ShowEntry).where(ShowEntry.show_id == show_id).order_by(ShowEntry.back_number)
    )
    entries = result.scalars().all()
    return [{"rider_id": str(e.rider_id), "back_number": e.back_number} for e in entries]


@router.patch("/")
async def bulk_update_back_numbers(
    show_id: UUID, body: BulkBackNumberUpdate, db: AsyncSession = Depends(get_db)
):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")

    # Check for duplicates in submission
    submitted = [a.back_number for a in body.assignments if a.back_number is not None]
    if len(submitted) != len(set(submitted)):
        dupes = list(set(n for n in submitted if submitted.count(n) > 1))
        raise HTTPException(400, f"Duplicate back numbers: {dupes}")

    for assignment in body.assignments:
        result = await db.execute(
            select(ShowEntry).where(
                ShowEntry.show_id == show_id,
                ShowEntry.rider_id == assignment.rider_id
            )
        )
        show_entry = result.scalar_one_or_none()
        if show_entry:
            show_entry.back_number = assignment.back_number
        else:
            show_entry = ShowEntry(
                show_id=show_id,
                rider_id=assignment.rider_id,
                back_number=assignment.back_number
            )
            db.add(show_entry)

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Duplicate back number — each rider must have a unique number in this show")

    return {"updated": len(body.assignments)}


@router.post("/auto-assign")
async def auto_assign_back_numbers(show_id: UUID, db: AsyncSession = Depends(get_db)):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")

    # Get all unique riders entered in this show
    result = await db.execute(
        select(Entry.rider_id).join(
            Entry.class_
        ).where(Entry.class_.has(show_id=show_id)).distinct()
    )
    rider_ids = result.scalars().all()

    for i, rider_id in enumerate(rider_ids, start=1):
        existing = await db.execute(
            select(ShowEntry).where(
                ShowEntry.show_id == show_id,
                ShowEntry.rider_id == rider_id
            )
        )
        show_entry = existing.scalar_one_or_none()
        if show_entry:
            show_entry.back_number = i
        else:
            db.add(ShowEntry(show_id=show_id, rider_id=rider_id, back_number=i))

    await db.commit()
    return {"assigned": len(rider_ids)}
