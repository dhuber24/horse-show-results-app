"""Show companies, and the paid features GaitDesk switches on for them.

A **show company** is the business that runs shows -- a club, an association
affiliate, a management firm (migration 142). It exists because the first
thing in this app a customer pays for, starting a show from its printed show
bill, is sold to that business: not to one of its staff, who come and go, and
not to one show, which does not exist yet at the moment the feature is used.

**A feature is switched on for a company and reaches every account in it.** A
caller has a feature when any company they belong to has it, so a freelance
secretary working for two clubs gets whatever either of them has paid for. An
ADMIN has every feature, because GaitDesk staff support every customer and
cannot do that from behind a paywall.

**The app collects no payment.** Paying is an arrangement between the company
and GaitDesk, recorded in `show_companies.notes`, and a GaitDesk admin turns
the feature on by hand once it is settled. So nothing here reads a
subscription period or an expiry: a feature is on until an admin turns it off.
When payment arrives it will need its own record of periods paid; the switch
this module reads should stay the one thing every gate asks.

**Every show manager and secretary belongs to a company** (migration 143),
because a feature can only reach an account through one. Somebody who works
for no club gets **a company of their own, named after them**
(`owner_user_id`), made with their account by `place_in_company` -- on the
sign-up screens, when an admin creates the account, and when a role change
makes somebody show office. The sign-up form's optional Company / Organization
box decides which: blank is their own company, a name nobody has used creates
that organization, and **a name that already exists is a request to join it,
never a membership** -- joining carries the company's paid features, so typing
a club's name must not buy its subscription. See `plan_placement`.

**Adding a paid feature is one entry in `FEATURES` and a gate.** The column
carries no CHECK (see the migration), so a feature key nobody registered is
inert -- `features_for` drops it -- rather than an error, and a key that is
registered but gates nothing is a switch that does nothing. Gate an endpoint
with `Depends(require_feature(KEY))` and a page by reading `GET
/users/me/features`; the endpoint is the enforcement and the page only decides
what to offer, the same split as every screen lock in this app.
"""
from dataclasses import dataclass
from typing import Iterable
from uuid import UUID

from fastapi import Depends, Header, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import safe_uuid
from models import ShowCompany, ShowCompanyFeature, ShowCompanyJoinRequest, ShowCompanyMember, User


@dataclass(frozen=True)
class Feature:
    key: str
    label: str
    description: str
    # The subscription a company upgrades to for this feature -- what the
    # locked button and the 403 name. The one place the plan is spelled.
    plan: str


SHOWBILL_IMPORT = "showbill_import"

FEATURES: dict[str, Feature] = {
    SHOWBILL_IMPORT: Feature(
        key=SHOWBILL_IMPORT,
        label="Start a show from its show bill",
        description=(
            "Upload the printed show bill and GaitDesk reads the dates, venue, judges, "
            "clubs, classes and fees into a draft show for the office to check."
        ),
        plan="GaitDesk Pro",
    ),
}

# Roles that have every feature without belonging to a company.
ALL_FEATURE_ROLES = frozenset({"ADMIN"})

# Roles that always belong to a company -- the ones that create shows, which
# is where every paid feature so far is used.
SHOW_OFFICE_ROLES = frozenset({"SHOW_MANAGER", "SHOW_SECRETARY"})

FEATURE_NOT_ENABLED = (
    "{label} needs the {plan} subscription, and your show company isn't on it yet. "
    "Ask GaitDesk about upgrading."
)


def features_for(role: str, company_features: Iterable[str]) -> set[str]:
    """What a caller may use: every feature for an ADMIN, otherwise whatever
    their companies have that is still a registered feature.

    A key in the table that `FEATURES` no longer names is dropped rather than
    passed on, so retiring a feature is deleting its entry here -- no gate can
    be satisfied by a switch for something that no longer exists.
    """
    if role in ALL_FEATURE_ROLES:
        return set(FEATURES)
    return {key for key in company_features if key in FEATURES}


def normalize_company_name(value: str | None) -> str | None:
    """A company name with its edges trimmed and inner runs of space closed up,
    or None when nothing is left. The unique index compares `lower(btrim(name))`,
    so "Minnesota  Paint Club" and "Minnesota Paint Club" would otherwise be two
    companies that print identically."""
    if value is None:
        return None
    cleaned = " ".join(value.split())
    return cleaned or None


