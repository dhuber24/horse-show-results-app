"""Gate management — the warm-up side of the in-gate.

A GATE_STEWARD assigned to a show manages the order-of-go for each class
(who enters the ring next and when), checks exhibitors in at the gate, and
marks classes done as the show progresses. Waiting / on-deck are class-level
concepts derived from show order: the first non-done class is in progress,
the one after it is on deck.

Read/write access: ADMIN, or an assigned Gate Steward / Show Secretary /
Show Manager for the show. Everything here is operational state — it never
touches placings or results.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backnumbers import back_numbers_for_show, resolve_back_number, sort_key
from database import get_db
from dependencies import INTERNAL_API_KEY, safe_uuid
from models import (
    Class,
    Entry,
    Show,
    ShowGateSteward,
    ShowManager,
    ShowSecretary,
)
from schemas import (
    GateCheckInBody,
    GateCheckInResult,
    GateClassStatusBody,
    GateEntryOut,
    GateOrderBody,
)

router = APIRouter(prefix="/shows/{show_id}/gate", tags=["Gate"])


async def _assert_gate_access(
    show_id: UUID, x_api_key: str, x_user_id: str, x_user_role: str, db: AsyncSession
) -> None:
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    if x_user_role == "ADMIN":
        return
    role_tables = {
        "GATE_STEWARD": ShowGateSteward,
        "SHOW_SECRETARY": ShowSecretary,
        "SHOW_MANAGER": ShowManager,
    }
    table = role_tables.get(x_user_role)
    if table is not None:
        row = await db.execute(
            select(table).where(
                table.show_id == show_id,
                table.user_id == safe_uuid(x_user_id),
            )
        )
        if row.scalar_one_or_none():
            return
    raise HTTPException(403, "Not authorized for this show's gate")


async def _get_class_or_404(show_id: UUID, class_id: UUID, db: AsyncSession) -> Class:
    if not await db.get(Show, show_id):
        raise HTTPException(404, "Show not found")
    class_ = await db.get(Class, class_id)
    if not class_ or class_.show_id != show_id:
        raise HTTPException(404, "Class not found")
    return class_


def _serialize_entry(e: Entry, by_exhibitor: dict[UUID, int] | None = None) -> dict:
    return {
        "id": e.id,
        # From show_entries, not the entry row — see backend/backnumbers.py. The
        # gate calls exhibitors by back number, so reading the always-NULL
        # per-entry column left the steward with a screen full of dashes.
        "back_number": resolve_back_number(e, by_exhibitor or {}),
        "exhibitor_name": e.exhibitor.full_name if e.exhibitor else "",
        "horse_name": e.horse.name if e.horse else None,
        "is_disqualified": e.is_disqualified,
        "gate_order": e.gate_order,
        "gate_checked_in": e.gate_checked_in,
    }


async def _load_class_entries(
    class_id: UUID, db: AsyncSession, show_id: UUID | None = None
) -> tuple[list[Entry], dict[UUID, int]]:
    """Entries for one class plus this show's back numbers, ordered the way the
    gate reads them: explicit order of go first, then by back number.

    Returns both because every caller that renders an entry needs the number
    map too, and fetching it separately is how the two drift apart.
    """
    result = await db.execute(
        select(Entry)
        .where(Entry.class_id == class_id, Entry.status != "WITHDRAWN")
        .options(selectinload(Entry.exhibitor), selectinload(Entry.horse))
    )
    entries = list(result.scalars().all())

    if show_id is None:
        class_ = await db.get(Class, class_id)
        show_id = class_.show_id if class_ else None
    by_exhibitor = await back_numbers_for_show(show_id, db) if show_id else {}

    entries.sort(
        key=lambda e: (
            (1, 0) if e.gate_order is None else (0, e.gate_order),
            sort_key(resolve_back_number(e, by_exhibitor)),
        )
    )
    return entries, by_exhibitor


@router.get("/classes/{class_id}/entries", response_model=list[GateEntryOut])
async def list_gate_entries(
    show_id: UUID,
    class_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_gate_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_class_or_404(show_id, class_id, db)
    entries, back_numbers = await _load_class_entries(class_id, db, show_id)
    return [_serialize_entry(e, back_numbers) for e in entries]


@router.put("/classes/{class_id}/order", response_model=list[GateEntryOut])
async def set_gate_order(
    show_id: UUID,
    class_id: UUID,
    body: GateOrderBody,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Replaces the class's order-of-go with the given entry order (1-based).
    Must list every non-withdrawn entry in the class exactly once."""
    await _assert_gate_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_class_or_404(show_id, class_id, db)

    entries, _ = await _load_class_entries(class_id, db, show_id)
    by_id = {e.id: e for e in entries}
    if set(body.entry_ids) != set(by_id) or len(body.entry_ids) != len(by_id):
        raise HTTPException(422, "entry_ids must contain each entry in this class exactly once")

    for position, entry_id in enumerate(body.entry_ids, start=1):
        by_id[entry_id].gate_order = position
    await db.commit()
    entries, back_numbers = await _load_class_entries(class_id, db, show_id)
    return [_serialize_entry(e, back_numbers) for e in entries]


