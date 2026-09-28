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
  * **Only show managers and secretaries**, as callers and as colleagues. A
    company is the people who run shows; a scribe or a gate steward is staffed
    per show, and an exhibitor account is not show office at all.
  * **An existing account, found by its email.** Somebody with no account signs
    up as a show manager or secretary and types the company's name, which
    leaves a join request here. The not-found message is the same whether the
    address has no account or belongs to somebody who is not show office, so
    this screen does not tell anybody who else uses the app.
  * **Nobody is added from here -- a GaitDesk admin approves every addition**
    (migration 149). Membership carries the company's paid features, so asking
    to add a colleague, or approving somebody who asked at sign-up, *vouches*
    for them: it leaves a join request with the voucher's name on it, which an
    admin answers on the company's page, and the admins are emailed. The
    company may still decline or withdraw a request, and remove or leave
    straight away -- neither hands anybody a feature.
  * **Never the features or the notes**, which are not in the payload at all.
    The features are named, read-only, because they are what membership hands
    out.

Removing and declining run through the same functions as the admin's buttons
(`show_companies.remove_company_member` and `decline_join_request`), with one
rule more on this door: a company's own staff cannot leave it empty.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import require_admin_or_show_admin, safe_uuid
from models import ShowCompany, ShowCompanyMember, User
from routers.show_companies import _load
from show_companies import (
    FEATURES,
    SHOW_OFFICE_ROLES,
    admin_emails,
    decline_join_request,
    email_admins,
    remove_company_member,
    staff_request_email,
    vouch_for_member,
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


class StaffAdd(BaseModel):
    email: str = Field(min_length=3, max_length=320)


def _out(company: ShowCompany, caller: UUID) -> MyCompanyOut:
    members = sorted(
        (m for m in company.members if m.user is not None),
        key=lambda m: (m.user.last_name.lower(), m.user.first_name.lower()),
    )
    requests = sorted(
        (r for r in company.join_requests if r.user is not None),
        key=lambda r: r.created_at or company.created_at,
    )
    switched_on = {f.feature for f in company.features}
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
    )


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


async def _vouch(
    company: ShowCompany,
    person: User,
    caller: UUID,
    db: AsyncSession,
    background: BackgroundTasks,
) -> None:
    """Stand behind somebody, commit, and tell GaitDesk's admins -- after the
    response, and only when something changed."""
    asked_at_signup = any(
        r.user_id == person.id and r.source == "signup" for r in company.join_requests
    )
    changed = vouch_for_member(company, person, caller)
    await _commit(db, f"{person.full_name} has already been asked for.")
    if not changed:
        return
    voucher = await db.get(User, caller)
    recipients = await admin_emails(db)
    if recipients and voucher is not None:
        subject, body = staff_request_email(
            company_id=company.id,
            company_name=company.name,
            voucher_name=voucher.full_name,
            voucher_email=voucher.email,
            person_name=person.full_name,
            person_email=person.email,
            person_role=person.role,
            asked_at_signup=asked_at_signup,
            features=[FEATURES[f.feature].label for f in company.features if f.feature in FEATURES],
        )
        background.add_task(email_admins, recipients, subject, body)


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
    return [_out(c, caller) for c in companies]


@router.post("/{company_id}/members", response_model=MyCompanyOut, status_code=202)
async def add_staff(
    company_id: UUID,
    body: StaffAdd,
    background: BackgroundTasks,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Ask for a colleague to be added, by the email their account signs in
    with. 202: it is a request until a GaitDesk admin approves it."""
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    email = body.email.strip().lower()
    user = (
        await db.execute(select(User).where(func.lower(func.btrim(User.email)) == email))
    ).scalar_one_or_none()
    if user is None or user.role not in SHOW_OFFICE_ROLES:
        how = (
            f'Ask them to sign up as a show manager or secretary and type "{company.name}" '
            "as their company -- their request will appear here to approve."
            if company.owner_user_id is None
            else "Ask them to sign up as a show manager or secretary first, then add them here."
        )
        raise HTTPException(404, f"No show manager or secretary account uses {email}. {how}")
    await _vouch(company, user, caller, db, background)
    return _out(await _load(db, company_id), caller)


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
    background: BackgroundTasks,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Approve, on the company's side, somebody who typed its name at sign-up.
    It goes to GaitDesk with the approver's name on it; an admin adds them."""
    caller = _caller(x_user_id, x_user_role)
    company = await _my_company(company_id, caller, db)
    request = next((r for r in company.join_requests if r.user_id == user_id), None)
    if request is None or request.user is None:
        raise HTTPException(404, "That account has not asked to join this company.")
    await _vouch(company, request.user, caller, db, background)
    return _out(await _load(db, company_id), caller)


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
    return _out(await _load(db, company_id), caller)
