"""Futurities.

A futurity is a named program within a show: its own set of classes, its own
tiered per-class entry fee, an entry deadline with a late fee, an office fee
that depends on club membership, and Hi-Point award divisions computed over a
named subset of its classes.

Two things separate it from a side pot, which it otherwise resembles:

1. **An entry is an enrollment of a horse, not a bet on classes.** The lettered
   futurity classes are ordinary `classes` entered through ordinary `entries`.
   `futurity_entries` records that a horse is in the program, at which fee
   tier, and whether its owner holds a membership. What that costs is derived
   in `billing.futurity_charge_cents`, which is the only place the arithmetic
   lives.

2. **The futurity supplies the class price.** A futurity class carries
   `entry_fee_cents = 0` because the rate depends on the entrant's category,
   which a class row cannot know. Nothing here enforces that — the class screens
   know nothing about futurities — so `entry_fee_cents` is returned on every
   class in the payload and the UI warns when one is priced. Zeroing it server
   side would hide a real mistake in the schedule; the fix belongs on the class.

Standings are computed on demand from the current `results` rows, like side pot
standings. Nothing is materialized — a futurity has no settle step, because the
awards are saddles and buckles rather than a money pool.
"""

from __future__ import annotations

from collections import Counter
from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

import billing
from database import get_db
from dependencies import require_admin_or_show_admin
from models import (
    Class,
    Entry,
    Exhibitor,
    Futurity,
    FuturityClass,
    FuturityDivision,
    FuturityDivisionClass,
    FuturityEntry,
    FuturityFeeTier,
    Horse,
    Result,
    Show,
    ShowEntry,
)
from schemas import (
    FuturityCreate,
    FuturityDivisionIn,
    FuturityDivisionOut,
    FuturityEntryCreate,
    FuturityEntryOut,
    FuturityEntryUpdate,
    FuturityOut,
    FuturityRosterEntry,
    FuturityStanding,
    FuturityStandingsOut,
    FuturityUpdate,
)

router = APIRouter(
    prefix="/shows/{show_id}/futurities",
    tags=["Futurities"],
    dependencies=[Depends(require_admin_or_show_admin)],
)


# ── Helpers ────────────────────────────────────────────────────────────────────

_FUTURITY_LOADS = (
    selectinload(Futurity.fee_tiers),
    selectinload(Futurity.futurity_classes).selectinload(FuturityClass.class_),
    selectinload(Futurity.divisions)
    .selectinload(FuturityDivision.division_classes)
    .selectinload(FuturityDivisionClass.class_),
    selectinload(Futurity.entries).selectinload(FuturityEntry.horse),
    selectinload(Futurity.entries).selectinload(FuturityEntry.fee_tier),
)


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _load_futurity(show_id: UUID, futurity_id: UUID, db: AsyncSession) -> Futurity:
    """Read a futurity with everything the serializer touches already loaded.

    Deliberately a fresh `select` with `populate_existing`, never
    `db.get(..., options=...)`: when the row is already in the identity map —
    the common case immediately after a create or update — `db.get` drops the
    options, and the first relationship read is then lazy IO inside an async
    request. That is a `MissingGreenlet`, which surfaces as a 500 with an empty
    body on a request whose write has already committed.
    """
    row = (
        await db.execute(
            select(Futurity)
            .where(Futurity.id == futurity_id, Futurity.show_id == show_id)
            .options(*_FUTURITY_LOADS)
            .execution_options(populate_existing=True)
        )
    ).scalars().first()
    if row is None:
        raise HTTPException(404, "Futurity not found")
    return row


async def _validate_class_ids(show_id: UUID, class_ids: list[UUID], db: AsyncSession) -> None:
    """Every class must belong to this show. Silently dropping a stray id would
    produce a futurity quietly missing a class the secretary thought they added."""
    if not class_ids:
        return
    found = set(
        (
            await db.execute(
                select(Class.id).where(Class.show_id == show_id, Class.id.in_(class_ids))
            )
        ).scalars().all()
    )
    missing = [str(c) for c in class_ids if c not in found]
    if missing:
        raise HTTPException(
            422, f"These classes do not belong to this show: {', '.join(sorted(missing))}"
        )


