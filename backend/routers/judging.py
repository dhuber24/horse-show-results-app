"""The judge's card: which scale a class is marked on, and what was marked.

Two things live here. `GET /judging-systems` is the catalog — how a card is
shaped, and the penalties that system recognises. The rest is one card:
`GET`/`PUT` on `(class, entry, judge)`, which is what identifies a card for the
same reason it identifies a result.

**The card does not write `results`.** `bulk_save_results` is a delete-all-then-
insert-all within one judge's card and the scribe screens autosave on a settle;
adding a second writer to `results.raw_score` would put two requests in flight
over the same number. The card save returns `effective_score` and the scribe
screen carries it into the ordinary save, so `results` keeps exactly one writer
and the card is the thing that decides what the number is.
"""

from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from dependencies import require_admin_or_scribe, require_api_key
from judging import (
    compute_score,
    effective_score,
    is_overridden,
    validate_maneuver,
    validate_penalty,
)
from models import (
    CardManeuver,
    CardPenalty,
    Class,
    Entry,
    JudgeCard,
    JudgingPenalty,
    JudgingSystem,
    Result,
    ResultAudit,
    Show,
    ShowJudge,
    ShowType,
)
from rules.apha import (
    OVER_FENCES_SCORE_AVERAGE,
    OVER_FENCES_SCORE_MAX,
    SYMBOL_SYSTEM_BANDS,
    SYMBOL_SYSTEM_DISCIPLINES,
    symbol_system_guidance,
)
from schemas import JudgeCardOut, JudgeCardSave, JudgingSystemOut

systems_router = APIRouter(prefix="/judging-systems", tags=["Judging"])
router = APIRouter(prefix="/shows/{show_id}/classes/{class_id}", tags=["Judging"])


# ── Helpers ────────────────────────────────────────────────────────────────────


def _actor(x_user_id: Optional[str]) -> Optional[UUID]:
    """Who made this change, where the header gives one.

    Not `safe_uuid`: a missing or malformed id must not 400 a card save. Same
    handling the results router already uses for the same header.
    """
    if not x_user_id:
        return None
    try:
        return UUID(x_user_id)
    except ValueError:
        return None


def _card_out(card: JudgeCard) -> dict:
    """One card, with the figure it is worth already worked out.

    `effective_score` is computed here rather than left to each caller so the
    scribe screen, the class read and any later report cannot disagree about
    what a card came to.
    """
    score = effective_score(card)
    return {
        "id": card.id,
        "class_id": card.class_id,
        "entry_id": card.entry_id,
        "judge_id": card.judge_id,
        "system_id": card.system_id,
        "computed_score": float(card.computed_score) if card.computed_score is not None else None,
        "override_score": float(card.override_score) if card.override_score is not None else None,
        "override_reason": card.override_reason,
        "notes": card.notes,
        "maneuvers": [
            {
                "sequence": m.sequence,
                "score": float(m.score) if m.score is not None else None,
                "label": m.label,
            }
            for m in card.maneuvers
        ],
        "penalties": [
            {
                "penalty_id": p.penalty_id,
                "label": p.label,
                "value": float(p.value),
                "sequence": p.sequence,
            }
            for p in card.penalties
        ],
        "effective_score": float(score) if score is not None else None,
        "is_overridden": is_overridden(card),
    }


async def _get_class_or_404(show_id: UUID, class_id: UUID, db: AsyncSession) -> Class:
    class_ = await db.get(Class, class_id)
    if not class_ or class_.show_id != show_id:
        raise HTTPException(404, "Class not found")
    return class_


async def _validate_judge(show_id: UUID, judge_id: Optional[UUID], db: AsyncSession) -> None:
    """A judge_id must name a judge assigned to *this* show — same rule the
    results router enforces, and for the same reason: otherwise a caller could
    file a card against any assignment id in the database."""
    if judge_id is None:
        return
    assignment = await db.get(ShowJudge, judge_id)
    if not assignment or assignment.show_id != show_id:
        raise HTTPException(400, "Judge is not assigned to this show")


