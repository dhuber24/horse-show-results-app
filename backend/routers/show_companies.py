"""Show companies: who they are, who works for them, and what they have paid for.

GaitDesk admin only: creating a company, any company's plan (Free included),
recording a Pro+ payment, and the billing notes. A company's own staff pick
Basic or Pro and manage their people from My Company. See `show_companies.py`.

The one way in that is not an admin's is the sign-up form (migration 143): an
independent gets a company of their own, and somebody who types an existing
organization's name leaves a **join request** here for an admin to answer.
Approving one is adding the member, which clears the request.

A company's own managers and secretaries manage their colleagues from **My
Company Staff** (`routers/my_company.py`), but **only an admin adds anybody**:
a company asking to add somebody, or approving a sign-up's request on its side,
leaves a join request here with who vouched for it (migration 149), and adding
the member answers it. Removing and leaving run through the same
`show_companies` functions as the buttons here. Features and notes stay here:
they stand for what somebody paid.

The other thing that waits here is an **upgrade request** (migration 144).
Since migration 169 a company picks Basic or Pro itself, so the one asked for
is Pro+, answered by starting a year (paid, owed or complimentary); an older request for a feature is
answered by moving the company onto a plan that includes it. There are no
per-feature switches since migration 170 -- a plan is the only way to one.

**The plan is set here too** (migration 168), and so is the usage statement
GaitDesk invoices a company from: each of its shows' exhibitors at the plan's
rate, priced by `billing.platform_usage`.
"""
import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
import stripe_gateway
from gaitdesk_invoices import invoice_email, issue_pro_plus_invoice, open_invoices_for_year, usage_statement
from payment_events import invoice_label, mark_invoice_paid
from dependencies import require_admin, safe_uuid
from models import (
    GaitDeskInvoice,
    Circuit,
    Show,
    PointSystem,
    ShowCompany,
    ShowCompanyCrew,
    ShowCompanyJoinRequest,
    ShowCompanyMember,
    ShowCompanyUpgradeRequest,
    ShowPointSystem,
    User,
)
from schemas import (
    CompanyUsageOut,
    PendingCompanyRequestsOut,
    ShowCompanyCreate,
    ShowCompanyFeatureOut,
    ShowCompanyJoinRequestOut,
    ShowCompanyMemberAdd,
    ShowCompanyMemberOut,
    ShowCompanyOut,
    ShowCompanyUpdate,
    ProPlusPaymentIn,
    ProPlusRecordIn,
    SubscriptionOut,
)
from show_companies import (
    FEATURES,
    PLANS,
    PRO_PLUS,
    REQUESTABLE,
    company_manager_emails,
    email_admins,
    loaded_effective_plan,
    next_pro_plus_term,
    plan_confirmation_email,
    plan_features,
    record_pro_plus,
    set_company_plan,
    utc_today,
    SHOW_OFFICE_ROLES,
    add_company_member,
    decline_join_request as decline_request,
    normalize_company_name,
    pin_company_shows,
    place_in_company,
    remove_company_member,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/show-companies",
    tags=["Show Companies"],
    dependencies=[Depends(require_admin)],
)

_LOAD = (
    selectinload(ShowCompany.members).selectinload(ShowCompanyMember.user),
    selectinload(ShowCompany.join_requests).selectinload(ShowCompanyJoinRequest.user),
    selectinload(ShowCompany.join_requests).selectinload(ShowCompanyJoinRequest.vouched_by),
    selectinload(ShowCompany.upgrade_requests).selectinload(ShowCompanyUpgradeRequest.requested_by),
    selectinload(ShowCompany.subscriptions),
    selectinload(ShowCompany.plan_changes),
    selectinload(ShowCompany.crew).selectinload(ShowCompanyCrew.user),
)


