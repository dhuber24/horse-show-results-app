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
from placings import RANKED_OUTCOMES, is_ranked
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


def _ranked(result) -> bool:
    """Whether this row is in the running on its card.

    Goes through `placings.is_ranked` so the scribe screens, the side pot
    standings and the publish gate cannot disagree about which outcomes count.
    Rows written before migration 121 — and the duck-typed rows the tests build —
    carry no outcome at all and read as `placed`.
    """
    return is_ranked(result)


def placing_shortfall(results, entry_count: int, judge_ids, required: Optional[int]):
    """Which of the required places each judge's card is still missing.

    `required` comes from the association (`rules.required_published_places`) and
    is a floor: a class with four entries can only fill four places, so the depth
    checked is capped by how many entries that card could actually place.

    That cap is **per card**, not per class. A judge who disqualified two horses
    has two fewer to place, and another judge on the same panel may have placed
    them — so a class-wide count would report the strict judge as short of a
    depth they could not have reached. Rows that carry a place despite a
    non-placed outcome still fill their slot: an Over Fences elimination during
    a ride-off (AM-111.D) is a placing.

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
    cards = list(judge_ids) or [None]
    shortfall = []
    for card in cards:
        rows = [r for r in results if r.judge_id == card]
        unplaceable = sum(1 for r in rows if not _ranked(r) and r.place is None)
        depth = min(required, max(entry_count - unplaceable, 0))
        placed = {r.place for r in rows if r.place is not None}
        missing = [p for p in range(1, depth + 1) if p not in placed]
        if missing:
            shortfall.append({"judge_id": card, "missing": missing})
    return shortfall


def unresolved_ties(results):
    """Places shared by two or more entries on one card that nobody has broken.

    Reads `is_tie`, which `_recompute_places_from_scores` sets only where the
    scores *and* the judge's tiebreak rank are equal — so a tie the judge has
    answered has already been resolved into two distinct places by the time this
    runs, and never appears here.
    """
    by_card_place: dict[tuple, list] = {}
    for r in results:
        if not r.is_tie or r.place is None:
            continue
        by_card_place.setdefault((r.judge_id, r.place), []).append(r)
    return [
        {"judge_id": judge_id, "place": place, "entry_ids": [r.entry_id for r in rows]}
        for (judge_id, place), rows in sorted(
            by_card_place.items(), key=lambda kv: kv[0][1]
        )
        if len(rows) > 1
    ]


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

    Pattern: highest raw_score wins. Time: lowest raw_score wins. Results without
    a raw_score sort last with sequential places.

    **Ranked within each judge's card, not across the class.** Every judge marks
    the same class on their own sheet, so a 71.5 from one judge and a 71.5 from
    another are two firsts, not a tie for first. Pooling them would also make
    each judge's placings depend on how many other judges had filed by then.

    **Only 'placed' rows are ranked** (migration 121). A disqualified or
    no-scored entry is not in the running, and whatever place it carries is a
    human's answer rather than a derivation — an Over Fences rider eliminated
    during a ride-off (AM-111.D) is still placed, last among that group, and the
    app has no way of knowing a ride-off happened. Those rows are left exactly as
    the scribe filed them.

    Equal scores share a place unless the judge broke the tie: `tiebreak_rank`
    joins the score in the ranking key, so two 71.5s ranked 1 and 2 come out as
    two distinct places with neither score touched.

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

    for card in cards.values():
        rank_card(class_.score_type, card)

    await db.flush()


def rank_card(score_type: str, rows) -> None:
    """Place one judge's card in-place, from the scores on it.

    Pulled out of `_recompute_places_from_scores` so the ranking can be exercised
    without a session — it is the part with the rules in it, and the rest is a
    query and a flush.

    Mutates `place` and `is_tie` on the rows it ranks, and clears `is_tie` on the
    rows it does not. Rows out of the running keep whatever place they came in
    with, which is the scribe's answer and never a derived one.

    A declared zero ranks — see `placings.RANKED_OUTCOMES`.
    """
    # Descending for a pattern score, ascending for a time.
    sign = -1.0 if score_type == "pattern" else 1.0

    ranked = [r for r in rows if _ranked(r)]
    for r in rows:
        if not _ranked(r):
            r.is_tie = False

    ranked.sort(
        key=lambda r: (
            r.raw_score is None,
            sign * float(r.raw_score) if r.raw_score is not None else 0.0,
            r.tiebreak_rank is None,
            r.tiebreak_rank or 0,
        )
    )

    # Assign places, sharing a place only where the score *and* the judge's
    # tiebreak answer are the same. Two equal scores the judge has ranked are
    # two different keys, so they take two places and neither is flagged.
    last_key: object = object()  # sentinel — first iteration never matches
    last_place = 0
    for idx, r in enumerate(ranked, start=1):
        if r.raw_score is None:
            r.place = idx
            last_key = object()  # break the tie chain
            last_place = idx
            continue
        key = (float(r.raw_score), r.tiebreak_rank)
        if key == last_key:
            r.place = last_place
        else:
            r.place = idx
            last_place = idx
            last_key = key

    counts = Counter(r.place for r in ranked)
    for r in ranked:
        r.is_tie = counts[r.place] > 1


def _validate_score_input(
    class_: Class,
    raw_score: Optional[float],
    place: Optional[int] = None,
    outcome: str = "placed",
) -> None:
    """What a row must carry to be filed, given what it claims happened.

    Only a `placed` row is held to it. A no-score has no score by definition, and
    demanding one would make the state unrecordable — which is the whole reason
    the outcomes exist.
    """
    if outcome != "placed":
        return
    if class_.score_type in ("pattern", "time") and raw_score is None:
        raise HTTPException(
            400,
            f"raw_score is required for {class_.score_type} classes",
        )
    if class_.score_type == "placement" and place is None:
        raise HTTPException(400, "place is required unless the entry was not placed")


def _normalize_row(class_: Class, data: dict, fallback: int) -> None:
    """Fill in what the outcome already implies, before the row is written.

    Two things, both of which have to happen before the flush:

    * A **declared zero has a score of zero.** That is what the outcome means, so
      the row says it rather than leaving a blank the sheet would render as
      unjudged. It is what makes a zero comparable to the horses that scored,
      which is the distinction SC-265.E.4-6 draws against a No Score.
    * A **ranked row on a scored class needs some place to insert with.**
      `ck_results_placed_has_place` fires at flush, which is before
      `_recompute_places_from_scores` runs. The placeholder is overwritten by
      the recompute a moment later and never read.
    """
    outcome = data.get("outcome") or "placed"
    if outcome == "zero_score" and data.get("raw_score") is None:
        data["raw_score"] = 0.0
    if class_.score_type != "placement" and outcome in RANKED_OUTCOMES:
        if data.get("place") is None:
            data["place"] = fallback


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


async def _show_rules(show_id: UUID, db: AsyncSession):
    """The association rules for this show, or the defaults."""
    show = await db.execute(
        select(Show).options(selectinload(Show.show_type)).where(Show.id == show_id)
    )
    show = show.scalar_one_or_none()
    return get_rules(show.show_type.code if show and show.show_type else None)


async def _judge_labels(show_id: UUID, db: AsyncSession):
    """judge_id -> display name, for naming a card in an error the scribe reads."""
    assignments = (await db.execute(
        select(ShowJudge).options(selectinload(ShowJudge.judge)).where(
            ShowJudge.show_id == show_id
        )
    )).scalars().all()
    names = {j.id: j for j in assignments}

    def label(judge_id):
        assignment = names.get(judge_id)
        judge = getattr(assignment, "judge", None) if assignment else None
        return getattr(judge, "name", None) or "Unattributed card"

    return label


async def _raise_for_unresolved_ties(show_id: UUID, class_: Class, db: AsyncSession) -> None:
    """422 where the association leaves ties to the judge and one is unbroken.

    APHA words it the same way in every scored class: equal scores are separated
    at the judge's discretion (AM-115.B.2 and the pattern class procedures). The
    app must not answer it — so this refuses the post, names the entries, and the
    scribe records the judge's answer in `tiebreak_rank`, leaving both scores as
    they were called. `acknowledge_ties` posts a shared place anyway, because a
    class the judge genuinely left tied is not something the app can rule out.
    """
    rules = await _show_rules(show_id, db)
    if not rules.ties_must_be_broken(class_):
        return

    results = list((await db.execute(
        select(Result).where(Result.class_id == class_.id)
    )).scalars().all())
    ties = unresolved_ties(results)
    if not ties:
        return

    label = await _judge_labels(show_id, db)
    raise HTTPException(
        422,
        {
            "code": "TIES_UNRESOLVED",
            "message": (
                "Equal scores are separated at the judge's discretion. Record how "
                "the judge broke each tie before this class is posted."
            ),
            "ties": [
                {
                    "judge_id": str(t["judge_id"]) if t["judge_id"] else None,
                    "judge_name": label(t["judge_id"]),
                    "place": t["place"],
                    "entry_ids": [str(e) for e in t["entry_ids"]],
                }
                for t in ties
            ],
        },
    )


async def _raise_for_incomplete_placings(show_id: UUID, class_: Class, db: AsyncSession) -> None:
    """422 with the per-judge shortfall, where the association names a depth."""
    rules = await _show_rules(show_id, db)
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

    label = await _judge_labels(show_id, db)

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

    An unbroken tie is refused the same way, under its own flag: a shortfall asks
    whether the card is finished, a tie asks which of two horses won, and only
    the judge can answer the second.
    """
    await _require_active_show(show_id, db)
    class_ = await _get_class_or_404(show_id, class_id, db)

    if class_.results_published_at is None:
        if not (body and body.acknowledge_ties):
            await _raise_for_unresolved_ties(show_id, class_, db)
        if not (body and body.acknowledge_incomplete):
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

    _validate_score_input(class_, body.raw_score, body.place, body.outcome)
    await _validate_judge(show_id, body.judge_id, db)

    # Placement classes: enforce manual place uniqueness as before.
    # Pattern/time classes: place is derived after insert, skip the check.
    # A row with no place at all — disqualified, no score — occupies no slot and
    # so cannot collide with one.
    #
    # Scoped to this judge's card: every judge on the panel awards a 1st, so
    # a class-wide check would reject the second judge's winner.
    if class_.score_type == "placement" and body.place is not None:
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

    data = body.model_dump()
    _normalize_row(class_, data, 1)
    result = Result(class_id=class_id, **data)
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
    new_outcome = updates.get("outcome", result.outcome) or "placed"

    _validate_score_input(class_, new_raw_score, new_place, new_outcome)

    # Placement classes: enforce manual place uniqueness as before, within this
    # result's own card. judge_id is not editable here — moving a placing to a
    # different judge is not a correction, it is a different judge's card.
    if class_.score_type == "placement" and new_place is not None and new_place != old_place:
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

    for item in body.results:
        _validate_score_input(class_, item.raw_score, item.place, item.outcome)

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
    for idx, item in enumerate(body.results, start=1):
        data = item.model_dump()
        _normalize_row(class_, data, idx)
        result = Result(class_id=class_id, judge_id=body.judge_id, **data)
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