def _serialize(futurity: Futurity) -> dict:
    classes = sorted(
        (fc.class_ for fc in futurity.futurity_classes if fc.class_ is not None),
        key=lambda c: (c.sort_order if c.sort_order is not None else 0, c.class_number),
    )
    return {
        "id": futurity.id,
        "show_id": futurity.show_id,
        "name": futurity.name,
        "description": futurity.description,
        "entry_deadline": futurity.entry_deadline,
        "late_fee_cents": futurity.late_fee_cents,
        "office_fee_member_cents": futurity.office_fee_member_cents,
        "office_fee_nonmember_cents": futurity.office_fee_nonmember_cents,
        "created_at": futurity.created_at,
        "classes": [
            {
                "class_id": c.id,
                "class_number": c.class_number,
                "class_name": c.class_name,
                "class_date": c.class_date,
                "entry_fee_cents": c.entry_fee_cents,
            }
            for c in classes
        ],
        "fee_tiers": [
            {
                "id": t.id,
                "name": t.name,
                "description": t.description,
                "amount_cents": t.amount_cents,
                "sort_order": t.sort_order,
            }
            for t in sorted(futurity.fee_tiers, key=lambda t: (t.sort_order, t.name))
        ],
        "divisions": [_serialize_division(d) for d in futurity.divisions],
        "entry_count": len(futurity.entries),
    }


def _serialize_division(division: FuturityDivision) -> dict:
    return {
        "id": division.id,
        "futurity_id": division.futurity_id,
        "name": division.name,
        "scoring_method": division.scoring_method,
        "sort_order": division.sort_order,
        "classes": [
            {
                "class_id": dc.class_id,
                "class_number": dc.class_.class_number if dc.class_ else None,
                "class_name": dc.class_.class_name if dc.class_ else None,
                "scoring": dc.scoring,
                "group_name": dc.group_name,
            }
            for dc in sorted(
                division.division_classes,
                key=lambda dc: (
                    dc.class_.sort_order
                    if dc.class_ is not None and dc.class_.sort_order is not None
                    else 0
                ),
            )
        ],
    }


async def _replace_fee_tiers(futurity: Futurity, tiers, db: AsyncSession) -> None:
    """Swap the tier set wholesale, keeping any tier an enrollment points at.

    Matching on name rather than deleting and re-creating: `futurity_entries`
    references a tier with ON DELETE RESTRICT precisely because a tier with
    enrollments against it is a price somebody was quoted. Re-creating it would
    either fail on the constraint or, worse, orphan the enrollment onto a new
    row and silently change what they owe.
    """
    existing = {t.name: t for t in futurity.fee_tiers}
    wanted = {t.name: t for t in tiers}

    for name, tier in wanted.items():
        row = existing.get(name)
        if row is None:
            db.add(
                FuturityFeeTier(
                    futurity_id=futurity.id,
                    name=name,
                    description=tier.description,
                    amount_cents=tier.amount_cents,
                    sort_order=tier.sort_order,
                )
            )
        else:
            row.description = tier.description
            row.amount_cents = tier.amount_cents
            row.sort_order = tier.sort_order

    doomed = [t for name, t in existing.items() if name not in wanted]
    if doomed:
        in_use = set(
            (
                await db.execute(
                    select(FuturityEntry.fee_tier_id).where(
                        FuturityEntry.fee_tier_id.in_([t.id for t in doomed])
                    )
                )
            ).scalars().all()
        )
        blocked = [t.name for t in doomed if t.id in in_use]
        if blocked:
            raise HTTPException(
                409,
                "These fee tiers still have entries against them and cannot be "
                f"removed: {', '.join(sorted(blocked))}. Move those entries to "
                "another tier first.",
            )
        await db.execute(
            delete(FuturityFeeTier).where(
                FuturityFeeTier.id.in_([t.id for t in doomed])
            )
        )


async def _replace_classes(futurity: Futurity, class_ids: list[UUID], db: AsyncSession) -> None:
    await db.execute(
        delete(FuturityClass).where(FuturityClass.futurity_id == futurity.id)
    )
    for class_id in dict.fromkeys(class_ids):
        db.add(FuturityClass(futurity_id=futurity.id, class_id=class_id))


# ── Billing support ────────────────────────────────────────────────────────────


class BillableFuturity:
    """A futurity carrying only one exhibitor's enrollments.

    `billing.futurity_lines` charges every enrollment it is handed, so the
    caller has to hand it the right ones. Filtering the ORM collection in place
    would mean mutating a loaded relationship — which the session would happily
    try to flush as deletions — so this copies the handful of attributes the
    billing code reads and swaps in the filtered list.
    """

    __slots__ = (
        "id",
        "name",
        "entry_deadline",
        "late_fee_cents",
        "office_fee_member_cents",
        "office_fee_nonmember_cents",
        "futurity_classes",
        "entries",
    )

    def __init__(self, futurity: Futurity, entries: list[FuturityEntry]):
        self.id = futurity.id
        self.name = futurity.name
        self.entry_deadline = futurity.entry_deadline
        self.late_fee_cents = futurity.late_fee_cents
        self.office_fee_member_cents = futurity.office_fee_member_cents
        self.office_fee_nonmember_cents = futurity.office_fee_nonmember_cents
        self.futurity_classes = futurity.futurity_classes
        self.entries = entries


