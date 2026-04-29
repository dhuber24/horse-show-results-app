from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError
from uuid import UUID
from typing import Optional

from database import get_db
from dependencies import require_admin, require_admin_or_scorekeeper, require_api_key
from models import Result, ResultAudit, Class, Entry, Show
from schemas import ResultCreate, ResultUpdate, ResultBulkSave, ResultOut, AuditOut

router = APIRouter(prefix="/shows/{show_id}/classes/{class_id}/results", tags=["Results"])


async def _get_class_or_404(show_id: UUID, class_id: UUID, db: AsyncSession):
    class_ = await db.get(Class, class_id)
    if not class_ or class_.show_id != show_id:
        raise HTTPException(404, "Class not found")
    return class_


async def _require_active_show(show_id: UUID, db: AsyncSession):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    if show.status != "ACTIVE":
        raise HTTPException(403, "Show is not active. Placings can only be entered for active shows.")


@router.get("/", response_model=list[ResultOut])
async def list_results(show_id: UUID, class_id: UUID, db: AsyncSession = Depends(get_db)):
    await _get_class_or_404(show_id, class_id, db)
    result = await db.execute(
        select(Result).where(Result.class_id == class_id).order_by(Result.place)
    )
    return result.scalars().all()


@router.post(
    "/",
    response_model=ResultOut,
    status_code=201,
    dependencies=[Depends(require_admin_or_scorekeeper)],
)
async def create_result(
    show_id: UUID, class_id: UUID, body: ResultCreate, db: AsyncSession = Depends(get_db)
):
    await _require_active_show(show_id, db)
    await _get_class_or_404(show_id, class_id, db)

    entry = await db.get(Entry, body.entry_id)
    if not entry or entry.class_id != class_id:
        raise HTTPException(400, "Entry does not belong to this class")

    # Prevent duplicate places unless all sharing entries are marked as ties
    if not body.is_tie:
        conflict = await db.execute(
            select(Result).where(Result.class_id == class_id, Result.place == body.place)
        )
        if conflict.scalar_one_or_none():
            raise HTTPException(409, f"Place {body.place} is already assigned. Mark as Tie if intentional.")
    else:
        conflict = await db.execute(
            select(Result).where(Result.class_id == class_id, Result.place == body.place, Result.is_tie == False)
        )
        if conflict.scalar_one_or_none():
            raise HTTPException(409, f"Place {body.place} is already assigned to a non-tie entry.")

    result = Result(class_id=class_id, **body.model_dump())
    db.add(result)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Placing conflict: duplicate entry in this class")
    await db.refresh(result)
    return result


@router.patch(
    "/{result_id}",
    response_model=ResultOut,
    dependencies=[Depends(require_admin_or_scorekeeper)],
)
async def update_result(
    show_id: UUID,
    class_id: UUID,
    result_id: UUID,
    body: ResultUpdate,
    x_user_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    await _require_active_show(show_id, db)
    result = await db.get(Result, result_id)
    if not result or result.class_id != class_id:
        raise HTTPException(404, "Result not found")

    old_place = result.place
    updates = body.model_dump(exclude_unset=True)

    new_place = updates.get("place", result.place)
    new_is_tie = updates.get("is_tie", result.is_tie)

    if new_place != old_place:
        if not new_is_tie:
            conflict = await db.execute(
                select(Result).where(
                    Result.class_id == class_id,
                    Result.place == new_place,
                    Result.id != result_id,
                )
            )
            if conflict.scalar_one_or_none():
                raise HTTPException(409, f"Place {new_place} is already assigned. Mark as Tie if intentional.")
        else:
            conflict = await db.execute(
                select(Result).where(
                    Result.class_id == class_id,
                    Result.place == new_place,
                    Result.is_tie == False,
                    Result.id != result_id,
                )
            )
            if conflict.scalar_one_or_none():
                raise HTTPException(409, f"Place {new_place} is already assigned to a non-tie entry.")

    for k, v in updates.items():
        setattr(result, k, v)

    if "place" in updates and updates["place"] != old_place:
        changed_by_uuid: Optional[UUID] = None
        if x_user_id:
            try:
                changed_by_uuid = UUID(x_user_id)
            except ValueError:
                pass
        audit = ResultAudit(
            result_id=result_id,
            changed_by=changed_by_uuid,
            old_place=old_place,
            new_place=updates["place"],
        )
        db.add(audit)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Placing conflict: duplicate place in this class")
    await db.refresh(result)
    return result


@router.put(
    "/",
    response_model=list[ResultOut],
    dependencies=[Depends(require_admin_or_scorekeeper)],
)
async def bulk_save_results(
    show_id: UUID,
    class_id: UUID,
    body: ResultBulkSave,
    x_user_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    await _require_active_show(show_id, db)
    await _get_class_or_404(show_id, class_id, db)

    # Validate all entries belong to this class in a single query
    entry_ids = [item.entry_id for item in body.results]
    if entry_ids:
        rows = await db.execute(
            select(Entry.id).where(Entry.id.in_(entry_ids), Entry.class_id == class_id)
        )
        valid_ids = {row for row in rows.scalars().all()}
        missing = [eid for eid in entry_ids if eid not in valid_ids]
        if missing:
            raise HTTPException(400, f"Entry {missing[0]} does not belong to this class")

    # Snapshot existing places before deleting so we can audit changes
    existing_rows = await db.execute(
        select(Result).where(Result.class_id == class_id)
    )
    old_by_entry: dict[UUID, Result] = {r.entry_id: r for r in existing_rows.scalars().all()}
    new_by_entry: dict[UUID, int] = {item.entry_id: item.place for item in body.results}

    changed_by_uuid: Optional[UUID] = None
    if x_user_id:
        try:
            changed_by_uuid = UUID(x_user_id)
        except ValueError:
            pass

    # Delete all existing results for this class
    await db.execute(delete(Result).where(Result.class_id == class_id))

    # Insert all new results
    new_results = []
    for item in body.results:
        result = Result(class_id=class_id, **item.model_dump())
        db.add(result)
        new_results.append(result)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Placing conflict: check for duplicate places")

    for r in new_results:
        await db.refresh(r)

    # Write audit records for entries whose place changed (or was newly assigned / removed)
    all_entry_ids = set(old_by_entry.keys()) | set(new_by_entry.keys())
    for eid in all_entry_ids:
        old_place = old_by_entry[eid].place if eid in old_by_entry else None
        new_place = new_by_entry.get(eid)
        if old_place != new_place:
            new_result = next((r for r in new_results if r.entry_id == eid), None)
            db.add(ResultAudit(
                result_id=new_result.id if new_result else None,
                changed_by=changed_by_uuid,
                old_place=old_place,
                new_place=new_place,
            ))
    await db.commit()

    return new_results


@router.delete("/{result_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_result(
    show_id: UUID, class_id: UUID, result_id: UUID, db: AsyncSession = Depends(get_db)
):
    result = await db.get(Result, result_id)
    if not result or result.class_id != class_id:
        raise HTTPException(404, "Result not found")
    await db.delete(result)
    await db.commit()


@router.get("/{result_id}/audit", response_model=list[AuditOut], dependencies=[Depends(require_api_key)])
async def get_result_audit(
    show_id: UUID, class_id: UUID, result_id: UUID, db: AsyncSession = Depends(get_db)
):
    result = await db.get(Result, result_id)
    if not result or result.class_id != class_id:
        raise HTTPException(404, "Result not found")
    audit = await db.execute(
        select(ResultAudit)
        .where(ResultAudit.result_id == result_id)
        .order_by(ResultAudit.changed_at.desc())
    )
    return audit.scalars().all()
