"""My Company Staff: a show company's own managers and secretaries managing who
works for it.

The Show Companies screens are a GaitDesk admin's (`routers/show_companies.py`),
because a company's paid features and its billing notes stand for a payment the
app does not take. Who works for the company is a different kind of fact -- the
club knows who its secretary is this season and GaitDesk does not -- so the
people half is handed to the company itself:

  * **Only the companies the caller is in.** Every endpoint loads the company
    and refuses a caller who is not a member, so nobody can reach a company by
    guessing its id, and nobody can add themselves to one: to add anybody you
    must already be inside.
  * **Only show managers and secretaries call it.** Its staff are managers
    and secretaries, who work every show the company runs; its **crew** is its
    scribes and gate stewards (migration 169), a list the office picks from
    for each show -- a crew member works only the shows they are assigned to.
  * **An existing account, found by its email -- or an invite.** The
    not-found message is the same whether the address has no account or one
    of another role, so this screen does not tell anybody who else uses the
    app. Somebody with no account gets an invite link (`user_invites`, with
    `company_id`), which the company copies and sends; accepting it puts them
    on the staff or the crew.
  * **The company adds people itself** (migration 169). Until then a GaitDesk
    admin approved every addition (migration 149), because membership carried
    paid features bought once for the whole company. A show is now billed for
    itself -- per exhibitor, or inside the company's own Pro+ year -- so who
    works for the company is the company's call. Approving somebody who typed
    its name at sign-up adds them too.
  * **The company picks its own plan** (migration 169): GaitDesk Basic or Pro,
    agreeing to be billed per exhibitor after each show; nothing is charged
    for choosing, and a company on Free cannot set up a show until it does.
    Pro+ is asked for -- it is a prepaid year, started when the payment is
    recorded. Every change is logged for pricing and mailed to the company's
    show managers.
  * **Never the add-on switches or the notes**, which are GaitDesk's. The
    features are named, read-only.
  * **The company's own policies are set here** -- so far one: how late an
    exhibitor may cancel their own registration (migration 157). A club's
    policy is the club's to choose, so this door writes it outright; a GaitDesk
    admin can set it too, on the company's admin page.

Removing and declining run through the same functions as the admin's buttons
(`show_companies.remove_company_member` and `decline_join_request`), with one
rule more on this door: a company's own staff cannot leave it empty.
"""
import os
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cancellations import MAX_SELF_CANCEL_DAYS_BEFORE
from database import get_db
from dependencies import require_admin_or_show_admin, safe_uuid
from models import (
    Show,
    ShowCompany,
    ShowCompanyCrew,
    ShowCompanyMember,
    ShowGateSteward,
    ShowScribe,
    User,
    UserInvite,
)
from routers.show_companies import _load
from show_companies import (
    FEATURES,
    PLANS,
    PRO_PLUS,
    RENEWAL_NOTICE_DAYS,
    SHOW_OFFICE_ROLES,
    add_company_member,
    company_features,
    company_manager_emails,
    covering_subscription,
    decline_join_request,
    effective_label,
    email_admins,
    keep_pro_plus,
    loaded_effective_plan,
    loaded_pro_plus_lapse,
    plan_confirmation_email,
    remove_company_member,
    set_company_plan,
    sets_up_shows,
    utc_today,
)

router = APIRouter(
    prefix="/my-company",
    tags=["My Company Staff"],
    dependencies=[Depends(require_admin_or_show_admin)],
)


class StaffMemberOut(BaseModel):
    user_id: UUID
    full_name: str
    email: str
    role: str
    added_at: Optional[datetime] = None
    is_me: bool = False
    # The independent whose own company this is; they cannot be removed from it.
    is_owner: bool = False


class StaffRequestOut(BaseModel):
    user_id: UUID
    full_name: str
    email: str
    role: str
    requested_at: Optional[datetime] = None
    # "signup": they typed the company's name when they signed up. "company":
    # somebody in the company asked for them.
    source: str = "signup"
    # Set once somebody in the company stands behind it -- it is then waiting
    # on GaitDesk rather than on the company.
    vouched_by_name: Optional[str] = None
    vouched_at: Optional[datetime] = None
    vouched_by_me: bool = False


class CompanyFeatureLabel(BaseModel):
    key: str
    label: str
    plan: str


