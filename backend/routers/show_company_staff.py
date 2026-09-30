"""The show's company, and its staff, from setup Step 1.

A show is run by a show company, and everyone in the company works it
(migration 156, `show_access.py`). So the Staff section of Step 1 is the
company's own staff list, and **a change made there changes the company** --
who works for it, on every show it runs -- rather than a copy of it kept for
one show. That is the third door onto company membership, beside a GaitDesk
admin's Show Companies screens and a member's My Company Staff, and it runs
through the same `show_companies` functions as both:

  * **Adding somebody is still a request.** Membership carries the company's
    paid features, so a member asking for a colleague vouches for them and a
    GaitDesk admin approves (migration 149) -- exactly what My Company Staff
    does. A GaitDesk admin working Step 1 *is* the approver, so their additions
    take effect at once, as on Show Companies.
  * **Only from inside the company.** Somebody working the show as a guest -- a
    per-show row, not a member -- sees the company's staff and changes nothing
    about it, the rule My Company Staff is built on.
  * **Removing somebody takes them off every show the company runs**, including
    any per-show row on one of them (`release_company_shows`), and nobody
    removes themselves here: leaving the company is My Company Staff's, since
    from this screen it would also take them off the show they are setting up.

Which company runs the show is chosen here too. A new show gets its creator's
company; a show created before the column, or by somebody in several
companies, has none until somebody picks one. Moving a show between companies
changes who works it, so only the current company's own staff (or an admin)
may do it, and only to a company they work for themselves.

Scribes and gate stewards are not company staff -- they are hired show by show
-- and nor is a guest secretary: both stay on `routers/show_staff.py`.
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import require_admin_or_show_admin, safe_uuid
from models import Show, ShowCompany, ShowCompanyMember, User
from routers.my_company import StaffAdd, StaffMemberOut, StaffRequestOut, _commit, _out, _vouch
from routers.show_companies import _load
from routers.shows import _assert_show_access
from show_access import SHOW_OFFICE_TABLES
from show_companies import (
    SHOW_OFFICE_ROLES,
    add_company_member,
    decline_join_request,
    default_show_company,
    remove_company_member,
)

router = APIRouter(
    prefix="/shows/{show_id}",
    tags=["Show Company Staff"],
    dependencies=[Depends(require_admin_or_show_admin)],
)


class CompanyChoice(BaseModel):
    id: UUID
    name: str
    # Somebody's own company (migration 143) rather than an organization.
    personal: bool


class ShowCompanyOut(BaseModel):
    id: UUID
    name: str
    personal: bool
    members: list[StaffMemberOut] = Field(default_factory=list)
    join_requests: list[StaffRequestOut] = Field(default_factory=list)


class GuestOut(BaseModel):
    """A manager or secretary working this show from outside its company."""
    user_id: UUID
    full_name: str
    email: str
    role: str


class ShowCompanyStaffOut(BaseModel):
    company: Optional[ShowCompanyOut] = None
    # May add, remove and answer requests: an admin, or somebody in the company.
    can_manage: bool = False
    # A GaitDesk admin's additions take effect at once; everybody else's wait
    # for one (migration 149).
    adds_directly: bool = False
    # May put the show under a company, or move it to another.
    can_change: bool = False
    choices: list[CompanyChoice] = Field(default_factory=list)
    # What Step 1 offers first on a show with no company yet.
    suggested_company_id: Optional[UUID] = None
    guests: list[GuestOut] = Field(default_factory=list)


class CompanyPick(BaseModel):
    company_id: UUID


def may_manage(role: str, caller: UUID, member_ids: set[UUID]) -> bool:
    """Whether the caller may change the company from this screen: a GaitDesk
    admin, or somebody who works for it. A guest on the show may not."""
    return role == "ADMIN" or caller in member_ids


def may_change_company(
    role: str,
    caller: UUID,
    current_members: Optional[set[UUID]],
    caller_companies: set[UUID],
) -> bool:
    """Whether the caller may put the show under a company, or move it.

    `current_members` is None when the show has no company yet: anybody working
    the show may then give it one of theirs. Once it has one, moving it changes
    who works it, so only that company's own staff may -- a guest who also
    works for a rival club must not be able to take the show there -- and only
    somewhere else they work.
    """
    if role == "ADMIN":
        return True
    if current_members is None:
        return bool(caller_companies)
    return caller in current_members and len(caller_companies) > 1


async def _show(db: AsyncSession, show_id: UUID) -> Show:
    show = await db.get(Show, show_id)
    if show is None:
        raise HTTPException(404, "Show not found")
    return show


async def _choices(db: AsyncSession, role: str, caller: UUID) -> list[ShowCompany]:
    """The companies this caller may run a show under: every one for an admin,
    otherwise the ones they work for. Organizations first."""
    query = select(ShowCompany)
    if role != "ADMIN":
        query = query.join(ShowCompanyMember, ShowCompanyMember.company_id == ShowCompany.id).where(
            ShowCompanyMember.user_id == caller
        )
    companies = list((await db.execute(query)).scalars().all())
    companies.sort(key=lambda c: (c.owner_user_id is not None, c.name.lower()))
    return companies


async def _companies_of(db: AsyncSession, user_ids: set[UUID]) -> list[tuple[UUID, Optional[UUID]]]:
    if not user_ids:
        return []
    rows = await db.execute(
        select(ShowCompany.id, ShowCompany.owner_user_id)
        .join(ShowCompanyMember, ShowCompanyMember.company_id == ShowCompany.id)
        .where(ShowCompanyMember.user_id.in_(user_ids))
        .distinct()
    )
    return [(cid, owner) for cid, owner in rows.all()]


async def _assigned(db: AsyncSession, show_id: UUID) -> list[User]:
    """Everybody on a per-show manager or secretary row."""
    people: dict[UUID, User] = {}
    for table in SHOW_OFFICE_TABLES.values():
        rows = await db.execute(
            select(User).join(table, table.user_id == User.id).where(table.show_id == show_id)
        )
        people.update({u.id: u for u in rows.scalars().all()})
    return list(people.values())


async def _suggest(db: AsyncSession, show: Show, assigned: list[User], choices: list[ShowCompany]) -> Optional[UUID]:
    """The company Step 1 offers first for a show with none: the one its creator
    would have got had the column existed, else the one its office staff share
    -- and in either case only one the caller could actually pick."""
    allowed = {c.id for c in choices}
    creator = await db.get(User, show.created_by_user_id) if show.created_by_user_id else None
    people = (
        {creator.id}
        if creator is not None and creator.role in SHOW_OFFICE_ROLES
        else {u.id for u in assigned}
    )
    candidates = [c for c in await _companies_of(db, people) if c[0] in allowed]
    return default_show_company(candidates) or default_show_company(
        [(c.id, c.owner_user_id) for c in choices]
    )


async def _staff_out(db: AsyncSession, show_id: UUID, role: str, caller: UUID) -> ShowCompanyStaffOut:
    show = await _show(db, show_id)
    choices = await _choices(db, role, caller)
    # An admin's choices are every company, and they work for none of them.
    caller_companies = set() if role == "ADMIN" else {c.id for c in choices}
    assigned = await _assigned(db, show_id)

    company_out = None
    member_ids: Optional[set[UUID]] = None
    if show.company_id is not None:
        company = await _load(db, show.company_id)
        member_ids = {m.user_id for m in company.members}
        listed = _out(company, caller)
        company_out = ShowCompanyOut(
            id=company.id,
            name=company.name,
            personal=company.owner_user_id is not None,
            members=listed.members,
            join_requests=listed.join_requests,
        )

    guests = sorted(
        (u for u in assigned if member_ids is None or u.id not in member_ids),
        key=lambda u: (u.last_name.lower(), u.first_name.lower()),
    )
    return ShowCompanyStaffOut(
        company=company_out,
        can_manage=member_ids is not None and may_manage(role, caller, member_ids),
        adds_directly=role == "ADMIN",
        can_change=may_change_company(role, caller, member_ids, caller_companies),
        choices=[CompanyChoice(id=c.id, name=c.name, personal=c.owner_user_id is not None) for c in choices],
        suggested_company_id=(await _suggest(db, show, assigned, choices)) if show.company_id is None else None,
        guests=[GuestOut(user_id=u.id, full_name=u.full_name, email=u.email, role=u.role) for u in guests],
    )


async def _managed_company(db: AsyncSession, show_id: UUID, role: str, caller: UUID) -> ShowCompany:
    """The show's company, loaded for writing -- if the caller may change it."""
    show = await _show(db, show_id)
    if show.company_id is None:
        raise HTTPException(409, "Choose the company that runs this show first.")
    company = await _load(db, show.company_id)
    if not may_manage(role, caller, {m.user_id for m in company.members}):
        raise HTTPException(
            403,
            f"Only {company.name}'s own staff can change who works for it. "
            "You work this show as a guest.",
        )
    return company


