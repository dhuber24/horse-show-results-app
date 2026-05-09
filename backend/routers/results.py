from collections import Counter
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import require_admin, require_admin_or_scorekeeper, require_api_key
from models import Class, Entry, Result, ResultAudit, Show
from schemas import AuditOut, ResultBulkSave, ResultCreate, ResultOut, ResultUpdate

router = APIRouter(prefix="/shows/{show_id}/classes/{class_id}/results", tags=["Results"])


# ── Helpers ────────────────────────────────────────────────────────────────────


async def _get_class_or_404(show_id: UUID, class_id: UUID, db: AsyncSession) -> Class:
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


async def _recompute_places_from_scores(class_: Class, db: AsyncSession) -> None:
    """For pattern/time classes, sort results by raw_score and assign places.

    Pattern: highest raw_score wins. Time: lowest raw_score wins. Equal scores
    share a place and are flagged is_tie=True. Results without a raw_score sort
    last with sequential places.

    No-op for placement classes — place stays as the secretary entered it.
    """
    if class_.score_type == "placement":
        return

    rows = await db.execute(select(Result).where(Result.class_id == class_.id))
    results = list(rows.scalars().all())
    if not results:
        return

    if class_.score_type == "pattern":
        # null last, then descending by score
        results.sort(
            key=lambda r: (
                r.raw_score is None,
                -float(r.raw_score) if r.raw_score is not None else 0.0,
            )
        )
    else:  # time
        results.sort(
            key=lambda r: (
                r.raw_score is None,
                float(r.raw_score) if r.raw_score is not None else 0.0,
            )
        )

    # Assign places, sharing a place across equal scores
    last_score: object = object()  # sentinel — first iteration never matches
    last_place = 0
    for idx, r in enumerate(results, start=1):
        if r.raw_score is None:
            r.place = idx
            last_score = object()  # break the tie chain
            last_place = idx
            continue
        score = float(r.raw_score)
        if score == last_score:
            r.place = last_place
        else:
            r.place = idx
            last_place = idx
            last_score = score

    counts = Counter(r.place for r in results)
    for r in results:
        r.is_tie = counts[r.place] > 1

    await db.flush()


def _validate_score_input(class_: Class, raw_score: Optional[float]) -> None:
    if class_.score_type in ("pattern", "time") and raw_score is None:
        raise HTTPException(
            400,
            f"raw_score is required for {class_.score_type} classes",
        )


# ── Endpoints ──────────────────────────────────────────────────────────────────


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
    class_ = await _get_class_or_404(show_id, class_id, db)

    entry = await db.get(Entry, body.entry_id)
    if not entry or entry.class_id != class_id:
        raise HTTPException(400, "Entry does not belong to this class")

    _validate_score_input(class_, body.raw_score)

    # Placement classes: enforce manual place uniqueness as before.
    # Pattern/time classes: place is derived after insert, skip the check.
    if class_.score_type == "placement":
        if not body.is_tie:
            conflict = await db.execute(
                select(Result).where(Result.class_id == class_id, Result.place == body.place)
            )
            if conflict.scalar_one_or_none():
                raise HTTPException(409, f"Place {body.place} is already assigned. Mark as Tie if intentional.")
        else:
            conflict = await db.execute(
                select(Result).where(
                    Result.class_id == class_id,
                    Result.place == body.place,
                    Result.is_tie == False,
                )
            )
            if conflict.scalar_one_or_none():
                raise HTTPException(409, f"Place {body.place} is already assigned to a non-tie entry.")

    result = Result(class_id=class_id, **body.model_dump())
    db.add(result)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Placing conflict: duplicate entry in this class")

    if class_.score_type != "placement":
        await _recompute_places_from_scores(class_, db)

    await db.commit()
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
    class_ = await _get_class_or_404(show_id, class_id, db)
    result = await db.get(Result, result_id)
    if not result or result.class_id != class_id:
        raise HTTPException(404, "Result not found")

    old_place = result.place
    updates = body.model_dump(exclude_unset=True)

    new_place = updates.get("place", result.place)
    new_is_tie = updates.get("is_tie", result.is_tie)
    new_raw_score = updates.get("raw_score", result.raw_score)

    if class_.score_type in ("pattern", "time") and new_raw_score is None:
        raise HTTPException(
            400,
            f"raw_score is required for {class_.score_type} classes",
        )

    # Placement classes: enforce manual place uniqueness as before.
    if class_.score_type == "placement" and new_place != old_place:
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

    # Audit only manual place changes on placement classes — derived places on
    # pattern/time classes are bookkeeping, not editorial decisions.
    if (
        class_.score_type == "placement"
        and "place" in updates
        and updates["place"] != old_place
    ):
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
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Placing conflict: duplicate place in this class")

    if class_.score_type != "placement":
        await _recompute_places_from_scores(class_, db)

    await db.commit()
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
    class_ = await _get_class_or_404(show_id, class_id, db)

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

    if class_.score_type in ("pattern", "time"):
        for item in body.results:
            if item.raw_score is None:
                raise HTTPException(
                    400,
                    f"raw_score is required for {class_.score_type} classes",
                )

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
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Placing conflict: check for duplicate places")

    if class_.score_type != "placement":
        await _recompute_places_from_scores(class_, db)

    await db.commit()
    for r in new_results:
        await db.refresh(r)

    # Audit: only meaningful for placement classes (manual place changes).
    if class_.score_type == "placement":
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
    class_ = await _get_class_or_404(show_id, class_id, db)
    result = await db.get(Result, result_id)
    if not result or result.class_id != class_id:
        raise HTTPException(404, "Result not found")
    await db.delete(result)
    await db.flush()
    if class_.score_type != "placement":
        await _recompute_places_from_scores(class_, db)
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