async def _futurities_and_enrollments(
    show_id: UUID, show_entry_ids: Optional[list[UUID]], db: AsyncSession
):
    """The show's futurities plus the enrollments in scope, in two queries.

    `show_entry_ids=None` means every enrollment at the show — what the
    Financials rollup needs. A list narrows it to those show entries.
    """
    futurities = (
        await db.execute(
            select(Futurity)
            .where(Futurity.show_id == show_id)
            .options(selectinload(Futurity.futurity_classes))
        )
    ).scalars().all()
    if not futurities:
        return [], []
    query = select(FuturityEntry).where(
        FuturityEntry.futurity_id.in_([f.id for f in futurities])
    )
    if show_entry_ids is not None:
        query = query.where(FuturityEntry.show_entry_id.in_(show_entry_ids))
    enrollments = (
        await db.execute(
            query.options(
                selectinload(FuturityEntry.horse),
                selectinload(FuturityEntry.fee_tier),
            )
        )
    ).scalars().all()
    return list(futurities), list(enrollments)


def _group(futurities, enrollments) -> list[BillableFuturity]:
    by_futurity: dict[UUID, list[FuturityEntry]] = {}
    for enrollment in enrollments:
        by_futurity.setdefault(enrollment.futurity_id, []).append(enrollment)
    return [
        BillableFuturity(f, by_futurity[f.id]) for f in futurities if f.id in by_futurity
    ]


async def load_billable_futurities(
    show_id: UUID, show_entry_ids, db: AsyncSession
) -> list[BillableFuturity]:
    """Futurities at this show, each carrying only these show entries' enrollments.

    Returns [] when nothing is enrolled, so a show with no futurity costs one
    cheap query and changes no bill. Shared with the registration screen and My
    Shows so both quote the same futurity money.
    """
    ids = [i for i in show_entry_ids if i is not None]
    if not ids:
        return []
    futurities, enrollments = await _futurities_and_enrollments(show_id, ids, db)
    return _group(futurities, enrollments)


async def load_futurity_bill_index(
    show_id: UUID, db: AsyncSession
) -> dict[UUID, list[BillableFuturity]]:
    """Every show entry's billable futurities at this show, keyed by show entry.

    Two queries for the whole show. Financials builds an account per exhibitor
    and would otherwise call `load_billable_futurities` once each — the N+1 the
    module docstring exists to warn against.
    """
    futurities, enrollments = await _futurities_and_enrollments(show_id, None, db)
    if not futurities:
        return {}
    by_show_entry: dict[UUID, list[FuturityEntry]] = {}
    for enrollment in enrollments:
        by_show_entry.setdefault(enrollment.show_entry_id, []).append(enrollment)
    return {
        show_entry_id: _group(futurities, rows)
        for show_entry_id, rows in by_show_entry.items()
    }


# ── Futurity CRUD ──────────────────────────────────────────────────────────────


@router.post("/", response_model=FuturityOut, status_code=201)
async def create_futurity(
    show_id: UUID, body: FuturityCreate, db: AsyncSession = Depends(get_db)
):
    await _get_show_or_404(show_id, db)
    await _validate_class_ids(show_id, body.class_ids, db)

    clash = (
        await db.execute(
            select(Futurity.id).where(
                Futurity.show_id == show_id, Futurity.name == body.name
            )
        )
    ).scalars().first()
    if clash:
        raise HTTPException(409, f"This show already has a futurity named {body.name!r}.")

    futurity = Futurity(
        show_id=show_id,
        name=body.name,
        description=body.description,
        entry_deadline=body.entry_deadline,
        late_fee_cents=body.late_fee_cents,
        office_fee_member_cents=body.office_fee_member_cents,
        office_fee_nonmember_cents=body.office_fee_nonmember_cents,
    )
    db.add(futurity)
    await db.flush()

    for class_id in dict.fromkeys(body.class_ids):
        db.add(FuturityClass(futurity_id=futurity.id, class_id=class_id))
    for tier in body.fee_tiers:
        db.add(
            FuturityFeeTier(
                futurity_id=futurity.id,
                name=tier.name,
                description=tier.description,
                amount_cents=tier.amount_cents,
                sort_order=tier.sort_order,
            )
        )
    await db.commit()
    return _serialize(await _load_futurity(show_id, futurity.id, db))


@router.get("/", response_model=list[FuturityOut])
async def list_futurities(show_id: UUID, db: AsyncSession = Depends(get_db)):
    await _get_show_or_404(show_id, db)
    rows = (
        await db.execute(
            select(Futurity)
            .where(Futurity.show_id == show_id)
            .options(*_FUTURITY_LOADS)
            .order_by(Futurity.created_at)
        )
    ).scalars().all()
    return [_serialize(f) for f in rows]


