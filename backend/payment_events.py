"""What a payment does once Stripe says it happened (migration 172).

Each kind of money has one function here that applies it, and both roads to a
settled payment go through it: the webhook Stripe sends (`handle_event`), and
the request that took the payment, when the card succeeds on the spot. Every
one is idempotent -- keyed on the PaymentIntent or the event -- so the two
roads, and Stripe retrying a delivery, apply a payment once.

  * **Trainer Registry Pro.** A paid subscription invoice moves
    `trainers.pro_until` to the end of the period paid for. Nothing turns Pro
    off: a cancelled or failed subscription stops moving the date, and the
    listing returns to Basic the day after it, as it always has.
  * **A GaitDesk invoice.** Paid by card or bank on GaitDesk's account; marks
    the invoice paid, and each Pro+ year on it.
  * **An exhibitor's payment to a show company.** Charged on the company's own
    account; lands in `show_payments` like the desk's cash, with the card fee
    in its own column so it is never credited against the bill.

Nothing here decides an amount. The amounts were quoted by `billing.py` when
the payment was started and travel in the PaymentIntent's metadata; this only
writes down what was paid.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy.orm import selectinload

from models import (
    GaitDeskInvoice,
    ShowCompany,
    ShowCompanySubscription,
    ShowEntry,
    ShowPayment,
    StripeEvent,
    Trainer,
    TrainerProRequest,
)

logger = logging.getLogger(__name__)

# PaymentIntent metadata `kind`: which of the three kinds of money this is.
KIND_TRAINER_PRO = "trainer_pro"
KIND_GAITDESK_INVOICE = "gaitdesk_invoice"
KIND_SHOW_PAYMENT = "show_payment"
KIND_PRO_PLUS = "pro_plus_purchase"

ONLINE_PAYMENT_NAME = "Paid online"


def _utc_day(timestamp: int | float | None = None) -> date:
    if timestamp is None:
        return datetime.now(timezone.utc).date()
    return datetime.fromtimestamp(int(timestamp), tz=timezone.utc).date()


def _uuid(value) -> Optional[UUID]:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def method_label(method_type: Optional[str], brand: Optional[str] = None) -> str:
    """How an online payment reads on a list: "Online, Visa card" or "Online,
    bank transfer". Never any digits of the card: no part of a card number is
    kept in GaitDesk's database -- Stripe holds it, and the payment's Stripe
    id (kept beside it) finds it there."""
    if method_type == "card":
        return f"Online, {(brand or '').title() or 'Card'} card" if brand else "Online, card"
    if method_type == "us_bank_account":
        return "Online, bank transfer"
    return "Online"


# ── Trainer Registry Pro ──────────────────────────────────────────────────────


def _period_end_and_plan(invoice: dict) -> tuple[Optional[date], Optional[str]]:
    """The last day a subscription invoice pays for, and whether it was the
    monthly or the annual plan -- read off its lines, which carry the period in
    every Stripe API version."""
    best_end: Optional[int] = None
    best_start: Optional[int] = None
    for line in ((invoice.get("lines") or {}).get("data") or []):
        period = line.get("period") or {}
        end = period.get("end")
        if end is not None and (best_end is None or end > best_end):
            best_end, best_start = end, period.get("start")
    if best_end is None:
        return None, None
    plan = None
    if best_start is not None:
        plan = "annual" if (best_end - best_start) > 40 * 86400 else "monthly"
    return _utc_day(best_end), plan


def _invoice_subscription_id(invoice: dict) -> Optional[str]:
    """The subscription an invoice bills: a top-level field before Stripe's
    2025 API versions, under `parent.subscription_details` after."""
    sub = invoice.get("subscription")
    if isinstance(sub, dict):
        sub = sub.get("id")
    if sub:
        return sub
    details = ((invoice.get("parent") or {}).get("subscription_details") or {})
    sub = details.get("subscription")
    return sub.get("id") if isinstance(sub, dict) else sub


async def apply_trainer_checkout(session: dict, db: AsyncSession) -> bool:
    """A trainer finished Checkout: remember their Stripe customer and
    subscription. Pro itself switches on with the paid invoice."""
    metadata = session.get("metadata") or {}
    if metadata.get("kind") != KIND_TRAINER_PRO:
        return False
    trainer = await db.get(Trainer, _uuid(metadata.get("trainer_id")))
    if trainer is None:
        logger.warning("Checkout finished for a trainer that no longer exists: %s", metadata.get("trainer_id"))
        return False
    if session.get("customer"):
        trainer.stripe_customer_id = session["customer"]
    if session.get("subscription"):
        trainer.stripe_subscription_id = session["subscription"]
    if metadata.get("plan") in ("monthly", "annual"):
        trainer.pro_plan = metadata["plan"]
    return True


async def apply_trainer_renewal(invoice: dict, db: AsyncSession) -> bool:
    """A Pro subscription invoice was paid: Pro through the end of the period
    it pays for. Only ever moves the date later -- an admin's complimentary
    months are never cut short by a smaller payment."""
    customer = invoice.get("customer")
    if not customer:
        return False
    trainer = (
        await db.execute(select(Trainer).where(Trainer.stripe_customer_id == customer))
    ).scalar_one_or_none()
    if trainer is None:
        # Not a trainer's invoice -- or Checkout's event has not arrived yet.
        # Stripe sends `checkout.session.completed` first in practice; if not,
        # its retry of this event finds the trainer.
        return False
    end, plan = _period_end_and_plan(invoice)
    if end is None:
        return False
    if trainer.pro_until is None or end > trainer.pro_until:
        trainer.pro_until = end
    if plan:
        trainer.pro_plan = plan
    subscription_id = _invoice_subscription_id(invoice)
    if subscription_id:
        trainer.stripe_subscription_id = subscription_id
    # Paying answers the ask, as an admin recording the date does.
    await db.execute(delete(TrainerProRequest).where(TrainerProRequest.trainer_id == trainer.id))
    logger.info("Trainer Registry Pro paid: trainer=%s through=%s", trainer.id, trainer.pro_until)
    return True


async def apply_subscription_ended(subscription: dict, db: AsyncSession) -> bool:
    """A Pro subscription was cancelled and has run out. Pro itself is left to
    lapse on its date; this only forgets the subscription, so the trainer may
    start a new one."""
    subscription_id = subscription.get("id")
    if not subscription_id:
        return False
    trainer = (
        await db.execute(select(Trainer).where(Trainer.stripe_subscription_id == subscription_id))
    ).scalar_one_or_none()
    if trainer is None:
        return False
    trainer.stripe_subscription_id = None
    return True


# ── A GaitDesk invoice ────────────────────────────────────────────────────────


def mark_invoice_paid(
    invoice: GaitDeskInvoice,
    subscriptions: list,
    *,
    paid_on: date,
    method: str,
    reference: Optional[str],
    card_fee_cents: int = 0,
    payment_intent_id: Optional[str] = None,
) -> bool:
    """Record an invoice as paid, and every Pro+ year on it with it. False when
    it already was -- a second report of the same payment changes nothing."""
    if invoice.paid_on is not None:
        return False
    invoice.paid_on = paid_on
    invoice.payment_method = method
    invoice.payment_reference = reference
    invoice.card_fee_cents = max(0, card_fee_cents)
    invoice.payment_pending_at = None
    if payment_intent_id:
        invoice.stripe_payment_intent_id = payment_intent_id
    year_ids = {line.subscription_id for line in invoice.lines if line.subscription_id}
    for year in subscriptions:
        if year.id in year_ids and year.payment_received_on is None:
            year.payment_received_on = paid_on
            year.payment_method = method
            year.payment_reference = f"GaitDesk invoice {invoice_label(invoice)}"
    return True


def invoice_label(invoice) -> str:
    return f"GD-{invoice.number:05d}" if invoice.number is not None else "GD-draft"


async def _invoice_years(db: AsyncSession, invoice: GaitDeskInvoice) -> list:
    ids = [line.subscription_id for line in invoice.lines if line.subscription_id]
    if not ids:
        return []
    return list(
        (await db.execute(select(ShowCompanySubscription).where(ShowCompanySubscription.id.in_(ids)))).scalars().all()
    )


async def apply_invoice_payment(intent: dict, db: AsyncSession) -> bool:
    """A payment on a GaitDesk invoice succeeded."""
    metadata = intent.get("metadata") or {}
    if metadata.get("kind") != KIND_GAITDESK_INVOICE:
        return False
    invoice = await db.get(GaitDeskInvoice, _uuid(metadata.get("invoice_id")))
    if invoice is None:
        logger.error("Payment %s is for an invoice that no longer exists", intent.get("id"))
        return False
    if invoice.voided_at is not None:
        # Money arrived on an invoice voided after the payment started. It is
        # recorded, so nobody loses track of it, and logged for a refund.
        logger.error("Payment %s arrived on void invoice %s -- refund it in Stripe", intent.get("id"), invoice.id)
    method = "card" if metadata.get("method_type") == "card" else "ach"
    return mark_invoice_paid(
        invoice,
        await _invoice_years(db, invoice),
        paid_on=_utc_day(),
        method=method,
        reference=method_label(metadata.get("method_type"), metadata.get("card_brand")),
        card_fee_cents=_int(metadata.get("card_fee_cents")),
        payment_intent_id=intent.get("id"),
    )


async def apply_invoice_payment_failed(intent: dict, db: AsyncSession) -> bool:
    """A bank payment on an invoice bounced: open it again to be paid."""
    metadata = intent.get("metadata") or {}
    if metadata.get("kind") != KIND_GAITDESK_INVOICE:
        return False
    invoice = await db.get(GaitDeskInvoice, _uuid(metadata.get("invoice_id")))
    if invoice is None or invoice.paid_on is not None:
        return False
    if invoice.stripe_payment_intent_id == intent.get("id"):
        invoice.payment_pending_at = None
        logger.warning("Payment %s on invoice %s failed", intent.get("id"), invoice.id)
        return True
    return False


# ── An exhibitor's payment to a show company ──────────────────────────────────


async def record_show_payment(intent: dict, account_id: Optional[str], db: AsyncSession) -> bool:
    """An exhibitor's online payment succeeded on the show company's account:
    one `show_payments` row, credited at the amount quoted, with the card fee
    beside it. Once per PaymentIntent, however many times it is reported."""
    metadata = intent.get("metadata") or {}
    if metadata.get("kind") != KIND_SHOW_PAYMENT:
        return False
    intent_id = intent.get("id")
    existing = (
        await db.execute(select(ShowPayment.id).where(ShowPayment.stripe_payment_intent_id == intent_id))
    ).first()
    if existing is not None:
        return False
    show_entry = await db.get(ShowEntry, _uuid(metadata.get("show_entry_id")))
    if show_entry is None:
        logger.error("Online payment %s is for an account that no longer exists -- refund it in Stripe", intent_id)
        return False
    company_id = _uuid(metadata.get("company_id"))
    company = await db.get(ShowCompany, company_id) if company_id else None
    if account_id and (company is None or company.stripe_account_id != account_id):
        # Only the company's own account may put money on its exhibitors' bills.
        logger.error("Online payment %s came from account %s, not the show company's", intent_id, account_id)
        return False
    amount = _int(metadata.get("amount_cents"))
    if amount <= 0:
        logger.error("Online payment %s carries no amount to credit", intent_id)
        return False
    method_type = metadata.get("method_type")
    db.add(ShowPayment(
        show_entry_id=show_entry.id,
        amount_cents=amount,
        card_fee_cents=max(0, _int(metadata.get("card_fee_cents"))),
        method="card" if method_type == "card" else "transfer",
        reference=method_label(method_type, metadata.get("card_brand")),
        received_on=_utc_day(),
        note=f"Stripe payment {intent_id}",
        recorded_by=None,
        recorded_by_name=ONLINE_PAYMENT_NAME,
        stripe_payment_intent_id=intent_id,
    ))
    release_show_payment(show_entry, intent_id)
    logger.info("Online payment recorded: show_entry=%s amount_cents=%d intent=%s", show_entry.id, amount, intent_id)
    return True


def release_show_payment(show_entry, intent_id: Optional[str]) -> bool:
    """The exhibitor's bank payment on its way has settled or failed: their
    balance may be paid online again (migration 174). Only that payment
    releases it."""
    if show_entry is None or not intent_id or show_entry.online_payment_intent_id != intent_id:
        return False
    show_entry.online_payment_intent_id = None
    show_entry.online_payment_pending_at = None
    return True


async def apply_show_payment_failed(intent: dict, account_id: Optional[str], db: AsyncSession) -> bool:
    """An exhibitor's bank payment bounced, or its microdeposit was never
    entered: nothing was paid, and the balance is theirs to pay again."""
    metadata = intent.get("metadata") or {}
    if metadata.get("kind") != KIND_SHOW_PAYMENT:
        return False
    show_entry = await db.get(ShowEntry, _uuid(metadata.get("show_entry_id")))
    company_id = _uuid(metadata.get("company_id"))
    company = await db.get(ShowCompany, company_id) if company_id else None
    if account_id and (company is None or company.stripe_account_id != account_id):
        return False
    if not release_show_payment(show_entry, intent.get("id")):
        return False
    logger.warning("Online bank payment %s for show_entry %s failed", intent.get("id"), show_entry.id)
    return True


async def apply_account_update(account: dict, db: AsyncSession) -> bool:
    """Stripe says whether a show company's account can take payments yet."""
    account_id = account.get("id")
    if not account_id:
        return False
    company = (
        await db.execute(select(ShowCompany).where(ShowCompany.stripe_account_id == account_id))
    ).scalar_one_or_none()
    if company is None:
        return False
    company.stripe_charges_enabled = bool(account.get("charges_enabled"))
    return True


