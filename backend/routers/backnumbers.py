from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, outerjoin
from sqlalchemy.exc import IntegrityError
from uuid import UUID
from pydantic import BaseModel, Field
from typing import Optional

from backnumbers import PER_HORSE, assign_missing_horse_numbers
from database import get_db
from dependencies import require_admin, require_admin_or_show_admin
from models import ShowEntry, ShowHorseNumber, Entry, Class, Show, Exhibitor, Horse
from routers.shows import _assert_show_access

router = APIRouter(prefix="/shows/{show_id}/back-numbers", tags=["Back Numbers"])


class BackNumberAssignment(BaseModel):
    exhibitor_id: UUID
    back_number: Optional[int] = None


class BulkBackNumberUpdate(BaseModel):
    assignments: list[BackNumberAssignment]


class HorseBackNumberAssignment(BaseModel):
    horse_id: UUID
    back_number: Optional[int] = Field(default=None, ge=1, le=9999)


class BulkHorseBackNumberUpdate(BaseModel):
    assignments: list[HorseBackNumberAssignment]


def _wrong_kind(show: Show) -> HTTPException:
    """A number of the kind this show does not issue (migration 161). Refused
    rather than stored, because nothing would read it and staff would think it
    had taken."""
    if show.back_number_per == PER_HORSE:
        message = (
            "This show gives each horse its own back number. "
            "Number the horse, not the exhibitor."
        )
    else:
        message = (
            "This show gives each exhibitor one back number. "
            "Switch it to a number per horse under Show details first."
        )
    return HTTPException(409, {"code": "BACK_NUMBER_KIND", "message": message})


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
    if show.back_number_per == PER_HORSE:
        raise _wrong_kind(show)

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

    # Somebody outside this batch already wears the number. Named, so the desk
    # can tell staff who has 42 rather than only that 42 is a duplicate; rows
    # inside the batch are excluded because a batch may legitimately swap two
    # numbers. The unique constraint below is still what makes it safe.
    if submitted:
        holders = await db.execute(
            select(ShowEntry.back_number, Exhibitor.full_name)
            .join(Exhibitor, Exhibitor.id == ShowEntry.exhibitor_id)
            .where(
                ShowEntry.show_id == show_id,
                ShowEntry.back_number.in_(submitted),
                ShowEntry.exhibitor_id.not_in(exhibitor_ids),
            )
        )
        clash = holders.first()
        if clash is not None:
            number, holder = clash
            raise HTTPException(
                409,
                {
                    "code": "BACK_NUMBER_TAKEN",
                    "message": (
                        f"Back number {number} is already held by {holder}. "
                        "Pick a different one."
                    ),
                },
            )

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
    if show.back_number_per == PER_HORSE:
        return {"assigned": await _renumber_horses(show_id, db)}

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


async def _renumber_horses(show_id: UUID, db: AsyncSession) -> int:
    """Auto-assign at a show that numbers horses (migration 161): every entered
    horse, requests first, then the lowest free number -- the same two rules,
    for the same reasons, as the exhibitor version above. A row for a horse no
    longer entered keeps its number, which stays reserved."""
    entered = await db.execute(
        select(Entry.horse_id)
        .join(Class, Class.id == Entry.class_id)
        .where(Class.show_id == show_id, Entry.horse_id.is_not(None))
        .distinct()
    )
    entered_ids = set(entered.scalars().all())
    rows = await db.execute(select(ShowHorseNumber).where(ShowHorseNumber.show_id == show_id))
    for row in rows.scalars().all():
        if row.horse_id in entered_ids:
            row.back_number = None
    await db.flush()
    assigned = await assign_missing_horse_numbers(show_id, db)
    await db.commit()
    return assigned