@router.get("/{futurity_id}", response_model=FuturityOut)
async def get_futurity(show_id: UUID, futurity_id: UUID, db: AsyncSession = Depends(get_db)):
    return _serialize(await _load_futurity(show_id, futurity_id, db))


@router.patch("/{futurity_id}", response_model=FuturityOut)
async def update_futurity(
    show_id: UUID,
    futurity_id: UUID,
    body: FuturityUpdate,
    db: AsyncSession = Depends(get_db),
):
    futurity = await _load_futurity(show_id, futurity_id, db)
    updates = body.model_dump(exclude_unset=True)

    class_ids = updates.pop("class_ids", None)
    fee_tiers = updates.pop("fee_tiers", None)

    # Checked against the values the row will end up with, not the ones it has,
    # so clearing a deadline out from under an existing late fee fails the same
    # way as setting a late fee with no deadline.
    deadline = updates.get("entry_deadline", futurity.entry_deadline)
    late_fee = updates.get("late_fee_cents", futurity.late_fee_cents)
    if late_fee and deadline is None:
        raise HTTPException(
            422,
            "A late fee needs an entry deadline — without one there is nothing "
            "for it to be late against.",
        )

    if "name" in updates and updates["name"] != futurity.name:
        clash = (
            await db.execute(
                select(Futurity.id).where(
                    Futurity.show_id == show_id,
                    Futurity.name == updates["name"],
                    Futurity.id != futurity_id,
                )
            )
        ).scalars().first()
        if clash:
            raise HTTPException(
                409, f"This show already has a futurity named {updates['name']!r}."
            )

    for field, value in updates.items():
        setattr(futurity, field, value)

    if class_ids is not None:
        await _validate_class_ids(show_id, class_ids, db)
        await _replace_classes(futurity, class_ids, db)
    if fee_tiers is not None:
        await _replace_fee_tiers(futurity, body.fee_tiers, db)

    await db.commit()
    return _serialize(await _load_futurity(show_id, futurity_id, db))


@router.delete("/{futurity_id}", status_code=204)
async def delete_futurity(
    show_id: UUID, futurity_id: UUID, db: AsyncSession = Depends(get_db)
):
    futurity = await _load_futurity(show_id, futurity_id, db)
    if futurity.entries:
        raise HTTPException(
            409,
            f"This futurity has {len(futurity.entries)} entries. Remove them "
            "first — deleting it would erase what those entrants were charged.",
        )
    await db.delete(futurity)
    await db.commit()
    return None


# ── Hi-Point divisions ─────────────────────────────────────────────────────────


@router.post(
    "/{futurity_id}/divisions", response_model=FuturityDivisionOut, status_code=201
)
async def create_division(
    show_id: UUID,
    futurity_id: UUID,
    body: FuturityDivisionIn,
    db: AsyncSession = Depends(get_db),
):
    futurity = await _load_futurity(show_id, futurity_id, db)
    await _validate_class_ids(show_id, [c.class_id for c in body.classes], db)

    clash = next((d for d in futurity.divisions if d.name == body.name), None)
    if clash:
        raise HTTPException(409, f"This futurity already has a division named {body.name!r}.")

    division = FuturityDivision(
        futurity_id=futurity.id,
        name=body.name,
        scoring_method=body.scoring_method,
        sort_order=body.sort_order,
    )
    db.add(division)
    await db.flush()
    for item in body.classes:
        db.add(
            FuturityDivisionClass(
                futurity_division_id=division.id,
                class_id=item.class_id,
                scoring=item.scoring,
                group_name=(item.group_name or "").strip() or None,
            )
        )
    await db.commit()
    return _serialize_division(await _load_division(show_id, futurity_id, division.id, db))


async def _load_division(
    show_id: UUID, futurity_id: UUID, division_id: UUID, db: AsyncSession
) -> FuturityDivision:
    row = (
        await db.execute(
            select(FuturityDivision)
            .join(Futurity, Futurity.id == FuturityDivision.futurity_id)
            .where(
                FuturityDivision.id == division_id,
                FuturityDivision.futurity_id == futurity_id,
                Futurity.show_id == show_id,
            )
            .options(
                selectinload(FuturityDivision.division_classes).selectinload(
                    FuturityDivisionClass.class_
                )
            )
            .execution_options(populate_existing=True)
        )
    ).scalars().first()
    if row is None:
        raise HTTPException(404, "Futurity division not found")
    return row


