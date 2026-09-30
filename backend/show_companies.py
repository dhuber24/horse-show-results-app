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

**A locked door asks for the upgrade itself** (migration 144). The button
beside it writes a `show_company_upgrade_requests` row for the company, which
GaitDesk's admins find on the Show Companies screens and as a count on the
admin home; each of them is also emailed, best-effort. The row is the
notification and the email a courtesy, because `mailer.py` does nothing without
SMTP. One request per company and feature -- the feature is sold to the
company, so a second colleague pressing the button is told the first already
asked -- and **switching the feature on answers it**, in the same transaction.
"""
import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Sequence
from uuid import UUID

from fastapi import Depends, Header, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from dependencies import safe_uuid
from mailer import public_app_url, send_email
from models import (
    Show,
    ShowCompany,
    ShowCompanyFeature,
    ShowCompanyJoinRequest,
    ShowCompanyMember,
    ShowCompanyUpgradeRequest,
    ShowManager,
    ShowSecretary,
    User,
)


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
    # The shows they ran on their own stay theirs: they move to no company, and
    # the owner keeps them through a row each (migration 156). Which company
    # they belong to now is the owner's to say on Step 1, not a guess made here.
    await pin_company_shows(own, db)
    await db.delete(own)
    return True


def member_removal_refusal(
    *,
    company_name: str,
    owner_user_id: UUID | None,
    target_user_id: UUID,
    target_name: str,
    member_ids: set[UUID],
    caller_user_id: UUID | None = None,
) -> str | None:
    """Why this member may not be taken out of the company, or None.

    * **Nobody leaves their own company** -- it goes by itself once they join
      the company they work for, and removing them would only make it again.
    * **A company's own staff cannot leave it empty** (`caller_user_id` set, the
      My Company Staff door): the last person out would take the company's
      paid features and its join requests with them, with nobody left who
      could answer either. A GaitDesk admin passes no caller and may.
    """
    if owner_user_id is not None and owner_user_id == target_user_id:
        return (
            f"This is {target_name}'s own company. Add them to the company they work "
            "for instead -- this one goes by itself once they have joined it."
        )
    if caller_user_id is not None and not (member_ids - {target_user_id}):
        return (
            f"{target_name} is the only person in {company_name}, and a company needs "
            "somebody in it. Add a colleague first, or ask GaitDesk to close the company."
        )
    return None


async def add_company_member(company: ShowCompany, user: User, added_by: UUID, db: AsyncSession) -> None:
    """Put an account in a company, in the caller's transaction.

    One implementation behind both doors -- a GaitDesk admin's Show Companies
    screen and a member's My Company Staff -- because who may press the button
    differs and what the press does must not. The company must be loaded with
    its members and join requests.
    """
    if any(m.user_id == user.id for m in company.members):
        raise HTTPException(409, f"{user.full_name} is already in {company.name}.")
    db.add(ShowCompanyMember(company_id=company.id, user_id=user.id, added_by_user_id=added_by))
    # Adding somebody who asked to join is approving the request.
    request = next((r for r in company.join_requests if r.user_id == user.id), None)
    if request is not None:
        company.join_requests.remove(request)
    # And somebody who now works for an organization is no longer independent:
    # their own company goes, if nothing is on it and nobody else is in it.
    if company.owner_user_id is None:
        await retire_spare_personal_company(user.id, company.id, db)


async def remove_company_member(
    company: ShowCompany,
    user_id: UUID,
    db: AsyncSession,
    caller_user_id: UUID | None = None,
) -> None:
    """Take an account out of a company, in the caller's transaction. Pass
    `caller_user_id` from the My Company Staff door, which may not empty the
    company. Nobody who creates shows is left in no company (migration 143)."""
    member = next((m for m in company.members if m.user_id == user_id), None)
    if member is None:
        raise HTTPException(404, "That account is not in this company.")
    refusal = member_removal_refusal(
        company_name=company.name,
        owner_user_id=company.owner_user_id,
        target_user_id=user_id,
        target_name=member.user.full_name if member.user else "This account",
        member_ids={m.user_id for m in company.members},
        caller_user_id=caller_user_id,
    )
    if refusal:
        raise HTTPException(409, refusal)
    removed = member.user
    company.members.remove(member)
    await db.flush()
    await release_company_shows(company.id, user_id, db)
    if removed is not None and removed.role in SHOW_OFFICE_ROLES:
        await place_in_company(removed, db)


async def release_company_shows(company_id: UUID, user_id: UUID, db: AsyncSession) -> None:
    """Take somebody who has left a company off every show it runs.

    The company is what put them on those shows (migration 156), so leaving it
    takes them off -- including through a per-show row, which a show created
    before the column, or one they were also assigned to by hand, may carry.
    Left in place, that row would keep somebody the company has let go working
    its shows, with nothing on the company's screens to say so. A show of some
    other company, or of none, is not this company's to clear."""
    shows = select(Show.id).where(Show.company_id == company_id)
    for table in (ShowManager, ShowSecretary):
        await db.execute(
            delete(table).where(table.user_id == user_id, table.show_id.in_(shows))
        )