class CrewMemberOut(BaseModel):
    """A scribe or gate steward on the company's crew (migration 169)."""
    user_id: UUID
    full_name: str
    email: str
    role: str
    added_at: Optional[datetime] = None


class CompanyInviteOut(BaseModel):
    """An invite from My Company still waiting to be accepted."""
    id: UUID
    email: str
    first_name: str
    last_name: str
    role: str
    expires_at: datetime
    # Only on the response that made it: the link to send them.
    accept_url: Optional[str] = None


class ProPlusYearOut(BaseModel):
    starts_on: date
    ends_on: date
    # Within `RENEWAL_NOTICE_DAYS` of the end with nothing after it -- the
    # banner that says so, whether or not the reminder email arrived.
    renewal_due: bool = False


class MyPlanOut(BaseModel):
    """The plan the company is on, as My Company shows it (migration 169)."""
    plan: str
    plan_label: str
    effective_plan: str
    effective_plan_label: str
    rate_cents: int
    sets_up_shows: bool
    pro_plus: Optional[ProPlusYearOut] = None
    pro_plus_requested_at: Optional[datetime] = None
    # Migration 175: the company is on Pro+ and renews it -- rather than moving
    # to `plan` when its year ends -- and, while that renewal is unpaid, the
    # day its last year ended (its unfinished shows frozen since the next).
    renews_pro_plus: bool = False
    pro_plus_ended_on: Optional[date] = None


class MyCompanyOut(BaseModel):
    id: UUID
    name: str
    # The caller's own company, named after them (migration 143). Nobody can
    # ask to join one by name, so its join-request list is always empty.
    personal: bool
    members: list[StaffMemberOut] = Field(default_factory=list)
    join_requests: list[StaffRequestOut] = Field(default_factory=list)
    # Switched on for this company, and so for everybody in it. Read-only.
    features: list[CompanyFeatureLabel] = Field(default_factory=list)
    # Migration 157: days before a show's first day that exhibitors stop being
    # able to cancel their own registration. 0 is until the show starts.
    self_cancel_days_before: int = 0
    # Migration 169.
    plan: Optional[MyPlanOut] = None
    crew: list[CrewMemberOut] = Field(default_factory=list)
    invites: list[CompanyInviteOut] = Field(default_factory=list)


