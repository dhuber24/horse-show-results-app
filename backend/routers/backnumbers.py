from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, outerjoin
from sqlalchemy.exc import IntegrityError
from uuid import UUID
from pydantic import BaseModel
from typing import Optional

from database import get_db
from dependencies import require_admin, require_admin_or_show_admin
from models import ShowEntry, Entry, Class, Show, Exhibitor
from routers.shows import _assert_show_access

router = APIRouter(prefix="/shows/{show_id}/back-numbers", tags=["Back Numbers"])


class BackNumberAssignment(BaseModel):
    exhibitor_id: UUID
    back_number: Optional[int] = None


class BulkBackNumberUpdate(BaseModel):
    assignments: list[BackNumberAssignment]


@router.get("/")
async def get_back_numbers(
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

    result = await db.execute(
        select(ShowEntry).where(ShowEntry.show_id == show_id).order_by(ShowEntry.back_number)
    )
    entries = result.scalars().all()
    return [{"exhibitor_id": str(e.exhibitor_id), "back_number": e.back_number} for e in entries]


@router.get("/exhibitors")
async def list_back_number_exhibitors(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Return all exhibitors entered in any class of this show with their current back number."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")

    # All distinct exhibitors with at least one entry in this show
    exhibitor_ids_result = await db.execute(
        select(Entry.exhibitor_id)
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id)
        .distinct()
    )
    exhibitor_ids = exhibitor_ids_result.scalars().all()

    if not exhibitor_ids:
        return []

    # Fetch exhibitor names in one query
    exhibitors_result = await db.execute(
        select(Exhibitor).where(Exhibitor.id.in_(exhibitor_ids))
    )
    exhibitors_by_id = {e.id: e for e in exhibitors_result.scalars().all()}

    # Fetch existing back numbers in one query
    show_entries_result = await db.execute(
        select(ShowEntry).where(
            ShowEntry.show_id == show_id,
            ShowEntry.exhibitor_id.in_(exhibitor_ids),
        )
    )
    back_number_by_exhibitor = {se.exhibitor_id: se.back_number for se in show_entries_result.scalars().all()}

    return [
        {
            "exhibitor_id": str(eid),
            "full_name": exhibitors_by_id[eid].full_name,
            "back_number": back_number_by_exhibitor.get(eid),
        }
        for eid in exhibitor_ids
        if eid in exhibitors_by_id
    ]


@router.patch("/", dependencies=[Depends(require_admin_or_show_admin)])
async def bulk_update_back_numbers(
    show_id: UUID,
    body: BulkBackNumberUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")

    # Check for duplicates within the submitted batch
    submitted = [a.back_number for a in body.assignments if a.back_number is not None]
    if len(submitted) != len(set(submitted)):
        dupes = list(set(n for n in submitted if submitted.count(n) > 1))
        raise HTTPException(400, f"Duplicate back numbers in submission: {dupes}")

    # Fetch all existing ShowEntry rows for this show in one query
    exhibitor_ids = [a.exhibitor_id for a in body.assignments]
    existing_result = await db.execute(
        select(ShowEntry).where(
            ShowEntry.show_id == show_id,
            ShowEntry.exhibitor_id.in_(exhibitor_ids),
        )
    )
    existing_by_exhibitor = {se.exhibitor_id: se for se in existing_result.scalars().all()}

    for assignment in body.assignments:
        show_entry = existing_by_exhibitor.get(assignment.exhibitor_id)
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


@router.post("/auto-assign", dependencies=[Depends(require_admin_or_show_admin)])
async def auto_assign_back_numbers(
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

    result = await db.execute(
        select(Entry.exhibitor_id).join(
            Entry.class_
        ).where(Entry.class_.has(show_id=show_id)).distinct()
    )
    exhibitor_ids = result.scalars().all()

    # Fetch all existing ShowEntry rows for this show in one query
    existing_result = await db.execute(
        select(ShowEntry).where(
            ShowEntry.show_id == show_id,
            ShowEntry.exhibitor_id.in_(exhibitor_ids),
        )
    )
    existing_by_exhibitor = {se.exhibitor_id: se for se in existing_result.scalars().all()}

    for i, exhibitor_id in enumerate(exhibitor_ids, start=1):
        show_entry = existing_by_exhibitor.get(exhibitor_id)
        if show_entry:
            show_entry.back_number = i
        else:
            db.add(ShowEntry(show_id=show_id, exhibitor_id=exhibitor_id, back_number=i))

    await db.commit()
    return {"assigned": len(exhibitor_ids)}
