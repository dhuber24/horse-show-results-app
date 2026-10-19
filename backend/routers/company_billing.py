"""A show company and money, both ways (migration 172).

**What GaitDesk invoices the company** -- `/show-companies/{id}/invoices`, a
GaitDesk admin's: issue an invoice off the usage statement (net 30), void one,
or record a check or wire. See `gaitdesk_invoices.py` for the rules.

**The company paying it** -- `/my-company/{id}/invoices`, its own managers and
secretaries: by bank (ACH) for the invoice amount, or by credit card with the
processing fee added (`billing.payment_quote`). A debit or prepaid card is
never surcharged. Paid on GaitDesk's own Stripe account.

**Buying Pro+** -- `/my-company/{id}/pro-plus` (migration 173): the year is
paid for when it is bought, by card (fee added) or bank, and starts when the
payment succeeds (`payment_events.apply_pro_plus_purchase`).

**Settling up after a show** -- `/my-company/{id}/settle-up` (migration 173):
the finished shows that stop the company setting up another until they are
paid, and an invoice for them on request, to pay here or by check.

**The company taking exhibitors' payments** -- `/my-company/{id}/online-
payments`: connect its own Stripe account (one it owns -- full Stripe Dashboard, signs
in to and is paid out from), and choose whether credit card payers pay the
processing fee or the company absorbs it. A GaitDesk Pro feature
(`online_payments`). GaitDesk takes nothing from these payments; it invoices
the company separately, after the show.

Every payment is confirmed on the server from a Stripe ConfirmationToken:
the browser collects the card or bank details, the server reads off the token
what kind of card it is, quotes the fee, and charges the quoted total -- so
whether a fee applies is never the browser's to say.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import stripe_gateway
from billing import CARD_FEE_CAP_BP, invoice_due_on, payment_quote
from database import get_db
from dependencies import require_admin, require_admin_or_show_admin, safe_uuid
from gaitdesk_invoices import (
    InvoiceRefused,
    invoice_email,
    invoice_lines,
    invoice_out,
    invoiced_for_company,
    issue_settle_up_invoice,
    load_company_for_usage,
    settle_up_message,
    unsettled_shows,
)
from mailer import public_app_url
from models import GaitDeskInvoice, GaitDeskInvoiceLine, ShowCompanySubscription, User
from payment_events import (
    KIND_GAITDESK_INVOICE,
    KIND_PRO_PLUS,
    apply_invoice_payment,
    apply_pro_plus_purchase,
    invoice_label,
    mail_pro_plus_started,
    mark_invoice_paid,
)
from routers.my_company import _caller, _my_company
from routers.payments import payment_result
from routers.show_companies import _load, usage_statement
from schemas import (
    GaitDeskInvoiceCreate,
    GaitDeskInvoiceOut,
    GaitDeskInvoicePaymentIn,
    OnlinePaymentsOut,
    OnlinePaymentsSettingsIn,
    PaymentQuoteOut,
    PaymentResultOut,
    PaymentSetupOut,
    PaymentTokenIn,
    ProPlusOfferOut,
    SettleUpOut,
    SettleUpShowOut,
)
from show_companies import (
    PLANS,
    PRO_PLUS,
    RENEWAL_NOTICE_DAYS,
    covering_subscription,
    next_pro_plus_term,
    ONLINE_PAYMENTS,
    company_features,
    company_manager_emails,
    email_admins,
    feature_not_enabled_message,
    utc_today,
)

logger = logging.getLogger(__name__)

admin_router = APIRouter(
    prefix="/show-companies",
    tags=["GaitDesk Invoices"],
    dependencies=[Depends(require_admin)],
)

company_router = APIRouter(
    prefix="/my-company",
    tags=["My Company Billing"],
    dependencies=[Depends(require_admin_or_show_admin)],
)


class CheckoutLinkOut(BaseModel):
    url: str


class PaymentStatusIn(BaseModel):
    payment_intent_id: str = Field(min_length=3, max_length=255)


# ── Loading ───────────────────────────────────────────────────────────────────


async def _company_invoices(db: AsyncSession, company_id: UUID, include_void: bool) -> list[GaitDeskInvoice]:
    query = select(GaitDeskInvoice).where(GaitDeskInvoice.company_id == company_id)
    if not include_void:
        query = query.where(GaitDeskInvoice.voided_at.is_(None))
    query = query.order_by(GaitDeskInvoice.issued_on.desc(), GaitDeskInvoice.number.desc())
    return list((await db.execute(query.execution_options(populate_existing=True))).scalars().all())


async def _invoice(db: AsyncSession, company_id: UUID, invoice_id: UUID) -> GaitDeskInvoice:
    invoice = (
        await db.execute(
            select(GaitDeskInvoice)
            .where(GaitDeskInvoice.id == invoice_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if invoice is None or invoice.company_id != company_id:
        raise HTTPException(404, "Invoice not found")
    return invoice


def _refuse_unless_open(invoice: GaitDeskInvoice) -> None:
    if invoice.voided_at is not None:
        raise HTTPException(409, f"Invoice {invoice_label(invoice)} was cancelled.")
    if invoice.paid_on is not None:
        raise HTTPException(409, f"Invoice {invoice_label(invoice)} is already paid.")
    if invoice.payment_pending_at is not None:
        raise HTTPException(
            409,
            f"A bank payment on invoice {invoice_label(invoice)} is already on its way. "
            "It takes a few business days to settle.",
        )


async def _years(db: AsyncSession, invoice: GaitDeskInvoice) -> list[ShowCompanySubscription]:
    ids = [line.subscription_id for line in invoice.lines if line.subscription_id]
    if not ids:
        return []
    return list(
        (await db.execute(select(ShowCompanySubscription).where(ShowCompanySubscription.id.in_(ids)))).scalars().all()
    )


# ── GaitDesk's side: issuing invoices ─────────────────────────────────────────


@admin_router.get("/{company_id}/invoices", response_model=list[GaitDeskInvoiceOut])
async def list_invoices(company_id: UUID, db: AsyncSession = Depends(get_db)):
    """Every invoice issued to the company, void ones included, newest first."""
    await _load(db, company_id)
    today = utc_today()
    return [invoice_out(i, today) for i in await _company_invoices(db, company_id, include_void=True)]


@admin_router.post("/{company_id}/invoices", response_model=GaitDeskInvoiceOut, status_code=201)
async def issue_invoice(
    company_id: UUID,
    body: GaitDeskInvoiceCreate,
    background: BackgroundTasks,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Issue an invoice for shows and Pro+ years off the usage statement, due
    30 days from its issue date. Each line is priced by the statement as it
    stands now. The company's show managers are emailed it."""
    company = await _load(db, company_id)
    today = utc_today()
    usage = await usage_statement(db, company)
    try:
        lines = invoice_lines(
            usage, body.show_ids, body.subscription_ids, await invoiced_for_company(db, company_id), today
        )
    except InvoiceRefused as exc:
        raise HTTPException(409, str(exc))
    issued_on = body.issued_on or today
    invoice = GaitDeskInvoice(
        company_id=company.id,
        company_name=company.name,
        issued_on=issued_on,
        due_on=invoice_due_on(issued_on),
        amount_cents=sum(line["amount_cents"] for line in lines),
        note=(body.note or "").strip() or None,
        issued_by_user_id=safe_uuid(x_user_id),
        lines=[GaitDeskInvoiceLine(**line) for line in lines],
    )
    db.add(invoice)
    await db.commit()
    invoice = await _invoice(db, company_id, invoice.id)
    logger.info("GaitDesk invoice issued: %s company=%s amount_cents=%d", invoice_label(invoice), company_id, invoice.amount_cents)

    recipients = await company_manager_emails(db, company_id)
    if recipients:
        subject, mail = invoice_email(invoice, invoice.lines, pay_online=stripe_gateway.configured())
        background.add_task(email_admins, recipients, subject, mail)
    return invoice_out(invoice, today)