# ── A Pro+ year bought on My Company (migration 173) ──────────────────────────


async def _company_for_pro_plus(db: AsyncSession, company_id: Optional[UUID]) -> Optional[ShowCompany]:
    """The company with what `record_pro_plus` reads and writes loaded."""
    if company_id is None:
        return None
    return (
        await db.execute(
            select(ShowCompany)
            .where(ShowCompany.id == company_id)
            .options(
                selectinload(ShowCompany.subscriptions),
                selectinload(ShowCompany.upgrade_requests),
                selectinload(ShowCompany.plan_changes),
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def apply_pro_plus_purchase(intent: dict, db: AsyncSession) -> Optional[ShowCompanySubscription]:
    """A company's payment for a Pro+ year succeeded: start the year, paid.
    It runs from today, or from the day after the year it renews -- the same
    term an admin's *Start a Pro+ year* picks. Once per PaymentIntent. Returns
    the new year, for the confirmation email."""
    from show_companies import next_pro_plus_term, record_pro_plus, utc_today

    metadata = intent.get("metadata") or {}
    if metadata.get("kind") != KIND_PRO_PLUS:
        return None
    intent_id = intent.get("id")
    already = (
        await db.execute(
            select(ShowCompanySubscription.id).where(ShowCompanySubscription.stripe_payment_intent_id == intent_id)
        )
    ).first()
    if already is not None:
        return None
    company = await _company_for_pro_plus(db, _uuid(metadata.get("company_id")))
    if company is None:
        logger.error("Pro+ payment %s is for a company that no longer exists -- refund it in Stripe", intent_id)
        return None
    today = utc_today()
    latest_end = max((t.ends_on for t in company.subscriptions), default=None)
    starts_on, ends_on = next_pro_plus_term(latest_end, today, bool(company.renews_pro_plus))
    method_type = metadata.get("method_type")
    term = record_pro_plus(
        company,
        starts_on=starts_on,
        ends_on=ends_on,
        price_cents=_int(metadata.get("amount_cents")),
        payment_method="card" if method_type == "card" else "ach",
        payment_reference=method_label(method_type, metadata.get("card_brand")),
        recorded_by=None,
        db=db,
        payment_received_on=today,
    )
    term.stripe_payment_intent_id = intent_id
    term.card_fee_cents = max(0, _int(metadata.get("card_fee_cents")))
    if company.pro_plus_payment_intent_id == intent_id:
        company.pro_plus_payment_intent_id = None
        company.pro_plus_payment_pending_at = None
    logger.info("Pro+ bought online: company=%s %s to %s intent=%s", company.id, starts_on, ends_on, intent_id)
    return term


async def apply_pro_plus_payment_failed(intent: dict, db: AsyncSession) -> bool:
    """A bank payment for a Pro+ year bounced: the company may buy it again."""
    metadata = intent.get("metadata") or {}
    if metadata.get("kind") != KIND_PRO_PLUS:
        return False
    company = await db.get(ShowCompany, _uuid(metadata.get("company_id")))
    if company is None or company.pro_plus_payment_intent_id != intent.get("id"):
        return False
    company.pro_plus_payment_intent_id = None
    company.pro_plus_payment_pending_at = None
    logger.warning("Pro+ bank payment %s for company %s failed", intent.get("id"), company.id)
    return True


async def mail_pro_plus_started(db: AsyncSession, company_id: UUID, term) -> None:
    """Tell the company's show managers their year has started. Best-effort,
    like all mail, and after the commit -- never part of recording it."""
    from show_companies import (
        company_manager_emails,
        email_admins,
        loaded_effective_plan,
        plan_confirmation_email,
    )

    try:
        company = await _company_for_pro_plus(db, company_id)
        recipients = await company_manager_emails(db, company_id)
        if company is None or not recipients:
            return
        subject, body = plan_confirmation_email(
            company.name,
            loaded_effective_plan(company),
            term=(term.starts_on, term.ends_on),
            returns_to=company.plan,
            renews=bool(company.renews_pro_plus),
        )
        await email_admins(recipients, subject, body)
    except Exception:  # noqa: BLE001 -- mail never undoes a payment
        logger.exception("Could not mail the Pro+ confirmation for company %s", company_id)


# ── The webhook ───────────────────────────────────────────────────────────────


async def handle_event(event: dict, connect: bool, db: AsyncSession) -> str:
    """Apply one verified Stripe event. Returns what happened, for the log:
    `applied`, `ignored`, or `duplicate` for an event handled before.

    The event's id is written in the same transaction as its effect, so a
    failure rolls both back and Stripe's retry tries again; and a retry of a
    handled event finds the id and does nothing.
    """
    event_id = event.get("id")
    event_type = event.get("type") or ""
    if not event_id:
        return "ignored"
    if await db.get(StripeEvent, event_id) is not None:
        return "duplicate"
    db.add(StripeEvent(id=event_id, type=event_type))

    obj = (event.get("data") or {}).get("object") or {}
    applied = False
    new_year = None
    if event_type == "account.updated":
        applied = await apply_account_update(obj, db)
    elif connect:
        if event_type == "payment_intent.succeeded":
            applied = await record_show_payment(obj, event.get("account"), db)
        elif event_type == "payment_intent.payment_failed":
            applied = await apply_show_payment_failed(obj, event.get("account"), db)
    elif event_type == "checkout.session.completed":
        applied = await apply_trainer_checkout(obj, db)
    elif event_type == "invoice.paid":
        applied = await apply_trainer_renewal(obj, db)
    elif event_type == "customer.subscription.deleted":
        applied = await apply_subscription_ended(obj, db)
    elif event_type == "payment_intent.succeeded":
        new_year = await apply_pro_plus_purchase(obj, db)
        applied = new_year is not None or await apply_invoice_payment(obj, db)
    elif event_type == "payment_intent.payment_failed":
        applied = await apply_pro_plus_payment_failed(obj, db) or await apply_invoice_payment_failed(obj, db)

    try:
        await db.commit()
    except IntegrityError:
        # The same event delivered twice at once: the other delivery applied it.
        await db.rollback()
        return "duplicate"
    if new_year is not None:
        await mail_pro_plus_started(db, new_year.company_id, new_year)
    return "applied" if applied else "ignored"