class StaffAdd(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class PlanChoice(BaseModel):
    # Basic or Pro; or, during a Pro+ year, Pro+ again -- to renew it after
    # choosing Basic or Pro to follow it (migration 175).
    plan: Literal["basic", "pro", "pro_plus"]
    # The office agrees to be billed per exhibitor after each show. Required
    # for Basic and Pro: choosing a plan is agreeing to its price.
    agree: bool = False


class CompanyInviteCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    role: Literal["SHOW_MANAGER", "SHOW_SECRETARY", "SCRIBE", "GATE_STEWARD"]


class CompanySettingsUpdate(BaseModel):
    self_cancel_days_before: int = Field(ge=0, le=MAX_SELF_CANCEL_DAYS_BEFORE)


CREW_ROLES = frozenset({"SCRIBE", "GATE_STEWARD"})
INVITE_TTL_DAYS = 14


def _plan_out(company: ShowCompany) -> MyPlanOut:
    today = utc_today()
    effective = loaded_effective_plan(company, today)
    lapse = loaded_pro_plus_lapse(company, today)
    base = PLANS.get(company.plan) or PLANS["free"]
    year = covering_subscription(company.subscriptions, today)
    pro_plus = None
    if year is not None:
        renewed = any(t.starts_on > year.ends_on for t in company.subscriptions)
        pro_plus = ProPlusYearOut(
            starts_on=year.starts_on,
            ends_on=year.ends_on,
            renewal_due=not renewed and year.ends_on - timedelta(days=RENEWAL_NOTICE_DAYS) <= today,
        )
    ask = next((r for r in company.upgrade_requests if r.feature == PRO_PLUS), None)
    return MyPlanOut(
        plan=base.key,
        plan_label=base.label,
        effective_plan=effective,
        effective_plan_label=effective_label(effective, lapse),
        rate_cents=base.rate_cents,
        sets_up_shows=sets_up_shows(effective),
        pro_plus=pro_plus,
        pro_plus_requested_at=ask.created_at if ask else None,
        renews_pro_plus=bool(company.renews_pro_plus),
        pro_plus_ended_on=lapse - timedelta(days=1) if lapse else None,
    )


def _out(company: ShowCompany, caller: UUID, invites: list | None = None) -> MyCompanyOut:
    members = sorted(
        (m for m in company.members if m.user is not None),
        key=lambda m: (m.user.last_name.lower(), m.user.first_name.lower()),
    )
    requests = sorted(
        (r for r in company.join_requests if r.user is not None),
        key=lambda r: r.created_at or company.created_at,
    )
    # Its plan's features and its add-ons alike (migration 168).
    switched_on = company_features(company)
    return MyCompanyOut(
        id=company.id,
        name=company.name,
        personal=company.owner_user_id == caller,
        members=[
            StaffMemberOut(
                user_id=m.user.id,
                full_name=m.user.full_name,
                email=m.user.email,
                role=m.user.role,
                added_at=m.created_at,
                is_me=m.user.id == caller,
                is_owner=company.owner_user_id == m.user.id,
            )
            for m in members
        ],
        join_requests=[
            StaffRequestOut(
                user_id=r.user.id,
                full_name=r.user.full_name,
                email=r.user.email,
                role=r.user.role,
                requested_at=r.created_at,
                source=r.source or "signup",
                vouched_by_name=r.vouched_by.full_name if r.vouched_by else None,
                vouched_at=r.vouched_at,
                vouched_by_me=r.vouched_by_user_id == caller,
            )
            for r in requests
        ],
        features=[
            CompanyFeatureLabel(key=f.key, label=f.label, plan=f.plan)
            for f in FEATURES.values()
            if f.key in switched_on
        ],
        self_cancel_days_before=company.self_cancel_days_before or 0,
        plan=_plan_out(company),
        crew=sorted(
            (
                CrewMemberOut(
                    user_id=c.user.id,
                    full_name=c.user.full_name,
                    email=c.user.email,
                    role=c.user.role,
                    added_at=c.created_at,
                )
                for c in company.crew
                if c.user is not None
            ),
            key=lambda c: (c.role, c.full_name.lower()),
        ),
        invites=[
            CompanyInviteOut(
                id=i.id,
                email=i.email,
                first_name=i.first_name,
                last_name=i.last_name,
                role=i.role,
                expires_at=i.expires_at,
            )
            for i in (invites or [])
        ],
    )


async def _pending_invites(db: AsyncSession, company_id: UUID) -> list[UserInvite]:
    now = datetime.now(timezone.utc)
    return list(
        (
            await db.execute(
                select(UserInvite)
                .where(
                    UserInvite.company_id == company_id,
                    UserInvite.show_id.is_(None),
                    UserInvite.status == "pending",
                    UserInvite.expires_at > now,
                )
                .order_by(UserInvite.created_at)
            )
        ).scalars().all()
    )


async def _full_out(db: AsyncSession, company_id: UUID, caller: UUID) -> MyCompanyOut:
    """The company as this screen shows it, re-read after a write."""
    return _out(await _load(db, company_id), caller, await _pending_invites(db, company_id))


def _caller(x_user_id: str, x_user_role: str) -> UUID:
    """Show managers and secretaries only. A GaitDesk admin manages every
    company from Show Companies and belongs to none."""
    if x_user_role not in SHOW_OFFICE_ROLES:
        raise HTTPException(403, "My Company Staff is for show managers and secretaries.")
    return safe_uuid(x_user_id)


async def _my_company(company_id: UUID, caller: UUID, db: AsyncSession) -> ShowCompany:
    """The company, loaded for writing -- if the caller works for it."""
    company = await _load(db, company_id)
    if not any(m.user_id == caller for m in company.members):
        raise HTTPException(403, "You can only manage the staff of a company you work for.")
    return company


async def _commit(db: AsyncSession, message: str) -> None:
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, message)