async def pin_company_shows(company: ShowCompany, db: AsyncSession) -> None:
    """Before a company is deleted, give its staff a per-show row on each of
    its shows. The show loses its company (`ON DELETE SET NULL`), which would
    otherwise lose every one of them a show they were working the moment an
    admin tidied the company list -- a company closing is not its people
    leaving its shows."""
    show_ids = (
        await db.execute(select(Show.id).where(Show.company_id == company.id))
    ).scalars().all()
    if not show_ids:
        return
    staff = (
        await db.execute(
            select(User.id, User.role)
            .join(ShowCompanyMember, ShowCompanyMember.user_id == User.id)
            .where(ShowCompanyMember.company_id == company.id, User.role.in_(tuple(SHOW_OFFICE_ROLES)))
        )
    ).all()
    for table, role in ((ShowManager, "SHOW_MANAGER"), (ShowSecretary, "SHOW_SECRETARY")):
        people = [uid for uid, r in staff if r == role]
        if not people:
            continue
        existing = set(
            (
                await db.execute(
                    select(table.show_id, table.user_id).where(
                        table.show_id.in_(show_ids), table.user_id.in_(people)
                    )
                )
            ).all()
        )
        for show_id in show_ids:
            for uid in people:
                if (show_id, uid) not in existing:
                    db.add(table(show_id=show_id, user_id=uid))
    await db.flush()


def default_show_company(companies: Sequence[tuple[UUID, UUID | None]]) -> UUID | None:
    """Which company a new show runs under, from the creator's companies as
    `(id, owner_user_id)` pairs -- or None, and Step 1 asks.

    * **Their only company** -- nearly everybody, since an independent has their
      own (migration 143) and joining a club retires it.
    * **Their one organization**, when they also kept a company of their own
      (it had a feature on, or somebody else in it): the club is who they work
      for, and their own company is the fallback that made sure they had one.
    * **Otherwise nothing.** A freelance secretary working for two clubs could
      be setting up either one's show, and guessing hands it to the wrong
      club's staff.
    """
    if len(companies) == 1:
        return companies[0][0]
    organizations = [cid for cid, owner in companies if owner is None]
    if len(organizations) == 1:
        return organizations[0]
    return None


async def default_show_company_for(db: AsyncSession, user_id: UUID, role: str) -> UUID | None:
    """`default_show_company` for the account creating a show. An ADMIN is in
    no company and chooses on Step 1."""
    if role not in SHOW_OFFICE_ROLES:
        return None
    rows = (
        await db.execute(
            select(ShowCompany.id, ShowCompany.owner_user_id)
            .join(ShowCompanyMember, ShowCompanyMember.company_id == ShowCompany.id)
            .where(ShowCompanyMember.user_id == user_id)
        )
    ).all()
    return default_show_company([(cid, owner) for cid, owner in rows])