def personal_company_name(first_name: str | None, last_name: str | None) -> str:
    """What an independent person's own company is called: their name, the way
    `users.full_name` composes it."""
    return " ".join(p for p in ((first_name or "").strip(), (last_name or "").strip()) if p)


@dataclass(frozen=True)
class Placement:
    """Where an account goes: a new organization to create and join, an
    existing one it has asked to join, and whether it needs its own company."""
    create_organization: str | None = None
    request_to_join: UUID | None = None
    personal: bool = False


def plan_placement(
    role: str,
    typed_name: str | None,
    existing_organization_id: UUID | None,
    member_of: set[UUID],
) -> Placement:
    """Decide where a show manager or secretary belongs.

    `typed_name` is the Company / Organization box, already normalized;
    `existing_organization_id` is the organization of that name, if there is
    one; `member_of` is every company the account is already in.

    * A role that does not create shows goes nowhere.
    * A name nobody has used is a new organization, and joining it is safe --
      a company made a moment ago has no features to hand out.
    * A name that exists is **a request, never a membership**: a paid feature
      reaches every account in a company, so a typed name must not be enough
      to get one. They get their own company meanwhile, so they are never in
      none.
    * Nothing typed: their own company, unless they are already in one.
    """
    if role not in SHOW_OFFICE_ROLES:
        return Placement()
    if typed_name:
        if existing_organization_id is None:
            return Placement(create_organization=typed_name)
        if existing_organization_id in member_of:
            return Placement()
        return Placement(request_to_join=existing_organization_id, personal=not member_of)
    return Placement(personal=not member_of)


async def _organization_named(db: AsyncSession, name: str) -> UUID | None:
    return (
        await db.execute(
            select(ShowCompany.id).where(
                ShowCompany.owner_user_id.is_(None),
                func.lower(func.btrim(ShowCompany.name)) == name.lower(),
            )
        )
    ).scalar_one_or_none()


async def place_in_company(user: User, db: AsyncSession, organization_name: str | None = None) -> Placement:
    """Put a show-office account where `plan_placement` says, in the caller's
    transaction. The user must be flushed. Never refuses over a company: an
    account being created must not fail because of the company it lands in.
    """
    typed = normalize_company_name(organization_name)
    member_of = set(
        (
            await db.execute(select(ShowCompanyMember.company_id).where(ShowCompanyMember.user_id == user.id))
        ).scalars().all()
    )
    existing = await _organization_named(db, typed) if typed else None
    plan = plan_placement(user.role, typed, existing, member_of)

    if plan.create_organization:
        try:
            # A savepoint, so that two people creating the same organization in
            # the same second cost the second one a join request rather than
            # their whole sign-up.
            async with db.begin_nested():
                company = ShowCompany(name=plan.create_organization, created_by_user_id=user.id)
                db.add(company)
                await db.flush()
                db.add(ShowCompanyMember(company_id=company.id, user_id=user.id, added_by_user_id=user.id))
                await db.flush()
        except IntegrityError:
            existing = await _organization_named(db, plan.create_organization)
            plan = plan_placement(user.role, typed, existing, member_of)

    if plan.request_to_join is not None:
        already = (
            await db.execute(
                select(ShowCompanyJoinRequest.id).where(
                    ShowCompanyJoinRequest.company_id == plan.request_to_join,
                    ShowCompanyJoinRequest.user_id == user.id,
                )
            )
        ).first()
        if already is None:
            db.add(ShowCompanyJoinRequest(company_id=plan.request_to_join, user_id=user.id))

    if plan.personal:
        own = (
            await db.execute(select(ShowCompany).where(ShowCompany.owner_user_id == user.id))
        ).scalar_one_or_none()
        if own is None:
            own = ShowCompany(
                name=personal_company_name(user.first_name, user.last_name) or user.email,
                owner_user_id=user.id,
                created_by_user_id=user.id,
            )
            db.add(own)
            await db.flush()
        if own.id not in member_of:
            db.add(ShowCompanyMember(company_id=own.id, user_id=user.id, added_by_user_id=user.id))

    await db.flush()
    return plan


