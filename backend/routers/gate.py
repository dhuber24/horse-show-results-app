"""Gate management — the warm-up side of the in-gate.

A GATE_STEWARD assigned to a show manages the order-of-go for each class
(who enters the ring next and when), checks riders in or marks them no-shows
for any class not yet started, and starts each class as it goes in -- which
closes the classes ahead of it, or runs it alongside them. The rules
themselves -- ready, on deck, what may start and what a start closes -- are
in `backend/gate_rules.py`.

Read/write access: ADMIN, or an assigned Gate Steward / Show Secretary /
Show Manager for the show. Everything here is operational state — it never
touches placings or results.
"""
import random
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

import gate_rules
from backnumbers import ShowBackNumbers, back_numbers_for_show, resolve_back_number, sort_key
from database import get_db
from dependencies import INTERNAL_API_KEY, safe_uuid
from models import (
    Class,
    Entry,
    Show,
    ShowGateSteward,
)
from routers.classes import list_classes
from show_access import works_show
from schemas import (
    ClassPatternPost,
    ClassPatternStatus,
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
    # The show office -- including its company's staff (migration 156) -- or
    # a gate steward assigned to this show.
    if await works_show(db, show_id, safe_uuid(x_user_id), x_user_role):
        return
    if x_user_role == "GATE_STEWARD":
        row = await db.execute(
            select(ShowGateSteward).where(
                ShowGateSteward.show_id == show_id,
                ShowGateSteward.user_id == safe_uuid(x_user_id),
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


def _serialize_entry(e: Entry, numbers: ShowBackNumbers | None = None) -> dict:
    return {
        "id": e.id,
        # From show_entries, not the entry row — see backend/backnumbers.py. The
        # gate calls exhibitors by back number, so reading the always-NULL
        # per-entry column left the steward with a screen full of dashes.
        "back_number": resolve_back_number(e, numbers),
        "exhibitor_name": e.exhibitor.full_name if e.exhibitor else "",
        "horse_name": e.horse.name if e.horse else None,
        "is_disqualified": e.is_disqualified,
        "gate_order": e.gate_order,
        "gate_checked_in": e.gate_checked_in,
        "gate_no_show": e.gate_no_show,
    }


async def _tallies(show_id: UUID, db: AsyncSession) -> dict[UUID, gate_rules.Tally]:
    """Every class's check-in tally, in one query. A class with no riders is
    absent; read it as an empty `Tally()`."""
    rows = await db.execute(
        select(
            Entry.class_id,
            func.count(Entry.id),
            func.count(Entry.id).filter(Entry.gate_checked_in.is_(True), Entry.gate_no_show.is_(False)),
            func.count(Entry.id).filter(Entry.gate_no_show.is_(True)),
        )
        .join(Class, Class.id == Entry.class_id)
        .where(Class.show_id == show_id, Entry.status != "WITHDRAWN")
        .group_by(Entry.class_id)
    )
    return {
        class_id: gate_rules.Tally(entries=entries, checked_in=checked_in, no_show=no_show)
        for class_id, entries, checked_in, no_show in rows.all()
    }


async def _class_tally(class_id: UUID, db: AsyncSession) -> gate_rules.Tally:
    result = await db.execute(select(Entry).where(Entry.class_id == class_id))
    return gate_rules.tally(result.scalars().all())


async def _show_classes(show_id: UUID, db: AsyncSession) -> list[Class]:
    """The show's classes in running order -- the order every lane is read in,
    and the one `GET /shows/{id}/classes/` hands the screens."""
    result = await db.execute(
        select(Class)
        .where(Class.show_id == show_id)
        .order_by(Class.class_date, Class.sort_order.nullslast(), Class.class_number)
    )
    return list(result.scalars().all())


async def _gate_classes(show_id: UUID, db: AsyncSession) -> list[dict]:
    """The class list the gate screen reads: the public class payload, with
    `gate_status` derived (ready is never stored) and the check-in counts."""
    rows = await list_classes(show_id, db)
    tallies = await _tallies(show_id, db)
    out = []
    for row in rows:
        t = tallies.get(row["id"], gate_rules.Tally())
        out.append({
            **row,
            "gate_status": gate_rules.gate_status(row["gate_status"], t),
            "checked_in_count": t.checked_in,
            "no_show_count": t.no_show,
        })
    return out


async def _load_class_entries(
    class_id: UUID, db: AsyncSession, show_id: UUID | None = None
) -> tuple[list[Entry], ShowBackNumbers | None]:
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
    numbers = await back_numbers_for_show(show_id, db) if show_id else None

    entries.sort(
        key=lambda e: (
            (1, 0) if e.gate_order is None else (0, e.gate_order),
            sort_key(resolve_back_number(e, numbers)),
        )
    )
    return entries, numbers


@router.get("/classes")
async def list_gate_classes(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The show's classes as the gate sees them: the public class payload, with
    ready derived and each class's check-in counts. The gate screen polls this,
    so a rider the office adds or scratches reaches the steward on its own."""
    await _assert_gate_access(show_id, x_api_key, x_user_id, x_user_role, db)
    if not await db.get(Show, show_id):
        raise HTTPException(404, "Show not found")
    return await _gate_classes(show_id, db)


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
    """Check a rider in, mark them a no-show, or put them back to waiting.

    Open for every class not yet started -- the steward works down the day as
    riders arrive, not only the class on deck. Closed once a class is in the
    ring. Whether the class is ready is derived from these two flags (see
    `gate_rules`), so nothing here writes the class.
    """
    await _assert_gate_access(show_id, x_api_key, x_user_id, x_user_role, db)
    class_ = await _get_class_or_404(show_id, class_id, db)

    refusal = gate_rules.check_in_refusal(class_)
    if refusal:
        raise HTTPException(409, refusal)

    result = await db.execute(
        select(Entry)
        .where(Entry.id == entry_id, Entry.class_id == class_id)
        .options(selectinload(Entry.exhibitor), selectinload(Entry.horse))
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Entry not found")
    entry.gate_checked_in = body.checked_in
    entry.gate_no_show = body.no_show

    await db.commit()
    tally = await _class_tally(class_id, db)
    back_numbers = await back_numbers_for_show(show_id, db)
    return {
        "entry": _serialize_entry(entry, back_numbers),
        "class_gate_status": gate_rules.gate_status(class_.gate_status, tally),
    }


@router.patch("/classes/{class_id}/pattern", response_model=ClassPatternStatus)
async def set_pattern_posted(
    show_id: UUID,
    class_id: UUID,
    body: ClassPatternPost,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Record that this class's pattern has gone up.

    Every pattern class in the rule book requires the judge to post the pattern
    at least an hour before the class (AM-115.B.2, YP-120.B.2, and the hunt-seat
    equitation class procedure). It is one of the few show-management duties
    stated as mandatory with a deadline, and the app had nowhere to record it.

    The timestamp is taken here, not from the caller — a class that could name
    the minute could claim it met the one-hour rule after the fact.

    **The app cannot check the hour, and does not pretend to.** `classes` carries
    a `class_date` and no start time, so there is nothing to measure an hour back
    from. What this gives the office is *whether* the pattern went up and when,
    which is the half that is answerable. Adding a start time to every class to
    derive the other half is a bigger change than this rule justifies on its own.

    Nothing is refused over this either way: refusing a class would not have
    posted its pattern any earlier, which is the same reasoning that took the
    block off health paperwork.

    This is the posting at the in-gate, which stays the official copy. The file
    exhibitors read ahead lives in `show_patterns` (migration 146) and is
    assigned to the class there; uploading it is not a posting and does not set
    this.
    """
    await _assert_gate_access(show_id, x_api_key, x_user_id, x_user_role, db)
    class_ = await _get_class_or_404(show_id, class_id, db)

    class_.pattern_posted_at = datetime.now(timezone.utc) if body.posted else None
    if body.pattern_notes is not None:
        class_.pattern_notes = body.pattern_notes.strip() or None
    await db.commit()
    await db.refresh(class_)

    return ClassPatternStatus(
        class_id=class_.id,
        pattern_posted_at=class_.pattern_posted_at,
        pattern_notes=class_.pattern_notes,
    )


@router.post("/classes/{class_id}/draw", response_model=list[GateEntryOut])
async def draw_gate_order(
    show_id: UUID,
    class_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Draw the order of go at random.

    SC-185.I: "A working order may be established by drawing for that order. The
    exhibitor does not necessarily need to be present during the drawing." Every
    individual-work class procedure in the rule book then says a working order is
    *required* — so the app had the order (`entries.gate_order`, dragged into
    place by hand) and no way to produce one the way the rules describe.

    Deliberately re-drawable and not recorded as an event: the same rule lets
    show management alter the order at its discretion, and a draw the steward
    cannot redo after a scratch would be worse than no draw at all. Dragging
    still works afterwards, which is that discretion.
    """
    await _assert_gate_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_class_or_404(show_id, class_id, db)

    entries, _ = await _load_class_entries(class_id, db, show_id)
    order = list(entries)
    # `SystemRandom` rather than the default Mersenne Twister: this decides who
    # works first in a class people have paid to enter, and a sequence somebody
    # could reproduce from a seed is not a draw.
    random.SystemRandom().shuffle(order)
    for position, entry in enumerate(order, start=1):
        entry.gate_order = position
    await db.commit()

    entries, back_numbers = await _load_class_entries(class_id, db, show_id)
    return [_serialize_entry(e, back_numbers) for e in entries]


@router.post("/classes/{class_id}/reset", response_model=list[GateEntryOut])
async def reset_gate_class(
    show_id: UUID,
    class_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Clears every rider's check-in and no-show on a class not yet started.
    Recovery hatch for steward mistakes; a started class is put back with
    undo start or reopen instead, which keep the ring's order."""
    await _assert_gate_access(show_id, x_api_key, x_user_id, x_user_role, db)
    class_ = await _get_class_or_404(show_id, class_id, db)
    refusal = gate_rules.reset_refusal(class_)
    if refusal:
        raise HTTPException(409, refusal)
    entries, _ = await _load_class_entries(class_id, db, show_id)
    for e in entries:
        e.gate_checked_in = False
        e.gate_no_show = False
    # Ready is derived now; `pending` also clears a `ready` an older row stored.
    class_.gate_status = "pending"
    await db.commit()
    entries, back_numbers = await _load_class_entries(class_id, db, show_id)
    return [_serialize_entry(e, back_numbers) for e in entries]


@router.patch("/classes/{class_id}/status")
async def set_gate_class_status(
    show_id: UUID,
    class_id: UUID,
    body: GateClassStatusBody,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Moves a class through the gate: start, finish, skip, undo a start, or
    reopen. Which of those a request is follows from where the class is now;
    what each may do is `gate_rules.transition_refusal`, answered with a 409.

    Starting a class finishes every class in the ring ahead of it -- the
    steward starts the next class when it goes in, and the one before is over.
    `concurrent` starts it alongside them instead, for classes that run
    together; the next ordinary start then finishes the whole group. Marking a
    class done likewise finishes the classes in the ring ahead of it, so the
    last of a group marked done finishes the group.

    Answers with the gate's class list, so the screen sees every class a start
    closed without a second request.
    """
    await _assert_gate_access(show_id, x_api_key, x_user_id, x_user_role, db)
    class_ = await _get_class_or_404(show_id, class_id, db)

    lane = gate_rules.lane(await _show_classes(show_id, db), class_)
    tally = await _class_tally(class_id, db)
    refusal = gate_rules.transition_refusal(class_, body.gate_status, lane, tally, body.concurrent)
    if refusal:
        raise HTTPException(409, refusal)

    if body.gate_status == "in_progress" and not gate_rules.started(class_):
        for ahead in gate_rules.closed_by_start(class_, lane, body.concurrent):
            ahead.gate_status = "done"
    if body.gate_status == "done" and class_.gate_status == "in_progress":
        for ahead in gate_rules.closed_by_finish(class_, lane):
            ahead.gate_status = "done"

    # Ready is derived, never stored: a class goes back to `pending`.
    class_.gate_status = "pending" if body.gate_status == "ready" else body.gate_status
    await db.commit()
    return await _gate_classes(show_id, db)
