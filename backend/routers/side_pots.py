"""Side pots (divisional jackpots).

A side pot is an optional money pool that spans multiple classes within a show.
Exhibitors enter at the show_entry (back number) level and pay a flat buy-in, so
one side pot entry covers every bundled class. The pot ranks its entries by
combined score across those classes and pays out per a producer-configurable
schedule.

Standings are computed on demand from the current `results` rows. They are
materialized into `side_pot_payouts` only when the pot is settled.

A `fastest_time` pot (migration 205) is the barrel sidepot: bought into one run
at a time (`side_pot_entries.entry_id`), ranked on that run's time, lowest
first, and paid in D splits by `side_pot_time`. Its standings, projected
payouts and settled payouts are per run, keyed by the buy-in row.
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

from backnumbers import back_numbers_for_show
from class_numbers import class_label, hash_label
from database import get_db
from dependencies import require_admin_or_show_admin
from show_companies import refuse_frozen_show
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
from placings import is_placed, place_key
from side_pot_time import TimedRun, time_pot
from schemas import (
    SidePotDLine,
    SidePotRun,
    default_d_percents,
    validate_d_percents,
    SidePotCreate,
    SidePotEntryCreate,
    SidePotEntryOut,
    SidePotEntryUpdate,
    SidePotOut,
    SidePotPayoutOut,
    SidePotRosterEntry,
    SidePotStanding,
    SidePotStandingsOut,
    SidePotUpdate,
)

router = APIRouter(
    prefix="/shows/{show_id}/side-pots",
    tags=["Side Pots"],
    # Migration 175: not while the show is frozen by an unpaid Pro+ renewal.
    dependencies=[Depends(require_admin_or_show_admin), Depends(refuse_frozen_show)],
)


# ── Helpers ────────────────────────────────────────────────────────────────────


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _get_pot_or_404(show_id: UUID, pot_id: UUID, db: AsyncSession) -> SidePot:
    """Load a pot with everything `_serialize_pot` reads already attached.

    `select().populate_existing()` rather than `db.get(..., options=[...])`:
    loader options are **silently ignored** when the instance is already in the
    session's identity map, which is exactly the case one line after
    `create_pot()` added it. The relationships then come back unloaded, the
    first attribute access is lazy IO inside an async request, and SQLAlchemy
    raises `MissingGreenlet` — a 500 on the save button with nothing in the
    response body to explain it. `populate_existing` forces the options onto the
    instance that is already there.
    """
    rows = await db.execute(
        select(SidePot)
        .where(SidePot.id == pot_id)
        .options(
            selectinload(SidePot.pot_classes).selectinload(SidePotClass.class_),
            selectinload(SidePot.pot_entries).selectinload(SidePotEntry.show_entry),
        )
        .execution_options(populate_existing=True)
    )
    pot = rows.scalar_one_or_none()
    if not pot or pot.show_id != show_id:
        raise HTTPException(404, "Side pot not found")
    return pot


def _require_not_settled(pot: SidePot) -> None:
    if pot.status == "settled":
        raise HTTPException(409, "Side pot is settled and cannot be modified")


TIME_POT = "fastest_time"


def is_time_pot(pot: SidePot) -> bool:
    """A pot bought into one run at a time and paid on that run's time."""
    return pot.scoring_method == TIME_POT


def _d_percents(pot: SidePot) -> list[int]:
    """The pot's D shares, or the default for its D count when none are stored
    or they no longer fit it."""
    stored = pot.d_percents
    if isinstance(stored, list) and len(stored) == pot.d_count and sum(stored) == 100:
        return list(stored)
    return default_d_percents(pot.d_count)