def _same_judge(judge_id: Optional[UUID]):
    """Filter matching one judge's card, treating NULL as its own card.

    `JudgeCard.judge_id == None` renders as `IS NULL`; a bare `==` against a
    NULL parameter matches nothing, so the unattributed card would be invisible.
    """
    return JudgeCard.judge_id.is_(None) if judge_id is None else JudgeCard.judge_id == judge_id


# ── The catalog ────────────────────────────────────────────────────────────────


@systems_router.get(
    "/", response_model=list[JudgingSystemOut], dependencies=[Depends(require_api_key)]
)
async def list_judging_systems(
    show_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Every card shape available, optionally narrowed to one association's.

    A system with no `show_type_id` is generic and always offered — the same
    fallback the standard-class library uses, and for the same reason: a show
    that is not a breed show still runs pattern classes.
    """
    query = select(JudgingSystem).where(JudgingSystem.is_active.is_(True))
    if show_type:
        type_id = await db.scalar(select(ShowType.id).where(ShowType.code == show_type))
        query = query.where(
            (JudgingSystem.show_type_id == type_id)
            | (JudgingSystem.show_type_id.is_(None))
        )
    rows = await db.execute(query.order_by(JudgingSystem.name))
    return rows.scalars().all()


@systems_router.get("/symbol-system", dependencies=[Depends(require_api_key)])
async def symbol_system_bands(discipline: Optional[str] = None):
    """APHA SC-215.E.3's traditional symbol system, as score bands.

    Not a `judging_systems` row, and deliberately so: the judge watches the round
    and picks a number inside a band, so there are no maneuvers to add up and
    nothing for a card to total. Forcing it into that table would mean inventing
    a maneuver range for a system that has none. A class scored this way carries
    no judging system at all, which is what the app already does by default --
    what was missing was the guidance beside the score box.

    Takes no session: the bands are rule text, held in `rules/apha.py` with the
    zone notes and the category requirements.
    """
    return {
        "rule_reference": "SC-215.E.3",
        "score_max": OVER_FENCES_SCORE_MAX,
        "score_average": OVER_FENCES_SCORE_AVERAGE,
        "disciplines": sorted(SYMBOL_SYSTEM_DISCIPLINES),
        "applies": discipline in SYMBOL_SYSTEM_DISCIPLINES if discipline else None,
        "bands": (
            symbol_system_guidance(discipline)
            if discipline
            else [
                {"min_score": low, "max_score": high, "description": text}
                for low, high, text in SYMBOL_SYSTEM_BANDS
            ]
        ),
    }


# ── One card ───────────────────────────────────────────────────────────────────


@router.get("/cards", dependencies=[Depends(require_admin_or_scribe)])
async def list_cards(
    show_id: UUID,
    class_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Every card filed for this class, across every judge.

    Staff only, with no publish gate of its own: a card is the scribe's
    worksheet and never goes on the public screens. What the public sees is the
    result the card produced, which `results_published_at` already governs.
    """
    await _get_class_or_404(show_id, class_id, db)
    rows = await db.execute(select(JudgeCard).where(JudgeCard.class_id == class_id))
    return [_card_out(c) for c in rows.scalars().all()]


@router.put(
    "/entries/{entry_id}/card",
    response_model=JudgeCardOut,
    dependencies=[Depends(require_admin_or_scribe)],
)
async def save_card(
    show_id: UUID,
    class_id: UUID,
    entry_id: UUID,
    body: JudgeCardSave,
    x_user_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Write one judge's worksheet for one entry, and add it up.

    Replaces what it owns — the maneuvers and penalties sent *are* the card, and
    anything absent has been rubbed out. Same shape as the results bulk save,
    and for the same reason: a card is a thing somebody hands in whole.

    Validation collects every bad row rather than failing on the first, because
    a scribe fixing a card one 400 at a time is a scribe who stops using it.
    """
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    class_ = await _get_class_or_404(show_id, class_id, db)

    entry = await db.get(Entry, entry_id)
    if not entry or entry.class_id != class_id:
        raise HTTPException(400, "Entry does not belong to this class")

    await _validate_judge(show_id, body.judge_id, db)

    # The class's own system is the default; the body may name one for a class
    # that has not been set up yet, which is what a scribe reaching for a card
    # mid-show actually does.
    system_id = body.system_id or class_.judging_system_id
    system = None
    if system_id:
        system = await db.get(
            JudgingSystem, system_id, options=[selectinload(JudgingSystem.penalties)]
        )
        if not system:
            raise HTTPException(400, "Judging system not found")

    issues: list[str] = []
    if system:
        for m in body.maneuvers:
            problem = validate_maneuver(system, m.score)
            if problem:
                issues.append(f"{system.unit_label} {m.sequence} {problem}")
            if system.unit_count and m.sequence > system.unit_count:
                issues.append(
                    f"{system.unit_label} {m.sequence} is past the "
                    f"{system.unit_count} this system declares"
                )

    catalog: dict[UUID, JudgingPenalty] = {}
    penalty_ids = [p.penalty_id for p in body.penalties if p.penalty_id]
    if penalty_ids:
        rows = await db.execute(
            select(JudgingPenalty).where(JudgingPenalty.id.in_(penalty_ids))
        )
        catalog = {p.id: p for p in rows.scalars().all()}
    for p in body.penalties:
        if p.penalty_id and p.penalty_id not in catalog:
            issues.append(f"Penalty '{p.label}' names a catalog row that does not exist")
            continue
        problem = validate_penalty(catalog.get(p.penalty_id) if p.penalty_id else None, p.value)
        if problem:
            issues.append(f"Penalty '{p.label}' {problem}")

    if issues:
        raise HTTPException(
            422,
            {
                "code": "CARD_INVALID",
                "message": "This card does not fit the system it is marked on.",
                "issues": issues,
            },
        )

    existing = await db.execute(
        select(JudgeCard)
        .where(
            JudgeCard.class_id == class_id,
            JudgeCard.entry_id == entry_id,
            _same_judge(body.judge_id),
        )
        .options(selectinload(JudgeCard.maneuvers), selectinload(JudgeCard.penalties))
    )
    card = existing.scalar_one_or_none()
    old_score = effective_score(card) if card else None

    if card is None:
        card = JudgeCard(class_id=class_id, entry_id=entry_id, judge_id=body.judge_id)
        db.add(card)

    card.system_id = system_id
    card.notes = body.notes
    card.override_score = (
        Decimal(str(body.override_score)) if body.override_score is not None else None
    )
    # A reason belongs to an override. Keeping it after the override is cleared
    # would leave the card explaining a decision nobody made.
    card.override_reason = body.override_reason if body.override_score is not None else None

    card.maneuvers = [
        CardManeuver(
            sequence=m.sequence,
            score=Decimal(str(m.score)) if m.score is not None else None,
            label=m.label,
        )
        for m in body.maneuvers
    ]
    card.penalties = [
        CardPenalty(
            penalty_id=p.penalty_id,
            label=p.label,
            value=Decimal(str(p.value)),
            sequence=p.sequence,
        )
        for p in body.penalties
    ]

    card.computed_score = (
        compute_score(system, card.maneuvers, card.penalties) if system else None
    )

    await db.flush()

    # An override is an editorial decision about a published number, which is
    # exactly what result_audit is for. Written against the result this card
    # feeds when there is one; a NULL result_id is a card filed before anybody
    # has placed the class, which the column already allows.
    new_score = effective_score(card)
    if old_score != new_score and is_overridden(card):
        result_id = await db.scalar(
            select(Result.id).where(
                Result.class_id == class_id,
                Result.entry_id == entry_id,
                Result.judge_id.is_(None)
                if body.judge_id is None
                else Result.judge_id == body.judge_id,
            )
        )
        db.add(
            ResultAudit(
                result_id=result_id,
                changed_by=_actor(x_user_id),
                old_score=old_score,
                new_score=new_score,
            )
        )

    await db.commit()

    refreshed = await db.execute(
        select(JudgeCard)
        .where(JudgeCard.id == card.id)
        .options(selectinload(JudgeCard.maneuvers), selectinload(JudgeCard.penalties))
        .execution_options(populate_existing=True)
    )
    return _card_out(refreshed.scalar_one())
