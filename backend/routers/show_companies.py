"""Show companies: who they are, who works for them, and what they have paid for.

GaitDesk admin only. A company is created, staffed and switched on by GaitDesk
staff, because the switch stands for a payment the app does not take -- a
manager able to add themselves to a company, or tick a feature on, would be
able to give themselves what somebody else paid for. See `show_companies.py`.

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

The other thing that waits here is an **upgrade request** (migration 144),
made from a locked paid feature's Request upgrade button. It rides on the
feature it asks for, and switching that feature on answers it.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from dependencies import require_admin, safe_uuid
from models import (
    Circuit,
    PointSystem,
    ShowCompany,
    ShowCompanyFeature,
    ShowCompanyJoinRequest,
    ShowCompanyMember,
    ShowCompanyUpgradeRequest,
    ShowPointSystem,
    User,
)
from schemas import (
    PendingCompanyRequestsOut,
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
    add_company_member,
    decline_join_request as decline_request,
    normalize_company_name,
    pin_company_shows,
    place_in_company,
    remove_company_member,
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
    selectinload(ShowCompany.join_requests).selectinload(ShowCompanyJoinRequest.vouched_by),
    selectinload(ShowCompany.upgrade_requests).selectinload(ShowCompanyUpgradeRequest.requested_by),
)


def _company_out(company: ShowCompany) -> ShowCompanyOut:
    members = sorted(
        (m for m in company.members if m.user is not None),
        key=lambda m: (m.user.last_name.lower(), m.user.first_name.lower()),
    )
    switched_on = {f.feature: f for f in company.features}
    asked_for = {r.feature: r for r in company.upgrade_requests}
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
        .where(ShowCompanyUpgradeRequest.feature.in_(list(FEATURES)))
    )
    return PendingCompanyRequestsOut(join_requests=joins or 0, upgrade_requests=upgrades or 0)


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
    if "self_cancel_days_before" in fields:
        # A number, never a blank: 0 is how "until the show starts" is said.
        if body.self_cancel_days_before is None:
            raise HTTPException(422, "Say how many days before the show, or 0 for until it starts.")
        company.self_cancel_days_before = body.self_cancel_days_before
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
    and the original `enabled_at` is kept, since that is when it started.

    Turning it on answers the company's request for it (migration 144), in the
    same commit -- the way adding a member answers a join request."""
    _registered(feature)
    company = await _load(db, company_id)
    changed = False
    if not any(f.feature == feature for f in company.features):
        db.add(
            ShowCompanyFeature(
                company_id=company.id,
                feature=feature,
                enabled_by_user_id=safe_uuid(x_user_id),
            )
        )
        changed = True
    request = next((r for r in company.upgrade_requests if r.feature == feature), None)
    if request is not None:
        company.upgrade_requests.remove(request)
        changed = True
    if changed:
        try:
            await db.commit()
        except IntegrityError:
            # Two admins pressed at once; the other press turned it on, and
            # cleared the request with it.
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


@router.delete("/{company_id}/upgrade-requests/{feature}", response_model=ShowCompanyOut)
async def dismiss_upgrade_request(company_id: UUID, feature: str, db: AsyncSession = Depends(get_db)):
    """Dismiss a company's request for a feature without switching it on --
    they decided against it, or it was pressed by mistake. Nothing tells them;
    their locked button simply offers the request again."""
    company = await _load(db, company_id)
    request = next((r for r in company.upgrade_requests if r.feature == feature), None)
    if request is None:
        raise HTTPException(404, "This company has not asked for that feature.")
    company.upgrade_requests.remove(request)
    await db.commit()
    return _company_out(await _load(db, company_id))