@router.get("/horses")
async def list_horse_back_numbers(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Every horse entered at this show with its number (migration 161), and
    who is showing it. At a show that numbers exhibitors every number is None."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")

    pairs = await db.execute(
        select(Horse.id, Horse.name, Exhibitor.id, Exhibitor.full_name)
        .join(Entry, Entry.horse_id == Horse.id)
        .join(Class, Class.id == Entry.class_id)
        .join(Exhibitor, Exhibitor.id == Entry.exhibitor_id)
        .where(Class.show_id == show_id)
        .distinct()
    )
    numbers = await db.execute(
        select(ShowHorseNumber).where(ShowHorseNumber.show_id == show_id)
    )
    by_horse = {row.horse_id: row for row in numbers.scalars().all()}
    per_horse = show.back_number_per == PER_HORSE

    horses: dict[UUID, dict] = {}
    for horse_id, horse_name, exhibitor_id, exhibitor_name in pairs.all():
        row = by_horse.get(horse_id) if per_horse else None
        horse = horses.setdefault(horse_id, {
            "horse_id": str(horse_id),
            "horse_name": horse_name,
            "back_number": row.back_number if row else None,
            "preferred_back_number": row.preferred_back_number if row else None,
            "exhibitors": [],
        })
        horse["exhibitors"].append({"exhibitor_id": str(exhibitor_id), "full_name": exhibitor_name})
    return sorted(
        horses.values(),
        key=lambda h: (h["back_number"] is None, h["back_number"] or 0, h["horse_name"].lower()),
    )


@router.patch("/horses", dependencies=[Depends(require_admin_or_show_admin)])
async def bulk_update_horse_back_numbers(
    show_id: UUID,
    body: BulkHorseBackNumberUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Set or clear horses' back numbers at a show that numbers horses
    (migration 161). The counterpart of the exhibitor PATCH above, with the
    same two refusals -- a duplicate inside the batch, and a number a horse
    outside it already wears, named so the desk can say who has 42. A batch
    may swap two numbers."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    if show.back_number_per != PER_HORSE:
        raise _wrong_kind(show)
    if not body.assignments:
        return {"updated": 0}

    submitted = [a.back_number for a in body.assignments if a.back_number is not None]
    if len(submitted) != len(set(submitted)):
        dupes = sorted({n for n in submitted if submitted.count(n) > 1})
        raise HTTPException(400, f"Duplicate back numbers in submission: {dupes}")

    horse_ids = [a.horse_id for a in body.assignments]
    # Only a horse entered at this show can be numbered at it -- otherwise any
    # horse id would do, and a number would sit on a horse nobody brought.
    entered = await db.execute(
        select(Entry.horse_id)
        .join(Class, Class.id == Entry.class_id)
        .where(Class.show_id == show_id, Entry.horse_id.in_(horse_ids))
        .distinct()
    )
    if set(horse_ids) - set(entered.scalars().all()):
        raise HTTPException(404, "That horse is not entered in any class at this show.")

    if submitted:
        holders = await db.execute(
            select(ShowHorseNumber.back_number, Horse.name)
            .join(Horse, Horse.id == ShowHorseNumber.horse_id)
            .where(
                ShowHorseNumber.show_id == show_id,
                ShowHorseNumber.back_number.in_(submitted),
                ShowHorseNumber.horse_id.not_in(horse_ids),
            )
        )
        clash = holders.first()
        if clash is not None:
            number, holder = clash
            raise HTTPException(
                409,
                {
                    "code": "BACK_NUMBER_TAKEN",
                    "message": (
                        f"Back number {number} is already on {holder}. "
                        "Pick a different one."
                    ),
                },
            )

    existing = await db.execute(
        select(ShowHorseNumber).where(
            ShowHorseNumber.show_id == show_id,
            ShowHorseNumber.horse_id.in_(horse_ids),
        )
    )
    rows = {row.horse_id: row for row in existing.scalars().all()}
    # Cleared first, so a swap inside the batch never meets the unique
    # constraint halfway -- Postgres checks it per statement.
    for row in rows.values():
        row.back_number = None
    await db.flush()
    for assignment in body.assignments:
        row = rows.get(assignment.horse_id)
        if row is None:
            row = ShowHorseNumber(show_id=show_id, horse_id=assignment.horse_id)
            db.add(row)
            rows[assignment.horse_id] = row
        row.back_number = assignment.back_number

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            409,
            {
                "code": "BACK_NUMBER_TAKEN",
                "message": "Another horse took that number a moment ago. Pick a different one.",
            },
        ) from None
    return {"updated": len(body.assignments)}
