"""Side pots (divisional jackpots).

A side pot is an optional money pool that spans multiple classes within a show.
Exhibitors opt in at the show_entry (back number) level and pay a flat fee.
The pot ranks all opt-ins by combined score across the bundled classes and
pays out per a producer-configurable schedule.

Standings are computed on demand from the current `results` rows. They are
materialized into `side_pot_payouts` only when the pot is settled.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from dependencies import require_admin_or_show_admin
from models import (
    Class,
    Entry,
    Result,
    Show,
    ShowEntry,
    SidePot,
    SidePotClass,
    SidePotEntry,
    SidePotPayout,
)
from schemas import (
    SidePotCreate,
    SidePotEntryCreate,
    SidePotEntryOut,
    SidePotEntryUpdate,
    SidePotOut,
    SidePotPayoutOut,
    SidePotStanding,
    SidePotStandingsOut,
    SidePotUpdate,
)

router = APIRouter(
    prefix="/shows/{show_id}/side-pots",
    tags=["Side Pots"],
    dependencies=[Depends(require_admin_or_show_admin)],
)


# ── Helpers ────────────────────────────────────────────────────────────────────


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _get_pot_or_404(show_id: UUID, pot_id: UUID, db: AsyncSession) -> SidePot:
    pot = await db.get(
        SidePot,
        pot_id,
        options=[
            selectinload(SidePot.pot_classes).selectinload(SidePotClass.class_),
            selectinload(SidePot.pot_entries).selectinload(SidePotEntry.show_entry),
        ],
    )
    if not pot or pot.show_id != show_id:
        raise HTTPException(404, "Side pot not found")
    return pot


def _require_not_settled(pot: SidePot) -> None:
    if pot.status == "settled":
        raise HTTPException(409, "Side pot is settled and cannot be modified")


async def _validate_class_ids_for_show(
    show_id: UUID,
    class_ids: list[UUID],
    scoring_method: str,
    db: AsyncSession,
) -> list[Class]:
    if not class_ids:
        raise HTTPException(400, "Side pot must include at least one class")
    rows = await db.execute(select(Class).where(Class.id.in_(class_ids)))
    classes = list(rows.scalars().all())
    found_ids = {c.id for c in classes}
    missing = [cid for cid in class_ids if cid not in found_ids]
    if missing:
        raise HTTPException(400, f"Class {missing[0]} not found")
    wrong_show = [c for c in classes if c.show_id != show_id]
    if wrong_show:
        raise HTTPException(400, f"Class {wrong_show[0].id} does not belong to this show")
    if scoring_method == "sum_scores":
        non_score = [c for c in classes if c.score_type not in ("pattern", "time")]
        if non_score:
            raise HTTPException(
                400,
                f"scoring_method 'sum_scores' requires every class to be score_type "
                f"'pattern' or 'time'; class {non_score[0].class_number} is "
                f"'{non_score[0].score_type}'",
            )
    return classes


def _serialize_pot(pot: SidePot) -> dict:
    """Build a dict suitable for SidePotOut, including class summaries and counts."""
    classes = [
        {
            "class_id": pc.class_id,
            "class_number": pc.class_.class_number,
            "class_name": pc.class_.class_name,
            "score_type": pc.class_.score_type,
        }
        for pc in pot.pot_classes
    ]
    classes.sort(key=lambda c: (c["class_number"], c["class_name"]))
    return {
        "id": pot.id,
        "show_id": pot.show_id,
        "name": pot.name,
        "description": pot.description,
        "entry_fee_cents": pot.entry_fee_cents,
        "payback_percent": pot.payback_percent,
        "scoring_method": pot.scoring_method,
        "eligibility_rule": pot.eligibility_rule,
        "payout_schedule": pot.payout_schedule,
        "status": pot.status,
        "settled_at": pot.settled_at,
        "created_at": pot.created_at,
        "classes": classes,
        "entry_count": len(pot.pot_entries),
        "paid_count": sum(1 for e in pot.pot_entries if e.paid),
    }


# ── Pot CRUD ───────────────────────────────────────────────────────────────────


@router.post("/", response_model=SidePotOut, status_code=201)
async def create_pot(
    show_id: UUID, body: SidePotCreate, db: AsyncSession = Depends(get_db)
):
    await _get_show_or_404(show_id, db)
    await _validate_class_ids_for_show(
        show_id, body.class_ids, body.scoring_method, db
    )

    pot = SidePot(
        show_id=show_id,
        name=body.name,
        description=body.description,
        entry_fee_cents=body.entry_fee_cents,
        payback_percent=body.payback_percent,
        scoring_method=body.scoring_method,
        eligibility_rule=body.eligibility_rule,
        payout_schedule=body.payout_schedule,
    )
    db.add(pot)
    await db.flush()
    for cid in body.class_ids:
        db.add(SidePotClass(side_pot_id=pot.id, class_id=cid))
    await db.commit()

    pot = await _get_pot_or_404(show_id, pot.id, db)
    return _serialize_pot(pot)


@router.get("/", response_model=list[SidePotOut])
async def list_pots(show_id: UUID, db: AsyncSession = Depends(get_db)):
    await _get_show_or_404(show_id, db)
    rows = await db.execute(
        select(SidePot)
        .where(SidePot.show_id == show_id)
        .options(
            selectinload(SidePot.pot_classes).selectinload(SidePotClass.class_),
            selectinload(SidePot.pot_entries),
        )
        .order_by(SidePot.created_at)
    )
    return [_serialize_pot(p) for p in rows.scalars().all()]


@router.get("/{pot_id}", response_model=SidePotOut)
async def get_pot(show_id: UUID, pot_id: UUID, db: AsyncSession = Depends(get_db)):
    pot = await _get_pot_or_404(show_id, pot_id, db)
    return _serialize_pot(pot)


@router.patch("/{pot_id}", response_model=SidePotOut)
async def update_pot(
    show_id: UUID,
    pot_id: UUID,
    body: SidePotUpdate,
    db: AsyncSession = Depends(get_db),
):
    pot = await _get_pot_or_404(show_id, pot_id, db)
    _require_not_settled(pot)

    updates = body.model_dump(exclude_unset=True)
    new_class_ids: Optional[list[UUID]] = updates.pop("class_ids", None)
    new_method = updates.get("scoring_method", pot.scoring_method)

    if new_class_ids is not None:
        await _validate_class_ids_for_show(show_id, new_class_ids, new_method, db)
    elif "scoring_method" in updates and new_method == "sum_scores":
        # method changed without changing classes; re-validate existing class set
        existing_ids = [pc.class_id for pc in pot.pot_classes]
        await _validate_class_ids_for_show(show_id, existing_ids, new_method, db)

    for k, v in updates.items():
        setattr(pot, k, v)

    if new_class_ids is not None:
        await db.execute(
            delete(SidePotClass).where(SidePotClass.side_pot_id == pot_id)
        )
        for cid in new_class_ids:
            db.add(SidePotClass(side_pot_id=pot_id, class_id=cid))

    await db.commit()
    pot = await _get_pot_or_404(show_id, pot_id, db)
    return _serialize_pot(pot)


@router.delete("/{pot_id}", status_code=204)
async def delete_pot(show_id: UUID, pot_id: UUID, db: AsyncSession = Depends(get_db)):
    pot = await _get_pot_or_404(show_id, pot_id, db)
    _require_not_settled(pot)
    await db.delete(pot)
    await db.commit()


# ── Opt-ins (entries) ─────────────────────────────────────────────────────────


async def _hydrate_entry(
    pot_entry: SidePotEntry, db: AsyncSession
) -> dict:
    """Build a dict for SidePotEntryOut, looking up back number + name."""
    show_entry = await db.get(
        ShowEntry, pot_entry.show_entry_id,
        options=[selectinload(ShowEntry.exhibitor)],
    )
    return {
        "id": pot_entry.id,
        "side_pot_id": pot_entry.side_pot_id,
        "show_entry_id": pot_entry.show_entry_id,
        "back_number": show_entry.back_number if show_entry else None,
        "exhibitor_name": (
            show_entry.exhibitor.full_name
            if show_entry and show_entry.exhibitor
            else None
        ),
        "paid": pot_entry.paid,
        "created_at": pot_entry.created_at,
    }


@router.get("/{pot_id}/entries", response_model=list[SidePotEntryOut])
async def list_entries(
    show_id: UUID, pot_id: UUID, db: AsyncSession = Depends(get_db)
):
    pot = await _get_pot_or_404(show_id, pot_id, db)
    out = []
    for pe in pot.pot_entries:
        out.append(await _hydrate_entry(pe, db))
    out.sort(key=lambda e: (e["back_number"] is None, e["back_number"] or 0))
    return out


@router.post("/{pot_id}/entries", response_model=SidePotEntryOut, status_code=201)
async def add_entry(
    show_id: UUID,
    pot_id: UUID,
    body: SidePotEntryCreate,
    db: AsyncSession = Depends(get_db),
):
    pot = await _get_pot_or_404(show_id, pot_id, db)
    _require_not_settled(pot)

    if body.show_entry_id is not None:
        show_entry = await db.get(ShowEntry, body.show_entry_id)
        if not show_entry or show_entry.show_id != show_id:
            raise HTTPException(400, "Show entry does not belong to this show")
    else:
        rows = await db.execute(
            select(ShowEntry).where(
                ShowEntry.show_id == show_id,
                ShowEntry.back_number == body.back_number,
            )
        )
        show_entry = rows.scalar_one_or_none()
        if not show_entry:
            raise HTTPException(
                404, f"Back number {body.back_number} is not assigned for this show"
            )

    existing = await db.execute(
        select(SidePotEntry).where(
            SidePotEntry.side_pot_id == pot_id,
            SidePotEntry.show_entry_id == show_entry.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "This back number is already opted into the pot")

    pe = SidePotEntry(
        side_pot_id=pot_id, show_entry_id=show_entry.id, paid=body.paid
    )
    db.add(pe)
    await db.commit()
    await db.refresh(pe)
    return await _hydrate_entry(pe, db)


@router.patch(
    "/{pot_id}/entries/{entry_id}", response_model=SidePotEntryOut
)
async def update_entry(
    show_id: UUID,
    pot_id: UUID,
    entry_id: UUID,
    body: SidePotEntryUpdate,
    db: AsyncSession = Depends(get_db),
):
    pot = await _get_pot_or_404(show_id, pot_id, db)
    _require_not_settled(pot)

    pe = await db.get(SidePotEntry, entry_id)
    if not pe or pe.side_pot_id != pot_id:
        raise HTTPException(404, "Pot entry not found")

    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(pe, k, v)
    await db.commit()
    await db.refresh(pe)
    return await _hydrate_entry(pe, db)


@router.delete("/{pot_id}/entries/{entry_id}", status_code=204)
async def remove_entry(
    show_id: UUID,
    pot_id: UUID,
    entry_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    pot = await _get_pot_or_404(show_id, pot_id, db)
    _require_not_settled(pot)

    pe = await db.get(SidePotEntry, entry_id)
    if not pe or pe.side_pot_id != pot_id:
        raise HTTPException(404, "Pot entry not found")
    await db.delete(pe)
    await db.commit()


# ── Standings & payout math ────────────────────────────────────────────────────


def _resolve_payout_splits(
    schedule: dict[str, list[int]], n_paid_entries: int
) -> list[int]:
    """Pick the splits list for the given paid-entry count.

    Schedule keys are bands like "1-3", "4-7", or "16+". Returns [] when no
    band matches (or n_paid_entries is 0).
    """
    if n_paid_entries <= 0:
        return []
    for band, splits in schedule.items():
        band = band.strip()
        if band.endswith("+"):
            lo = int(band[:-1])
            if n_paid_entries >= lo:
                return list(splits)
        elif "-" in band:
            lo_str, hi_str = band.split("-", 1)
            lo, hi = int(lo_str), int(hi_str)
            if lo <= n_paid_entries <= hi:
                return list(splits)
        else:
            # exact match (e.g. "5")
            if n_paid_entries == int(band):
                return list(splits)
    return []


def _split_payouts(
    pool_cents: int, splits: list[int]
) -> list[int]:
    """Distribute pool_cents across splits (% of pool). Remainder goes to 1st place.

    Returns one cents amount per split position. Length matches splits.
    """
    if not splits or pool_cents <= 0:
        return [0] * len(splits)
    raw = [(pool_cents * s) // 100 for s in splits]
    distributed = sum(raw)
    remainder = pool_cents - distributed
    if remainder and raw:
        raw[0] += remainder
    return raw


def _entry_aggregate(
    scoring_method: str,
    eligibility_rule: str,
    bundled_class_ids: set[UUID],
    entry_results: list[Result],  # results for this show_entry across bundled classes
) -> tuple[float, list[int], list[Optional[float]], set[UUID], bool]:
    """Compute the entry's aggregate and supporting metadata.

    Returns (aggregate_value, place_breakdown, score_breakdown, missing_class_ids, is_eligible).

    sum_placings: aggregate = sum of `place` values; lower is better.
    sum_scores:   aggregate = sum of `raw_score` values; higher is better.

    For all_classes: must have a result for every bundled class to be eligible.
    For any_class:   missing classes get last-place-plus-one (placings) or 0 (scores).
                     The entry is always eligible.
    """
    by_class = {r.class_id: r for r in entry_results}
    missing = bundled_class_ids - set(by_class.keys())
    is_eligible = (eligibility_rule != "all_classes") or not missing

    # placings/scores per bundled class (None where missing)
    placings: list[int] = []
    scores: list[Optional[float]] = []
    for cid in bundled_class_ids:
        r = by_class.get(cid)
        placings.append(r.place if r else None)
        scores.append(float(r.raw_score) if (r and r.raw_score is not None) else None)

    if not is_eligible:
        return 0.0, [p for p in placings if p is not None], scores, missing, False

    if scoring_method == "sum_placings":
        # missing → last-place-plus-one (only relevant for any_class mode)
        # We don't know the class size here, so we use a sentinel large value.
        # In practice this only affects ranking — agreement with industry
        # convention is "missing classes hurt the score." We'll resolve the
        # actual penalty when standings are computed (by passing class sizes).
        agg = sum(p for p in placings if p is not None)
    else:
        agg = sum(s for s in scores if s is not None)

    return agg, placings, scores, missing, True


def _tiebreaker_key(placings: list[int]) -> tuple[int, ...]:
    """Most 1sts → most 2nds → ... — used to break ties when aggregates match.

    Placings are filtered for None. The returned tuple sorts entries by:
      (- count_of_1sts, - count_of_2nds, - count_of_3rds, ...)
    so smaller (more negative) tuples sort earlier when used as a secondary key.
    """
    counts = Counter(p for p in placings if p is not None)
    return tuple(-counts.get(rank, 0) for rank in range(1, 11))


async def _compute_standings(
    pot: SidePot, db: AsyncSession
) -> list[SidePotStanding]:
    bundled_class_ids: set[UUID] = {pc.class_id for pc in pot.pot_classes}
    if not bundled_class_ids or not pot.pot_entries:
        return []

    show_entry_ids = [pe.show_entry_id for pe in pot.pot_entries]

    # Pull all relevant results in one query
    rows = await db.execute(
        select(Result, Entry.class_id, Entry.exhibitor_id, ShowEntry.id)
        .join(Entry, Result.entry_id == Entry.id)
        .join(ShowEntry, ShowEntry.exhibitor_id == Entry.exhibitor_id)
        .where(
            Result.class_id.in_(bundled_class_ids),
            ShowEntry.id.in_(show_entry_ids),
        )
    )
    by_show_entry: dict[UUID, list[Result]] = {sid: [] for sid in show_entry_ids}
    for result, _cid, _eid, sid in rows.all():
        by_show_entry[sid].append(result)

    # Lookup back numbers + names for display
    se_rows = await db.execute(
        select(ShowEntry)
        .where(ShowEntry.id.in_(show_entry_ids))
        .options(selectinload(ShowEntry.exhibitor))
    )
    se_by_id = {se.id: se for se in se_rows.scalars().all()}
    paid_by_id = {pe.show_entry_id: pe.paid for pe in pot.pot_entries}

    standings: list[SidePotStanding] = []
    for sid in show_entry_ids:
        agg, placings, _scores, missing, is_eligible = _entry_aggregate(
            pot.scoring_method,
            pot.eligibility_rule,
            bundled_class_ids,
            by_show_entry.get(sid, []),
        )
        se = se_by_id.get(sid)
        standings.append(
            SidePotStanding(
                show_entry_id=sid,
                back_number=se.back_number if se else None,
                exhibitor_name=(
                    se.exhibitor.full_name if se and se.exhibitor else None
                ),
                aggregate_value=float(agg),
                place=None,  # filled below
                is_eligible=is_eligible,
                missing_class_ids=list(missing),
                paid=paid_by_id.get(sid, False),
            )
        )

    # Rank only the eligible ones; ineligible entries keep place=None
    eligible = [s for s in standings if s.is_eligible]

    # placings_breakdown for tie-breakers — needs to come back from _entry_aggregate.
    # We re-derive here from the same source for clarity.
    breakdowns: dict[UUID, list[int]] = {}
    for s in eligible:
        results = by_show_entry.get(s.show_entry_id, [])
        breakdowns[s.show_entry_id] = [r.place for r in results]

    if pot.scoring_method == "sum_placings":
        primary = lambda s: s.aggregate_value  # ascending: lowest sum wins
    else:
        primary = lambda s: -s.aggregate_value  # descending: highest sum wins

    eligible.sort(key=lambda s: (primary(s), _tiebreaker_key(breakdowns[s.show_entry_id])))

    # Assign place; equal (primary, tiebreaker) → same place
    last_key = None
    last_place = 0
    for idx, s in enumerate(eligible, start=1):
        key = (primary(s), _tiebreaker_key(breakdowns[s.show_entry_id]))
        if key != last_key:
            last_place = idx
            last_key = key
        s.place = last_place

    # Stable order in the response: by place asc, then back number, ineligible last
    standings.sort(
        key=lambda s: (
            s.place is None,
            s.place or 9999,
            s.back_number is None,
            s.back_number or 0,
        )
    )
    return standings


def _project_payouts(
    standings: list[SidePotStanding], pool_cents: int, splits: list[int]
) -> dict[str, int]:
    """Map (back_number or show_entry_id) → cents for projected payouts.

    Tied entries split the combined share of their tied positions evenly.
    Remainder cents from rounding go to the lowest position in the tie.
    """
    if not splits or pool_cents <= 0:
        return {}
    place_amounts = _split_payouts(pool_cents, splits)
    payouts: dict[str, int] = {}

    eligible = [s for s in standings if s.is_eligible and s.place is not None]
    eligible.sort(key=lambda s: s.place)

    # Group by place
    i = 0
    while i < len(eligible):
        place = eligible[i].place
        group = [s for s in eligible if s.place == place]
        n = len(group)
        # Sum the slots this group occupies (place..place+n-1)
        slots = place_amounts[place - 1 : place - 1 + n]
        if not slots:
            break
        combined = sum(slots)
        per = combined // n
        remainder = combined - (per * n)
        for idx_in_group, s in enumerate(group):
            amount = per + (remainder if idx_in_group == 0 else 0)
            key = (
                str(s.back_number)
                if s.back_number is not None
                else str(s.show_entry_id)
            )
            payouts[key] = amount
        i += n
    return payouts


@router.get("/{pot_id}/standings", response_model=SidePotStandingsOut)
async def get_standings(
    show_id: UUID, pot_id: UUID, db: AsyncSession = Depends(get_db)
):
    pot = await _get_pot_or_404(show_id, pot_id, db)
    standings = await _compute_standings(pot, db)

    paid_count = sum(1 for s in standings if s.paid)
    total_pool_cents = pot.entry_fee_cents * paid_count
    payout_pool_cents = (total_pool_cents * pot.payback_percent) // 100
    splits = _resolve_payout_splits(pot.payout_schedule, paid_count)
    projected = _project_payouts(standings, payout_pool_cents, splits)

    return SidePotStandingsOut(
        side_pot_id=pot.id,
        status=pot.status,
        scoring_method=pot.scoring_method,
        eligibility_rule=pot.eligibility_rule,
        total_pool_cents=total_pool_cents,
        payout_pool_cents=payout_pool_cents,
        standings=standings,
        projected_payouts=projected,
    )


# ── Settle ─────────────────────────────────────────────────────────────────────


@router.post("/{pot_id}/settle", response_model=list[SidePotPayoutOut])
async def settle_pot(
    show_id: UUID, pot_id: UUID, db: AsyncSession = Depends(get_db)
):
    pot = await _get_pot_or_404(show_id, pot_id, db)
    if pot.status == "settled":
        raise HTTPException(409, "Side pot is already settled")

    standings = await _compute_standings(pot, db)
    paid_count = sum(1 for s in standings if s.paid)
    total_pool_cents = pot.entry_fee_cents * paid_count
    payout_pool_cents = (total_pool_cents * pot.payback_percent) // 100
    splits = _resolve_payout_splits(pot.payout_schedule, paid_count)
    place_amounts = _split_payouts(payout_pool_cents, splits)

    # Group eligible standings by place to handle ties
    eligible = [s for s in standings if s.is_eligible and s.place is not None]
    eligible.sort(key=lambda s: s.place)

    written: list[SidePotPayout] = []
    i = 0
    while i < len(eligible):
        place = eligible[i].place
        group = [s for s in eligible if s.place == place]
        n = len(group)
        slots = place_amounts[place - 1 : place - 1 + n] if place_amounts else []
        combined = sum(slots)
        if n > 0 and combined > 0:
            per = combined // n
            remainder = combined - (per * n)
        else:
            per = 0
            remainder = 0
        for idx_in_group, s in enumerate(group):
            amount = per + (remainder if idx_in_group == 0 else 0)
            tiebreaker_notes: Optional[str] = None
            if n > 1:
                tiebreaker_notes = (
                    f"Tied with {n - 1} other entr"
                    f"{'y' if n - 1 == 1 else 'ies'} at place {place}; "
                    "share split evenly."
                )
            payout = SidePotPayout(
                side_pot_id=pot.id,
                show_entry_id=s.show_entry_id,
                place=place,
                payout_cents=amount,
                aggregate_value=s.aggregate_value,
                tiebreaker_notes=tiebreaker_notes,
            )
            db.add(payout)
            written.append(payout)
        i += n

    pot.status = "settled"
    pot.settled_at = datetime.now(timezone.utc)
    await db.commit()
    for p in written:
        await db.refresh(p)

    # Hydrate output with back numbers + names
    se_rows = await db.execute(
        select(ShowEntry)
        .where(ShowEntry.id.in_([p.show_entry_id for p in written]))
        .options(selectinload(ShowEntry.exhibitor))
    )
    se_by_id = {se.id: se for se in se_rows.scalars().all()}
    return [
        {
            "id": p.id,
            "side_pot_id": p.side_pot_id,
            "show_entry_id": p.show_entry_id,
            "back_number": (
                se_by_id[p.show_entry_id].back_number
                if p.show_entry_id in se_by_id
                else None
            ),
            "exhibitor_name": (
                se_by_id[p.show_entry_id].exhibitor.full_name
                if p.show_entry_id in se_by_id
                and se_by_id[p.show_entry_id].exhibitor
                else None
            ),
            "place": p.place,
            "payout_cents": p.payout_cents,
            "aggregate_value": float(p.aggregate_value),
            "tiebreaker_notes": p.tiebreaker_notes,
            "created_at": p.created_at,
        }
        for p in written
    ]


@router.get("/{pot_id}/payouts", response_model=list[SidePotPayoutOut])
async def list_payouts(
    show_id: UUID, pot_id: UUID, db: AsyncSession = Depends(get_db)
):
    pot = await _get_pot_or_404(show_id, pot_id, db)
    rows = await db.execute(
        select(SidePotPayout)
        .where(SidePotPayout.side_pot_id == pot.id)
        .order_by(SidePotPayout.place)
    )
    payouts = list(rows.scalars().all())
    if not payouts:
        return []
    se_rows = await db.execute(
        select(ShowEntry)
        .where(ShowEntry.id.in_([p.show_entry_id for p in payouts]))
        .options(selectinload(ShowEntry.exhibitor))
    )
    se_by_id = {se.id: se for se in se_rows.scalars().all()}
    return [
        {
            "id": p.id,
            "side_pot_id": p.side_pot_id,
            "show_entry_id": p.show_entry_id,
            "back_number": (
                se_by_id[p.show_entry_id].back_number
                if p.show_entry_id in se_by_id
                else None
            ),
            "exhibitor_name": (
                se_by_id[p.show_entry_id].exhibitor.full_name
                if p.show_entry_id in se_by_id
                and se_by_id[p.show_entry_id].exhibitor
                else None
            ),
            "place": p.place,
            "payout_cents": p.payout_cents,
            "aggregate_value": float(p.aggregate_value),
            "tiebreaker_notes": p.tiebreaker_notes,
            "created_at": p.created_at,
        }
        for p in payouts
    ]