@admin_router.post("/{company_id}/invoices/{invoice_id}/void", response_model=GaitDeskInvoiceOut)
async def void_invoice(company_id: UUID, invoice_id: UUID, db: AsyncSession = Depends(get_db)):
    """Cancel an invoice issued in error. Its shows and Pro+ years may then be
    invoiced again. A paid invoice is never voided -- the money moved -- and
    nor is one with a bank payment on its way."""
    invoice = await _invoice(db, company_id, invoice_id)
    if invoice.paid_on is not None:
        raise HTTPException(409, "A paid invoice cannot be cancelled. Refund the payment first.")
    if invoice.payment_pending_at is not None:
        raise HTTPException(409, "A bank payment on this invoice is on its way. Wait for it to settle or fail.")
    if invoice.voided_at is None:
        invoice.voided_at = datetime.now(timezone.utc)
        await db.commit()
        logger.info("GaitDesk invoice voided: %s", invoice_label(invoice))
    return invoice_out(await _invoice(db, company_id, invoice_id), utc_today())


@admin_router.post("/{company_id}/invoices/{invoice_id}/payment", response_model=GaitDeskInvoiceOut)
async def record_invoice_payment(
    company_id: UUID,
    invoice_id: UUID,
    body: GaitDeskInvoicePaymentIn,
    db: AsyncSession = Depends(get_db),
):
    """Mark an invoice paid for money that did not come through the app -- a
    check, a wire. Marks each Pro+ year on it paid too."""
    invoice = await _invoice(db, company_id, invoice_id)
    _refuse_unless_open(invoice)
    mark_invoice_paid(
        invoice,
        await _years(db, invoice),
        paid_on=body.paid_on or utc_today(),
        method=body.method,
        reference=(body.reference or "").strip() or None,
    )
    await db.commit()
    logger.info("GaitDesk invoice marked paid by hand: %s method=%s", invoice_label(invoice), body.method)
    return invoice_out(await _invoice(db, company_id, invoice_id), utc_today())