@router.put(
    "/{futurity_id}/divisions/{division_id}", response_model=FuturityDivisionOut
)
async def update_division(
    show_id: UUID,
    futurity_id: UUID,
    division_id: UUID,
    body: FuturityDivisionIn,
    db: AsyncSession = Depends(get_db),
):
    division = await _load_division(show_id, futurity_id, division_id, db)
    await _validate_class_ids(show_id, [c.class_id for c in body.classes], db)

    division.name = body.name
    division.scoring_method = body.scoring_method
    division.sort_order = body.sort_order
    await db.execute(
        delete(FuturityDivisionClass).where(
            FuturityDivisionClass.futurity_division_id == division_id
        )
    )
    for item in body.classes:
        db.add(
            FuturityDivisionClass(
                futurity_division_id=division_id,
                class_id=item.class_id,
                scoring=item.scoring,
                group_name=(item.group_name or "").strip() or None,
            )
        )
    await db.commit()
    return _serialize_division(await _load_division(show_id, futurity_id, division_id, db))


@router.delete("/{futurity_id}/divisions/{division_id}", status_code=204)
async def delete_division(
    show_id: UUID, futurity_id: UUID, division_id: UUID, db: AsyncSession = Depends(get_db)
):
    division = await _load_division(show_id, futurity_id, division_id, db)
    await db.delete(division)
    await db.commit()
    return None


# ── Enrollments ────────────────────────────────────────────────────────────────


async def _entered_class_counts(
    futurity: Futurity, db: AsyncSession
) -> dict[UUID, int]:
    """How many of the futurity's classes each enrolled horse is actually in.

    One query for the whole futurity rather than one per enrollment — the
    entries panel lists every entrant and would otherwise be N+1 on a screen
    the office opens constantly.
    """
    class_ids = [fc.class_id for fc in futurity.futurity_classes]
    horse_ids = [e.horse_id for e in futurity.entries if e.horse_id is not None]
    if not class_ids or not horse_ids:
        return {}
    rows = (
        await db.execute(
            select(Entry.horse_id)
            .where(Entry.class_id.in_(class_ids), Entry.horse_id.in_(horse_ids))
        )
    ).scalars().all()
    return Counter(rows)


async def _hydrate_entries(
    futurity: Futurity, db: AsyncSession
) -> list[dict]:
    counts = await _entered_class_counts(futurity, db)
    show_entry_ids = [e.show_entry_id for e in futurity.entries]
    people: dict[UUID, tuple[Optional[int], Optional[str]]] = {}
    if show_entry_ids:
        rows = await db.execute(
            select(ShowEntry.id, ShowEntry.back_number, Exhibitor.name)
            .join(Exhibitor, Exhibitor.id == ShowEntry.exhibitor_id)
            .where(ShowEntry.id.in_(show_entry_ids))
        )
        people = {r[0]: (r[1], r[2]) for r in rows}

    out: list[dict] = []
    for enrollment in futurity.entries:
        count = counts.get(enrollment.horse_id, 0)
        charge, is_late = billing.futurity_charge_cents(futurity, enrollment, count)
        back_number, exhibitor_name = people.get(enrollment.show_entry_id, (None, None))
        out.append(
            {
                "id": enrollment.id,
                "futurity_id": enrollment.futurity_id,
                "show_entry_id": enrollment.show_entry_id,
                "horse_id": enrollment.horse_id,
                "horse_name": enrollment.horse.name if enrollment.horse else None,
                "back_number": back_number,
                "exhibitor_name": exhibitor_name,
                "fee_tier_id": enrollment.fee_tier_id,
                "fee_tier_name": (
                    enrollment.fee_tier.name if enrollment.fee_tier else None
                ),
                "is_member": enrollment.is_member,
                "entered_at": enrollment.entered_at,
                "is_late": is_late,
                "entered_class_count": count,
                "charge_cents": charge,
                "notes": enrollment.notes,
                "created_at": enrollment.created_at,
            }
        )
    out.sort(key=lambda r: (r["back_number"] is None, r["back_number"], r["horse_name"] or ""))
    return out


@router.get("/{futurity_id}/roster", response_model=list[FuturityRosterEntry])
async def list_roster(show_id: UUID, futurity_id: UUID, db: AsyncSession = Depends(get_db)):
    """The show roster with each exhibitor's horses, for the enroll picker.

    Read from `show_entries` like the side pot roster, then joined out to the
    horses each exhibitor has entered at this show. Horses already enrolled are
    flagged rather than dropped, so the picker can grey them out and the office
    can see at a glance who is already in.
    """
    futurity = await _load_futurity(show_id, futurity_id, db)
    enrolled = {e.horse_id for e in futurity.entries if e.horse_id is not None}

    show_entries = (
        await db.execute(
            select(ShowEntry)
            .where(ShowEntry.show_id == show_id)
            .options(selectinload(ShowEntry.exhibitor))
        )
    ).scalars().all()

    horses_by_exhibitor: dict[UUID, dict[UUID, str]] = {}
    rows = await db.execute(
        select(Entry.exhibitor_id, Horse.id, Horse.name)
        .join(Class, Entry.class_id == Class.id)
        .join(Horse, Entry.horse_id == Horse.id)
        .where(Class.show_id == show_id)
        .distinct()
    )
    for exhibitor_id, horse_id, horse_name in rows:
        horses_by_exhibitor.setdefault(exhibitor_id, {})[horse_id] = horse_name

    roster = [
        {
            "show_entry_id": se.id,
            "back_number": se.back_number,
            "exhibitor_name": se.exhibitor.full_name if se.exhibitor else None,
            "horses": [
                {
                    "horse_id": horse_id,
                    "horse_name": horse_name,
                    "already_entered": horse_id in enrolled,
                }
                for horse_id, horse_name in sorted(
                    horses_by_exhibitor.get(se.exhibitor_id, {}).items(),
                    key=lambda kv: kv[1].lower(),
                )
            ],
        }
        for se in show_entries
    ]
    roster.sort(
        key=lambda r: (
            r["back_number"] is None,
            r["back_number"] or 0,
            (r["exhibitor_name"] or "").lower(),
        )
    )
    return roster


