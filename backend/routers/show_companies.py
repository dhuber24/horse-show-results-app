"""Show companies: who they are, who works for them, and what they have paid for.

GaitDesk admin only. A company is created, staffed and switched on by GaitDesk
staff, because the switch stands for a payment the app does not take -- a
manager able to add themselves to a company, or tick a feature on, would be
able to give themselves what somebody else paid for. See `show_companies.py`.

The one way in that is not an admin's is the sign-up form (migration 143): an
independent gets a company of their own, and somebody who types an existing
organization's name leaves a **join request** here for an admin to answer.
Approving one is adding the member, which clears the request.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from dependencies import require_admin, safe_uuid
from models import ShowCompany, ShowCompanyFeature, ShowCompanyJoinRequest, ShowCompanyMember, User
from schemas import (
    ShowCompanyCreate,
    ShowCompanyFeatureOut,
    ShowCompanyJoinRequestOut,
    ShowCompanyMemberAdd,
    ShowCompanyMemberOut,
    ShowCompanyOut,
    ShowCompanyUpdate,
)
from show_companies import (
    FEATURES,
    SHOW_OFFICE_ROLES,
    normalize_company_name,
    place_in_company,
    retire_spare_personal_company,
)

router = APIRouter(
    prefix="/show-companies",
    tags=["Show Companies"],
    dependencies=[Depends(require_admin)],
)

_LOAD = (
    selectinload(ShowCompany.members).selectinload(ShowCompanyMember.user),
    selectinload(ShowCompany.features).selectinload(ShowCompanyFeature.enabled_by),
    selectinload(ShowCompany.join_requests).selectinload(ShowCompanyJoinRequest.user),
)


def _company_out(company: ShowCompany) -> ShowCompanyOut:
    members = sorted(
        (m for m in company.members if m.user is not None),
        key=lambda m: (m.user.last_name.lower(), m.user.first_name.lower()),
    )
    switched_on = {f.feature: f for f in company.features}
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
        join_requests=[
            ShowCompanyJoinRequestOut(
                user_id=r.user.id,
                full_name=r.user.full_name,
                email=r.user.email,
                role=r.user.role,
                requested_at=r.created_at,
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
        # Every registered feature, on or off, in registry order. A row for a
        # key the registry no longer names is left out: it switches nothing on.
        features=[
            ShowCompanyFeatureOut(
                key=feature.key,
                label=feature.label,
                description=feature.description,
                plan=feature.plan,
                enabled=feature.key in switched_on,
                enabled_at=switched_on[feature.key].enabled_at if feature.key in switched_on else None,
                enabled_by_name=(
                    switched_on[feature.key].enabled_by.full_name
                    if feature.key in switched_on and switched_on[feature.key].enabled_by
                    else None
                ),
            )
            for feature in FEATURES.values()
        ],
    )


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


@router.get("/{company_id}", response_model=ShowCompanyOut)
async def get_company(company_id: UUID, db: AsyncSession = Depends(get_db)):
    return _company_out(await _load(db, company_id))


@router.patch("/{company_id}", response_model=ShowCompanyOut)
async def update_company(
    company_id: UUID,
    body: ShowCompanyUpdate,
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
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "There is already a show company with that name.")
    return _company_out(await _load(db, company_id))


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
    """Takes its memberships and switches with it -- every account that had a
    feature only through this company loses it on the next request.

    Every show manager and secretary belongs to a company (migration 143), so
    anybody this leaves in none gets their own back, and somebody's own company
    cannot be deleted while it is the only one they have: it would only be made
    again."""
    company = await _load(db, company_id)
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
    if any(m.user_id == user.id for m in company.members):
        raise HTTPException(409, f"{user.full_name} is already in {company.name}.")
    db.add(
        ShowCompanyMember(
            company_id=company.id,
            user_id=user.id,
            added_by_user_id=safe_uuid(x_user_id),
        )
    )
    # Adding somebody who asked to join is approving the request.
    request = next((r for r in company.join_requests if r.user_id == user.id), None)
    if request is not None:
        company.join_requests.remove(request)
    # And somebody who now works for an organization is no longer independent:
    # their own company goes, if nothing is on it and nobody else is in it.
    if company.owner_user_id is None:
        await retire_spare_personal_company(user.id, company.id, db)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, f"{user.full_name} is already in {company.name}.")
    return _company_out(await _load(db, company_id))


@router.delete("/{company_id}/members/{user_id}", response_model=ShowCompanyOut)
async def remove_member(company_id: UUID, user_id: UUID, db: AsyncSession = Depends(get_db)):
    company = await _load(db, company_id)
    member = next((m for m in company.members if m.user_id == user_id), None)
    if member is None:
        raise HTTPException(404, "That account is not in this company.")
    if company.owner_user_id == user_id:
        raise HTTPException(
            409,
            f"This is {member.user.full_name}'s own company. Add them to the company they work "
            "for instead -- this one goes by itself once they have joined it.",
        )
    removed = member.user
    company.members.remove(member)
    await db.flush()
    # Nobody who creates shows is left in no company (migration 143).
    if removed is not None and removed.role in SHOW_OFFICE_ROLES:
        await place_in_company(removed, db)
    await db.commit()
    return _company_out(await _load(db, company_id))


@router.delete("/{company_id}/join-requests/{user_id}", response_model=ShowCompanyOut)
async def decline_join_request(company_id: UUID, user_id: UUID, db: AsyncSession = Depends(get_db)):
    """Decline somebody who asked to join at sign-up. They keep the company of
    their own that sign-up gave them; approving is adding them as a member."""
    company = await _load(db, company_id)
    request = next((r for r in company.join_requests if r.user_id == user_id), None)
    if request is None:
        raise HTTPException(404, "That account has not asked to join this company.")
    company.join_requests.remove(request)
    await db.commit()
    return _company_out(await _load(db, company_id))


def _registered(feature: str) -> str:
    if feature not in FEATURES:
        raise HTTPException(404, "No such feature")
    return feature


@router.put("/{company_id}/features/{feature}", response_model=ShowCompanyOut)
async def enable_feature(
    company_id: UUID,
    feature: str,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Turn a feature on. A second press is not an error -- it is already on,
    and the original `enabled_at` is kept, since that is when it started."""
    _registered(feature)
    company = await _load(db, company_id)
    if not any(f.feature == feature for f in company.features):
        db.add(
            ShowCompanyFeature(
                company_id=company.id,
                feature=feature,
                enabled_by_user_id=safe_uuid(x_user_id),
            )
        )
        try:
            await db.commit()
        except IntegrityError:
            # Two admins pressed at once; the other press turned it on.
            await db.rollback()
    return _company_out(await _load(db, company_id))


@router.delete("/{company_id}/features/{feature}", response_model=ShowCompanyOut)
async def disable_feature(company_id: UUID, feature: str, db: AsyncSession = Depends(get_db)):
    """Turn a feature off. The row is the switch, so off is its deletion."""
    _registered(feature)
    company = await _load(db, company_id)
    row = next((f for f in company.features if f.feature == feature), None)
    if row is not None:
        company.features.remove(row)
        await db.commit()
    return _company_out(await _load(db, company_id))