def _company_out(company: ShowCompany) -> ShowCompanyOut:
    members = sorted(
        (m for m in company.members if m.user is not None),
        key=lambda m: (m.user.last_name.lower(), m.user.first_name.lower()),
    )
    effective = loaded_effective_plan(company)
    included = plan_features(effective)
    plan = PLANS.get(company.plan) or PLANS["free"]
    asked_for = {r.feature: r for r in company.upgrade_requests}
    pro_plus_ask = asked_for.get(PRO_PLUS)
    requests = sorted(
        (r for r in company.join_requests if r.user is not None),
        key=lambda r: r.created_at or company.created_at,
    )
    return ShowCompanyOut(
        id=company.id,
        name=company.name,
        notes=company.notes,
        created_at=company.created_at,
        owner_user_id=company.owner_user_id,
        self_cancel_days_before=company.self_cancel_days_before or 0,
        plan=plan.key,
        plan_label=plan.label,
        plan_rate_cents=plan.rate_cents,
        effective_plan=effective,
        effective_plan_label=PLANS[effective].label,
        subscriptions=[SubscriptionOut.model_validate(t) for t in company.subscriptions],
        pro_plus_requested_at=pro_plus_ask.created_at if pro_plus_ask else None,
        pro_plus_requested_by_name=(
            pro_plus_ask.requested_by.full_name if pro_plus_ask and pro_plus_ask.requested_by else None
        ),
        pro_plus_requested_by_email=(
            pro_plus_ask.requested_by.email if pro_plus_ask and pro_plus_ask.requested_by else None
        ),
        join_requests=[
            ShowCompanyJoinRequestOut(
                user_id=r.user.id,
                full_name=r.user.full_name,
                email=r.user.email,
                role=r.user.role,
                requested_at=r.created_at,
                source=r.source or "signup",
                vouched_by_name=r.vouched_by.full_name if r.vouched_by else None,
                vouched_at=r.vouched_at,
            )
            for r in requests
        ],
        members=[
            ShowCompanyMemberOut(
                user_id=m.user.id,
                full_name=m.user.full_name,
                email=m.user.email,
                role=m.user.role,
                added_at=m.created_at,
            )
            for m in members
        ],
        # Every registered feature, in registry order, and whether today's plan
        # includes it -- the only way to one since migration 170.
        features=[
            ShowCompanyFeatureOut(
                key=feature.key,
                label=feature.label,
                description=feature.description,
                plan=feature.plan,
                enabled=feature.key in included,
                included_in_plan=feature.key in included,
                **_request_fields(asked_for.get(feature.key)),
            )
            for feature in FEATURES.values()
        ],
    )


def _request_fields(request: ShowCompanyUpgradeRequest | None) -> dict:
    """Who asked for a feature and when, for its row on the admin screens."""
    if request is None:
        return {}
    who = request.requested_by
    return {
        "requested_at": request.created_at,
        "requested_by_user_id": request.requested_by_user_id,
        "requested_by_name": who.full_name if who else None,
        "requested_by_email": who.email if who else None,
    }


