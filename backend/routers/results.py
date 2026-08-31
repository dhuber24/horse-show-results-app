from collections import Counter
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from dependencies import (
    INTERNAL_API_KEY,
    require_admin,
    require_admin_or_scribe,
    require_api_key,
)
from models import Class, Entry, Result, ResultAudit, Show, ShowJudge
from rules import get_rules
from schemas import (
    AuditOut,
    ClassResultsPublishIn,
    ClassResultsPublishOut,
    ResultBulkSave,
    ResultCreate,
    ResultOut,
    ResultUpdate,
)

router = APIRouter(prefix="/shows/{show_id}/classes/{class_id}/results", tags=["Results"])


# ── Helpers ────────────────────────────────────────────────────────────────────


# Roles that may see results before the class is posted. Everyone else — the
# public class page, the at-the-rail screens — waits for the publish gate.
_STAFF_ROLES = {"ADMIN", "SCRIBE", "SHOW_SECRETARY", "SHOW_MANAGER"}


def _is_show_staff(x_api_key: Optional[str], x_user_role: Optional[str]) -> bool:
    """Whether this caller may read draft results.

    Both halves matter: the API key proves the request came through the Next
    server rather than straight off the internet, and the role decides what
    that authenticated caller is allowed to see.
    """
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        return False
    return x_user_role in _STAFF_ROLES


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


def placing_shortfall(results, entry_count: int, judge_ids, required: Optional[int]):
    """Which of the required places each judge's card is still missing.

    `required` comes from the association (`rules.required_published_places`) and
    is a floor: a class with four entries can only fill four places, so the depth
    checked is `min(required, entry_count)`.

    Cards are the show's **assigned judges**, not the judges who happen to have
    filed — a three-judge panel where one has entered nothing is exactly the case
    SC-110.I is about, and keying off the results would report it as complete.
    A show with no judges assigned has one unattributed card, which is what the
    NULL `judge_id` means.

    Returns [] when the association names no depth, so this costs nothing on a
    show whose rules do not ask.
    """
    if not required or entry_count <= 0:
        return []
    depth = min(required, entry_count)
    cards = list(judge_ids) or [None]
    shortfall = []
    for card in cards:
        placed = {
            r.place for r in results
            if r.judge_id == card and r.place is not None
        }
        missing = [p for p in range(1, depth + 1) if p not in placed]
        if missing:
            shortfall.append({"judge_id": card, "missing": missing})
    return shortfall


async def _validate_judge(show_id: UUID, judge_id: Optional[UUID], db: AsyncSession) -> None:
    """A judge_id must name a judge assigned to *this* show.

    Without this a caller could file placings against any assignment id in the
    database, attributing a card to a judge who never worked the show.
    """
    if judge_id is None:
        return
    assignment = await db.get(ShowJudge, judge_id)
    if not assignment or assignment.show_id != show_id:
        raise HTTPException(400, "Judge is not assigned to this show")


def _same_judge(judge_id: Optional[UUID]):
    """Filter matching one judge's card, treating NULL as its own card.

    `Result.judge_id == None` renders as `IS NULL`; a bare `==` against a NULL
    parameter would match nothing, so the unattributed card would be invisible
    to every scoped query here.
    """
    return Result.judge_id.is_(None) if judge_id is None else Result.judge_id == judge_id