def vouch_for_member(company: ShowCompany, user: User, voucher_id: UUID) -> bool:
    """A company member asks for somebody to be added (migration 149).

    **Never a membership.** Membership carries the company's paid features, so
    the company's own say-so is a request a GaitDesk admin approves -- adding
    them on the company's page, which clears it like any join request. Somebody
    who already asked at sign-up has that request vouched for rather than a
    second one made. Returns whether anything changed: a colleague vouching
    again for somebody already vouched for is not news to anybody.

    The company must be loaded with its members and join requests.
    """
    if any(m.user_id == user.id for m in company.members):
        raise HTTPException(409, f"{user.full_name} is already in {company.name}.")
    request = next((r for r in company.join_requests if r.user_id == user.id), None)
    if request is not None and request.vouched_by_user_id is not None:
        return False
    now = datetime.now(timezone.utc)
    if request is None:
        company.join_requests.append(
            ShowCompanyJoinRequest(
                company_id=company.id,
                user_id=user.id,
                source="company",
                vouched_by_user_id=voucher_id,
                vouched_at=now,
                created_at=now,
            )
        )
    else:
        request.vouched_by_user_id = voucher_id
        request.vouched_at = now
    return True


def staff_request_email(
    *,
    company_id: UUID,
    company_name: str,
    voucher_name: str,
    voucher_email: str,
    person_name: str,
    person_email: str,
    person_role: str,
    asked_at_signup: bool,
    features: Sequence[str],
) -> tuple[str, str]:
    """What GaitDesk's admins are sent when a company asks to add somebody.
    Best-effort, like the upgrade email: the request on the company's page is
    the notification, and the count on the admin home points at it."""
    role = _ROLE_LABEL.get(person_role, person_role)
    subject = f"{company_name} asked to add {person_name}"
    how = (
        f"{person_name} asked to join when they signed up, and {voucher_name} ({voucher_email}) "
        f"approved it for {company_name}."
        if asked_at_signup
        else f"{voucher_name} ({voucher_email}) asked to add {person_name} to {company_name}."
    )
    gets = (
        f"Members get the company's paid features: {', '.join(features)}."
        if features
        else "The company has no paid features switched on yet."
    )
    body = (
        f"{how}\n\n"
        f"{person_name}: {person_email}, {role}.\n{gets}\n\n"
        "Add them or decline on the company's page:\n"
        f"{public_app_url()}/admin/companies/{company_id}\n"
    )
    return subject, body


def decline_join_request(company: ShowCompany, user_id: UUID) -> None:
    """Turn down somebody who asked to join at sign-up. They keep the company of
    their own that sign-up gave them."""
    request = next((r for r in company.join_requests if r.user_id == user_id), None)
    if request is None:
        raise HTTPException(404, "That account has not asked to join this company.")
    company.join_requests.remove(request)


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


def resolve_upgrade_company(role: str, requested: UUID | None, member_of: Sequence[UUID]) -> UUID:
    """Which company an upgrade request is for.

    Only a company the caller works for: asking on behalf of somebody else's
    club would put a request in front of GaitDesk that the club never made.
    Somebody in exactly one company -- nearly everybody, since an independent
    has their own (migration 143) -- need not say which.
    """
    if role in ALL_FEATURE_ROLES:
        raise HTTPException(409, "GaitDesk admins already have every feature.")
    if not member_of:
        raise HTTPException(
            409,
            "Your account isn't in a show company yet, so there is nothing to upgrade. "
            "Ask GaitDesk to set your show company up.",
        )
    if requested is None:
        if len(member_of) == 1:
            return member_of[0]
        raise HTTPException(422, "You work for more than one show company. Choose which one the upgrade is for.")
    if requested not in member_of:
        raise HTTPException(403, "You can only ask for an upgrade for a show company you work for.")
    return requested