async def _load(db: AsyncSession, company_id: UUID) -> ShowCompany:
    # populate_existing: every write path has the row in the identity map
    # already, and the options would otherwise be dropped (see CLAUDE.md).
    company = (
        await db.execute(
            select(ShowCompany)
            .where(ShowCompany.id == company_id)
            .options(*_LOAD)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if company is None:
        raise HTTPException(404, "Show company not found")
    return company


async def _assert_name_free(db: AsyncSession, name: str, except_id: UUID | None = None) -> None:
    """Only organizations need a unique name (migration 143): two independent
    people can both be called Sarah Johnson, and their companies with them."""
    query = select(ShowCompany.id).where(
        ShowCompany.owner_user_id.is_(None),
        func.lower(func.btrim(ShowCompany.name)) == name.lower(),
    )
    if except_id is not None:
        query = query.where(ShowCompany.id != except_id)
    if (await db.execute(query)).first() is not None:
        raise HTTPException(409, f"There is already a show company called {name}.")


def _require_name(value: str | None) -> str:
    name = normalize_company_name(value)
    if name is None:
        raise HTTPException(422, "A show company needs a name.")
    return name


def _clean_notes(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


@router.get("/", response_model=list[ShowCompanyOut])
async def list_companies(
    user_id: UUID | None = Query(None, description="Only the companies this account works for."),
    db: AsyncSession = Depends(get_db),
):
    query = select(ShowCompany).options(*_LOAD).order_by(func.lower(ShowCompany.name))
    if user_id is not None:
        query = query.join(ShowCompanyMember, ShowCompanyMember.company_id == ShowCompany.id).where(
            ShowCompanyMember.user_id == user_id
        )
    companies = (await db.execute(query)).scalars().unique().all()
    return [_company_out(c) for c in companies]


@router.post("/", response_model=ShowCompanyOut, status_code=201)
async def create_company(
    body: ShowCompanyCreate,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    name = _require_name(body.name)
    await _assert_name_free(db, name)
    company = ShowCompany(
        name=name,
        notes=_clean_notes(body.notes),
        created_by_user_id=safe_uuid(x_user_id),
    )
    db.add(company)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, f"There is already a show company called {name}.")
    return _company_out(await _load(db, company.id))


@router.get("/pending-requests", response_model=PendingCompanyRequestsOut)
async def pending_requests(db: AsyncSession = Depends(get_db)):
    """How much is waiting on a GaitDesk admin, for the count on the admin home.
    Declared before `/{company_id}`, which would otherwise take the path.

    An upgrade request for a feature the registry no longer names is not
    counted: nothing could answer it."""
    joins = await db.scalar(select(func.count()).select_from(ShowCompanyJoinRequest))
    upgrades = await db.scalar(
        select(func.count())
        .select_from(ShowCompanyUpgradeRequest)
        .where(ShowCompanyUpgradeRequest.feature.in_(list(REQUESTABLE)))
    )
    return PendingCompanyRequestsOut(join_requests=joins or 0, upgrade_requests=upgrades or 0)


@router.get("/{company_id}", response_model=ShowCompanyOut)
async def get_company(company_id: UUID, db: AsyncSession = Depends(get_db)):
    return _company_out(await _load(db, company_id))


@router.patch("/{company_id}", response_model=ShowCompanyOut)
async def update_company(
    company_id: UUID,
    body: ShowCompanyUpdate,
    background: BackgroundTasks,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    company = await _load(db, company_id)
    fields = body.model_fields_set
    if "name" in fields:
        name = _require_name(body.name)
        if company.owner_user_id is None:
            await _assert_name_free(db, name, except_id=company.id)
        company.name = name
    if "notes" in fields:
        company.notes = _clean_notes(body.notes)
    if "self_cancel_days_before" in fields:
        # A number, never a blank: 0 is how "until the show starts" is said.
        if body.self_cancel_days_before is None:
            raise HTTPException(422, "Say how many days before the show, or 0 for until it starts.")
        company.self_cancel_days_before = body.self_cancel_days_before
    plan_changed = False
    if "plan" in fields:
        if body.plan is None:
            raise HTTPException(422, "Choose GaitDesk Free, Basic or Pro.")
        # Logged, and answers every request for what it now includes, in the
        # same commit.
        plan_changed = set_company_plan(company, body.plan, safe_uuid(x_user_id), db)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "There is already a show company with that name.")
    company = await _load(db, company_id)
    if plan_changed:
        await _mail_plan(background, db, company)
    return _company_out(company)


async def _mail_plan(background: BackgroundTasks, db: AsyncSession, company: ShowCompany, term=None) -> None:
    """Tell the company's show managers the plan it is now on, after the
    response. Best-effort, like every email here; the plan is on My Company
    whether or not this arrives."""
    recipients = await company_manager_emails(db, company.id)
    if not recipients:
        return
    effective = loaded_effective_plan(company)
    subject, body = plan_confirmation_email(
        company.name,
        effective,
        term=(term.starts_on, term.ends_on) if term is not None else None,
        returns_to=company.plan,
    )
    background.add_task(email_admins, recipients, subject, body)


@router.post("/{company_id}/subscriptions", response_model=ShowCompanyOut, status_code=201)
async def start_pro_plus_year(
    company_id: UUID,
    body: ProPlusRecordIn,
    background: BackgroundTasks,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Start a Pro+ year for the company (migration 169) -- with its payment
    received, still owed (`payment_received: false`, marked paid later), or
    complimentary (a price of 0) (migration 171). The year is in force at once
    whichever it is. Mails the company's show managers.

    A year started still owed is invoiced at once (net 30), and the managers
    are emailed the invoice with a link that opens its payment on My Company
    -- Pro+ is paid for up front, so a year GaitDesk starts on credit is a
    bill, not a favour.

    Left blank, the year is the next one -- from today, or from the day after
    the current year ends, so a renewal paid early loses nothing."""
    company = await _load(db, company_id)
    if body.starts_on is not None:
        starts_on, ends_on = next_pro_plus_term(None, body.starts_on)
    else:
        latest_end = max((t.ends_on for t in company.subscriptions), default=None)
        starts_on, ends_on = next_pro_plus_term(latest_end, utc_today())
    term = record_pro_plus(
        company,
        starts_on=starts_on,
        ends_on=body.ends_on or ends_on,
        price_cents=PLANS[PRO_PLUS].annual_cents if body.price_cents is None else body.price_cents,
        payment_method=body.payment_method,
        payment_reference=body.payment_reference,
        recorded_by=safe_uuid(x_user_id),
        db=db,
        payment_received_on=utc_today() if body.payment_received else None,
    )
    await db.commit()
    company = await _load(db, company_id)
    await _mail_plan(background, db, company, term=term)
    if term.payment_received_on is None and term.price_cents > 0:
        invoice = await issue_pro_plus_invoice(db, company, term.id, safe_uuid(x_user_id))
        if invoice is not None:
            await db.commit()
            invoice = (
                await db.execute(
                    select(GaitDeskInvoice)
                    .where(GaitDeskInvoice.id == invoice.id)
                    .execution_options(populate_existing=True)
                )
            ).scalar_one()
            recipients = await company_manager_emails(db, company_id)
            if recipients:
                subject, mail = invoice_email(
                    invoice,
                    invoice.lines,
                    pay_online=stripe_gateway.configured(),
                    intro=(
                        f"GaitDesk has started a Pro+ year for {company.name}, and invoice "
                        f"{invoice_label(invoice)} is due for it."
                    ),
                )
                background.add_task(email_admins, recipients, subject, mail)
        company = await _load(db, company_id)
    return _company_out(company)


@router.patch("/{company_id}/subscriptions/{subscription_id}", response_model=ShowCompanyOut)
async def mark_pro_plus_paid(
    company_id: UUID,
    subscription_id: UUID,
    body: ProPlusPaymentIn,
    db: AsyncSession = Depends(get_db),
):
    """Mark a Pro+ year paid -- the money for a year started without it has
    arrived (migration 171). Changes nothing the company can use: the year was
    already in force."""
    company = await _load(db, company_id)
    term = next((t for t in company.subscriptions if t.id == subscription_id), None)
    if term is None:
        raise HTTPException(404, "That Pro+ year isn't on this company.")
    term.payment_received_on = body.payment_received_on or utc_today()
    if body.payment_method is not None:
        term.payment_method = body.payment_method.strip() or None
    if body.payment_reference is not None:
        term.payment_reference = body.payment_reference.strip() or None
    # The year's own invoice is settled with it, so My Company stops asking the
    # company to pay what GaitDesk has just recorded as paid.
    for invoice in await open_invoices_for_year(db, term.id):
        method = (term.payment_method or "").lower()
        mark_invoice_paid(
            invoice,
            [term],
            paid_on=term.payment_received_on,
            method=method if method in ("card", "ach", "check", "wire") else "other",
            reference=term.payment_reference,
        )
    await db.commit()
    return _company_out(await _load(db, company_id))


@router.delete("/{company_id}/subscriptions/{subscription_id}", response_model=ShowCompanyOut)
async def delete_pro_plus_year(
    company_id: UUID,
    subscription_id: UUID,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Remove a Pro+ year recorded in error. A year that was paid and then
    refunded is removed the same way; the company's notes say why. The row
    goes, so the log keeps what it was -- above all a year paid online, whose
    Stripe payment is the only other trace of the money."""
    company = await _load(db, company_id)
    term = next((t for t in company.subscriptions if t.id == subscription_id), None)
    if term is None:
        raise HTTPException(404, "That Pro+ year isn't on this company.")
    paid = term.payment_received_on is not None and term.price_cents > 0
    (logger.warning if paid else logger.info)(
        "Pro+ year removed: company=%s %s to %s price_cents=%d paid_on=%s method=%s reference=%r "
        "stripe_payment_intent=%s card_fee_cents=%d by user=%s",
        company_id, term.starts_on, term.ends_on, term.price_cents, term.payment_received_on,
        term.payment_method, term.payment_reference, term.stripe_payment_intent_id,
        term.card_fee_cents or 0, x_user_id,
    )
    company.subscriptions.remove(term)
    await db.commit()
    return _company_out(await _load(db, company_id))


@router.get("/{company_id}/usage", response_model=CompanyUsageOut)
async def company_usage(company_id: UUID, db: AsyncSession = Depends(get_db)):
    """The usage statement GaitDesk invoices the company from: every show it
    runs, newest first, with the exhibitors on its roster at the company's
    plan rate.

    Each show is priced at its own billing plan (migration 169,
    `show_billing_plan`): the highest plan the company held across the show's
    dates, or nothing per exhibitor when a Pro+ year covers its first day. Each
    Pro+ year is its own line at its price. Each line names the invoice it is
    on, once one that is not void has it (migration 172).
    """
    return await usage_statement(db, await _load(db, company_id))


async def _in_other_company(db: AsyncSession, user_id: UUID, company_id: UUID) -> bool:
    return (
        await db.execute(
            select(ShowCompanyMember.id).where(
                ShowCompanyMember.user_id == user_id, ShowCompanyMember.company_id != company_id
            )
        )
    ).first() is not None


@router.delete("/{company_id}", status_code=204)
async def delete_company(company_id: UUID, db: AsyncSession = Depends(get_db)):
    """Takes its memberships and its plan with it -- every account that had a
    feature only through this company loses it on the next request.

    Every show manager and secretary belongs to a company (migration 143), so
    anybody this leaves in none gets their own back, and somebody's own company
    cannot be deleted while it is the only one they have: it would only be made
    again.

    **Its points systems go with it** (migration 148), and the delete is refused
    while one of them still scores a show or a circuit. Left behind with no
    company, a system would read as a GaitDesk standard one (migration 151) and
    appear in every other company's list under GaitDesk's name."""
    company = await _load(db, company_id)
    systems = (
        await db.execute(select(PointSystem).where(PointSystem.company_id == company_id))
    ).scalars().all()
    if systems:
        ids = [s.id for s in systems]
        in_use = set(
            (await db.execute(
                select(ShowPointSystem.point_system_id).where(ShowPointSystem.point_system_id.in_(ids))
            )).scalars().all()
        ) | set(
            (await db.execute(
                select(Circuit.point_system_id).where(Circuit.point_system_id.in_(ids))
            )).scalars().all()
        )
        if in_use:
            names = ", ".join(sorted(s.name for s in systems if s.id in in_use))
            raise HTTPException(
                409,
                f"{company.name}'s points systems still score shows or circuits ({names}). "
                "Choose another system for those first.",
            )
    if company.owner_user_id is not None:
        owner = next((m.user for m in company.members if m.user_id == company.owner_user_id), None)
        if (
            owner is not None
            and owner.role in SHOW_OFFICE_ROLES
            and not await _in_other_company(db, owner.id, company.id)
        ):
            raise HTTPException(
                409,
                f"This is {owner.full_name}'s own company and the only one they are in. "
                "Add them to the company they work for first -- this one then goes by itself.",
            )
    staff = [m.user for m in company.members if m.user is not None and m.user.role in SHOW_OFFICE_ROLES]
    for system in systems:
        await db.delete(system)
    # Its shows lose their company (SET NULL); its staff keep them, per show.
    await pin_company_shows(company, db)
    await db.delete(company)
    await db.flush()
    for user in staff:
        await place_in_company(user, db)
    await db.commit()


@router.post("/{company_id}/members", response_model=ShowCompanyOut, status_code=201)
async def add_member(
    company_id: UUID,
    body: ShowCompanyMemberAdd,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    company = await _load(db, company_id)
    user = await db.get(User, body.user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    await add_company_member(company, user, safe_uuid(x_user_id), db)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, f"{user.full_name} is already in {company.name}.")
    return _company_out(await _load(db, company_id))


@router.delete("/{company_id}/members/{user_id}", response_model=ShowCompanyOut)
async def remove_member(company_id: UUID, user_id: UUID, db: AsyncSession = Depends(get_db)):
    company = await _load(db, company_id)
    await remove_company_member(company, user_id, db)
    await db.commit()
    return _company_out(await _load(db, company_id))


@router.delete("/{company_id}/join-requests/{user_id}", response_model=ShowCompanyOut)
async def decline_join_request(company_id: UUID, user_id: UUID, db: AsyncSession = Depends(get_db)):
    """Decline somebody who asked to join at sign-up. They keep the company of
    their own that sign-up gave them; approving is adding them as a member."""
    company = await _load(db, company_id)
    decline_request(company, user_id)
    await db.commit()
    return _company_out(await _load(db, company_id))


@router.delete("/{company_id}/upgrade-requests/{feature}", response_model=ShowCompanyOut)
async def dismiss_upgrade_request(company_id: UUID, feature: str, db: AsyncSession = Depends(get_db)):
    """Dismiss a company's request without answering it -- they decided
    against it, or it was pressed by mistake. Nothing tells them."""
    company = await _load(db, company_id)
    request = next((r for r in company.upgrade_requests if r.feature == feature), None)
    if request is None:
        raise HTTPException(404, "This company has not asked for that feature.")
    company.upgrade_requests.remove(request)
    await db.commit()
    return _company_out(await _load(db, company_id))