# ── The company's side: paying an invoice ─────────────────────────────────────


@company_router.get("/{company_id}/invoices", response_model=list[GaitDeskInvoiceOut])
async def my_invoices(
    company_id: UUID,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The company's invoices from GaitDesk, newest first. A voided invoice
    is not shown: it is not owed, and it was never anything but a mistake."""
    caller = _caller(x_user_id, x_user_role)
    await _my_company(company_id, caller, db)
    today = utc_today()
    return [invoice_out(i, today) for i in await _company_invoices(db, company_id, include_void=False)]


@company_router.get("/{company_id}/invoices/{invoice_id}/payment", response_model=PaymentSetupOut)
async def invoice_payment_setup(
    company_id: UUID,
    invoice_id: UUID,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """What the browser needs to draw the payment form for one invoice."""
    stripe_gateway.require_configured()
    caller = _caller(x_user_id, x_user_role)
    await _my_company(company_id, caller, db)
    invoice = await _invoice(db, company_id, invoice_id)
    _refuse_unless_open(invoice)
    percent_bp, fixed_cents = stripe_gateway.card_rate()
    return PaymentSetupOut(
        publishable_key=stripe_gateway.publishable_key(),
        amount_cents=invoice.amount_cents,
        pass_card_fees=True,
        card_percent_bp=percent_bp,
        card_fixed_cents=fixed_cents,
        card_fee_cap_bp=CARD_FEE_CAP_BP,
    )


async def _quote_invoice(invoice: GaitDeskInvoice, token_id: str) -> tuple[dict, dict]:
    try:
        token = await stripe_gateway.run(stripe_gateway.confirmation_token, token_id)
    except stripe_gateway.PaymentError as exc:
        raise HTTPException(400, exc.message)
    percent_bp, fixed_cents = stripe_gateway.card_rate()
    # GaitDesk always passes the card fee on to a show company: they chose to
    # pay by card rather than by bank.
    quote = payment_quote(
        invoice.amount_cents, token["method_type"], token["card_funding"], True, percent_bp, fixed_cents
    )
    return token, quote


@company_router.post("/{company_id}/invoices/{invoice_id}/quote", response_model=PaymentQuoteOut)
async def quote_invoice_payment(
    company_id: UUID,
    invoice_id: UUID,
    body: PaymentTokenIn,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """What paying this invoice with the method entered costs: the invoice,
    plus the processing fee for a credit card. Nothing is charged."""
    stripe_gateway.require_configured()
    caller = _caller(x_user_id, x_user_role)
    await _my_company(company_id, caller, db)
    invoice = await _invoice(db, company_id, invoice_id)
    _refuse_unless_open(invoice)
    token, quote = await _quote_invoice(invoice, body.confirmation_token)
    return PaymentQuoteOut(**quote, method_type=token["method_type"], card_funding=token["card_funding"])


@company_router.post("/{company_id}/invoices/{invoice_id}/pay", response_model=PaymentResultOut)
async def pay_invoice(
    company_id: UUID,
    invoice_id: UUID,
    body: PaymentTokenIn,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Pay the invoice with the method entered, at the total quoted for it."""
    stripe_gateway.require_configured()
    caller = _caller(x_user_id, x_user_role)
    await _my_company(company_id, caller, db)
    invoice = await _invoice(db, company_id, invoice_id)
    _refuse_unless_open(invoice)
    token, quote = await _quote_invoice(invoice, body.confirmation_token)
    if body.expected_total_cents is not None and body.expected_total_cents != quote["total_cents"]:
        raise HTTPException(409, "The amount to pay changed. Check the total and pay again.")

    payer = await db.get(User, caller)
    try:
        intent = await stripe_gateway.run(
            stripe_gateway.create_payment,
            amount_cents=quote["total_cents"],
            token_id=token["id"],
            return_url=f"{public_app_url()}/admin/my-company?invoice={invoice.id}",
            description=f"GaitDesk invoice {invoice_label(invoice)} - {invoice.company_name}",
            metadata={
                "kind": KIND_GAITDESK_INVOICE,
                "invoice_id": str(invoice.id),
                "company_id": str(company_id),
                "amount_cents": str(quote["amount_cents"]),
                "card_fee_cents": str(quote["card_fee_cents"]),
                "method_type": token["method_type"] or "",
                "card_brand": token["card_brand"] or "",
            },
            idempotency_key=f"gaitdesk-invoice-{invoice.id}-{token['id']}",
            receipt_email=payer.email if payer else None,
        )
    except stripe_gateway.PaymentError as exc:
        raise HTTPException(402, exc.message)

    await _settle_invoice_intent(db, invoice, intent)
    return payment_result(intent, quote["total_cents"])


async def _settle_invoice_intent(db: AsyncSession, invoice: GaitDeskInvoice, intent: dict) -> None:
    """Write down where a payment on an invoice stands right now. A card that
    succeeded is paid at once -- the webhook confirms it later and changes
    nothing -- and a bank payment holds the invoice as processing until it
    settles or fails, from the moment it starts: a bank account typed in by
    hand waits on its microdeposit first, and the invoice must not be paid a
    second time meanwhile."""
    invoice.stripe_payment_intent_id = intent["id"]
    if intent.get("status") == "succeeded":
        await apply_invoice_payment(intent, db)
    elif stripe_gateway.on_its_way(intent):
        invoice.payment_pending_at = invoice.payment_pending_at or datetime.now(timezone.utc)
    await db.commit()


@company_router.post("/{company_id}/invoices/{invoice_id}/payment-status", response_model=GaitDeskInvoiceOut)
async def invoice_payment_status(
    company_id: UUID,
    invoice_id: UUID,
    body: PaymentStatusIn,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """After the bank asked the payer to confirm, look the payment up and
    write down where it stands -- so the page is right without waiting on the
    webhook."""
    stripe_gateway.require_configured()
    caller = _caller(x_user_id, x_user_role)
    await _my_company(company_id, caller, db)
    invoice = await _invoice(db, company_id, invoice_id)
    if invoice.paid_on is None and invoice.voided_at is None:
        try:
            intent = await stripe_gateway.run(stripe_gateway.retrieve_payment, body.payment_intent_id)
        except stripe_gateway.PaymentError as exc:
            raise HTTPException(400, exc.message)
        if (intent.get("metadata") or {}).get("invoice_id") != str(invoice.id):
            raise HTTPException(404, "That payment is not for this invoice.")
        await _settle_invoice_intent(db, invoice, intent)
    return invoice_out(await _invoice(db, company_id, invoice_id), utc_today())


# ── The company's side: taking exhibitors' payments ───────────────────────────


def _online_payments_out(company) -> OnlinePaymentsOut:
    percent_bp, fixed_cents = stripe_gateway.card_rate()
    return OnlinePaymentsOut(
        configured=stripe_gateway.configured(),
        plan_allows=ONLINE_PAYMENTS in company_features(company),
        connected=bool(company.stripe_account_id),
        charges_enabled=bool(company.stripe_charges_enabled),
        details_submitted=bool(company.stripe_account_id) and bool(company.stripe_charges_enabled),
        pass_card_fees=bool(company.pass_card_fees),
        card_percent_bp=percent_bp,
        card_fixed_cents=fixed_cents,
        card_fee_cap_bp=CARD_FEE_CAP_BP,
    )


@company_router.get("/{company_id}/online-payments", response_model=OnlinePaymentsOut)
async def online_payments(
    company_id: UUID,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Whether the company takes exhibitors' payments online yet. While its
    Stripe account is still being set up, this asks Stripe -- the webhook
    says the same thing, but the manager has just come back from Stripe and is
    looking at this screen now."""
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    out = _online_payments_out(company)
    if company.stripe_account_id and not company.stripe_charges_enabled and stripe_gateway.configured():
        try:
            account = await stripe_gateway.run(stripe_gateway.retrieve_account, company.stripe_account_id)
        except stripe_gateway.PaymentError:
            logger.warning("Could not read Stripe account %s", company.stripe_account_id)
        else:
            company.stripe_charges_enabled = account["charges_enabled"]
            await db.commit()
            out = _online_payments_out(company).model_copy(
                update={"details_submitted": account["details_submitted"], "details_due": account["details_due"]}
            )
    return out


@company_router.post("/{company_id}/online-payments/connect", response_model=CheckoutLinkOut)
async def connect_stripe(
    company_id: UUID,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Start, or carry on, setting up the company's own Stripe account: returns
    Stripe's sign-up page to send the manager to. The account is the
    company's -- Stripe pays it out to the company's bank and bills it the
    processing fees -- and GaitDesk only asks it to take payments."""
    stripe_gateway.require_configured()
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    if ONLINE_PAYMENTS not in company_features(company):
        raise HTTPException(403, feature_not_enabled_message(ONLINE_PAYMENTS))
    try:
        if not company.stripe_account_id:
            user = await db.get(User, caller)
            company.stripe_account_id = await stripe_gateway.run(
                stripe_gateway.create_connected_account,
                user.email if user else None,
                company.name,
                {"company_id": str(company.id)},
            )
            await db.commit()
            logger.info("Stripe account %s created for company %s", company.stripe_account_id, company.id)
        # Stripe sends the manager to `refresh` when this link has expired or
        # was already opened; My Company then makes a new one and carries on.
        # The company is named because a manager may work for several.
        url = await stripe_gateway.run(
            stripe_gateway.create_onboarding_link,
            company.stripe_account_id,
            f"{public_app_url()}/admin/my-company?stripe=refresh&company={company.id}",
            f"{public_app_url()}/admin/my-company?stripe=return&company={company.id}",
        )
    except stripe_gateway.PaymentError as exc:
        raise HTTPException(502, exc.message)
    return CheckoutLinkOut(url=url)


@company_router.put("/{company_id}/online-payments/settings", response_model=OnlinePaymentsOut)
async def online_payment_settings(
    company_id: UUID,
    body: OnlinePaymentsSettingsIn,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Who pays the card processing fee on an exhibitor's online payment: the
    credit card payer, on top of their balance, or the company. Debit cards
    and bank payments are never charged a fee either way.

    Turning the fee on is the company confirming it may surcharge where it
    does business -- some states forbid or cap it, and the company is the
    merchant -- so it must agree to switch it on."""
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    if body.pass_card_fees and not company.pass_card_fees and not body.agree_surcharge_rules:
        raise HTTPException(
            422,
            "Confirm that card surcharges are allowed where your company does business before passing the fee on.",
        )
    company.pass_card_fees = body.pass_card_fees
    await db.commit()
    logger.info("Company %s card fee passed on: %s", company.id, company.pass_card_fees)
    return _online_payments_out(company)


# ── Settling up after a show (migration 173) ──────────────────────────────────


async def _settle_up(db: AsyncSession, company_id: UUID) -> SettleUpOut:
    company = await load_company_for_usage(db, company_id)
    if company is None:
        raise HTTPException(404, "Show company not found")
    shows = unsettled_shows(await usage_statement(db, company), company.settle_shows_from, utc_today())
    return SettleUpOut(
        blocked=bool(shows),
        message=settle_up_message(company.name, shows) if shows else None,
        shows=[
            SettleUpShowOut(
                show_id=line.show_id,
                show_name=line.show_name,
                end_date=line.end_date,
                exhibitor_count=line.exhibitor_count,
                rate_cents=line.rate_cents,
                amount_cents=line.amount_cents,
                billing_plan_label=line.billing_plan_label,
                invoice_id=line.invoice_id,
                invoice_label=line.invoice_label,
            )
            for line in shows
        ],
        can_issue_invoice=any(line.invoice_id is None for line in shows),
    )


@admin_router.get("/{company_id}/settle-up", response_model=SettleUpOut)
async def admin_settle_up(company_id: UUID, db: AsyncSession = Depends(get_db)):
    """Whether the company is held back from setting up a show, and by which
    finished shows. Marking their invoice paid releases it."""
    return await _settle_up(db, company_id)


@company_router.get("/{company_id}/settle-up", response_model=SettleUpOut)
async def my_settle_up(
    company_id: UUID,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The finished shows the company must pay for before it sets up another."""
    caller = _caller(x_user_id, x_user_role)
    await _my_company(company_id, caller, db)
    return await _settle_up(db, company_id)


@company_router.post("/{company_id}/settle-up/invoice", response_model=GaitDeskInvoiceOut, status_code=201)
async def request_settle_up_invoice(
    company_id: UUID,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Have an invoice issued now for every finished show not yet invoiced --
    to pay online straight away, or to send a check against. The same invoice
    a GaitDesk admin issues: priced by the usage statement, due in 30 days.
    The company stays held back until it is paid."""
    caller = _caller(x_user_id, x_user_role)
    await _my_company(company_id, caller, db)
    company = await load_company_for_usage(db, company_id)
    try:
        invoice = await issue_settle_up_invoice(db, company, caller)
    except InvoiceRefused as exc:
        raise HTTPException(409, str(exc))
    if invoice is None:
        raise HTTPException(409, "Every show to settle is already on an invoice. Pay it below.")
    await db.commit()
    invoice = await _invoice(db, company_id, invoice.id)
    logger.info("Settle-up invoice issued by the company: %s company=%s", invoice_label(invoice), company_id)
    return invoice_out(invoice, utc_today())


# ── Buying Pro+ (migration 173) ───────────────────────────────────────────────


def _pro_plus_price() -> int:
    return PLANS[PRO_PLUS].annual_cents


def _refuse_pro_plus(company) -> None:
    """A company buys one year at a time: not while a bank payment for one is
    on its way, and not once next year is already bought."""
    if company.pro_plus_payment_pending_at is not None:
        raise HTTPException(
            409, "A bank payment for Pro+ is already on its way. Your year starts when it settles."
        )
    today = utc_today()
    ahead = [t for t in company.subscriptions if t.starts_on > today]
    if ahead:
        last = max(ahead, key=lambda t: t.ends_on)
        raise HTTPException(409, f"Pro+ is already paid for through {_day(last.ends_on)}.")
    # A year in force renews only in its last month -- the same window the
    # renewal reminder opens -- so a second press is never a second year.
    current = covering_subscription(company.subscriptions, today)
    if current is not None and current.ends_on - timedelta(days=RENEWAL_NOTICE_DAYS) > today:
        opens = current.ends_on - timedelta(days=RENEWAL_NOTICE_DAYS)
        raise HTTPException(
            409,
            f"You're on Pro+ through {_day(current.ends_on)}. You can renew from {_day(opens)}.",
        )


def _day(value) -> str:
    return f"{value:%b} {value.day}, {value.year}"


@company_router.get("/{company_id}/pro-plus", response_model=ProPlusOfferOut)
async def pro_plus_offer(
    company_id: UUID,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """What buying Pro+ now costs and the year it would buy: from today, or
    from the day after the current year ends when it is a renewal."""
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    latest_end = max((t.ends_on for t in company.subscriptions), default=None)
    starts_on, ends_on = next_pro_plus_term(latest_end, utc_today())
    return ProPlusOfferOut(
        price_cents=_pro_plus_price(),
        starts_on=starts_on,
        ends_on=ends_on,
        can_buy_online=stripe_gateway.configured(),
        pending=company.pro_plus_payment_pending_at is not None,
    )


@company_router.get("/{company_id}/pro-plus/payment", response_model=PaymentSetupOut)
async def pro_plus_payment_setup(
    company_id: UUID,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    stripe_gateway.require_configured()
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    _refuse_pro_plus(company)
    percent_bp, fixed_cents = stripe_gateway.card_rate()
    return PaymentSetupOut(
        publishable_key=stripe_gateway.publishable_key(),
        amount_cents=_pro_plus_price(),
        pass_card_fees=True,
        card_percent_bp=percent_bp,
        card_fixed_cents=fixed_cents,
        card_fee_cap_bp=CARD_FEE_CAP_BP,
    )


async def _quote_pro_plus(token_id: str) -> tuple[dict, dict]:
    try:
        token = await stripe_gateway.run(stripe_gateway.confirmation_token, token_id)
    except stripe_gateway.PaymentError as exc:
        raise HTTPException(400, exc.message)
    percent_bp, fixed_cents = stripe_gateway.card_rate()
    quote = payment_quote(_pro_plus_price(), token["method_type"], token["card_funding"], True, percent_bp, fixed_cents)
    return token, quote


@company_router.post("/{company_id}/pro-plus/quote", response_model=PaymentQuoteOut)
async def quote_pro_plus(
    company_id: UUID,
    body: PaymentTokenIn,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """What a year of Pro+ costs with the method entered: the price, plus the
    processing fee for a credit card. Nothing is charged."""
    stripe_gateway.require_configured()
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    _refuse_pro_plus(company)
    token, quote = await _quote_pro_plus(body.confirmation_token)
    return PaymentQuoteOut(**quote, method_type=token["method_type"], card_funding=token["card_funding"])


async def _settle_pro_plus_intent(db: AsyncSession, company_id: UUID, intent: dict) -> None:
    """Write down where a Pro+ payment stands: a card that succeeded starts the
    year now (the webhook later changes nothing); a bank payment holds the
    company as pending until it settles or fails -- including while a bank
    account typed in by hand waits on its microdeposit, so a second year is
    not bought meanwhile."""
    if intent.get("status") == "succeeded":
        term = await apply_pro_plus_purchase(intent, db)
        await db.commit()
        if term is not None:
            await mail_pro_plus_started(db, company_id, term)
        return
    if stripe_gateway.on_its_way(intent):
        company = await _load(db, company_id)
        if company.pro_plus_payment_intent_id != intent["id"]:
            company.pro_plus_payment_intent_id = intent["id"]
            company.pro_plus_payment_pending_at = datetime.now(timezone.utc)
        await db.commit()


@company_router.post("/{company_id}/pro-plus/pay", response_model=PaymentResultOut)
async def buy_pro_plus(
    company_id: UUID,
    body: PaymentTokenIn,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Buy a year of Pro+, paid now, at the total quoted."""
    stripe_gateway.require_configured()
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    _refuse_pro_plus(company)
    token, quote = await _quote_pro_plus(body.confirmation_token)
    if body.expected_total_cents is not None and body.expected_total_cents != quote["total_cents"]:
        raise HTTPException(409, "The amount to pay changed. Check the total and pay again.")
    payer = await db.get(User, caller)
    try:
        intent = await stripe_gateway.run(
            stripe_gateway.create_payment,
            amount_cents=quote["total_cents"],
            token_id=token["id"],
            return_url=f"{public_app_url()}/admin/my-company?pro_plus=1",
            description=f"GaitDesk Pro+ year - {company.name}",
            metadata={
                "kind": KIND_PRO_PLUS,
                "company_id": str(company.id),
                "amount_cents": str(quote["amount_cents"]),
                "card_fee_cents": str(quote["card_fee_cents"]),
                "method_type": token["method_type"] or "",
                "card_brand": token["card_brand"] or "",
            },
            idempotency_key=f"pro-plus-{company.id}-{token['id']}",
            receipt_email=payer.email if payer else None,
        )
    except stripe_gateway.PaymentError as exc:
        raise HTTPException(402, exc.message)
    await _settle_pro_plus_intent(db, company.id, intent)
    return payment_result(intent, quote["total_cents"])


@company_router.post("/{company_id}/pro-plus/payment-status", response_model=PaymentResultOut)
async def pro_plus_payment_status(
    company_id: UUID,
    body: PaymentStatusIn,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """After the bank asked the payer to confirm, look the payment up and
    start the year if it went through."""
    stripe_gateway.require_configured()
    caller = _caller(x_user_id, x_user_role)
    await _my_company(company_id, caller, db)
    try:
        intent = await stripe_gateway.run(stripe_gateway.retrieve_payment, body.payment_intent_id)
    except stripe_gateway.PaymentError as exc:
        raise HTTPException(400, exc.message)
    metadata = intent.get("metadata") or {}
    if metadata.get("kind") != KIND_PRO_PLUS or metadata.get("company_id") != str(company_id):
        raise HTTPException(404, "That payment is not for this company's Pro+.")
    await _settle_pro_plus_intent(db, company_id, intent)
    return payment_result(intent, int(intent.get("amount") or 0))