@router.get("/company-staff", response_model=ShowCompanyStaffOut)
async def get_company_staff(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The company that runs the show, its staff and waiting requests, and
    anybody working the show from outside it."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    return await _staff_out(db, show_id, x_user_role, safe_uuid(x_user_id))


@router.put("/company", response_model=ShowCompanyStaffOut)
async def set_show_company(
    show_id: UUID,
    body: CompanyPick,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Put the show under a company, or move it to another. Everybody in the
    company it lands in works it from now on; everybody in the one it left
    stops, unless they are also on it by hand."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    caller = safe_uuid(x_user_id)
    show = await _show(db, show_id)
    if show.company_id == body.company_id:
        return await _staff_out(db, show_id, x_user_role, caller)

    choices = await _choices(db, x_user_role, caller)
    target = next((c for c in choices if c.id == body.company_id), None)
    if target is None:
        raise HTTPException(
            404 if x_user_role == "ADMIN" else 403,
            "Show company not found"
            if x_user_role == "ADMIN"
            else "You can only run a show under a company you work for.",
        )
    current_members: Optional[set[UUID]] = None
    if show.company_id is not None:
        current = await _load(db, show.company_id)
        current_members = {m.user_id for m in current.members}
        if not may_change_company(x_user_role, caller, current_members, {c.id for c in choices}):
            raise HTTPException(
                403,
                f"Only {current.name}'s own staff can move its show to another company.",
            )
    show.company_id = target.id
    await db.commit()
    return await _staff_out(db, show_id, x_user_role, caller)


@router.post("/company-staff", response_model=ShowCompanyStaffOut, status_code=202)
async def add_company_staff(
    show_id: UUID,
    body: StaffAdd,
    response: Response,
    background: BackgroundTasks,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Add somebody to the show's company by the email their account signs in
    with. 202 from a member: a request, until a GaitDesk admin approves it. 201
    from an admin: added."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    caller = safe_uuid(x_user_id)
    company = await _managed_company(db, show_id, x_user_role, caller)
    email = body.email.strip().lower()
    user = (
        await db.execute(select(User).where(func.lower(func.btrim(User.email)) == email))
    ).scalar_one_or_none()
    if user is None or user.role not in SHOW_OFFICE_ROLES:
        # The same answer for no account and a non-office one, as on My
        # Company Staff: this screen does not tell anybody who uses the app.
        raise HTTPException(
            404,
            f"No show manager or secretary account uses {email}. Ask them to sign up as a "
            "show manager or secretary first, then add them here.",
        )
    if x_user_role == "ADMIN":
        await add_company_member(company, user, caller, db)
        await _commit(db, f"{user.full_name} is already in {company.name}.")
        response.status_code = 201
    else:
        await _vouch(company, user, caller, db, background)
    return await _staff_out(db, show_id, x_user_role, caller)


@router.delete("/company-staff/{user_id}", response_model=ShowCompanyStaffOut)
async def remove_company_staff(
    show_id: UUID,
    user_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Take somebody out of the show's company -- and so off every show it
    runs. Nobody removes themselves here; that is My Company Staff's."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    caller = safe_uuid(x_user_id)
    company = await _managed_company(db, show_id, x_user_role, caller)
    if user_id == caller:
        raise HTTPException(
            409,
            f"Leave {company.name} from My Company Staff. From here it would also take you "
            "off the show you are setting up.",
        )
    await remove_company_member(
        company, user_id, db, caller_user_id=None if x_user_role == "ADMIN" else caller
    )
    await db.commit()
    return await _staff_out(db, show_id, x_user_role, caller)


@router.post("/company-staff/requests/{user_id}", response_model=ShowCompanyStaffOut)
async def approve_company_request(
    show_id: UUID,
    user_id: UUID,
    response: Response,
    background: BackgroundTasks,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Approve somebody who asked to join. A member's approval goes to GaitDesk
    with their name on it (202); an admin's adds them (200)."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    caller = safe_uuid(x_user_id)
    company = await _managed_company(db, show_id, x_user_role, caller)
    request = next((r for r in company.join_requests if r.user_id == user_id), None)
    if request is None or request.user is None:
        raise HTTPException(404, "That account has not asked to join this company.")
    if x_user_role == "ADMIN":
        await add_company_member(company, request.user, caller, db)
        await _commit(db, f"{request.user.full_name} is already in {company.name}.")
    else:
        await _vouch(company, request.user, caller, db, background)
        response.status_code = 202
    return await _staff_out(db, show_id, x_user_role, caller)


@router.delete("/company-staff/requests/{user_id}", response_model=ShowCompanyStaffOut)
async def decline_company_request(
    show_id: UUID,
    user_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Turn a request down, or withdraw one the company made."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    caller = safe_uuid(x_user_id)
    company = await _managed_company(db, show_id, x_user_role, caller)
    decline_join_request(company, user_id)
    await db.commit()
    return await _staff_out(db, show_id, x_user_role, caller)