async def _recompute_places_from_scores(class_: Class, db: AsyncSession) -> None:
    """For pattern/time classes, sort results by raw_score and assign places.

    Pattern: highest raw_score wins. Time: lowest raw_score wins. Equal scores
    share a place and are flagged is_tie=True. Results without a raw_score sort
    last with sequential places.

    **Ranked within each judge's card, not across the class.** Every judge marks
    the same class on their own sheet, so a 71.5 from one judge and a 71.5 from
    another are two firsts, not a tie for first. Pooling them would also make
    each judge's placings depend on how many other judges had filed by then.

    No-op for placement classes — place stays as the secretary entered it.
    """
    if class_.score_type == "placement":
        return

    rows = await db.execute(select(Result).where(Result.class_id == class_.id))
    all_results = list(rows.scalars().all())
    if not all_results:
        return

    cards: dict[Optional[UUID], list[Result]] = {}
    for r in all_results:
        cards.setdefault(r.judge_id, []).append(r)

    for results in cards.values():
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
async def list_results(
    show_id: UUID,
    class_id: UUID,
    x_api_key: Optional[str] = Header(None),
    x_user_role: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Placings for a class.

    This one endpoint serves both the public class page and the scribe's own
    entry form, so it cannot filter unconditionally — the scribe would lose
    sight of the draft they are in the middle of typing. Show staff see the
    results whatever their state; everyone else sees them only once the class
    has been posted (`results_published_at`).
    """
    class_ = await _get_class_or_404(show_id, class_id, db)

    if not _is_show_staff(x_api_key, x_user_role) and class_.results_published_at is None:
        return []

    # Ordered by judge then place so a caller that walks the list gets whole
    # cards in the panel's running order rather than interleaved placings.
    result = await db.execute(
        select(Result)
        .outerjoin(ShowJudge, Result.judge_id == ShowJudge.id)
        .where(Result.class_id == class_id)
        .order_by(ShowJudge.sort_order.nulls_first(), ShowJudge.created_at.nulls_first(), Result.place)
    )
    return result.scalars().all()


async def _raise_for_incomplete_placings(show_id: UUID, class_: Class, db: AsyncSession) -> None:
    """422 with the per-judge shortfall, where the association names a depth."""
    show = await db.execute(
        select(Show).options(selectinload(Show.show_type)).where(Show.id == show_id)
    )
    show = show.scalar_one_or_none()
    rules = get_rules(show.show_type.code if show and show.show_type else None)
    required = rules.required_published_places(class_)
    if not required:
        return

    entry_count = await db.scalar(
        select(func.count(Entry.id)).where(
            Entry.class_id == class_.id, Entry.status == "ENTERED"
        )
    ) or 0
    judge_ids = list((await db.execute(
        select(ShowJudge.id).where(ShowJudge.show_id == show_id).order_by(ShowJudge.sort_order)
    )).scalars().all())
    results = list((await db.execute(
        select(Result).where(Result.class_id == class_.id)
    )).scalars().all())

    shortfall = placing_shortfall(results, entry_count, judge_ids, required)
    if not shortfall:
        return

    names = {j.id: j for j in (await db.execute(
        select(ShowJudge).options(selectinload(ShowJudge.judge)).where(
            ShowJudge.show_id == show_id
        )
    )).scalars().all()}

    def label(judge_id):
        assignment = names.get(judge_id)
        judge = getattr(assignment, "judge", None) if assignment else None
        return getattr(judge, "name", None) or "Unattributed card"

    raise HTTPException(
        422,
        {
            "code": "PLACINGS_INCOMPLETE",
            "message": (
                f"Every judge must have placed one through {min(required, entry_count)} "
                "before this class is posted."
            ),
            "required_places": required,
            "shortfall": [
                {
                    "judge_id": str(s["judge_id"]) if s["judge_id"] else None,
                    "judge_name": label(s["judge_id"]),
                    "missing": s["missing"],
                }
                for s in shortfall
            ],
        },
    )


@router.post(
    "/publish",
    response_model=ClassResultsPublishOut,
    dependencies=[Depends(require_admin_or_scribe)],
)
async def publish_results(
    show_id: UUID,
    class_id: UUID,
    body: Optional[ClassResultsPublishIn] = None,
    db: AsyncSession = Depends(get_db),
):
    """Post a class's results to the public screens.

    Idempotent: re-posting an already-published class keeps the original
    timestamp rather than moving it, so "when did this go up?" stays answerable
    after a correction.

    Where the association names a placing depth (APHA SC-110.I: one through seven
    under every judge), an incomplete card is refused with the shortfall named,
    and `acknowledge_incomplete` posts anyway. It is a confirmation rather than a
    hard block because the app cannot see a scratch, a disqualification, or a
    class the judge genuinely placed shallow — but it must not be silent, because
    the scribe form's own gap warning only catches *interior* gaps and a card
    that simply stops at third looks finished to it.
    """
    await _require_active_show(show_id, db)
    class_ = await _get_class_or_404(show_id, class_id, db)

    if class_.results_published_at is None and not (body and body.acknowledge_incomplete):
        await _raise_for_incomplete_placings(show_id, class_, db)

    if class_.results_published_at is None:
        class_.results_published_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(class_)

    return ClassResultsPublishOut(
        class_id=class_.id,
        results_published_at=class_.results_published_at,
    )


@router.post(
    "/",
    response_model=ResultOut,
    status_code=201,
    dependencies=[Depends(require_admin_or_scribe)],
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
    await _validate_judge(show_id, body.judge_id, db)

    # Placement classes: enforce manual place uniqueness as before.
    # Pattern/time classes: place is derived after insert, skip the check.
    #
    # Scoped to this judge's card: every judge on the panel awards a 1st, so
    # a class-wide check would reject the second judge's winner.
    if class_.score_type == "placement":
        if not body.is_tie:
            conflict = await db.execute(
                select(Result).where(
                    Result.class_id == class_id,
                    _same_judge(body.judge_id),
                    Result.place == body.place,
                )
            )
            if conflict.scalar_one_or_none():
                raise HTTPException(409, f"Place {body.place} is already assigned. Mark as Tie if intentional.")
        else:
            conflict = await db.execute(
                select(Result).where(
                    Result.class_id == class_id,
                    _same_judge(body.judge_id),
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
    dependencies=[Depends(require_admin_or_scribe)],
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

    # Placement classes: enforce manual place uniqueness as before, within this
    # result's own card. judge_id is not editable here — moving a placing to a
    # different judge is not a correction, it is a different judge's card.
    if class_.score_type == "placement" and new_place != old_place:
        if not new_is_tie:
            conflict = await db.execute(
                select(Result).where(
                    Result.class_id == class_id,
                    _same_judge(result.judge_id),
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
                    _same_judge(result.judge_id),
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
    dependencies=[Depends(require_admin_or_scribe)],
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
    await _validate_judge(show_id, body.judge_id, db)

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

    # Snapshot existing places before deleting so we can audit changes. Scoped
    # to this judge — an unscoped snapshot would read another judge's placings
    # as this card's "old" values and audit every one of them as a change.
    existing_rows = await db.execute(
        select(Result).where(Result.class_id == class_id, _same_judge(body.judge_id))
    )
    old_by_entry: dict[UUID, Result] = {r.entry_id: r for r in existing_rows.scalars().all()}
    new_by_entry: dict[UUID, int] = {item.entry_id: item.place for item in body.results}

    changed_by_uuid: Optional[UUID] = None
    if x_user_id:
        try:
            changed_by_uuid = UUID(x_user_id)
        except ValueError:
            pass

    # Replace this judge's card only. The delete used to take the whole class,
    # which with a panel of judges would mean each scribe's autosave wiped every
    # other judge's placings 1.5 seconds after they were typed.
    await db.execute(
        delete(Result).where(Result.class_id == class_id, _same_judge(body.judge_id))
    )

    # Insert all new results
    new_results = []
    for item in body.results:
        result = Result(class_id=class_id, judge_id=body.judge_id, **item.model_dump())
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

    # Audit: only meaningful for placement classes (manual place changes), and
    # only once the class is published. Before that the results are a draft the
    # public has never seen, so there is no published value for an edit to have
    # changed — and autosave would otherwise write a row per keystroke settle.
    if class_.score_type == "placement" and class_.results_published_at is not None:
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