@router.get("", response_model=list[MyCompanyOut])
async def list_my_companies(
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Every company the caller works for, with its staff and waiting requests."""
    caller = _caller(x_user_id, x_user_role)
    ids = (
        await db.execute(
            select(ShowCompanyMember.company_id).where(ShowCompanyMember.user_id == caller)
        )
    ).scalars().all()
    companies = [await _load(db, company_id) for company_id in ids]
    # An organization before the caller's own company: it is the one with
    # colleagues in it, and so the one this screen is mostly for.
    companies.sort(key=lambda c: (c.owner_user_id == caller, c.name.lower()))
    return [_out(c, caller, await _pending_invites(db, c.id)) for c in companies]


@router.put("/{company_id}/settings", response_model=MyCompanyOut)
async def update_settings(
    company_id: UUID,
    body: CompanySettingsUpdate,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The company's own policies for the shows it runs. So far: how many days
    before a show exhibitors stop cancelling themselves (0: until it starts).

    Written outright rather than requested, unlike a new member: it hands
    nobody a paid feature, and it is the club's policy to set. It reaches every
    show the company runs (`shows.company_id`) from the next read -- the rule
    is looked up each time, never copied onto the show.
    """
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    company.self_cancel_days_before = body.self_cancel_days_before
    await db.commit()
    return await _full_out(db, company_id, caller)


@router.post("/{company_id}/members", response_model=MyCompanyOut, status_code=201)
async def add_staff(
    company_id: UUID,
    body: StaffAdd,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Add a colleague -- a show manager or secretary -- by the email their
    account signs in with. Takes effect at once (migration 169). Somebody with
    no account yet is invited instead (`POST /{id}/invites`)."""
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    email = body.email.strip().lower()
    user = (
        await db.execute(select(User).where(func.lower(func.btrim(User.email)) == email))
    ).scalar_one_or_none()
    if user is None or user.role not in SHOW_OFFICE_ROLES:
        raise HTTPException(
            404,
            f"No show manager or secretary account uses {email}. Send them an invite instead -- "
            "it sets up their account and adds them here.",
        )
    await add_company_member(company, user, caller, db)
    await _commit(db, f"{user.full_name} is already in {company.name}.")
    return await _full_out(db, company_id, caller)


@router.delete("/{company_id}/members/{user_id}", response_model=list[MyCompanyOut])
async def remove_staff(
    company_id: UUID,
    user_id: UUID,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Take a colleague out of the company, or leave it yourself. Answers with
    every company the caller is still in: leaving one takes it off the screen."""
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    await remove_company_member(company, user_id, db, caller_user_id=caller)
    await db.commit()
    return await list_my_companies(x_user_id=x_user_id, x_user_role=x_user_role, db=db)


@router.post("/{company_id}/join-requests/{user_id}", response_model=MyCompanyOut)
async def approve_request(
    company_id: UUID,
    user_id: UUID,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Approve somebody who typed the company's name at sign-up: adds them
    (migration 169)."""
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    request = next((r for r in company.join_requests if r.user_id == user_id), None)
    if request is None or request.user is None:
        raise HTTPException(404, "That account has not asked to join this company.")
    await add_company_member(company, request.user, caller, db)
    await _commit(db, f"{request.user.full_name} is already in {company.name}.")
    return await _full_out(db, company_id, caller)


@router.delete("/{company_id}/join-requests/{user_id}", response_model=MyCompanyOut)
async def decline_request(
    company_id: UUID,
    user_id: UUID,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Turn a request down, or withdraw one the company made. Somebody who
    asked at sign-up keeps the company of their own it gave them."""
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    decline_join_request(company, user_id)
    await db.commit()
    return await _full_out(db, company_id, caller)


# ── The plan (migration 169) ───────────────────────────────────────────────────


@router.put("/{company_id}/plan", response_model=MyCompanyOut)
async def choose_plan(
    company_id: UUID,
    body: PlanChoice,
    background: BackgroundTasks,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Put the company on GaitDesk Basic or Pro. Nothing is charged now: each
    show is invoiced after it runs, at the highest plan the company held across
    its dates, so moving down mid-show does not lower that show's bill. The
    company's show managers are emailed. Pro+ is not bought here -- it is a
    year billed up front.

    **During a Pro+ year this is what follows it** (migration 175): Basic or
    Pro stops Pro+ renewing, and Pro+ puts the renewal back. With an unpaid
    renewal, Basic or Pro is the way out of the freeze without paying it."""
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    if body.plan == PRO_PLUS:
        changed = keep_pro_plus(company, caller, db)
    else:
        if not body.agree:
            raise HTTPException(422, "Agree to be billed per exhibitor after each show to choose a plan.")
        changed = set_company_plan(company, body.plan, caller, db)
    await db.commit()
    company = await _load(db, company_id)
    if changed:
        recipients = await company_manager_emails(db, company_id)
        if recipients:
            year = covering_subscription(company.subscriptions, utc_today())
            subject, mail = plan_confirmation_email(
                company.name,
                loaded_effective_plan(company),
                term=(year.starts_on, year.ends_on) if year is not None else None,
                returns_to=company.plan,
                renews=bool(company.renews_pro_plus),
            )
            background.add_task(email_admins, recipients, subject, mail)
    return _out(company, caller, await _pending_invites(db, company_id))


# ── The crew: scribes and gate stewards (migration 169) ────────────────────────


@router.post("/{company_id}/crew", response_model=MyCompanyOut, status_code=201)
async def add_crew(
    company_id: UUID,
    body: StaffAdd,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Put a scribe or gate steward on the company's crew by the email their
    account signs in with. They work no show until the office assigns them."""
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    email = body.email.strip().lower()
    user = (
        await db.execute(select(User).where(func.lower(func.btrim(User.email)) == email))
    ).scalar_one_or_none()
    if user is None or user.role not in CREW_ROLES:
        raise HTTPException(
            404,
            f"No scribe or gate steward account uses {email}. Send them an invite instead -- "
            "it sets up their account and puts them on your crew.",
        )
    if any(c.user_id == user.id for c in company.crew):
        raise HTTPException(409, f"{user.full_name} is already on {company.name}'s crew.")
    db.add(ShowCompanyCrew(company_id=company.id, user_id=user.id, added_by_user_id=caller))
    await _commit(db, f"{user.full_name} is already on {company.name}'s crew.")
    return await _full_out(db, company_id, caller)


@router.delete("/{company_id}/crew/{user_id}", response_model=MyCompanyOut)
async def remove_crew(
    company_id: UUID,
    user_id: UUID,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Take somebody off the crew -- and off every show of the company's that
    has not finished, since they were only there as its crew. A finished show
    keeps its record of who scribed it."""
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    row = next((c for c in company.crew if c.user_id == user_id), None)
    if row is None:
        raise HTTPException(404, "That person isn't on this company's crew.")
    company.crew.remove(row)
    open_shows = select(Show.id).where(Show.company_id == company_id, Show.status != "COMPLETED")
    for table in (ShowScribe, ShowGateSteward):
        await db.execute(delete(table).where(table.user_id == user_id, table.show_id.in_(open_shows)))
    await db.commit()
    return await _full_out(db, company_id, caller)


# ── Invites (migration 169) ────────────────────────────────────────────────────


def _accept_url(token: str) -> str:
    return f"{os.getenv('PUBLIC_APP_URL', 'http://localhost:3000').rstrip('/')}/invite/{token}"


@router.post("/{company_id}/invites", response_model=CompanyInviteOut, status_code=201)
async def invite(
    company_id: UUID,
    body: CompanyInviteCreate,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Invite somebody with no account: a manager or secretary onto the staff,
    a scribe or gate steward onto the crew. Answers with the link to send them
    -- email here is best-effort, so the link is the invite."""
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    email = body.email.strip().lower()
    if (
        await db.execute(select(User.id).where(func.lower(func.btrim(User.email)) == email))
    ).first() is not None:
        raise HTTPException(
            409,
            f"An account already uses {email}. Add them by that email instead.",
        )
    if any(i.email == email for i in await _pending_invites(db, company_id)):
        raise HTTPException(409, f"{email} already has an invite from {company.name} waiting.")
    row = UserInvite(
        token=secrets.token_urlsafe(24),
        email=email,
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
        role=body.role,
        company_id=company.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS),
        invited_by_user_id=caller,
    )
    db.add(row)
    await db.commit()
    return CompanyInviteOut(
        id=row.id,
        email=row.email,
        first_name=row.first_name,
        last_name=row.last_name,
        role=row.role,
        expires_at=row.expires_at,
        accept_url=_accept_url(row.token),
    )


@router.delete("/{company_id}/invites/{invite_id}", response_model=MyCompanyOut)
async def cancel_invite(
    company_id: UUID,
    invite_id: UUID,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    caller = _caller(x_user_id, x_user_role)
    await _my_company(company_id, caller, db)
    row = await db.get(UserInvite, invite_id)
    if row is None or row.company_id != company_id or row.status != "pending":
        raise HTTPException(404, "That invite isn't waiting any more.")
    row.status = "cancelled"
    await db.commit()
    return await _full_out(db, company_id, caller)