def run_label(entry: Entry) -> str:
    """'#100 Int. Barrels · Smokin Doc', the run a time pot's buy-in names."""
    cls = entry.class_
    horse = entry.horse.name if entry.horse else None
    label = hash_label(cls) if cls else "A class"
    return f"{label} · {horse}" if horse else label


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
                f"'pattern' or 'time'; {class_label(non_score[0])} is "
                f"'{non_score[0].score_type}'",
            )
    if scoring_method == TIME_POT:
        untimed = [c for c in classes if c.score_type != "time"]
        if untimed:
            raise HTTPException(
                400,
                f"A pot paid on time takes its times from timed classes; "
                f"{class_label(untimed[0])} is not timed. Mark it Timed in the class editor.",
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
        "added_money_cents": pot.added_money_cents or 0,
        "d_count": pot.d_count or 1,
        "d_split_ms": pot.d_split_ms or 500,
        "d_percents": _d_percents(pot),
        "per_run": is_time_pot(pot),
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
        added_money_cents=body.added_money_cents,
        d_count=body.d_count,
        d_split_ms=body.d_split_ms,
        d_percents=body.d_percents,
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

    # A time pot's buy-ins are runs and every other pot's are exhibitors, so a
    # pot with buy-ins cannot change between the two: its rows would mean the
    # wrong thing.
    if (new_method == TIME_POT) != is_time_pot(pot) and pot.pot_entries:
        raise HTTPException(
            409,
            "This pot already has entries. A pot paid on time is bought into run by run, "
            "so take everybody out before changing how it is scored.",
        )

    if new_class_ids is not None:
        await _validate_class_ids_for_show(show_id, new_class_ids, new_method, db)
    elif "scoring_method" in updates and new_method in ("sum_scores", TIME_POT):
        # method changed without changing classes; re-validate existing class set
        existing_ids = [pc.class_id for pc in pot.pot_classes]
        await _validate_class_ids_for_show(show_id, existing_ids, new_method, db)

    # The D shares must fit the D count the update leaves the pot with; a new
    # count with no shares takes that count's default rather than failing.
    if "d_count" in updates or "d_percents" in updates:
        new_count = updates.get("d_count") or pot.d_count
        shares = updates.get("d_percents")
        if shares is None:
            shares = (
                pot.d_percents
                if "d_count" not in updates or new_count == pot.d_count
                else default_d_percents(new_count)
            ) or default_d_percents(new_count)
        try:
            updates["d_percents"] = validate_d_percents(list(shares), new_count)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

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


# ── Side pot entries ──────────────────────────────────────────────────────────


async def _show_entry_wearing(show_id: UUID, number: int, db: AsyncSession) -> ShowEntry:
    """The roster row of whoever wears this back number.

    At a show that numbers horses (migration 161) the number is a horse's, and
    a buy-in is an exhibitor's: the horse's rider is the answer when there is
    one, and when two exhibitors show that horse the number cannot say which of
    them is buying in, so staff are asked to pick by name. At a show that
    numbers pairs (migration 178) the number names its exhibitor outright.
    """
    numbers = await back_numbers_for_show(show_id, db)
    if numbers.per_exhibitor:
        rows = await db.execute(
            select(ShowEntry).where(
                ShowEntry.show_id == show_id,
                ShowEntry.back_number == number,
            )
        )
        show_entry = rows.scalar_one_or_none()
    else:
        riders = numbers.wearers_of(number)
        if len(riders) > 1:
            raise HTTPException(
                409,
                f"Back number {number} is a horse shown by more than one exhibitor. "
                "Pick the exhibitor by name instead.",
            )
        show_entry = None
        if riders:
            rows = await db.execute(
                select(ShowEntry).where(
                    ShowEntry.show_id == show_id,
                    ShowEntry.exhibitor_id == riders[0],
                )
            )
            show_entry = rows.scalar_one_or_none()
    if not show_entry:
        raise HTTPException(404, f"Back number {number} is not assigned for this show")
    return show_entry


async def _hydrate_entry(
    pot_entry: SidePotEntry, db: AsyncSession, show_id: UUID
) -> dict:
    """Build a dict for SidePotEntryOut, looking up back number + name.

    Same `populate_existing` reason as `_get_pot_or_404`: `_get_pot_or_404`
    already pulled these `ShowEntry` rows into the session (without their
    exhibitor), so `db.get(..., options=[...])` would hand back the loaded
    instance and drop the option, and reading `.exhibitor` would lazy-load.
    """
    rows = await db.execute(
        select(ShowEntry)
        .where(ShowEntry.id == pot_entry.show_entry_id)
        .options(selectinload(ShowEntry.exhibitor))
        .execution_options(populate_existing=True)
    )
    show_entry = rows.scalar_one_or_none()
    numbers = await back_numbers_for_show(show_id, db)
    exhibitor_id = show_entry.exhibitor_id if show_entry else None
    run = await _load_run(pot_entry.entry_id, db) if pot_entry.entry_id else None
    if run is not None:
        # A run's buy-in is that horse's number, at a show that numbers horses.
        number = numbers.for_entry(run)
        return {
            "id": pot_entry.id,
            "side_pot_id": pot_entry.side_pot_id,
            "show_entry_id": pot_entry.show_entry_id,
            "back_number": number,
            "back_numbers": [number] if number is not None else [],
            "exhibitor_name": (
                show_entry.exhibitor.full_name if show_entry and show_entry.exhibitor else None
            ),
            "paid": pot_entry.paid,
            "created_at": pot_entry.created_at,
            "entry_id": run.id,
            "run_label": run_label(run),
        }
    return {
        "id": pot_entry.id,
        "side_pot_id": pot_entry.side_pot_id,
        "show_entry_id": pot_entry.show_entry_id,
        # A buy-in is the exhibitor's, so it carries every number they wear --
        # one per horse at a show that numbers horses (migration 161).
        "back_number": numbers.first_for_exhibitor(exhibitor_id),
        "back_numbers": numbers.for_exhibitor(exhibitor_id),
        "exhibitor_name": (
            show_entry.exhibitor.full_name
            if show_entry and show_entry.exhibitor
            else None
        ),
        "paid": pot_entry.paid,
        "created_at": pot_entry.created_at,
    }


async def _load_run(entry_id: UUID, db: AsyncSession) -> Optional[Entry]:
    """A class entry with what `run_label` and the back number read."""
    rows = await db.execute(
        select(Entry)
        .where(Entry.id == entry_id)
        .options(selectinload(Entry.class_), selectinload(Entry.horse))
    )
    return rows.scalar_one_or_none()


@router.get("/{pot_id}/entries", response_model=list[SidePotEntryOut])
async def list_entries(
    show_id: UUID, pot_id: UUID, db: AsyncSession = Depends(get_db)
):
    pot = await _get_pot_or_404(show_id, pot_id, db)
    out = []
    for pe in pot.pot_entries:
        out.append(await _hydrate_entry(pe, db, show_id))
    out.sort(key=lambda e: (e["back_number"] is None, e["back_number"] or 0))
    return out


@router.get("/{pot_id}/roster", response_model=list[SidePotRosterEntry])
async def list_show_roster(
    show_id: UUID, pot_id: UUID, db: AsyncSession = Depends(get_db)
):
    """The show's roster, which is what the pot's exhibitor picker offers.

    Read from `show_entries` rather than from who is entered in the pot's
    bundled classes: the pot is joined at the show level, and the desk adds
    people to a pot before the class entries settle. Someone with no results in
    the bundled classes simply ranks as ineligible, which the standings already
    say plainly.

    Scoped to the pot so it 404s on a pot that belongs to another show; the
    caller filters out who is already in.
    """
    await _get_pot_or_404(show_id, pot_id, db)
    rows = await db.execute(
        select(ShowEntry)
        .where(ShowEntry.show_id == show_id)
        .options(selectinload(ShowEntry.exhibitor))
    )
    numbers = await back_numbers_for_show(show_id, db)
    roster = [
        {
            "show_entry_id": se.id,
            "back_number": numbers.first_for_exhibitor(se.exhibitor_id),
            "back_numbers": numbers.for_exhibitor(se.exhibitor_id),
            "exhibitor_name": se.exhibitor.full_name if se.exhibitor else None,
        }
        for se in rows.scalars().all()
    ]
    # Numbered first in number order, then whoever has no number yet, by name.
    roster.sort(
        key=lambda r: (
            r["back_number"] is None,
            r["back_number"] or 0,
            (r["exhibitor_name"] or "").lower(),
        )
    )
    return roster


@router.get("/{pot_id}/runs", response_model=list[SidePotRun])
async def list_runs(show_id: UUID, pot_id: UUID, db: AsyncSession = Depends(get_db)):
    """The runs a time pot can be bought into: every entry in its classes.

    A time pot's buy-in is a run, not a person -- a rider on two horses can buy
    both in, and the futurity pot must pay on the futurity horse's time -- so
    its Entries screen picks from these rather than from the show roster.
    `joined` marks the runs already in. Empty for any other pot.
    """
    pot = await _get_pot_or_404(show_id, pot_id, db)
    if not is_time_pot(pot):
        return []
    class_ids = [pc.class_id for pc in pot.pot_classes]
    if not class_ids:
        return []
    rows = await db.execute(
        select(Entry)
        .where(Entry.class_id.in_(class_ids))
        .options(
            selectinload(Entry.class_),
            selectinload(Entry.horse),
            selectinload(Entry.exhibitor),
        )
    )
    entries = list(rows.scalars().all())
    se_rows = await db.execute(select(ShowEntry).where(ShowEntry.show_id == show_id))
    show_entry_by_exhibitor = {se.exhibitor_id: se.id for se in se_rows.scalars().all()}
    numbers = await back_numbers_for_show(show_id, db)
    joined = {pe.entry_id for pe in pot.pot_entries if pe.entry_id}
    runs = [
        {
            "entry_id": e.id,
            "show_entry_id": show_entry_by_exhibitor.get(e.exhibitor_id),
            "back_number": numbers.for_entry(e),
            "exhibitor_name": e.exhibitor.full_name if e.exhibitor else None,
            "horse_name": e.horse.name if e.horse else None,
            "class_id": e.class_id,
            "class_number": e.class_.class_number,
            "class_name": e.class_.class_name,
            "run_label": run_label(e),
            "joined": e.id in joined,
        }
        for e in entries
    ]
    runs.sort(
        key=lambda r: (
            r["back_number"] is None,
            r["back_number"] or 0,
            (r["exhibitor_name"] or "").lower(),
            r["run_label"],
        )
    )
    return runs


async def _add_run(pot: SidePot, show_id: UUID, body: SidePotEntryCreate, db: AsyncSession) -> SidePotEntry:
    """Buy one run into a time pot. The run names its exhibitor, so nothing
    else on the request is read."""
    if body.entry_id is None:
        raise HTTPException(
            422, "This pot is paid on time, so it is bought into one run at a time: pick the run."
        )
    run = await _load_run(body.entry_id, db)
    if run is None or run.class_ is None or run.class_.show_id != show_id:
        raise HTTPException(400, "That entry is not at this show")
    if run.class_id not in {pc.class_id for pc in pot.pot_classes}:
        raise HTTPException(
            400, f"{class_label(run.class_)} is not one of this pot's classes, so its time cannot count here."
        )
    if any(pe.entry_id == run.id for pe in pot.pot_entries):
        raise HTTPException(409, "This run is already in the pot")
    show_entry = (
        await db.execute(
            select(ShowEntry).where(
                ShowEntry.show_id == show_id, ShowEntry.exhibitor_id == run.exhibitor_id
            )
        )
    ).scalar_one_or_none()
    if show_entry is None:
        raise HTTPException(409, "This rider is not signed up to the show, so there is no bill to put the buy-in on")
    return SidePotEntry(side_pot_id=pot.id, show_entry_id=show_entry.id, entry_id=run.id, paid=body.paid)


@router.post("/{pot_id}/entries", response_model=SidePotEntryOut, status_code=201)
async def add_entry(
    show_id: UUID,
    pot_id: UUID,
    body: SidePotEntryCreate,
    db: AsyncSession = Depends(get_db),
):
    pot = await _get_pot_or_404(show_id, pot_id, db)
    _require_not_settled(pot)

    if is_time_pot(pot):
        pe = await _add_run(pot, show_id, body, db)
        db.add(pe)
        await db.commit()
        await db.refresh(pe)
        return await _hydrate_entry(pe, db, show_id)
    if body.entry_id is not None:
        raise HTTPException(
            422, "This pot is joined once per exhibitor, not run by run: pick the exhibitor."
        )

    if body.show_entry_id is not None:
        show_entry = await db.get(ShowEntry, body.show_entry_id)
        if not show_entry or show_entry.show_id != show_id:
            raise HTTPException(400, "Show entry does not belong to this show")
    else:
        show_entry = await _show_entry_wearing(show_id, body.back_number, db)

    existing = await db.execute(
        select(SidePotEntry).where(
            SidePotEntry.side_pot_id == pot_id,
            SidePotEntry.show_entry_id == show_entry.id,
            SidePotEntry.entry_id.is_(None),
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
    return await _hydrate_entry(pe, db, show_id)


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
    return await _hydrate_entry(pe, db, show_id)


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
    # One card per judge since migration 095, so a class can contribute several
    # results for the same entry. Take the best of them, deterministically —
    # this used to be a dict comprehension whose winner depended on row order.
    #
    # Open decision, not a rule: bills that run multi-judge side pots settle
    # "from combined judge score sheets", which is a sum across judges rather
    # than a best-of. Adopting that would silently change payouts on existing
    # pots, so it needs a deliberate call. Best-of matches today's behaviour and
    # is identical to it on the single-judge shows side pots have run on.
    #
    # A card that did not place the entry is skipped outright (migration 121):
    # pot money is settled from placings and scores, and a disqualified or
    # no-scored run should contribute neither. A class where every card threw the
    # entry out therefore reads as missing, which is what `all_classes`
    # eligibility already knows how to handle.
    by_class: dict[UUID, Result] = {}
    for r in entry_results:
        if not is_placed(r):
            continue
        current = by_class.get(r.class_id)
        if current is None or place_key(r) < place_key(current):
            by_class[r.class_id] = r
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
    numbers = await back_numbers_for_show(pot.show_id, db)

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
                back_number=numbers.first_for_exhibitor(se.exhibitor_id if se else None),
                back_numbers=numbers.for_exhibitor(se.exhibitor_id if se else None),
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
        breakdowns[s.show_entry_id] = [r.place for r in results if is_placed(r)]

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
    """Map show_entry_id, and back_number where there is one, → cents for
    projected payouts. The roster row is the key that cannot collide: at a show
    that numbers horses (migration 161) two exhibitors sharing a horse can
    report the same lowest number. The back-number key stays for a page loaded
    before the change.

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
            payouts[str(s.show_entry_id)] = amount
            if s.back_number is not None:
                payouts.setdefault(str(s.back_number), amount)
        i += n
    return payouts


def pot_pools(pot: SidePot, paid_count: int) -> tuple[int, int]:
    """(buy-ins taken, payout pool). The pool is the buy-ins' payback plus any
    money the show added (migration 205) -- the same figures as
    `billing.side_pot_money`."""
    total_pool_cents = pot.entry_fee_cents * paid_count
    payout_pool_cents = (total_pool_cents * pot.payback_percent) // 100 + (pot.added_money_cents or 0)
    return total_pool_cents, payout_pool_cents


async def _compute_time_pot(pot: SidePot, db: AsyncSession):
    """A time pot's standings, one per run bought in, and what each is paid.

    A run's time is the fastest placed time it has in the pot's classes --
    normally its one age-division run; a run with no placed time (no time,
    knocked out, disqualified) is in the pot but unranked. Only paid buy-ins
    count toward the pool and the payout band, as in every pot; an unpaid
    run is ranked and flagged but paid nothing.
    """
    rows_by_id = {pe.id: pe for pe in pot.pot_entries if pe.entry_id}
    run_ids = [pe.entry_id for pe in rows_by_id.values()]
    class_ids = {pc.class_id for pc in pot.pot_classes}

    runs: dict[UUID, Entry] = {}
    times: dict[UUID, Optional[float]] = {}
    if run_ids:
        entry_rows = await db.execute(
            select(Entry)
            .where(Entry.id.in_(run_ids))
            .options(selectinload(Entry.class_), selectinload(Entry.horse))
        )
        runs = {e.id: e for e in entry_rows.scalars().all()}
        result_rows = await db.execute(
            select(Result).where(Result.entry_id.in_(run_ids), Result.class_id.in_(class_ids))
        )
        for r in result_rows.scalars().all():
            if not is_placed(r) or r.raw_score is None:
                continue
            current = times.get(r.entry_id)
            if current is None or r.raw_score < current:
                times[r.entry_id] = r.raw_score

    paid_rows = [pe for pe in rows_by_id.values() if pe.paid]
    total_pool_cents, payout_pool_cents = pot_pools(pot, len(paid_rows))
    splits = _resolve_payout_splits(pot.payout_schedule, len(paid_rows))
    d_percents = _d_percents(pot)
    result = time_pot(
        [TimedRun(key=pe.id, time=times.get(pe.entry_id)) for pe in paid_rows],
        payout_pool_cents,
        pot.d_count,
        pot.d_split_ms,
        d_percents,
        splits,
    )
    # Unpaid runs are ranked for the office to see but take no money, so they
    # are placed into the Ds the paid field set, and never move its lines.
    ranked = {st.key: st for st in result.standings}
    fastest = min((st.time_ms for st in result.standings), default=None)

    se_ids = {pe.show_entry_id for pe in rows_by_id.values()}
    se_rows = await db.execute(
        select(ShowEntry).where(ShowEntry.id.in_(se_ids)).options(selectinload(ShowEntry.exhibitor))
    ) if se_ids else None
    se_by_id = {se.id: se for se in se_rows.scalars().all()} if se_rows is not None else {}
    numbers = await back_numbers_for_show(pot.show_id, db)

    standings: list[SidePotStanding] = []
    for pe in rows_by_id.values():
        run = runs.get(pe.entry_id)
        se = se_by_id.get(pe.show_entry_id)
        time = times.get(pe.entry_id)
        st = ranked.get(pe.id)
        d_number = st.d_number if st else None
        behind = st.behind_ms if st else None
        if st is None and time is not None and fastest is not None:
            behind = max(int(round(float(time) * 1000)) - fastest, 0)
            d_number = min(behind // pot.d_split_ms, pot.d_count - 1) + 1
        number = numbers.for_entry(run) if run else None
        standings.append(
            SidePotStanding(
                show_entry_id=pe.show_entry_id,
                back_number=number,
                back_numbers=[number] if number is not None else [],
                exhibitor_name=se.exhibitor.full_name if se and se.exhibitor else None,
                aggregate_value=float(time) if time is not None else 0.0,
                place=st.place if st else None,
                is_eligible=time is not None,
                missing_class_ids=[] if time is not None or run is None else [run.class_id],
                paid=pe.paid,
                side_pot_entry_id=pe.id,
                entry_id=pe.entry_id,
                run_label=run_label(run) if run else None,
                d_number=d_number,
                behind_ms=behind,
            )
        )
    standings.sort(
        key=lambda s: (
            s.d_number is None,
            s.d_number or 0,
            s.place is None,
            s.place or 9999,
            s.aggregate_value,
            s.back_number or 0,
        )
    )
    d_lines = [
        SidePotDLine(
            d_number=line.d_number,
            percent=line.percent,
            from_time=None if line.from_ms is None else line.from_ms / 1000,
            runners=line.runners,
            paid_places=line.paid_places,
            amount_cents=line.amount_cents,
        )
        for line in result.d_lines
    ]
    return standings, result, total_pool_cents, payout_pool_cents, d_lines


@router.get("/{pot_id}/standings", response_model=SidePotStandingsOut)
async def get_standings(
    show_id: UUID, pot_id: UUID, db: AsyncSession = Depends(get_db)
):
    pot = await _get_pot_or_404(show_id, pot_id, db)
    if is_time_pot(pot):
        standings, result, total_pool_cents, payout_pool_cents, d_lines = await _compute_time_pot(pot, db)
        return SidePotStandingsOut(
            side_pot_id=pot.id,
            status=pot.status,
            scoring_method=pot.scoring_method,
            eligibility_rule=pot.eligibility_rule,
            total_pool_cents=total_pool_cents,
            payout_pool_cents=payout_pool_cents,
            standings=standings,
            projected_payouts={str(k): v for k, v in result.payouts.items()},
            added_money_cents=pot.added_money_cents or 0,
            d_lines=d_lines,
            unawarded_cents=result.unawarded_cents,
        )
    standings = await _compute_standings(pot, db)

    paid_count = sum(1 for s in standings if s.paid)
    total_pool_cents, payout_pool_cents = pot_pools(pot, paid_count)
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
        added_money_cents=pot.added_money_cents or 0,
    )


# ── Settle ─────────────────────────────────────────────────────────────────────


@router.post("/{pot_id}/settle", response_model=list[SidePotPayoutOut])
async def settle_pot(
    show_id: UUID, pot_id: UUID, db: AsyncSession = Depends(get_db)
):
    pot = await _get_pot_or_404(show_id, pot_id, db)
    if pot.status == "settled":
        raise HTTPException(409, "Side pot is already settled")

    written: list[SidePotPayout] = []
    if is_time_pot(pot):
        standings, result, *_ = await _compute_time_pot(pot, db)
        for s in standings:
            if not s.paid or s.place is None:
                continue
            same = [
                o for o in standings
                if o.paid and o.d_number == s.d_number and o.place == s.place
            ]
            payout = SidePotPayout(
                side_pot_id=pot.id,
                show_entry_id=s.show_entry_id,
                place=s.place,
                payout_cents=result.payouts.get(s.side_pot_entry_id, 0),
                aggregate_value=s.aggregate_value,
                tiebreaker_notes=(
                    f"Tied with {len(same) - 1} other run{'s' if len(same) > 2 else ''} "
                    f"at place {s.place} in the {s.d_number}D; share split evenly."
                    if len(same) > 1
                    else None
                ),
                entry_id=s.entry_id,
                d_number=s.d_number,
            )
            db.add(payout)
            written.append(payout)
        pot.status = "settled"
        pot.settled_at = datetime.now(timezone.utc)
        await db.commit()
        for p in written:
            await db.refresh(p)
        return await _payouts_out(show_id, written, db)

    standings = await _compute_standings(pot, db)
    paid_count = sum(1 for s in standings if s.paid)
    total_pool_cents, payout_pool_cents = pot_pools(pot, paid_count)
    splits = _resolve_payout_splits(pot.payout_schedule, paid_count)
    place_amounts = _split_payouts(payout_pool_cents, splits)

    # Group eligible standings by place to handle ties
    eligible = [s for s in standings if s.is_eligible and s.place is not None]
    eligible.sort(key=lambda s: s.place)

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
    return await _payouts_out(show_id, written, db)


async def _payouts_out(show_id: UUID, payouts: list[SidePotPayout], db: AsyncSession) -> list[dict]:
    """Payout rows with their back numbers and names -- and, for a time pot's,
    the run they paid, whose own number is the one printed."""
    if not payouts:
        return []
    se_rows = await db.execute(
        select(ShowEntry)
        .where(ShowEntry.id.in_([p.show_entry_id for p in payouts]))
        .options(selectinload(ShowEntry.exhibitor))
    )
    se_by_id = {se.id: se for se in se_rows.scalars().all()}
    run_ids = [p.entry_id for p in payouts if p.entry_id]
    runs: dict[UUID, Entry] = {}
    if run_ids:
        run_rows = await db.execute(
            select(Entry)
            .where(Entry.id.in_(run_ids))
            .options(selectinload(Entry.class_), selectinload(Entry.horse))
        )
        runs = {e.id: e for e in run_rows.scalars().all()}
    numbers = await back_numbers_for_show(show_id, db)
    out = []
    for p in payouts:
        se = se_by_id.get(p.show_entry_id)
        exhibitor_id = se.exhibitor_id if se else None
        run = runs.get(p.entry_id) if p.entry_id else None
        if run is not None:
            number = numbers.for_entry(run)
            back_number, back_numbers = number, ([number] if number is not None else [])
        else:
            back_number = numbers.first_for_exhibitor(exhibitor_id)
            back_numbers = numbers.for_exhibitor(exhibitor_id)
        out.append(
            {
                "id": p.id,
                "side_pot_id": p.side_pot_id,
                "show_entry_id": p.show_entry_id,
                "back_number": back_number,
                "back_numbers": back_numbers,
                "exhibitor_name": se.exhibitor.full_name if se and se.exhibitor else None,
                "place": p.place,
                "payout_cents": p.payout_cents,
                "aggregate_value": float(p.aggregate_value),
                "tiebreaker_notes": p.tiebreaker_notes,
                "created_at": p.created_at,
                "entry_id": p.entry_id,
                "d_number": p.d_number,
                "run_label": run_label(run) if run else None,
            }
        )
    return out


@router.get("/{pot_id}/payouts", response_model=list[SidePotPayoutOut])
async def list_payouts(
    show_id: UUID, pot_id: UUID, db: AsyncSession = Depends(get_db)
):
    pot = await _get_pot_or_404(show_id, pot_id, db)
    rows = await db.execute(
        select(SidePotPayout)
        .where(SidePotPayout.side_pot_id == pot.id)
        .order_by(SidePotPayout.d_number.nulls_first(), SidePotPayout.place)
    )
    return await _payouts_out(show_id, list(rows.scalars().all()), db)
