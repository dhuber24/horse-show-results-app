"""Online payments: Stripe's webhook, and an exhibitor paying a show company
(migration 172).

**The webhook** (`POST /payments/stripe/webhook`). Stripe cannot reach the API
directly -- every request to it carries the internal API key -- so the web
service forwards each delivery from `/api/stripe/webhook` (GaitDesk's own
account) and `/api/stripe/webhook/connect` (the show companies' accounts)
with the body untouched, and the signature is checked here against those raw
bytes. What each event does is `payment_events.handle_event`.

**An exhibitor paying their balance at a show** (`/my-shows/{show_id}/payment`).
The money goes to the show company's own Stripe account, never through
GaitDesk, and only:

  * where Stripe is set up, the show's company has finished connecting its
    account, and the show's plan includes online payments (Pro or Pro+) --
    the plan of the *show's* company, since the show is what is billed;
  * for the balance the office's own Financials screen shows
    (`show_financials._load_financials`, built by `billing.build_account`),
    so an exhibitor can never pay a figure the office does not recognise;
  * plus the card processing fee on a credit card, if the company passes it
    on (`show_companies.pass_card_fees`). A debit card or a bank payment pays
    the balance alone.

The payment lands in `show_payments` like the desk's cash, credited at the
balance paid, with the fee in `card_fee_cents` beside it.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

import stripe_gateway
from billing import CARD_FEE_CAP_BP, payment_quote
from database import get_db
from dependencies import require_api_key, require_authenticated, safe_uuid
from mailer import public_app_url
from models import Exhibitor, Show, ShowCompany, ShowEntry, User
from payment_events import KIND_SHOW_PAYMENT, handle_event, record_show_payment, release_show_payment
from routers.show_financials import _load_financials
from schemas import (
    PaymentQuoteOut,
    PaymentResultOut,
    PaymentSetupOut,
    PaymentTokenIn,
    ShowPaymentAvailabilityOut,
)
from show_companies import ONLINE_PAYMENTS, show_features

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Online Payments"])

NOT_AT_THIS_SHOW = "This show does not take payments online. Pay the show office."
NOTHING_TO_PAY = "You have nothing to pay at this show."
BANK_PAYMENT_ON_ITS_WAY = (
    "Your bank payment is on its way. It takes a few business days to settle, and shows on your account once it does."
)


class PaymentsConfigOut(BaseModel):
    configured: bool
    publishable_key: Optional[str] = None


class PaymentStatusIn(BaseModel):
    payment_intent_id: str = Field(min_length=3, max_length=255)


def payment_result(intent: dict, total_cents: int) -> PaymentResultOut:
    """What the payment form is told, for every kind of payment: a bank
    account waiting on its microdeposit reads as a bank payment on its way,
    with Stripe's page for entering the deposit -- never as paid."""
    status = stripe_gateway.payer_status(intent)
    return PaymentResultOut(
        status=status,
        payment_intent_id=intent["id"],
        client_secret=intent.get("client_secret") if status == "requires_action" else None,
        total_cents=total_cents,
        verification_url=intent.get("verification_url"),
    )


# ── The webhook ───────────────────────────────────────────────────────────────


