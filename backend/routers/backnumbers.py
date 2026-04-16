from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from uuid import UUID
from pydantic import BaseModel
from typing import Optional

from database import get_db
from dependencies import require_admin
from models import ShowEntry, Entry, Show

router = APIRouter(prefix="/shows/{show_id}/back-numbers", tags=["Back Numbers"])


class BackNumberAssignment(BaseModel):
    exhibitor_id: UUID
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
    return [{"exhibitor_id": str(e.exhibitor_id), "back_number": e.back_number} for e in entries]


@router.patch("/", dependencies=[Depends(require_admin)])
async def bulk_update_back_numbers(
    show_id: UUID, body: BulkBackNumberUpdate, db: AsyncSession = Depends(get_db)
):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")

    # Check for duplicates within the submitted batch
    submitted = [a.back_number for a in body.assignments if a.back_number is not None]
    if len(submitted) != len(set(submitted)):
        dupes = list(set(n for n in submitted if submitted.count(n) > 1))
        raise HTTPException(400, f"Duplicate back numbers in submission: {dupes}")

    for assignment in body.assignments:
        result = await db.execute(
            select(ShowEntry).where(
                ShowEntry.show_id == show_id,
                ShowEntry.exhibitor_id == assignment.exhibitor_id
            )
        )
        show_entry = result.scalar_one_or_none()
        if show_entry:
            show_entry.back_number = assignment.back_number
        else:
            show_entry = ShowEntry(
                show_id=show_id,
                exhibitor_id=assignment.exhibitor_id,
                back_number=assignment.back_number
            )
            db.add(show_entry)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Duplicate back number — each exhibitor must have a unique number in this show")

    return {"updated": len(body.assignments)}


@router.post("/auto-assign", dependencies=[Depends(require_admin)])
async def auto_assign_back_numbers(show_id: UUID, db: AsyncSession = Depends(get_db)):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")

    result = await db.execute(
        select(Entry.exhibitor_id).join(
            Entry.class_
        ).where(Entry.class_.has(show_id=show_id)).distinct()
    )
    exhibitor_ids = result.scalars().all()

    for i, exhibitor_id in enumerate(exhibitor_ids, start=1):
        existing = await db.execute(
            select(ShowEntry).where(
                ShowEntry.show_id == show_id,
                ShowEntry.exhibitor_id == exhibitor_id
            )
        )
        show_entry = existing.scalar_one_or_none()
        if show_entry:
            show_entry.back_number = i
        else:
            db.add(ShowEntry(show_id=show_id, exhibitor_id=exhibitor_id, back_number=i))

    await db.commit()
    return {"assigned": len(exhibitor_ids)}