@router.get("/{futurity_id}/entries", response_model=list[FuturityEntryOut])
async def list_entries(show_id: UUID, futurity_id: UUID, db: AsyncSession = Depends(get_db)):
    futurity = await _load_futurity(show_id, futurity_id, db)
    return await _hydrate_entries(futurity, db)


@router.post("/{futurity_id}/entries", response_model=FuturityEntryOut, status_code=201)
async def add_entry(
    show_id: UUID,
    futurity_id: UUID,
    body: FuturityEntryCreate,
    db: AsyncSession = Depends(get_db),
):
    futurity = await _load_futurity(show_id, futurity_id, db)

    show_entry = await db.get(ShowEntry, body.show_entry_id)
    if show_entry is None or show_entry.show_id != show_id:
        raise HTTPException(422, "That show entry does not belong to this show.")
    horse = await db.get(Horse, body.horse_id)
    if horse is None:
        raise HTTPException(422, "Horse not found.")

    if body.fee_tier_id is not None:
        if not any(t.id == body.fee_tier_id for t in futurity.fee_tiers):
            raise HTTPException(422, "That fee tier does not belong to this futurity.")
    elif futurity.fee_tiers:
        raise HTTPException(
            422,
            "This futurity prices entries by category — pick a fee tier.",
        )

    already = next((e for e in futurity.entries if e.horse_id == body.horse_id), None)
    if already:
        raise HTTPException(409, "That horse is already entered in this futurity.")

    enrollment = FuturityEntry(
        futurity_id=futurity.id,
        show_entry_id=body.show_entry_id,
        horse_id=body.horse_id,
        fee_tier_id=body.fee_tier_id,
        is_member=body.is_member,
        # Stored, never derived at read time — the late fee is decided by the
        # day the office took the entry.
        entered_at=body.entered_at or date.today(),
        notes=body.notes,
    )
    db.add(enrollment)
    await db.commit()

    futurity = await _load_futurity(show_id, futurity_id, db)
    hydrated = await _hydrate_entries(futurity, db)
    return next(r for r in hydrated if r["id"] == enrollment.id)


@router.patch(
    "/{futurity_id}/entries/{entry_id}", response_model=FuturityEntryOut
)
async def update_entry(
    show_id: UUID,
    futurity_id: UUID,
    entry_id: UUID,
    body: FuturityEntryUpdate,
    db: AsyncSession = Depends(get_db),
):
    futurity = await _load_futurity(show_id, futurity_id, db)
    enrollment = next((e for e in futurity.entries if e.id == entry_id), None)
    if enrollment is None:
        raise HTTPException(404, "Futurity entry not found")

    updates = body.model_dump(exclude_unset=True)
    if "fee_tier_id" in updates and updates["fee_tier_id"] is not None:
        if not any(t.id == updates["fee_tier_id"] for t in futurity.fee_tiers):
            raise HTTPException(422, "That fee tier does not belong to this futurity.")
    for field, value in updates.items():
        setattr(enrollment, field, value)
    await db.commit()

    futurity = await _load_futurity(show_id, futurity_id, db)
    hydrated = await _hydrate_entries(futurity, db)
    return next(r for r in hydrated if r["id"] == entry_id)


@router.delete("/{futurity_id}/entries/{entry_id}", status_code=204)
async def remove_entry(
    show_id: UUID, futurity_id: UUID, entry_id: UUID, db: AsyncSession = Depends(get_db)
):
    futurity = await _load_futurity(show_id, futurity_id, db)
    enrollment = next((e for e in futurity.entries if e.id == entry_id), None)
    if enrollment is None:
        raise HTTPException(404, "Futurity entry not found")
    await db.delete(enrollment)
    await db.commit()
    return None


# ── Hi-Point standings ─────────────────────────────────────────────────────────