@router.post("/payments/stripe/webhook", dependencies=[Depends(require_api_key)])
async def stripe_webhook(
    request: Request,
    connect: bool = Query(False),
    stripe_signature: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """One event from Stripe, forwarded by the web service. A bad signature is
    a 400 (Stripe stops retrying it); a failure applying it is a 500, so
    Stripe retries, and the event is applied once (`stripe_events`)."""
    payload = await request.body()
    try:
        event = stripe_gateway.verify_event(payload, stripe_signature, connect=connect)
    except stripe_gateway.BadSignature as exc:
        logger.warning("Rejected a Stripe webhook: %s", exc)
        raise HTTPException(400, "Invalid signature")
    except stripe_gateway.PaymentsNotConfigured:
        raise HTTPException(503, stripe_gateway.NOT_CONFIGURED)
    outcome = await handle_event(event, connect, db)
    logger.info("Stripe event %s (%s): %s", event.get("id"), event.get("type"), outcome)
    return {"received": True, "outcome": outcome}


@router.get("/payments/config", response_model=PaymentsConfigOut, dependencies=[Depends(require_api_key)])
async def payments_config():
    """Whether online payment is set up, and the publishable key the browser
    draws the payment form with. Never the secret key."""
    if not stripe_gateway.configured():
        return PaymentsConfigOut(configured=False)
    return PaymentsConfigOut(configured=True, publishable_key=stripe_gateway.publishable_key())


# ── An exhibitor paying a show company ────────────────────────────────────────


class _Context:
    def __init__(self, exhibitor, show, company, account, features, show_entry=None):
        self.exhibitor = exhibitor
        self.show = show
        self.company = company
        self.account = account
        self.features = features
        self.show_entry = show_entry

    @property
    def balance_cents(self) -> int:
        return int(self.account["balance_cents"]) if self.account else 0

    @property
    def bank_payment_pending(self) -> bool:
        return self.show_entry is not None and self.show_entry.online_payment_pending_at is not None


async def _settle_show_intent(db: AsyncSession, show_entry: Optional[ShowEntry], company, intent: dict) -> None:
    """Write down where an exhibitor's payment stands now. A card that
    succeeded is recorded at once (the webhook later changes nothing); a bank
    payment on its way -- processing, or waiting on its microdeposit -- holds
    the balance so it is not paid twice (migration 174); and one that failed
    lets it go."""
    if intent.get("status") == "succeeded":
        await record_show_payment(intent, company.stripe_account_id, db)
    elif show_entry is None:
        return
    elif stripe_gateway.on_its_way(intent):
        if show_entry.online_payment_intent_id != intent["id"]:
            show_entry.online_payment_intent_id = intent["id"]
            show_entry.online_payment_pending_at = datetime.now(timezone.utc)
    elif intent.get("status") in ("requires_payment_method", "canceled"):
        release_show_payment(show_entry, intent["id"])
    await db.commit()


async def _catch_up(db: AsyncSession, show_entry: ShowEntry, company) -> None:
    """A bank payment held on the exhibitor's account: ask Stripe where it
    stands before the balance is read. The webhook says the same thing, but a
    delivery that never arrives must not leave an exhibitor unable to pay
    online for good -- as My Company asks Stripe about a company's account."""
    try:
        intent = await stripe_gateway.run(
            stripe_gateway.retrieve_payment, show_entry.online_payment_intent_id, company.stripe_account_id
        )
    except stripe_gateway.PaymentError:
        logger.warning("Could not read online payment %s", show_entry.online_payment_intent_id)
        return
    await _settle_show_intent(db, show_entry, company, intent)


async def _context(show_id: UUID, user_id: str, db: AsyncSession) -> _Context:
    exhibitor = (
        await db.execute(select(Exhibitor).where(Exhibitor.user_id == safe_uuid(user_id)))
    ).scalar_one_or_none()
    if exhibitor is None:
        raise HTTPException(403, "Only an exhibitor pays a show online.")
    show = await db.get(Show, show_id)
    if show is None:
        raise HTTPException(404, "Show not found")
    company = await db.get(ShowCompany, show.company_id) if show.company_id else None
    show_entry = (
        await db.execute(select(ShowEntry).where(ShowEntry.show_id == show_id, ShowEntry.exhibitor_id == exhibitor.id))
    ).scalar_one_or_none()
    if (
        show_entry is not None
        and show_entry.online_payment_intent_id
        and company is not None
        and company.stripe_account_id
        and stripe_gateway.configured()
    ):
        await _catch_up(db, show_entry, company)
    # The office's own figures, account for account. Heavier than one bill,
    # and worth it: the balance paid here is the one Financials shows.
    financials = await _load_financials(show_id, db)
    account = next((a for a in financials["accounts"] if a["exhibitor_id"] == exhibitor.id), None)
    return _Context(exhibitor, show, company, account, await show_features(db, show_id), show_entry)


def unavailable_reason(ctx: _Context) -> Optional[str]:
    """Why this exhibitor cannot pay this show online, or None when they can."""
    if not stripe_gateway.configured():
        return stripe_gateway.NOT_CONFIGURED
    company = ctx.company
    if company is None or not company.stripe_account_id or not company.stripe_charges_enabled:
        return NOT_AT_THIS_SHOW
    if ONLINE_PAYMENTS not in ctx.features:
        return NOT_AT_THIS_SHOW
    if ctx.bank_payment_pending:
        return BANK_PAYMENT_ON_ITS_WAY
    if ctx.account is None or ctx.balance_cents <= 0:
        return NOTHING_TO_PAY
    return None


def _setup(ctx: _Context) -> PaymentSetupOut:
    percent_bp, fixed_cents = stripe_gateway.card_rate()
    return PaymentSetupOut(
        publishable_key=stripe_gateway.publishable_key(),
        stripe_account=ctx.company.stripe_account_id,
        amount_cents=ctx.balance_cents,
        pass_card_fees=bool(ctx.company.pass_card_fees),
        card_percent_bp=percent_bp,
        card_fixed_cents=fixed_cents,
        card_fee_cap_bp=CARD_FEE_CAP_BP,
    )


@router.get("/my-shows/{show_id}/payment", response_model=ShowPaymentAvailabilityOut)
async def show_payment_availability(
    show_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Can the caller pay their balance at this show online -- and if not, why."""
    ctx = await _context(show_id, user_id, db)
    reason = unavailable_reason(ctx)
    return ShowPaymentAvailabilityOut(
        available=reason is None,
        reason=reason,
        balance_cents=ctx.balance_cents,
        company_name=ctx.company.name if ctx.company else None,
        setup=_setup(ctx) if reason is None else None,
        bank_payment_pending=ctx.bank_payment_pending,
    )


async def _quote(ctx: _Context, token_id: str) -> tuple[dict, dict]:
    reason = unavailable_reason(ctx)
    if reason is not None:
        raise HTTPException(409, reason)
    try:
        token = await stripe_gateway.run(
            stripe_gateway.confirmation_token, token_id, ctx.company.stripe_account_id
        )
    except stripe_gateway.PaymentError as exc:
        raise HTTPException(400, exc.message)
    percent_bp, fixed_cents = stripe_gateway.card_rate()
    quote = payment_quote(
        ctx.balance_cents,
        token["method_type"],
        token["card_funding"],
        bool(ctx.company.pass_card_fees),
        percent_bp,
        fixed_cents,
    )
    return token, quote


@router.post("/my-shows/{show_id}/payment/quote", response_model=PaymentQuoteOut)
async def quote_show_payment(
    show_id: UUID,
    body: PaymentTokenIn,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """What paying the balance with the method entered costs. Nothing is charged."""
    ctx = await _context(show_id, user_id, db)
    token, quote = await _quote(ctx, body.confirmation_token)
    return PaymentQuoteOut(**quote, method_type=token["method_type"], card_funding=token["card_funding"])


async def _ensure_show_entry(show_id: UUID, exhibitor_id: UUID, db: AsyncSession) -> ShowEntry:
    """The exhibitor's account row at the show. Somebody the office entered by
    hand may not have one yet -- the same shell row `record_payment` makes."""
    query = select(ShowEntry).where(ShowEntry.show_id == show_id, ShowEntry.exhibitor_id == exhibitor_id)
    show_entry = (await db.execute(query)).scalar_one_or_none()
    if show_entry is not None:
        return show_entry
    db.add(ShowEntry(show_id=show_id, exhibitor_id=exhibitor_id))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
    show_entry = (await db.execute(query)).scalar_one_or_none()
    if show_entry is None:
        raise HTTPException(409, "Could not open your account at this show. Try again.")
    return show_entry


@router.post("/my-shows/{show_id}/payment", response_model=PaymentResultOut)
async def pay_show_balance(
    show_id: UUID,
    body: PaymentTokenIn,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Pay the whole balance at this show, on the show company's own Stripe
    account, at the total quoted. Refused if the balance changed since the
    quote -- the payer agreed to a figure, not to whatever is owed now."""
    ctx = await _context(show_id, user_id, db)
    token, quote = await _quote(ctx, body.confirmation_token)
    if body.expected_total_cents is not None and body.expected_total_cents != quote["total_cents"]:
        raise HTTPException(409, "Your balance changed. Check the total and pay again.")

    show_entry = await _ensure_show_entry(show_id, ctx.exhibitor.id, db)
    payer = await db.get(User, safe_uuid(user_id))
    company = ctx.company
    try:
        intent = await stripe_gateway.run(
            stripe_gateway.create_payment,
            amount_cents=quote["total_cents"],
            token_id=token["id"],
            return_url=f"{public_app_url()}/shows/{show_id}/my-bill?paid=1",
            description=f"{ctx.show.name} - {ctx.exhibitor.full_name}",
            metadata={
                "kind": KIND_SHOW_PAYMENT,
                "show_id": str(show_id),
                "company_id": str(company.id),
                "exhibitor_id": str(ctx.exhibitor.id),
                "show_entry_id": str(show_entry.id),
                "amount_cents": str(quote["amount_cents"]),
                "card_fee_cents": str(quote["card_fee_cents"]),
                "method_type": token["method_type"] or "",
                "card_brand": token["card_brand"] or "",
            },
            idempotency_key=f"show-payment-{show_entry.id}-{token['id']}",
            receipt_email=payer.email if payer else None,
            stripe_account=company.stripe_account_id,
        )
    except stripe_gateway.PaymentError as exc:
        raise HTTPException(402, exc.message)

    await _settle_show_intent(db, show_entry, company, intent)
    return payment_result(intent, quote["total_cents"])


@router.post("/my-shows/{show_id}/payment/status", response_model=PaymentResultOut)
async def show_payment_status(
    show_id: UUID,
    body: PaymentStatusIn,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """After the bank asked the payer to confirm, look the payment up and
    record it if it went through -- so My Shows is right without waiting on
    the webhook."""
    stripe_gateway.require_configured()
    ctx = await _context(show_id, user_id, db)
    if ctx.company is None or not ctx.company.stripe_account_id:
        raise HTTPException(409, NOT_AT_THIS_SHOW)
    try:
        intent = await stripe_gateway.run(
            stripe_gateway.retrieve_payment, body.payment_intent_id, ctx.company.stripe_account_id
        )
    except stripe_gateway.PaymentError as exc:
        raise HTTPException(400, exc.message)
    metadata = intent.get("metadata") or {}
    if metadata.get("exhibitor_id") != str(ctx.exhibitor.id) or metadata.get("show_id") != str(show_id):
        raise HTTPException(404, "That payment is not yours.")
    await _settle_show_intent(db, ctx.show_entry, ctx.company, intent)
    return payment_result(intent, int(intent.get("amount") or 0))
