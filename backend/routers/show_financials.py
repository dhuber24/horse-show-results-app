"""The show office's money: what was billed, what came in, what is still owed.

Before this existed the app could only say what an exhibitor *owed*.
`billing.build_bill` itemized the charges and nothing recorded the check handed
over at the desk, so "who still owes us money?" lived on the secretary's paper
list and any balance the app could have shown would have read as the full bill
for everyone, forever. Migration 096 adds the other half.

**Recording, not processing.** Nothing here touches a card or calls a processor.
Staff write down the cash or check they took, exactly as `show_office.py` writes
down a document a human physically inspected. The app still collects no payment.

Three things are deliberate:

  * **Money is not re-derived here.** Every figure comes from `billing.py` —
    `build_bill` per account, then `summarize_accounts` over the results. A SQL
    `SUM` over `entry_fee_cents` would be faster and would eventually disagree
    with the bill the exhibitor sees on their own My Shows screen, which is the
    one thing this screen cannot afford.

  * **The whole show loads in a fixed number of queries.** Accounts are built in
    Python from four bulk selects rather than a `build_bill` call per exhibitor
    behind its own round trip.

  * **Side pot money is reported apart from the accounts.** Pot buy-ins are not
    part of `build_bill`, so folding them into a balance would make this screen
    and the exhibitor's bill disagree. They get their own block and their own
    report.

Access is the show-office tier — ADMIN, or the SHOW_SECRETARY / SHOW_MANAGER
assigned to *this* show. `SCRIBE` and `GATE_STEWARD` are show staff too and are
deliberately excluded: neither role has any business reading revenue.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from billing import build_account, side_pot_money, summarize_accounts
from cancellations import is_on_roster
from database import get_db
from dependencies import require_admin_or_show_admin, safe_uuid
from financial_reports import build_report, list_reports
from models import (
    Class,
    Entry,
    Exhibitor,
    Show,
    ShowEntry,
    ShowEntryReservation,
    ShowPayment,
    SidePot,
    SidePotPayout,
    User,
)
from routers.futurities import load_futurity_bill_index
from routers.show_office import _assert_exhibitor_on_roster
from routers.shows import _assert_show_access
from schemas import (
    ReportDefinitionOut,
    ReportOut,
    ShowFinancialsOut,
    ShowPaymentCreate,
    ShowPaymentOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/shows/{show_id}",
    tags=["Financials"],
    dependencies=[Depends(require_admin_or_show_admin)],
)

# Timezone-aware, to sort alongside `created_at` without mixing naive and aware.
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


# ── Assembling the picture ─────────────────────────────────────────────────────


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    """The Show row, with everything `build_bill` reads off it loaded.

    A plain `select` rather than `db.get(..., options=[...])`: `get` silently
    drops the options when the row is already in the session's identity map —
    the common case here, since the desk loads the show before calling this —
    and the first read of an unloaded relationship in an async request is a
    MissingGreenlet 500. `fees` and `judges` are what `charge_lines` bills the
    show's own per-horse and per-judge charges from.
    """
    result = await db.execute(
        select(Show)
        .options(
            selectinload(Show.sanctioning),
            selectinload(Show.fees),
            selectinload(Show.judges),
        )
        .where(Show.id == show_id)
        .execution_options(populate_existing=True)
    )
    show = result.scalar_one_or_none()
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _load_financials(show_id: UUID, db: AsyncSession) -> dict:
    """Everything the Financials screen and every report is built from.

    Returns the `ShowFinancialsOut` shape as a plain dict, because the report
    builders read it too and get exactly what the overview showed.
    """
    show = await _get_show_or_404(show_id, db)

    # 1. Roster rows: back numbers, sign-up state, reservations, and payments.
    show_entry_result = await db.execute(
        select(ShowEntry)
        .options(
            selectinload(ShowEntry.exhibitor),
            selectinload(ShowEntry.reservations).selectinload(ShowEntryReservation.show_fee),
            selectinload(ShowEntry.payments),
        )
        .where(ShowEntry.show_id == show_id)
    )
    show_entries = list(show_entry_result.scalars().all())

    # 2. Class entries, which is what `build_bill` charges for.
    entry_result = await db.execute(
        select(Entry)
        .options(
            selectinload(Entry.class_),
            selectinload(Entry.horse),
            selectinload(Entry.exhibitor),
        )
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id)
    )
    entries = list(entry_result.scalars().all())

    # An exhibitor can reach this list two ways, and neither alone is complete:
    # a completed sign-up with no entries yet (they owe for reserved stalls), or
    # entries with no `show_entries` row at all (a secretary added them by hand
    # before any back number was assigned).
    exhibitors: dict[UUID, Exhibitor] = {}
    entries_by_exhibitor: dict[UUID, list[Entry]] = {}
    horses_by_exhibitor: dict[UUID, set] = {}
    for entry in entries:
        if entry.exhibitor is None:
            continue
        exhibitors.setdefault(entry.exhibitor_id, entry.exhibitor)
        entries_by_exhibitor.setdefault(entry.exhibitor_id, []).append(entry)
        if entry.horse_id:
            horses_by_exhibitor.setdefault(entry.exhibitor_id, set()).add(entry.horse_id)

    show_entry_by_exhibitor: dict[UUID, ShowEntry] = {}
    for show_entry in show_entries:
        if show_entry.exhibitor is None:
            continue
        exhibitors.setdefault(show_entry.exhibitor_id, show_entry.exhibitor)
        show_entry_by_exhibitor[show_entry.exhibitor_id] = show_entry

    # 3. Futurity enrollments, keyed by show entry — two queries for the whole
    # show rather than one per exhibitor, same as everything else here.
    futurity_index = await load_futurity_bill_index(show_id, db)

    accounts: list[dict] = []
    for exhibitor_id, exhibitor in exhibitors.items():
        show_entry = show_entry_by_exhibitor.get(exhibitor_id)
        exhibitor_entries = entries_by_exhibitor.get(exhibitor_id, [])
        reservations = list(show_entry.reservations) if show_entry else []
        # `created_at` breaks ties within a day. The None branch is sorted on
        # separately rather than defaulting to `datetime.min`, because that is
        # naive and the column is timezone-aware — comparing the two raises.
        payments = sorted(
            (show_entry.payments if show_entry else []),
            key=lambda p: (p.received_on, p.created_at is None, p.created_at or _EPOCH),
        )

        money = build_account(
            show,
            exhibitor_entries,
            reservations,
            payments,
            futurity_index.get(show_entry.id, []) if show_entry else [],
        )
        accounts.append({
            "exhibitor_id": exhibitor_id,
            "exhibitor_name": exhibitor.full_name,
            "show_entry_id": show_entry.id if show_entry else None,
            "back_number": show_entry.back_number if show_entry else None,
            "preferred_back_number": (
                show_entry.preferred_back_number if show_entry else None
            ),
            "signed_up": is_on_roster(show_entry),
            "registered_at": show_entry.registered_at if show_entry else None,
            # Set means the registration was called off (migration 126). The
            # account survives it, because the payments do — a cancelled
            # exhibitor who had already paid reads here as a credit, which is
            # the whole reason the row is marked rather than deleted.
            "cancelled_at": show_entry.cancelled_at if show_entry else None,
            "entry_count": len(exhibitor_entries),
            "horse_count": len(horses_by_exhibitor.get(exhibitor_id, set())),
            "payments": [
                {
                    "id": p.id,
                    "show_entry_id": p.show_entry_id,
                    "amount_cents": p.amount_cents,
                    "method": p.method,
                    "reference": p.reference,
                    "received_on": p.received_on,
                    "note": p.note,
                    "recorded_by": p.recorded_by,
                    "recorded_by_name": p.recorded_by_name,
                    "created_at": p.created_at,
                }
                for p in payments
            ],
            **money,
        })

    # Owing first — the office opens this screen to find out who to chase — then
    # by back number so the settled majority reads in the usual order.
    accounts.sort(
        key=lambda a: (
            -a["balance_cents"],
            a["back_number"] is None,
            a["back_number"] or 0,
            (a["exhibitor_name"] or "").lower(),
        )
    )

    totals = summarize_accounts(accounts)

    # 3. Class counts, for context on how much of the show is actually entered.
    class_count_result = await db.execute(
        select(func.count()).select_from(Class).where(Class.show_id == show_id)
    )
    classes_with_entries = len({e.class_id for e in entries})

    # 4. Side pots, reported apart from the accounts on purpose.
    pot_result = await db.execute(
        select(SidePot)
        .options(selectinload(SidePot.pot_entries))
        .where(SidePot.show_id == show_id)
        .order_by(SidePot.created_at)
    )
    pots = list(pot_result.scalars().all())
    payouts_by_pot: dict[UUID, list[SidePotPayout]] = {}
    if pots:
        payout_result = await db.execute(
            select(SidePotPayout).where(
                SidePotPayout.side_pot_id.in_([p.id for p in pots])
            )
        )
        for payout in payout_result.scalars().all():
            payouts_by_pot.setdefault(payout.side_pot_id, []).append(payout)

    side_pots_out = []
    for pot in pots:
        paid_count = sum(1 for e in pot.pot_entries if e.paid)
        money = side_pot_money(pot, paid_count, payouts_by_pot.get(pot.id, []))
        side_pots_out.append({
            "side_pot_id": pot.id,
            "name": pot.name,
            "status": pot.status,
            "entry_fee_cents": pot.entry_fee_cents,
            "payback_percent": pot.payback_percent,
            "entry_count": len(pot.pot_entries),
            "paid_count": paid_count,
            **money,
        })

    return {
        "show_id": show.id,
        "show_name": show.name,
        "show_status": show.status,
        "office_charge_basis": show.office_charge_basis,
        "totals": totals,
        "registrations": {
            "exhibitors": len(exhibitors),
            "signed_up": sum(1 for a in accounts if a["signed_up"]),
            "staff_added": sum(1 for a in accounts if not a["signed_up"]),
            "entries": len(entries),
            "horses": len({e.horse_id for e in entries if e.horse_id}),
            "classes": class_count_result.scalar_one(),
            "classes_with_entries": classes_with_entries,
        },
        "accounts": accounts,
        "side_pots": side_pots_out,
        "side_pot_buy_ins_cents": sum(p["buy_ins_cents"] for p in side_pots_out),
        "side_pot_paid_out_cents": sum(p["paid_out_cents"] for p in side_pots_out),
        "side_pot_retained_cents": sum(p["retained_cents"] for p in side_pots_out),
    }


@router.get("/financials", response_model=ShowFinancialsOut)
async def get_show_financials(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Registrations, revenue, and outstanding balances for one show."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    return await _load_financials(show_id, db)


# ── Recording what came in ─────────────────────────────────────────────────────


@router.post("/payments", response_model=ShowPaymentOut, status_code=201)
async def record_payment(
    show_id: UUID,
    body: ShowPaymentCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Write down money the office took from an exhibitor at this show.

    Limited to exhibitors on this show's roster, the same rule the desk works
    under in `show_office.py` — staff get this reach because the person is
    standing in front of them at *their* show.

    The `show_entries` row is created if it does not exist. A secretary can be
    handed a check before a back number has been assigned, and refusing the
    payment until the roster catches up would push the record back onto paper,
    which is the problem this replaces. The shell row is the same one the back
    number screen creates.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    await _assert_exhibitor_on_roster(show_id, body.exhibitor_id, db)

    show_entry_result = await db.execute(
        select(ShowEntry).where(
            ShowEntry.show_id == show_id, ShowEntry.exhibitor_id == body.exhibitor_id
        )
    )
    show_entry = show_entry_result.scalar_one_or_none()
    if show_entry is None:
        show_entry = ShowEntry(show_id=show_id, exhibitor_id=body.exhibitor_id)
        db.add(show_entry)
        try:
            await db.flush()
        except IntegrityError:
            # Two staff taking money from the same person at once, before the
            # roster row existed. `UNIQUE (show_id, exhibitor_id)` catches the
            # second one; re-read and use the row the first insert created,
            # rather than failing a payment that genuinely happened.
            logger.warning(
                "Concurrent roster insert for exhibitor %s at show %s; recovering existing row",
                body.exhibitor_id,
                show_id,
            )
            await db.rollback()
            existing = await db.execute(
                select(ShowEntry).where(
                    ShowEntry.show_id == show_id,
                    ShowEntry.exhibitor_id == body.exhibitor_id,
                )
            )
            show_entry = existing.scalar_one_or_none()
            if show_entry is None:
                # The unique constraint fired and yet nothing is there to find.
                # That should not be reachable; if it is, the money is not being
                # recorded and somebody needs to know why.
                logger.error(
                    "Roster row for exhibitor %s at show %s vanished after IntegrityError",
                    body.exhibitor_id,
                    show_id,
                )
                raise HTTPException(409, "Could not open an account for that exhibitor. Try again.")

    actor = await db.get(User, safe_uuid(x_user_id))
    payment = ShowPayment(
        show_entry_id=show_entry.id,
        amount_cents=body.amount_cents,
        method=body.method,
        reference=body.reference,
        note=body.note,
        recorded_by=actor.id if actor else None,
        recorded_by_name=actor.full_name if actor else None,
    )
    # Left to the column default when unset, so "today" is the database's day
    # rather than whatever the browser thinks it is.
    if body.received_on is not None:
        payment.received_on = body.received_on

    db.add(payment)
    await db.commit()
    await db.refresh(payment)
    # `show_payments` is the app's only record that money moved, and
    # `recorded_by_name` is denormalized precisely because staff accounts do
    # not outlive the show. A line per payment is a few dozen a day.
    logger.info(
        "Payment recorded: show=%s show_entry=%s amount_cents=%d method=%s by=%s",
        show_id,
        show_entry.id,
        payment.amount_cents,
        payment.method,
        payment.recorded_by_name or "unknown",
    )
    return payment


@router.get("/payments", response_model=list[ShowPaymentOut])
async def list_payments(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Every payment recorded at this show, newest first."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    result = await db.execute(
        select(ShowPayment)
        .join(ShowEntry, ShowPayment.show_entry_id == ShowEntry.id)
        .where(ShowEntry.show_id == show_id)
        .order_by(ShowPayment.received_on.desc(), ShowPayment.created_at.desc())
    )
    return list(result.scalars().all())


@router.delete("/payments/{payment_id}", status_code=204)
async def delete_payment(
    show_id: UUID,
    payment_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Remove a payment recorded in error.

    For a payment that genuinely happened and is being given back, record a
    negative amount instead — deleting it would balance the account but lose the
    fact that money moved twice.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    payment = await db.get(ShowPayment, payment_id)
    if payment is None:
        raise HTTPException(404, "Payment not found")
    show_entry = await db.get(ShowEntry, payment.show_entry_id)
    if show_entry is None or show_entry.show_id != show_id:
        raise HTTPException(404, "Payment not found")
    # Logged before the delete, because afterwards there is nothing left to say
    # what was removed.
    logger.info(
        "Payment deleted: show=%s payment=%s amount_cents=%d originally_recorded_by=%s",
        show_id,
        payment.id,
        payment.amount_cents,
        payment.recorded_by_name or "unknown",
    )
    await db.delete(payment)
    await db.commit()


# ── Reports ────────────────────────────────────────────────────────────────────


@router.get("/financials/reports", response_model=list[ReportDefinitionOut])
async def list_financial_reports(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """What the reporting module can produce. Access-checked like the rest —
    the list of reports is not sensitive, but nothing under a show should
    answer to a caller with no rights to that show."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    return list_reports()


@router.get("/financials/reports/{slug}", response_model=ReportOut)
async def get_financial_report(
    show_id: UUID,
    slug: str,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Run one report. Built from the same payload as the overview, so a report
    can never quote a different number than the screen it was opened from."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    financials = await _load_financials(show_id, db)

    report = build_report(slug, financials)
    if report is None:
        raise HTTPException(404, "Report not found")

    return {
        **report,
        "show_id": financials["show_id"],
        "show_name": financials["show_name"],
        "generated_at": datetime.now(timezone.utc),
    }