def is_spare_personal_company(
    owner_user_id: UUID | None,
    user_id: UUID,
    feature_count: int,
    member_ids: set[UUID],
) -> bool:
    """Whether somebody's own company can go now that they work for an
    organization: it is theirs, nothing has been switched on for it, and nobody
    else is in it. A company with a feature on is one somebody paid for, and one
    with other people in it is no longer only theirs -- both stay."""
    return owner_user_id == user_id and feature_count == 0 and member_ids <= {user_id}


async def retire_spare_personal_company(user_id: UUID, joined_company_id: UUID, db: AsyncSession) -> bool:
    """Remove somebody's own company once they have joined an organization, if
    it is spare -- otherwise the list keeps an "Independent" row for everybody
    who ever signed up before their club added them."""
    own = (
        await db.execute(
            select(ShowCompany).where(
                ShowCompany.owner_user_id == user_id, ShowCompany.id != joined_company_id
            )
        )
    ).scalar_one_or_none()
    if own is None:
        return False
    feature_count = len(
        (await db.execute(select(ShowCompanyFeature.id).where(ShowCompanyFeature.company_id == own.id))).all()
    )
    member_ids = set(
        (
            await db.execute(select(ShowCompanyMember.user_id).where(ShowCompanyMember.company_id == own.id))
        ).scalars().all()
    )
    if not is_spare_personal_company(own.owner_user_id, user_id, feature_count, member_ids):
        return False
    await db.delete(own)
    return True


async def sync_personal_company_name(user: User, old_full_name: str, db: AsyncSession) -> None:
    """Carry a rename through to the person's own company -- **only while it
    still carries their old name**. A company somebody has renamed (to the
    business they have since set up) is left as they named it.

    `old_full_name` is taken from the caller, captured before the account was
    edited: any query autoflushes the rename, and the listener in `models.py`
    rewrites `user.full_name` on that flush, so by the time this runs the
    account no longer remembers what it was called."""
    own = (
        await db.execute(select(ShowCompany).where(ShowCompany.owner_user_id == user.id))
    ).scalar_one_or_none()
    if own is not None and own.name == old_full_name:
        own.name = personal_company_name(user.first_name, user.last_name) or own.name


async def company_features_for_user(db: AsyncSession, user_id: UUID) -> set[str]:
    """Every feature switched on for any company this account belongs to."""
    rows = await db.execute(
        select(ShowCompanyFeature.feature)
        .join(ShowCompanyMember, ShowCompanyMember.company_id == ShowCompanyFeature.company_id)
        .where(ShowCompanyMember.user_id == user_id)
        .distinct()
    )
    return set(rows.scalars().all())


async def enabled_features(db: AsyncSession, user_id: UUID, role: str) -> set[str]:
    """The features this caller has. An ADMIN never needs the query."""
    if role in ALL_FEATURE_ROLES:
        return set(FEATURES)
    return features_for(role, await company_features_for_user(db, user_id))


async def companies_for_user(db: AsyncSession, user_id: UUID) -> list[ShowCompany]:
    """The companies this account works for, by name."""
    rows = await db.execute(
        select(ShowCompany)
        .join(ShowCompanyMember, ShowCompanyMember.company_id == ShowCompany.id)
        .where(ShowCompanyMember.user_id == user_id)
        .order_by(ShowCompany.name)
    )
    return list(rows.scalars().all())


def feature_not_enabled_message(feature: str) -> str:
    entry = FEATURES[feature]
    return FEATURE_NOT_ENABLED.format(label=entry.label, plan=entry.plan)


def require_feature(feature: str):
    """A dependency refusing a caller whose companies have not paid for `feature`.

    Raises at import time on an unregistered key, so a typo in a gate is a
    failed startup rather than an endpoint nobody can ever reach.
    """
    if feature not in FEATURES:
        raise ValueError(f"Unknown feature: {feature}")

    async def dependency(
        x_user_id: str = Header(...),
        x_user_role: str = Header(...),
        db: AsyncSession = Depends(get_db),
    ) -> None:
        if feature not in await enabled_features(db, safe_uuid(x_user_id), x_user_role):
            raise HTTPException(403, feature_not_enabled_message(feature))

    return dependency