_ROLE_LABEL = {"SHOW_MANAGER": "Show Manager", "SHOW_SECRETARY": "Show Secretary"}


def upgrade_request_email(
    *,
    feature: str,
    company_id: UUID,
    company_name: str,
    personal: bool,
    requester_name: str,
    requester_email: str,
    requester_role: str,
) -> tuple[str, str]:
    """The subject and body GaitDesk's admins are sent when a company asks.

    An independent's company is named after them, so "Jane Smith asked for Pro
    for Jane Smith" would say nothing -- it names what they are instead."""
    entry = FEATURES[feature]
    whom = "their own account (an independent -- no club or firm)" if personal else company_name
    subject = f"{requester_name if personal else company_name} asked for {entry.plan}"
    role = _ROLE_LABEL.get(requester_role, requester_role)
    body = (
        f"{requester_name} ({requester_email}, {role}) asked for {entry.plan} for {whom}, "
        f"to use: {entry.label}.\n\n"
        "GaitDesk doesn't take payment in the app, so get in touch with them to arrange it. "
        "Once it's settled, switch the feature on for the company -- that answers the request:\n"
        f"{public_app_url()}/admin/companies/{company_id}\n"
    )
    return subject, body


async def load_upgrade_request(db: AsyncSession, company_id: UUID, feature: str) -> ShowCompanyUpgradeRequest | None:
    """A company's request for a feature, with the company and the requester
    loaded -- refreshed, since the write path has the row in the identity map
    and would otherwise keep its unloaded relationships (see CLAUDE.md)."""
    return (
        await db.execute(
            select(ShowCompanyUpgradeRequest)
            .where(
                ShowCompanyUpgradeRequest.company_id == company_id,
                ShowCompanyUpgradeRequest.feature == feature,
            )
            .options(
                selectinload(ShowCompanyUpgradeRequest.company),
                selectinload(ShowCompanyUpgradeRequest.requested_by),
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def request_upgrade(
    db: AsyncSession, user_id: UUID, role: str, feature: str, company_id: UUID | None
) -> tuple[UUID, bool]:
    """Record that a company wants `feature`, in the caller's transaction.

    Returns the company and whether this call made the request -- False when
    one was already standing, so nobody is emailed twice. Refuses a feature the
    company already has: the caller's page is stale, and a request for
    something that is on would sit on the admin's list with nothing to do.
    """
    if feature not in FEATURES:
        raise HTTPException(404, "No such feature")
    member_of = [c.id for c in await companies_for_user(db, user_id)]
    target = resolve_upgrade_company(role, company_id, member_of)

    already_on = (
        await db.execute(
            select(ShowCompanyFeature.id).where(
                ShowCompanyFeature.company_id == target, ShowCompanyFeature.feature == feature
            )
        )
    ).first()
    if already_on is not None:
        company = await db.get(ShowCompany, target)
        raise HTTPException(
            409, f"{company.name} already has {FEATURES[feature].label}. Reload the page to use it."
        )

    try:
        # A savepoint, so a request the company already made -- a colleague's
        # earlier press, or two in the same second -- is found rather than
        # doubled, without costing the caller's transaction.
        async with db.begin_nested():
            db.add(ShowCompanyUpgradeRequest(company_id=target, feature=feature, requested_by_user_id=user_id))
            await db.flush()
    except IntegrityError:
        return target, False
    return target, True


async def admin_emails(db: AsyncSession) -> list[str]:
    """Where an upgrade request is mailed: every GaitDesk admin whose account
    is not locked."""
    rows = await db.execute(select(User.email).where(User.role == "ADMIN", User.is_approved.is_(True)))
    return [email for email in rows.scalars().all() if email]


async def email_admins(recipients: Sequence[str], subject: str, body: str) -> None:
    """Best-effort, and run after the response: `send_email` never raises, and
    nothing about the request depends on whether it arrived."""
    await asyncio.gather(*(send_email(to, subject, body) for to in recipients))


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
