from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from typing import Optional

from database import get_db
from models import Result, ResultAudit, Class, Entry
from schemas import ResultCreate, ResultUpdate, ResultOut, AuditOut

router = APIRouter(prefix="/shows/{show_id}/classes/{class_id}/results", tags=["Results"])


async def _get_class_or_404(show_id: UUID, class_id: UUID, db: AsyncSession):
    class_ = await db.get(Class, class_id)
    if not class_ or class_.show_id != show_id:
        raise HTTPException(404, "Class not found")
    return class_


@router.get("/", response_model=list[ResultOut])
async def list_results(show_id: UUID, class_id: UUID, db: AsyncSession = Depends(get_db)):
    await _get_class_or_404(show_id, class_id, db)
    result = await db.execute(
        select(Result).where(Result.class_id == class_id).order_by(Result.place)
    )
    return result.scalars().all()


@router.post("/", response_model=ResultOut, status_code=201)
async def create_result(
    show_id: UUID, class_id: UUID, body: ResultCreate, db: AsyncSession = Depends(get_db)
):
    await _get_class_or_404(show_id, class_id, db)

    # Verify entry belongs to this class
    entry = await db.get(Entry, body.entry_id)
    if not entry or entry.class_id != class_id:
        raise HTTPException(400, "Entry does not belong to this class")

    result = Result(class_id=class_id, **body.model_dump())
    db.add(result)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Placing conflict: duplicate place or entry in this class")
    await db.refresh(result)
    return result


@router.patch("/{result_id}", response_model=ResultOut)
async def update_result(
    show_id: UUID,
    class_id: UUID,
    result_id: UUID,
    body: ResultUpdate,
    changed_by: Optional[UUID] = Query(None, description="User ID making the change"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.get(Result, result_id)
    if not result or result.class_id != class_id:
        raise HTTPException(404, "Result not found")

    old_place = result.place
    updates = body.model_dump(exclude_unset=True)
    for k, v in updates.items():
        setattr(result, k, v)

    # Write audit record if place changed
    if "place" in updates and updates["place"] != old_place:
        audit = ResultAudit(
            result_id=result_id,
            changed_by=changed_by,
            old_place=old_place,
            new_place=updates["place"],
        )
        db.add(audit)

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Placing conflict: duplicate place in this class")
    await db.refresh(result)
    return result


@router.delete("/{result_id}", status_code=204)
async def delete_result(
    show_id: UUID, class_id: UUID, result_id: UUID, db: AsyncSession = Depends(get_db)
):
    result = await db.get(Result, result_id)
    if not result or result.class_id != class_id:
        raise HTTPException(404, "Result not found")
    await db.delete(result)
    await db.commit()


@router.get("/{result_id}/audit", response_model=list[AuditOut])
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