def _best(results: list[Result], scoring_method: str) -> Optional[Result]:
    """The best of several cards for one horse in one class.

    One card per judge since migration 095, so a class yields several results
    for the same entry. Best-of, chosen deterministically, matching what side
    pot standings do — and carrying the same open question: show bills settle
    multi-judge programs "from combined judge score sheets", which is a sum
    across judges rather than a best-of. Changing it is a rules decision, not a
    display fix, so both places behave the same way until someone makes it.
    """
    if not results:
        return None
    if scoring_method == "sum_scores":
        scored = [r for r in results if r.raw_score is not None]
        if not scored:
            return None
        return max(scored, key=lambda r: (float(r.raw_score), -r.place))
    return min(results, key=lambda r: r.place)


def _better(a: Result, b: Result, scoring_method: str) -> Result:
    return _best([a, b], scoring_method) or a


@router.get(
    "/{futurity_id}/divisions/{division_id}/standings",
    response_model=FuturityStandingsOut,
)
async def get_standings(
    show_id: UUID, futurity_id: UUID, division_id: UUID, db: AsyncSession = Depends(get_db)
):
    """Hi-Point standings for one division.

    A `counts` class contributes its result outright. Classes sharing a
    `group_name` contribute exactly one result between them — the best — which
    is the "all three pleasure classes may be entered, only the best counts"
    rule. An entrant missing any counting slot is listed but marked ineligible
    rather than dropped, because "who still needs a class" is the question the
    office is actually asking of this screen.
    """
    futurity = await _load_futurity(show_id, futurity_id, db)
    division = await _load_division(show_id, futurity_id, division_id, db)

    always = [dc for dc in division.division_classes if dc.scoring == "counts"]
    groups: dict[str, list[FuturityDivisionClass]] = {}
    for dc in division.division_classes:
        if dc.scoring == "best_of_group":
            groups.setdefault(dc.group_name, []).append(dc)

    class_ids = [dc.class_id for dc in division.division_classes]
    horse_ids = [e.horse_id for e in futurity.entries if e.horse_id is not None]

    by_horse_class: dict[tuple[UUID, UUID], list[Result]] = {}
    if class_ids and horse_ids:
        rows = await db.execute(
            select(Result, Entry.class_id, Entry.horse_id)
            .join(Entry, Result.entry_id == Entry.id)
            .where(Entry.class_id.in_(class_ids), Entry.horse_id.in_(horse_ids))
        )
        for result, class_id, horse_id in rows:
            by_horse_class.setdefault((horse_id, class_id), []).append(result)

    people: dict[UUID, tuple[Optional[int], Optional[str]]] = {}
    show_entry_ids = [e.show_entry_id for e in futurity.entries]
    if show_entry_ids:
        rows = await db.execute(
            select(ShowEntry.id, ShowEntry.back_number, Exhibitor.name)
            .join(Exhibitor, Exhibitor.id == ShowEntry.exhibitor_id)
            .where(ShowEntry.id.in_(show_entry_ids))
        )
        people = {r[0]: (r[1], r[2]) for r in rows}

    class_numbers = {
        dc.class_id: (dc.class_.class_number if dc.class_ else str(dc.class_id))
        for dc in division.division_classes
    }

    rows_out: list[dict] = []
    for enrollment in futurity.entries:
        counted: list[dict] = []
        missing: list[str] = []
        values: list[float] = []

        def take(dc: FuturityDivisionClass) -> Optional[Result]:
            return _best(
                by_horse_class.get((enrollment.horse_id, dc.class_id), []),
                division.scoring_method,
            )

        for dc in always:
            result = take(dc)
            if result is None:
                missing.append(class_numbers[dc.class_id])
                continue
            counted.append(
                {
                    "class_id": dc.class_id,
                    "class_number": class_numbers[dc.class_id],
                    "class_name": dc.class_.class_name if dc.class_ else None,
                    "scoring": dc.scoring,
                    "group_name": dc.group_name,
                }
            )
            values.append(
                float(result.raw_score)
                if division.scoring_method == "sum_scores" and result.raw_score is not None
                else float(result.place)
            )

        for group_name, members in groups.items():
            best_dc: Optional[FuturityDivisionClass] = None
            best_result: Optional[Result] = None
            for dc in members:
                result = take(dc)
                if result is None:
                    continue
                if best_result is None:
                    best_dc, best_result = dc, result
                else:
                    winner = _better(best_result, result, division.scoring_method)
                    if winner is result:
                        best_dc, best_result = dc, result
            if best_result is None or best_dc is None:
                missing.append(f"{group_name} (any)")
                continue
            counted.append(
                {
                    "class_id": best_dc.class_id,
                    "class_number": class_numbers[best_dc.class_id],
                    "class_name": best_dc.class_.class_name if best_dc.class_ else None,
                    "scoring": best_dc.scoring,
                    "group_name": group_name,
                }
            )
            values.append(
                float(best_result.raw_score)
                if division.scoring_method == "sum_scores"
                and best_result.raw_score is not None
                else float(best_result.place)
            )

        back_number, exhibitor_name = people.get(enrollment.show_entry_id, (None, None))
        rows_out.append(
            {
                "futurity_entry_id": enrollment.id,
                "horse_id": enrollment.horse_id,
                "horse_name": enrollment.horse.name if enrollment.horse else None,
                "back_number": back_number,
                "exhibitor_name": exhibitor_name,
                "place": None,
                "aggregate_value": sum(values) if values else None,
                "counted": counted,
                "missing_class_numbers": missing,
                "is_eligible": not missing,
            }
        )

    # Only complete entrants are ranked. An incomplete one has no comparable
    # total — half a scorecard is not a low score — so it is listed unplaced.
    eligible = [r for r in rows_out if r["is_eligible"] and r["aggregate_value"] is not None]
    reverse = division.scoring_method == "sum_scores"
    eligible.sort(key=lambda r: r["aggregate_value"], reverse=reverse)
    for i, row in enumerate(eligible, start=1):
        row["place"] = i

    rows_out.sort(
        key=lambda r: (
            r["place"] is None,
            r["place"] or 0,
            r["horse_name"] or "",
        )
    )

    return {
        "futurity_id": futurity.id,
        "division_id": division.id,
        "division_name": division.name,
        "scoring_method": division.scoring_method,
        "standings": rows_out,
    }