@router.patch("/classes/{class_id}/entries/{entry_id}/check-in", response_model=GateCheckInResult)
async def set_gate_check_in(
    show_id: UUID,
    class_id: UUID,
    entry_id: UUID,
    body: GateCheckInBody,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Check an exhibitor in (or undo it). Only allowed for the on-deck
    class — the first not-yet-started class of the day in its ring. The class
    flips between pending and ready automatically: checking in the last
    exhibitor makes it ready, un-checking someone on a ready class drops it
    back to pending."""
    await _assert_gate_access(show_id, x_api_key, x_user_id, x_user_role, db)
    class_ = await _get_class_or_404(show_id, class_id, db)

    if class_.gate_status not in ("pending", "ready"):
        raise HTTPException(409, "Check-in is closed — this class has already started or finished.")
    ring_cond = (
        Class.ring_id.is_(None) if class_.ring_id is None else Class.ring_id == class_.ring_id
    )
    on_deck_q = await db.execute(
        select(Class)
        .where(
            Class.show_id == show_id,
            Class.class_date == class_.class_date,
            ring_cond,
            Class.gate_status.in_(("pending", "ready")),
        )
        .order_by(Class.sort_order.nulls_last(), Class.class_number)
    )
    on_deck = on_deck_q.scalars().first()
    if on_deck is not None and on_deck.id != class_.id:
        raise HTTPException(
            409,
            f"Check-in is only open for the on-deck class "
            f"(#{on_deck.class_number} {on_deck.class_name}).",
        )

    result = await db.execute(
        select(Entry)
        .where(Entry.id == entry_id, Entry.class_id == class_id)
        .options(selectinload(Entry.exhibitor), selectinload(Entry.horse))
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Entry not found")
    entry.gate_checked_in = body.checked_in

    if class_.gate_status in ("pending", "ready"):
        all_entries, _ = await _load_class_entries(class_id, db, show_id)
        all_in = len(all_entries) > 0 and all(e.gate_checked_in for e in all_entries)
        class_.gate_status = "ready" if all_in else "pending"

    await db.commit()
    back_numbers = await back_numbers_for_show(show_id, db)
    return {
        "entry": _serialize_entry(entry, back_numbers),
        "class_gate_status": class_.gate_status,
    }


@router.post("/classes/{class_id}/reset", response_model=list[GateEntryOut])
async def reset_gate_class(
    show_id: UUID,
    class_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Full gate reset for a class: clears every exhibitor's check-in and
    returns the class to pending. Recovery hatch for steward mistakes."""
    await _assert_gate_access(show_id, x_api_key, x_user_id, x_user_role, db)
    class_ = await _get_class_or_404(show_id, class_id, db)
    entries, _ = await _load_class_entries(class_id, db, show_id)
    for e in entries:
        e.gate_checked_in = False
    class_.gate_status = "pending"
    await db.commit()
    entries, back_numbers = await _load_class_entries(class_id, db, show_id)
    return [_serialize_entry(e, back_numbers) for e in entries]


@router.patch("/classes/{class_id}/status", status_code=204)
async def set_gate_class_status(
    show_id: UUID,
    class_id: UUID,
    body: GateClassStatusBody,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Moves a class through the gate lifecycle. Only one class per ring can
    be in progress at a time: starting a class while another is running in
    the same ring returns 409 with the conflicting class so the UI can ask
    the steward whether the previous class has finished."""
    await _assert_gate_access(show_id, x_api_key, x_user_id, x_user_role, db)
    class_ = await _get_class_or_404(show_id, class_id, db)

    if body.gate_status == "in_progress":
        if class_.ring_id is None:
            # Every class needs a ring; older rows may pre-date the default.
            from routers.classes import _get_or_create_default_ring
            class_.ring_id = await _get_or_create_default_ring(show_id, db)
        conflict_q = await db.execute(
            select(Class).where(
                Class.show_id == show_id,
                Class.ring_id == class_.ring_id,
                Class.gate_status == "in_progress",
                Class.id != class_.id,
            )
        )
        other = conflict_q.scalars().first()
        if other:
            raise HTTPException(409, {
                "message": (
                    f"Class #{other.class_number} {other.class_name} is still "
                    "in progress in this ring."
                ),
                "conflict_class_id": str(other.id),
                "conflict_class_number": other.class_number,
                "conflict_class_name": other.class_name,
            })

    class_.gate_status = body.gate_status
    await db.commit()
