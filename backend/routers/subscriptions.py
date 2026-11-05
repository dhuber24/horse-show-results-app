"""Manage Subscriptions: what GaitDesk sells, to whom, and what it gives away.

GaitDesk admin only (migration 179). The screen quotes: a company's plan and
Pro+ years stay on `routers/show_companies.py`, its invoices on
`routers/company_billing.py` and a trainer's recorded date on
`routers/trainers.py`, and the screen posts to those. Three things live here
because nothing owned them:

  * **The list**: every company's money at a glance, read off the same usage
    statement and invoices its own page reads, and every trainer's plan.
  * **Comps and trials**: a plan or Pro given for free, for a time or for good.
  * **The prices**: a dated history (`subscription_prices.py`). A price can't
    start in the past, and a raise on a show company's plan takes the 30 days'
    notice the Terms promise, by email and on My Company.

And it is where an admin reaches a trainer's **card subscription**: read live
from Stripe, because the trainer can change it on Stripe's own portal.
"""
import logging
from datetime import date
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

import stripe_gateway
from database import get_db
from dependencies import require_admin, safe_uuid
from gaitdesk_invoices import company_money, usage_statement
from mailer import send_email, smtp_configured
from models import GaitDeskInvoice, Show, ShowCompany, SubscriptionPrice, Trainer
from routers.show_companies import _load, _respond
from schemas import (
    CompanyGrantIn,
    CompanySubscriptionOut,
    PriceChangeIn,
    PriceChangeOut,
    ShowCompanyOut,
    SubscriptionPriceOut,
    SubscriptionPriceRowOut,
    TrainerBillingOut,
    TrainerGrantIn,
    TrainerRenewalIn,
    TrainerSubscriptionOut,
)
from show_companies import (
    GRANT_NOTICE_DAYS,
    RENEWAL_NOTICE_DAYS,
    VERIFIED_BY_ADMIN,
    company_manager_emails,
    email_admins,
    end_grant,
    grant_email,
    grant_plan,
    price_notice_email,
    remove_verification,
    utc_today,
    verified_email,
    verify_company,
)
from subscription_prices import (
    PRICE_INFO,
    PRO_PLUS_ANNUAL,
    BASIC_RATE,
    PRO_RATE,
    change_refusal,
    history_for,
    is_raise,
    load_prices,
)
from trainer_registry import (
    PRO_NO_END,
    PRO_PLANS,
    card_change_email,
    card_state,
    grant_email as trainer_grant_email,
    is_pro,
    lead_recipient,
    pro_ending_soon,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/subscriptions", tags=["Subscriptions"], dependencies=[Depends(require_admin)])


# ── The list ──────────────────────────────────────────────────────────────────


@router.get("/companies", response_model=list[CompanySubscriptionOut])
async def company_subscriptions(db: AsyncSession = Depends(get_db)):
    """Each company's money and what is coming up. Only a company with a show has
    a statement to read, which is most of the cost saved: there is a company for
    every independent show manager, and most of them have run nothing."""
    today = utc_today()
    prices = await load_prices(db)
    companies = (
        await db.execute(
            select(ShowCompany).options(selectinload(ShowCompany.subscriptions), selectinload(ShowCompany.plan_changes))
        )
    ).scalars().all()
    with_shows = set(
        (await db.execute(select(Show.company_id).where(Show.company_id.is_not(None)).distinct())).scalars().all()
    )
    invoices: dict[UUID, list] = {}
    for row in (
        await db.execute(
            select(
                GaitDeskInvoice.company_id,
                GaitDeskInvoice.amount_cents,
                GaitDeskInvoice.due_on,
                GaitDeskInvoice.paid_on,
                GaitDeskInvoice.voided_at,
                GaitDeskInvoice.payment_pending_at,
            ).where(GaitDeskInvoice.company_id.is_not(None))
        )
    ).all():
        invoices.setdefault(row.company_id, []).append(row)

    out = []
    for company in companies:
        usage = await usage_statement(db, company, prices) if company.id in with_shows else None
        out.append(
            CompanySubscriptionOut(
                company_id=company.id,
                **company_money(
                    invoices.get(company.id, []),
                    usage,
                    company.settle_shows_from,
                    today,
                    company.subscriptions,
                    company.grants,
                    RENEWAL_NOTICE_DAYS,
                    GRANT_NOTICE_DAYS,
                ),
            )
        )
    return out


@router.post("/companies/{company_id}/verify", response_model=ShowCompanyOut)
async def verify_show_company(
    company_id: UUID,
    background: BackgroundTasks,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Say a company is who it says it is (migration 180), which lets its office
    reach anybody with a GaitDesk record. See `company_verification.py`."""
    company = await _load(db, company_id)
    subject, mail = verified_email(company.name)
    if verify_company(company, VERIFIED_BY_ADMIN, by=safe_uuid(x_user_id)):
        await db.commit()
        logger.info("Company verified: company=%s by user=%s", company_id, x_user_id)
        recipients = await company_manager_emails(db, company_id)
        if recipients:
            background.add_task(email_admins, recipients, subject, mail)
    return await _respond(db, await _load(db, company_id))


@router.delete("/companies/{company_id}/verify", response_model=ShowCompanyOut)
async def remove_show_company_verification(
    company_id: UUID,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Take verification away. A later payment does not put it back, and people it
    has already put on a roster stay there: this stops it reaching anybody new."""
    company = await _load(db, company_id)
    remove_verification(company)
    await db.commit()
    logger.info("Company verification removed: company=%s by user=%s", company_id, x_user_id)
    return await _respond(db, await _load(db, company_id))


def _trainer_row(trainer: Trainer, today: date) -> TrainerSubscriptionOut:
    request = trainer.pro_request
    return TrainerSubscriptionOut(
        id=trainer.id,
        name=trainer.name,
        business_name=trainer.business_name,
        email=lead_recipient(trainer),
        is_public=bool(trainer.is_public),
        is_pro=is_pro(trainer, today),
        pro_until=trainer.pro_until,
        pro_plan=trainer.pro_plan,
        pro_grant=trainer.pro_grant,
        pro_grant_note=trainer.pro_grant_note,
        pro_request_plan=request.plan if request else None,
        pro_requested_at=request.created_at if request else None,
        pays_by_card=bool(trainer.stripe_subscription_id),
        ending_soon=pro_ending_soon(trainer, today),
    )


async def _trainer(db: AsyncSession, trainer_id: UUID) -> Trainer:
    trainer = (
        await db.execute(
            select(Trainer)
            .where(Trainer.id == trainer_id)
            .options(selectinload(Trainer.user), selectinload(Trainer.pro_request))
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if trainer is None:
        raise HTTPException(404, "Trainer not found")
    return trainer


@router.get("/trainers", response_model=list[TrainerSubscriptionOut])
async def trainer_subscriptions(db: AsyncSession = Depends(get_db)):
    today = date.today()
    trainers = (
        await db.execute(
            select(Trainer)
            .options(selectinload(Trainer.user), selectinload(Trainer.pro_request))
            .order_by(Trainer.name)
        )
    ).scalars().all()
    return [_trainer_row(t, today) for t in trainers]


# ── Comps and trials ──────────────────────────────────────────────────────────


@router.post("/companies/{company_id}/grants", response_model=ShowCompanyOut, status_code=201)
async def give_company_plan(
    company_id: UUID,
    body: CompanyGrantIn,
    background: BackgroundTasks,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Give a company Basic or Pro for free, and tell its show managers."""
    company = await _load(db, company_id)
    grant = grant_plan(
        company,
        plan=body.plan,
        kind=body.kind,
        starts_on=body.starts_on or utc_today(),
        ends_on=body.ends_on,
        note=body.note,
        granted_by=safe_uuid(x_user_id),
    )
    await db.commit()
    logger.info(
        "Plan given: company=%s plan=%s kind=%s %s to %s by user=%s",
        company_id, grant.plan, grant.kind, grant.starts_on, grant.ends_on, x_user_id,
    )
    recipients = await company_manager_emails(db, company_id)
    if recipients:
        subject, mail = grant_email(company.name, grant, company.plan, prices=await load_prices(db))
        background.add_task(email_admins, recipients, subject, mail)
    return await _respond(db, await _load(db, company_id))


@router.post("/companies/{company_id}/grants/{grant_id}/end", response_model=ShowCompanyOut)
async def end_company_plan(
    company_id: UUID,
    grant_id: UUID,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """End a comp or trial now. Shows that started while it ran stay covered."""
    company = await _load(db, company_id)
    grant = next((g for g in company.grants if g.id == grant_id), None)
    if grant is None:
        raise HTTPException(404, "That comp or trial isn't on this company.")
    logger.info(
        "Plan given ended: company=%s plan=%s kind=%s %s to %s by user=%s",
        company_id, grant.plan, grant.kind, grant.starts_on, grant.ends_on, x_user_id,
    )
    end_grant(company, grant, utc_today())
    await db.commit()
    return await _respond(db, await _load(db, company_id))


async def _renews_by_card(trainer: Trainer) -> bool:
    if not trainer.stripe_subscription_id or not stripe_gateway.configured():
        return False
    try:
        subscription = await stripe_gateway.run(stripe_gateway.retrieve_subscription, trainer.stripe_subscription_id)
    except stripe_gateway.PaymentError as exc:
        raise HTTPException(502, exc.message)
    return card_state(subscription)["renews"]


@router.post("/trainers/{trainer_id}/grant", response_model=TrainerSubscriptionOut, status_code=201)
async def give_trainer_pro(
    trainer_id: UUID,
    body: TrainerGrantIn,
    background: BackgroundTasks,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Give a trainer Pro for free, and tell them. Refused while their card still
    renews, or it would go on charging for what they were just given; and it
    never cuts short a date they have paid for. It replaces an earlier comp or
    trial, so one can be extended by giving it again. Answers their request."""
    today = date.today()
    if body.kind == "trial" and body.ends_on is None:
        raise HTTPException(422, "A trial needs an end date.")
    if body.ends_on is not None and body.ends_on < today:
        raise HTTPException(422, "It can't end in the past.")
    trainer = await _trainer(db, trainer_id)
    if await _renews_by_card(trainer):
        raise HTTPException(
            409, f"{trainer.name} pays for Pro by card and it still renews. Stop the renewal first."
        )
    until = body.ends_on or PRO_NO_END
    if trainer.pro_grant is None and trainer.pro_until is not None and trainer.pro_until > until:
        raise HTTPException(409, f"{trainer.name} has already paid for Pro past that date.")
    trainer.pro_until = until
    trainer.pro_plan = None
    trainer.pro_grant = body.kind
    trainer.pro_grant_note = (body.note or "").strip() or None
    trainer.pro_grant_reminder_sent_at = None
    if trainer.pro_request:
        await db.delete(trainer.pro_request)
    await db.commit()
    logger.info("Pro given: trainer=%s kind=%s through %s by user=%s", trainer_id, body.kind, until, x_user_id)
    trainer = await _trainer(db, trainer_id)
    recipient = lead_recipient(trainer)
    if recipient:
        subject, mail = trainer_grant_email(body.kind, body.ends_on)
        background.add_task(send_email, recipient, subject, mail)
    return _trainer_row(trainer, today)


# ── A trainer's card subscription ─────────────────────────────────────────────


async def _pro_prices(db: AsyncSession) -> dict[str, int]:
    prices = await load_prices(db)
    today = date.today()
    return {plan: prices.trainer(plan, today) for plan in PRO_PLANS}


@router.get("/trainers/{trainer_id}/billing", response_model=TrainerBillingOut)
async def trainer_billing(trainer_id: UUID, db: AsyncSession = Depends(get_db)):
    """How a trainer's Pro is paid for, with their card subscription as Stripe has
    it now. Stripe being unreachable is said, not an error: the rest of the
    admin's panel still works."""
    trainer = await _trainer(db, trainer_id)
    out = TrainerBillingOut(
        pays_by_card=bool(trainer.stripe_subscription_id),
        can_manage=stripe_gateway.configured(),
        pro_grant=trainer.pro_grant,
        pro_grant_note=trainer.pro_grant_note,
        pro_prices=await _pro_prices(db),
    )
    if trainer.stripe_subscription_id and stripe_gateway.configured():
        try:
            state = card_state(
                await stripe_gateway.run(stripe_gateway.retrieve_subscription, trainer.stripe_subscription_id)
            )
            out = out.model_copy(update=state)
        except stripe_gateway.PaymentError:
            out = out.model_copy(update={"read_failed": True})
    return out


@router.put("/trainers/{trainer_id}/billing/renewal", response_model=TrainerBillingOut)
async def set_trainer_renewal(
    trainer_id: UUID,
    body: TrainerRenewalIn,
    background: BackgroundTasks,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Stop a trainer's card subscription renewing, or turn it back on, and tell
    them. Pro stays on through the date paid for either way. Nothing is stored:
    Stripe holds whether it renews."""
    stripe_gateway.require_configured()
    trainer = await _trainer(db, trainer_id)
    if not trainer.stripe_subscription_id:
        raise HTTPException(409, f"{trainer.name} has no card subscription.")
    try:
        state = card_state(
            await stripe_gateway.run(
                stripe_gateway.set_subscription_renewal, trainer.stripe_subscription_id, body.renews
            )
        )
    except stripe_gateway.PaymentError as exc:
        raise HTTPException(502, exc.message)
    logger.info("Trainer Pro renewal set: trainer=%s renews=%s by user=%s", trainer_id, body.renews, x_user_id)
    recipient = lead_recipient(trainer)
    if recipient:
        subject, mail = card_change_email("resumed" if body.renews else "stopped", state["period_end"])
        background.add_task(send_email, recipient, subject, mail)
    return TrainerBillingOut(
        pays_by_card=True,
        can_manage=True,
        pro_grant=trainer.pro_grant,
        pro_grant_note=trainer.pro_grant_note,
        pro_prices=await _pro_prices(db),
        **state,
    )


# ── The prices ────────────────────────────────────────────────────────────────


async def _price_list(db: AsyncSession) -> list[SubscriptionPriceOut]:
    today = utc_today()
    prices = await load_prices(db)
    rows = (
        await db.execute(select(SubscriptionPrice).options(selectinload(SubscriptionPrice.set_by)))
    ).scalars().all()
    out = []
    for key, info in PRICE_INFO.items():
        upcoming = prices.upcoming(key, today)
        out.append(
            SubscriptionPriceOut(
                key=key,
                label=info.label,
                per=info.per,
                audience=info.audience,
                minimum_cents=info.minimum_cents,
                raise_needs_notice=info.raise_needs_notice,
                current_cents=prices.cents(key, today),
                upcoming_cents=upcoming[1] if upcoming else None,
                upcoming_on=upcoming[0] if upcoming else None,
                history=[
                    SubscriptionPriceRowOut(
                        id=row.id,
                        amount_cents=row.amount_cents,
                        effective_on=row.effective_on,
                        created_at=row.created_at,
                        set_by_name=row.set_by.full_name if row.set_by else None,
                        scheduled=row.effective_on > today,
                    )
                    for row in history_for(rows, key)
                ],
            )
        )
    return out


@router.get("/prices", response_model=list[SubscriptionPriceOut])
async def list_prices(db: AsyncSession = Depends(get_db)):
    return await _price_list(db)


async def _companies_to_notify(db: AsyncSession, key: str) -> list[ShowCompany]:
    """Who a raise reaches: the companies on that plan, or renewing Pro+. A
    company that picks the plan later is shown the coming price when it chooses."""
    query = select(ShowCompany)
    if key == PRO_PLUS_ANNUAL:
        query = query.where(ShowCompany.renews_pro_plus.is_(True))
    else:
        plan = {BASIC_RATE: "basic", PRO_RATE: "pro"}[key]
        query = query.where(ShowCompany.plan == plan, ShowCompany.renews_pro_plus.is_(False))
    return list((await db.execute(query)).scalars().all())


@router.post("/prices", response_model=PriceChangeOut, status_code=201)
async def change_price(
    body: PriceChangeIn,
    background: BackgroundTasks,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Set a price from a day on, today by default. A raise on a show company's
    plan emails every company it reaches, best-effort like all mail, so the
    answer says how many and whether mail is set up at all: it is the notice the
    Terms promise, and without SMTP somebody has to give it another way."""
    today = utc_today()
    effective_on = body.effective_on or today
    prices = await load_prices(db)
    refusal = change_refusal(prices, body.key, body.amount_cents, effective_on, today)
    if refusal:
        raise HTTPException(422, refusal)
    notify = PRICE_INFO[body.key].raise_needs_notice and is_raise(prices, body.key, body.amount_cents, effective_on)
    old_cents = prices.cents(body.key, effective_on)
    db.add(
        SubscriptionPrice(
            key=body.key,
            amount_cents=body.amount_cents,
            effective_on=effective_on,
            set_by_user_id=safe_uuid(x_user_id),
        )
    )
    await db.commit()
    logger.warning(
        "Price changed: %s from %d to %d on %s by user=%s", body.key, old_cents, body.amount_cents, effective_on, x_user_id
    )
    notified = 0
    if notify:
        for company in await _companies_to_notify(db, body.key):
            recipients = await company_manager_emails(db, company.id)
            if not recipients:
                continue
            subject, mail = price_notice_email(company.name, body.key, old_cents, body.amount_cents, effective_on)
            background.add_task(email_admins, recipients, subject, mail)
            notified += 1
    return PriceChangeOut(
        prices=await _price_list(db),
        notice_needed=notify,
        companies_notified=notified,
        mail_configured=smtp_configured(),
    )


@router.delete("/prices/{price_id}", response_model=list[SubscriptionPriceOut])
async def cancel_scheduled_price(
    price_id: UUID,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Cancel a price change before its day comes. One already in force stays:
    the history is what shows are priced from. Nobody is emailed that a raise was
    called off; it reads off My Company on the next visit."""
    row = await db.get(SubscriptionPrice, price_id)
    if row is None:
        raise HTTPException(404, "That price isn't on file.")
    if row.effective_on <= utc_today():
        raise HTTPException(409, "That price is already in force. Set a new one instead.")
    logger.warning(
        "Scheduled price cancelled: %s %d on %s by user=%s", row.key, row.amount_cents, row.effective_on, x_user_id
    )
    await db.delete(row)
    await db.commit()
    return await _price_list(db)