# ── Public read ────────────────────────────────────────────────────────────────
#
# Its own router, because the one above carries a router-level
# `require_admin_or_show_admin` and a public route underneath it would be gated
# by that. Same split as `show_fees.list_show_fees_public`, and for the same
# reason: a futurity's classes, categories and deadline are the published
# programme — they are printed on the paper show bill — and a generated show
# bill that had to keep them behind a login would be a second source of truth.

public_router = APIRouter(prefix="/shows/{show_id}/futurities", tags=["Futurities"])

# Matches show_fees.PUBLIC_SHOW_STATUSES — same question, same answer.
PUBLIC_SHOW_STATUSES = ("PUBLISHED", "ACTIVE", "COMPLETED")


@public_router.get("/public")
async def list_futurities_public(show_id: UUID, db: AsyncSession = Depends(get_db)):
    """The show's futurities, no auth — what the show bill prints.

    Entries and who is in them are deliberately absent: this is the programme,
    not the roster.
    """
    show = await db.get(Show, show_id)
    if not show or show.status not in PUBLIC_SHOW_STATUSES:
        # Same answer as a missing show: a stranger probing ids should not learn
        # which drafts exist.
        raise HTTPException(404, "Show not found")

    futurities = (
        await db.execute(
            select(Futurity)
            .where(Futurity.show_id == show_id)
            .options(
                selectinload(Futurity.fee_tiers),
                selectinload(Futurity.futurity_classes).selectinload(FuturityClass.class_),
                selectinload(Futurity.divisions).selectinload(
                    FuturityDivision.division_classes
                ).selectinload(FuturityDivisionClass.class_),
            )
            .order_by(Futurity.created_at)
        )
    ).scalars().all()

    return [
        {
            "id": str(f.id),
            "name": f.name,
            "description": f.description,
            "entry_deadline": f.entry_deadline,
            "late_fee_cents": f.late_fee_cents,
            "office_fee_member_cents": f.office_fee_member_cents,
            "office_fee_nonmember_cents": f.office_fee_nonmember_cents,
            "classes": [
                {
                    "class_id": str(fc.class_id),
                    "class_number": fc.class_.class_number,
                    "class_name": fc.class_.class_name,
                }
                for fc in sorted(
                    (fc for fc in f.futurity_classes if fc.class_ is not None),
                    key=lambda fc: (
                        fc.class_.sort_order if fc.class_.sort_order is not None else 0
                    ),
                )
            ],
            "fee_tiers": [
                {
                    "id": str(t.id),
                    "name": t.name,
                    "description": t.description,
                    "amount_cents": t.amount_cents,
                }
                for t in sorted(f.fee_tiers, key=lambda t: (t.sort_order, t.name))
            ],
            "divisions": [
                {
                    "id": str(d.id),
                    "name": d.name,
                    "classes": [
                        {
                            "class_number": dc.class_.class_number if dc.class_ else None,
                            "class_name": dc.class_.class_name if dc.class_ else None,
                            "scoring": dc.scoring,
                            "group_name": dc.group_name,
                        }
                        for dc in d.division_classes
                    ],
                }
                for d in sorted(f.divisions, key=lambda d: (d.sort_order, d.name))
            ],
        }
        for f in futurities
    ]
