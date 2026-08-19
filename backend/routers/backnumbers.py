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
    return [
        {
            "exhibitor_id": str(e.exhibitor_id),
            "back_number": e.back_number,
            "preferred_back_number": e.preferred_back_number,
        }
        for e in entries
    ]


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
    show_entry_by_exhibitor = {se.exhibitor_id: se for se in show_entries_result.scalars().all()}

    return [
        {
            "exhibitor_id": str(eid),
            "full_name": exhibitors_by_id[eid].full_name,
            "back_number": (
                show_entry_by_exhibitor[eid].back_number
                if eid in show_entry_by_exhibitor else None
            ),
            # What they asked for at registration. Shown next to the field so
            # staff renumbering a show can see whose number was a request.
            "preferred_back_number": (
                show_entry_by_exhibitor[eid].preferred_back_number
                if eid in show_entry_by_exhibitor else None
            ),
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
    """Give every entered exhibitor a number, honouring the ones they asked for.

    Requested numbers (`preferred_back_number`, migration 104) are claimed
    first, then everyone else is filled in from the lowest number still free.
    Numbering straight through 1..N instead would undo every request in one
    click, which makes asking for a number pointless — and the office would
    only find out at the desk, from the exhibitor.

    Two collisions have to be avoided, and both are why this clears the field
    before it fills it:

      * Numbers held by roster rows *outside* this run — someone on the show
        roster with no class entry yet — are reserved, not overwritten.
      * Reassigning in place can swap two numbers, and Postgres checks the
        unique constraint per statement, so the halfway state raises. Nulling
        the whole target set first and flushing removes that window.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")

    result = await db.execute(
        select(Entry.exhibitor_id).join(
            Entry.class_
        ).where(Entry.class_.has(show_id=show_id)).distinct()
    )
    exhibitor_ids = list(result.scalars().all())

    # Every roster row for the show, not only the ones being numbered: the rest
    # hold numbers this run must not hand out twice.
    all_rows_result = await db.execute(
        select(ShowEntry).where(ShowEntry.show_id == show_id)
    )
    all_rows = list(all_rows_result.scalars().all())
    rows_by_exhibitor = {se.exhibitor_id: se for se in all_rows}

    targets = []
    for exhibitor_id in exhibitor_ids:
        row = rows_by_exhibitor.get(exhibitor_id)
        if row is None:
            row = ShowEntry(show_id=show_id, exhibitor_id=exhibitor_id)
            db.add(row)
            rows_by_exhibitor[exhibitor_id] = row
        targets.append(row)

    target_ids = {id(row) for row in targets}
    reserved = {
        se.back_number
        for se in all_rows
        if se.back_number is not None and id(se) not in target_ids
    }

    for row in targets:
        row.back_number = None
    await db.flush()

    # Requests first, so a sequential fill can never take a number somebody
    # asked for out from under them.
    unassigned = []
    for row in targets:
        wanted = row.preferred_back_number
        if wanted is not None and wanted not in reserved:
            row.back_number = wanted
            reserved.add(wanted)
        else:
            unassigned.append(row)

    next_number = 1
    for row in unassigned:
        while next_number in reserved:
            next_number += 1
        row.back_number = next_number
        reserved.add(next_number)

    await db.commit()
    return {"assigned": len(targets)}
