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

**A company is on a plan, and the plan carries the features** (migration 168).
GaitDesk Basic runs the show; GaitDesk Pro adds the back office (`PLANS`). Both
are charged per exhibitor registered to a show, which GaitDesk invoices off the
usage statement (`billing.platform_usage`). **A company has a feature through
its plan and no other way** (migration 170): the per-feature switches of
migrations 142 and 168 are retired, since every paid feature is in Pro and
Pro+, and a company moves itself to Pro from My Company.

**A feature is read off the caller or off the show** -- whichever the screen
belongs to. The show bill import is used before the show exists, so it asks
the caller's companies (`require_feature`). Everything else Pro sells is used
*at* a show and billed *for* that show, so it asks the show's own company
(`require_show_feature`, `show_features`): a freelance secretary whose other
club is on Pro does not bring Pro reports to a Basic club's show.

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
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Sequence
from uuid import UUID

from fastapi import Depends, Header, HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from dependencies import safe_uuid
from mailer import public_app_url, send_email
from models import (
    Show,
    ShowCompany,
    ShowCompanyJoinRequest,
    ShowCompanyMember,
    ShowCompanyPlanChange,
    ShowCompanySubscription,
    ShowCompanyUpgradeRequest,
    ShowManager,
    ShowSecretary,
    User,
)
from schemas import PlanInfoOut

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Feature:
    key: str
    label: str
    description: str
    # The subscription a company upgrades to for this feature -- what the
    # locked button and the 403 name. The one place the plan is spelled.
    plan: str


PRO_LABEL = "GaitDesk Pro"

SHOWBILL_IMPORT = "showbill_import"
FINANCIAL_REPORTS = "financial_reports"
ASSOCIATION_EXPORT = "association_export"
LIVE_BOARDS = "live_boards"
ONLINE_PAYMENTS = "online_payments"

FEATURES: dict[str, Feature] = {
    SHOWBILL_IMPORT: Feature(
        key=SHOWBILL_IMPORT,
        label="Start a show from its show bill",
        description=(
            "Upload the printed show bill and GaitDesk reads the dates, venue, judges, "
            "clubs, classes and fees into a draft show for the office to check."
        ),
        plan=PRO_LABEL,
    ),
    FINANCIAL_REPORTS: Feature(
        key=FINANCIAL_REPORTS,
        label="Financial reports",
        description=(
            "Revenue by category, registration counts, balances, stalls and the rest of "
            "the show's money reports, ready to print or export."
        ),
        plan=PRO_LABEL,
    ),
    ASSOCIATION_EXPORT: Feature(
        key=ASSOCIATION_EXPORT,
        label="Association results export",
        description=(
            "Export the show's results in the file format a breed association asks for, "
            "such as APHA's results CSV."
        ),
        plan=PRO_LABEL,
    ),
    LIVE_BOARDS: Feature(
        key=LIVE_BOARDS,
        label="Live Boards",
        description=(
            "The Results Board, Results & High Point and the Gate Board, full screen on "
            "a lobby or ring-side TV for exhibitors and spectators. Monitors not included."
        ),
        plan=PRO_LABEL,
    ),
    # Migration 172: the company connects its own Stripe account on My Company,
    # and exhibitors pay their balance from What I Owe. Gated where the company
    # connects (`company_billing.connect_stripe`) and where an exhibitor pays
    # (`payments.unavailable_reason`, on the show's plan).
    ONLINE_PAYMENTS: Feature(
        key=ONLINE_PAYMENTS,
        label="Online payments",
        description=(
            "Exhibitors pay their balance online, by card or bank transfer, straight to your "
            "company's own Stripe account. You choose whether credit card payers cover the fee."
        ),
        plan=PRO_LABEL,
    ),
}


@dataclass(frozen=True)
class Plan:
    key: str
    label: str
    # What GaitDesk charges the show company for each exhibitor on a show's
    # roster. Priced through `billing.platform_usage`.
    rate_cents: int
    features: frozenset[str]
    # One line each, for the plan's card on the admin screens and My Company.
    includes: tuple[str, ...]
    # Migration 169. Free sets up no show; every other plan does.
    sets_up_shows: bool = True
    # A prepaid year's price; 0 for the plans billed per exhibitor.
    annual_cents: int = 0
    # A company may move itself onto it from My Company. Pro+ is billed for
    # up front, so a GaitDesk admin starts it (paid or not, migration 171).
    self_serve: bool = False


FREE = "free"
BASIC = "basic"
PRO = "pro"
PRO_PLUS = "pro_plus"

PLANS: dict[str, Plan] = {
    FREE: Plan(
        key=FREE,
        label="GaitDesk Free",
        rate_cents=0,
        features=frozenset(),
        includes=(
            "Your company's managers, secretaries, scribes and gate stewards",
            "Choose GaitDesk Basic or Pro to set up a show -- nothing is charged until after it",
        ),
        sets_up_shows=False,
    ),
    BASIC: Plan(
        key=BASIC,
        label="GaitDesk Basic",
        rate_cents=200,
        features=frozenset(),
        includes=(
            "Registration, back numbers, the gate, scribing and judge's cards",
            "Live results on the show's public pages",
            "Billing and payment recording",
        ),
        self_serve=True,
    ),
    PRO: Plan(
        key=PRO,
        label=PRO_LABEL,
        rate_cents=400,
        features=frozenset(FEATURES),
        includes=(
            "Everything in GaitDesk Basic",
            "Financial reports",
            "Start a show from its show bill",
            "Association results export",
            "Live Boards for exhibitors and spectators (monitors not included)",
            "Online payments from exhibitors, to your own Stripe account",
        ),
        self_serve=True,
    ),
    PRO_PLUS: Plan(
        key=PRO_PLUS,
        label="GaitDesk Pro+",
        rate_cents=0,
        features=frozenset(FEATURES),
        includes=(
            "Everything in GaitDesk Pro",
            "Unlimited shows and exhibitors for a year, billed once",
            "Made for companies running more than one mid-sized show a year",
        ),
        annual_cents=149900,
    ),
}

# The values `show_companies.plan` takes -- the plans billed per exhibitor, and
# Free. Pro+ is a prepaid year on top (`show_company_subscriptions`).
COLUMN_PLANS = (FREE, BASIC, PRO)

# What a company made from now on starts on -- the column's default.
DEFAULT_PLAN = FREE

# How long before a Pro+ year ends its company's managers are reminded.
RENEWAL_NOTICE_DAYS = 30

# What a company may ask GaitDesk for from a locked door: a feature, or Pro+.
REQUESTABLE = frozenset(FEATURES) | {PRO_PLUS}


def plan_catalog() -> list[PlanInfoOut]:
    """Every plan, for a page that says what each includes."""
    return [
        PlanInfoOut(
            key=p.key,
            label=p.label,
            rate_cents=p.rate_cents,
            annual_cents=p.annual_cents,
            sets_up_shows=p.sets_up_shows,
            self_serve=p.self_serve,
            features=sorted(p.features),
            includes=list(p.includes),
        )
        for p in PLANS.values()
    ]


def plan_features(plan: str | None) -> frozenset[str]:
    """The features a plan includes. An unknown plan includes nothing."""
    entry = PLANS.get(plan or "")
    return entry.features if entry else frozenset()


def plan_label(plan: str | None) -> str:
    entry = PLANS.get(plan or "")
    return entry.label if entry else PLANS[FREE].label


def covering_subscription(subscriptions: Iterable, on: date):
    """The Pro+ year that covers a day, or None. Overlapping years (a renewal
    recorded early) are one cover; the one running longest is returned."""
    covering = [s for s in subscriptions if s.starts_on <= on <= s.ends_on]
    return max(covering, key=lambda s: s.ends_on) if covering else None


def pro_plus_lapse(renews: bool, subscriptions: Iterable, on: date) -> date | None:
    """The day an unpaid Pro+ renewal froze the company, or None (migration 175).

    A company on Pro+ renews Pro+ (`renews_pro_plus`) -- it does not drop onto
    a per-exhibitor plan when its year runs out. From the day after its latest
    year ended until it pays the renewal or picks Basic or Pro, it is on no
    plan at all: it sets up no show, and every show of its that had not
    finished by that day is frozen (`frozen_since`). A company whose only year
    is still to start is not lapsed; it has not had one yet."""
    if not renews or covering_subscription(subscriptions, on) is not None:
        return None
    ended = [s.ends_on for s in subscriptions if s.ends_on < on]
    return max(ended) + timedelta(days=1) if ended else None


def frozen_since(renews: bool, subscriptions: Iterable, show_end: date, on: date) -> date | None:
    """The day a show froze, or None: its company's Pro+ renewal has lapsed and
    the show had not finished by the day it did -- **a show running when the
    year ran out freezes too**, mid-show. A show that finished inside a paid
    year stays open: its results and records are history, not a show being
    run."""
    lapse = pro_plus_lapse(renews, subscriptions, on)
    return lapse if lapse is not None and show_end >= lapse else None


def effective_plan(plan: str | None, subscriptions: Iterable, on: date, renews: bool = False) -> str:
    """The plan a company is on today: Pro+ while a paid year covers the day;
    **Free while a Pro+ renewal is unpaid** (`pro_plus_lapse`) -- no show set
    up, no feature -- and otherwise its per-exhibitor plan, which is what a
    company that chose one returns to when its year runs out."""
    if covering_subscription(subscriptions, on) is not None:
        return PRO_PLUS
    if pro_plus_lapse(renews, subscriptions, on) is not None:
        return FREE
    return plan if plan in PLANS else FREE


def sets_up_shows(plan: str | None) -> bool:
    entry = PLANS.get(plan or "")
    return bool(entry and entry.sets_up_shows)


def show_billing_plan(changes: Iterable, subscriptions: Iterable, start: date, end: date) -> str:
    """The plan one show is invoiced at (migration 169).

    **Pro+ when a paid year covers the show's first day** -- the year is
    unlimited, so a show that starts inside it costs nothing per exhibitor.
    Otherwise **the highest-priced plan the company was on at any point across
    the show's dates**: a company picks its own plan, and pricing the show at
    whatever it is on the day it is invoiced would let it run Pro and move to
    Basic the night the show closed. Free counts as Basic -- no show is free --
    and so does a day on Pro+ that no year covered (migration 175: the log
    records Pro+ as a choice too, and an unpaid renewal is on no plan), so a
    show that started while a renewal was unpaid is priced by whatever the
    company picked to come out of it.

    `changes` are `(changed_at, plan)` pairs, or rows with those attributes;
    each is in effect from the UTC day it was made. With no change on or
    before the first day, the earliest one is taken as the start.
    """
    if covering_subscription(subscriptions, start) is not None:
        return PRO_PLUS
    ordered = sorted(((_change_day(c), _change_plan(c)) for c in changes), key=lambda pair: pair[0])
    if not ordered:
        return BASIC
    before = [plan for day, plan in ordered if day <= start]
    held = [before[-1] if before else ordered[0][1]]
    held += [plan for day, plan in ordered if start < day <= end]
    priced = [BASIC if plan in (FREE, PRO_PLUS) or plan not in PLANS else plan for plan in held]
    return max(priced, key=lambda plan: PLANS[plan].rate_cents)


def _change_day(change) -> date:
    when = change[0] if isinstance(change, tuple) else change.changed_at
    return when.astimezone(timezone.utc).date() if isinstance(when, datetime) else when


def _change_plan(change) -> str:
    return change[1] if isinstance(change, tuple) else change.plan


def next_pro_plus_term(latest_end: date | None, today: date, renewing: bool = False) -> tuple[date, date]:
    """The year a new Pro+ payment buys: from today, or from the day after the
    current year ends when it is a renewal paid early -- so paying a month
    ahead never loses the month. A year runs to the day before its anniversary.

    **A renewal paid late is backdated** (migration 175): a company that
    renews Pro+ (`renewing`) and let its year run out picks up the day after
    it ended, so its years run back to back and every show in between --
    frozen until now -- is covered by the renewal. Paying late never buys a
    later year-end. Once a whole renewal year has gone by unpaid, the next
    year starts today."""
    if latest_end is None:
        starts = today
    elif latest_end >= today or (renewing and _term_from(latest_end + timedelta(days=1))[1] >= today):
        starts = latest_end + timedelta(days=1)
    else:
        starts = today
    return _term_from(starts)


def _term_from(starts: date) -> tuple[date, date]:
    try:
        anniversary = starts.replace(year=starts.year + 1)
    except ValueError:  # 29 February
        anniversary = starts.replace(year=starts.year + 1, day=28)
    return starts, anniversary - timedelta(days=1)


def renewal_reminder_due(subscription, terms: Iterable, today: date) -> bool:
    """Whether a Pro+ year's one renewal reminder should go today: within
    `RENEWAL_NOTICE_DAYS` of its end, not yet sent, and not already renewed by
    another year that picks up by the day after it ends."""
    if subscription.renewal_reminder_sent_at is not None:
        return False
    if not (subscription.ends_on - timedelta(days=RENEWAL_NOTICE_DAYS) <= today <= subscription.ends_on):
        return False
    return not any(
        t is not subscription
        and t.starts_on <= subscription.ends_on + timedelta(days=1)
        and t.ends_on > subscription.ends_on
        for t in terms
    )


# Roles that have every feature without belonging to a company.
ALL_FEATURE_ROLES = frozenset({"ADMIN"})

# Roles that always belong to a company -- the ones that create shows, which
# is where every paid feature so far is used.
SHOW_OFFICE_ROLES = frozenset({"SHOW_MANAGER", "SHOW_SECRETARY"})

FEATURE_NOT_ENABLED = (
    "{label} needs the {plan} subscription, and your show company isn't on it yet. "
    "Choose GaitDesk Pro on My Company -- nothing is charged until after the show."
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
    paid_years: int,
    show_count: int,
    member_ids: set[UUID],
) -> bool:
    """Whether somebody's own company can go now that they work for an
    organization: it is theirs, nobody else is in it, it has no Pro+ year, and
    it runs no show. A Pro+ year is something paid for, and a show is something
    to invoice -- the usage statement lists a company's own shows, so deleting
    the company would leave the show on nobody's (migration 170, which retired
    the feature switches that used to mark a company as paid for)."""
    return owner_user_id == user_id and paid_years == 0 and show_count == 0 and member_ids <= {user_id}


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
    paid_years = await db.scalar(
        select(func.count()).select_from(ShowCompanySubscription).where(ShowCompanySubscription.company_id == own.id)
    )
    show_count = await db.scalar(select(func.count()).select_from(Show).where(Show.company_id == own.id))
    member_ids = set(
        (
            await db.execute(select(ShowCompanyMember.user_id).where(ShowCompanyMember.company_id == own.id))
        ).scalars().all()
    )
    if not is_spare_personal_company(own.owner_user_id, user_id, paid_years or 0, show_count or 0, member_ids):
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
    """Every feature any company this account belongs to has -- through its
    plan or through an add-on switch."""
    company_ids = (
        await db.execute(select(ShowCompanyMember.company_id).where(ShowCompanyMember.user_id == user_id))
    ).scalars().all()
    if not company_ids:
        return set()
    return combined_features((await effective_plans(db, company_ids)).values())


def utc_today() -> date:
    return datetime.now(timezone.utc).date()


async def effective_plans(db: AsyncSession, company_ids: Iterable[UUID], on: date | None = None) -> dict[UUID, str]:
    """Each company's plan on a day (today by default): Pro+ while a paid year
    covers it, Free while its Pro+ renewal is unpaid, else
    `show_companies.plan` -- `effective_plan`, for many companies at once."""
    return {cid: plan for cid, (plan, _lapse) in (await plan_states(db, company_ids, on)).items()}


async def plan_states(
    db: AsyncSession, company_ids: Iterable[UUID], on: date | None = None
) -> dict[UUID, tuple[str, date | None]]:
    """Each company's effective plan on a day, with the day its Pro+ renewal
    lapsed (`pro_plus_lapse`) or None."""
    ids = list(company_ids)
    if not ids:
        return {}
    on = on or utc_today()
    rows = (
        await db.execute(
            select(ShowCompany.id, ShowCompany.plan, ShowCompany.renews_pro_plus).where(ShowCompany.id.in_(ids))
        )
    ).all()
    terms: dict[UUID, list] = {}
    for term in (
        await db.execute(
            select(
                ShowCompanySubscription.company_id,
                ShowCompanySubscription.starts_on,
                ShowCompanySubscription.ends_on,
            ).where(ShowCompanySubscription.company_id.in_(ids))
        )
    ).all():
        terms.setdefault(term.company_id, []).append(term)
    return {
        cid: (
            effective_plan(plan, terms.get(cid, []), on, renews),
            pro_plus_lapse(renews, terms.get(cid, []), on),
        )
        for cid, plan, renews in rows
    }


def combined_features(plans: Iterable[str | None]) -> set[str]:
    """What some companies have between them: every one of their plans'
    features. A plan is the only way to a feature (migration 170)."""
    features: set[str] = set()
    for plan in plans:
        features |= plan_features(plan)
    return features


def company_features(company: ShowCompany, on: date | None = None) -> set[str]:
    """What one loaded company has: its plan's features, today's plan being Pro+
    while a paid year covers it. `company.subscriptions` must be loaded."""
    return combined_features([loaded_effective_plan(company, on)])


def loaded_effective_plan(company: ShowCompany, on: date | None = None) -> str:
    """`effective_plan` for a company loaded with its subscriptions."""
    return effective_plan(company.plan, company.subscriptions, on or utc_today(), company.renews_pro_plus)


def loaded_pro_plus_lapse(company: ShowCompany, on: date | None = None) -> date | None:
    """`pro_plus_lapse` for a company loaded with its subscriptions."""
    return pro_plus_lapse(company.renews_pro_plus, company.subscriptions, on or utc_today())


# What a company is called while its Pro+ renewal is unpaid: on no plan, and
# not "Free", which it never chose.
LAPSED_LABEL = "GaitDesk Pro+ (renewal unpaid)"


def effective_label(effective: str, lapse: date | None) -> str:
    return LAPSED_LABEL if lapse is not None else plan_label(effective)


async def show_company_ids(db: AsyncSession, show_id: UUID) -> list[UUID]:
    """The companies whose plan a show is on.

    The show's own company (migration 156). A show from before then, which its
    office has not given a company yet, is run by its managers, so it is on
    whatever their companies are on -- the same people who had every screen of
    it before plans existed, which is what grandfathering promised them.
    """
    company_id = (await db.execute(select(Show.company_id).where(Show.id == show_id))).scalar_one_or_none()
    if company_id is not None:
        return [company_id]
    rows = await db.execute(
        select(ShowCompanyMember.company_id)
        .join(ShowManager, ShowManager.user_id == ShowCompanyMember.user_id)
        .where(ShowManager.show_id == show_id)
        .distinct()
    )
    return list(rows.scalars().all())


async def show_features(db: AsyncSession, show_id: UUID) -> set[str]:
    """Every feature a show's company has, through its plan or an add-on."""
    company_ids = await show_company_ids(db, show_id)
    if not company_ids:
        return set()
    return combined_features((await effective_plans(db, company_ids)).values())


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
    whom = "their own account (an independent -- no club or firm)" if personal else company_name
    role = _ROLE_LABEL.get(requester_role, requester_role)
    if feature == PRO_PLUS:
        pro_plus = PLANS[PRO_PLUS]
        return (
            f"{requester_name if personal else company_name} asked for {pro_plus.label}",
            f"{requester_name} ({requester_email}, {role}) asked for {pro_plus.label} for {whom}: "
            f"a year of unlimited shows and exhibitors for {_dollars(pro_plus.annual_cents)}.\n\n"
            "Arrange the payment with them, then record it on the company's page -- that starts "
            "their year and answers the request:\n"
            f"{public_app_url()}/admin/companies/{company_id}\n",
        )
    entry = FEATURES[feature]
    subject = f"{requester_name if personal else company_name} asked for {entry.plan}"
    body = (
        f"{requester_name} ({requester_email}, {role}) asked for {entry.plan} for {whom}, "
        f"to use: {entry.label}.\n\n"
        "GaitDesk doesn't take payment in the app, so get in touch with them to arrange it. "
        f"Once it's settled, move the company to {entry.plan} (or switch just this feature on) "
        "-- that answers the request:\n"
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
    if feature not in REQUESTABLE:
        raise HTTPException(404, "No such feature")
    member_of = [c.id for c in await companies_for_user(db, user_id)]
    target = resolve_upgrade_company(role, company_id, member_of)

    company = await db.get(ShowCompany, target)
    current = (await effective_plans(db, [target]))[target]
    if feature == PRO_PLUS:
        # Pro+ is asked for, never pressed on: a GaitDesk admin starts the
        # year (migrations 169, 171).
        if current == PRO_PLUS:
            raise HTTPException(409, f"{company.name} is already on {PLANS[PRO_PLUS].label}.")
    else:
        if feature in plan_features(current):
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
    """Where mail for GaitDesk's admins goes -- an upgrade request, a join
    request, a contact-form message: the address of every ADMIN account that is
    not locked (`users.is_approved` is the account lock), each once.

    A locked admin is left out on purpose: locking is how an account is shut
    off, and a shut-off account should stop receiving customers' messages too.
    """
    rows = await db.execute(select(User.email).where(User.role == "ADMIN", User.is_approved.is_(True)))
    return unique_addresses(rows.scalars().all())


def unique_addresses(addresses: Iterable[str | None]) -> list[str]:
    """Each address once, blanks dropped, first spelling kept -- two spellings
    of one mailbox are one recipient, not two copies of the same email."""
    seen: set[str] = set()
    out: list[str] = []
    for address in addresses:
        cleaned = (address or "").strip()
        if cleaned and cleaned.lower() not in seen:
            seen.add(cleaned.lower())
            out.append(cleaned)
    return out


# How long a failed send waits before its one retry. Long enough for a
# per-second rate limit (Resend's is counted per second) to have moved on.
ADMIN_EMAIL_RETRY_SECONDS = 2.0


async def email_admins(
    recipients: Sequence[str], subject: str, body: str, reply_to: str | None = None
) -> dict[str, bool | None]:
    """Send each admin their own copy, one after another, and retry a failed
    send once.

    Best-effort, and run after the response: `send_email` never raises, and
    nothing about the request depends on whether it arrived. But every admin
    is meant to get it, so two things are guarded against:

    - **A burst.** These went out all at once, and Resend refuses a team's
      sends past its per-second limit -- so the more admins there were, the
      likelier the last few were refused. One at a time keeps the rate down.
    - **One refusal.** A send that fails (`False`: attempted, refused) is tried
      once more after a pause. `None` -- no SMTP configured -- is not retried;
      there is nothing to retry against.

    Returns each address's outcome, and logs a line saying how many admins were
    reached, so a missed admin shows up in the service's logs by address.
    """
    results: dict[str, bool | None] = {}
    for to in unique_addresses(recipients):
        sent = await send_email(to, subject, body, reply_to)
        if sent is False:
            await asyncio.sleep(ADMIN_EMAIL_RETRY_SECONDS)
            sent = await send_email(to, subject, body, reply_to)
        results[to] = sent

    failed = [to for to, sent in results.items() if sent is False]
    if failed:
        logger.warning(
            "Admin email %r reached %d of %d admins; not delivered to %s",
            subject, len(results) - len(failed), len(results), ", ".join(failed),
        )
    elif any(sent for sent in results.values()):
        logger.info("Admin email %r sent to all %d admins", subject, len(results))
    return results


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


SHOW_FEATURE_NOT_ENABLED = (
    "{label} needs the {plan} subscription, and this show's company isn't on it yet. "
    "Its office can choose GaitDesk Pro on My Company -- nothing is charged until after the show."
)


def show_feature_not_enabled_message(feature: str) -> str:
    entry = FEATURES[feature]
    return SHOW_FEATURE_NOT_ENABLED.format(label=entry.label, plan=entry.plan)


def require_show_feature(feature: str):
    """A dependency refusing a caller at a show whose company has not paid for
    `feature` -- for a feature used at a show and billed for that show. Reads
    the `show_id` path parameter, so it only goes on a route under a show; who
    may open the show at all is still the route's own `_assert_show_access`.

    An ADMIN passes without a lookup, as everywhere.
    """
    if feature not in FEATURES:
        raise ValueError(f"Unknown feature: {feature}")

    async def dependency(
        show_id: UUID,
        x_user_role: str = Header(...),
        db: AsyncSession = Depends(get_db),
    ) -> None:
        if x_user_role in ALL_FEATURE_ROLES:
            return
        if feature not in await show_features(db, show_id):
            raise HTTPException(403, show_feature_not_enabled_message(feature))

    return dependency


# ── A show frozen by an unpaid Pro+ renewal (migration 175) ─────────────────────


FROZEN_SHOW = (
    "{name}'s GaitDesk Pro+ year ended on {ended}, so this show is frozen until the company renews "
    "Pro+ or chooses GaitDesk Basic or Pro on My Company. Nothing is lost -- its entries and results "
    "are kept, and exhibitors can still sign up."
)


async def show_freeze(db: AsyncSession, show_id: UUID) -> str | None:
    """Why the office, the gate and the scribes can't work this show, or None.

    Frozen while its company's Pro+ renewal is unpaid, if the show had not
    finished when the year ran out (`frozen_since`). Only a show's own
    company counts: a show from before migration 156 with none is never
    frozen. The caller exempts an ADMIN."""
    row = (
        await db.execute(
            select(Show.end_date, ShowCompany.id, ShowCompany.name, ShowCompany.renews_pro_plus)
            .join(ShowCompany, ShowCompany.id == Show.company_id)
            .where(Show.id == show_id)
        )
    ).first()
    if row is None or not row.renews_pro_plus:
        return None
    terms = (
        await db.execute(
            select(ShowCompanySubscription.starts_on, ShowCompanySubscription.ends_on).where(
                ShowCompanySubscription.company_id == row.id
            )
        )
    ).all()
    since = frozen_since(True, terms, row.end_date, utc_today())
    if since is None:
        return None
    return FROZEN_SHOW.format(name=row.name, ended=_day(since - timedelta(days=1)))


async def refuse_frozen_show(
    show_id: UUID,
    x_user_role: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
) -> None:
    """A dependency refusing (403) work on a frozen show (`show_freeze`), for a
    route under a show whose own access check is a role, not the show office
    (`_assert_show_access` asks itself). An ADMIN passes."""
    if x_user_role in ALL_FEATURE_ROLES:
        return
    message = await show_freeze(db, show_id)
    if message:
        raise HTTPException(403, message)


# ── Choosing a plan, Pro+ years, and setting up a show (migration 169) ─────────


def _dollars(cents: int) -> str:
    return f"${cents / 100:,.0f}" if cents % 100 == 0 else f"${cents / 100:,.2f}"


def set_company_plan(company: ShowCompany, plan: str, changed_by: UUID | None, db: AsyncSession) -> bool:
    """Move a company onto a per-exhibitor plan (or Free), in the caller's
    transaction, and log it -- the log is what a show is priced from
    (`show_billing_plan`). Answers every upgrade request for a feature the
    company now has. Returns False when it was already on that plan.

    **It also stops Pro+ renewing** (migration 175): picking Basic or Pro is
    how a company on Pro+ chooses what follows its year, and how one whose
    renewal is unpaid unfreezes without paying it. So the plan it is already
    on is still a change while Pro+ renews, and is logged as one: the log is
    the company's choice, Pro+ included.

    `company.upgrade_requests` and `company.subscriptions` must be loaded."""
    if plan not in COLUMN_PLANS:
        raise HTTPException(422, "Choose GaitDesk Free, Basic or Pro.")
    if company.plan == plan and not company.renews_pro_plus:
        return False
    company.renews_pro_plus = False
    company.plan = plan
    _log_plan(company, plan, changed_by, db)
    now_has = plan_features(effective_plan(plan, company.subscriptions, utc_today()))
    for request in [r for r in company.upgrade_requests if r.feature in now_has]:
        company.upgrade_requests.remove(request)
    return True


def keep_pro_plus(company: ShowCompany, changed_by: UUID | None, db: AsyncSession) -> bool:
    """Put a company back on renewing Pro+ during a year it has -- the way back
    after choosing Basic or Pro to follow it. Refused (409) with no year in
    force: a lapsed renewal is paid for, never switched back on, or it would
    freeze the company the moment it was pressed. Returns False when it
    already renews. `company.subscriptions` must be loaded."""
    if covering_subscription(company.subscriptions, utc_today()) is None:
        raise HTTPException(409, "Buy a GaitDesk Pro+ year to go back on Pro+.")
    if company.renews_pro_plus:
        return False
    company.renews_pro_plus = True
    _log_plan(company, PRO_PLUS, changed_by, db)
    return True


def _log_plan(company: ShowCompany, plan: str, changed_by: UUID | None, db: AsyncSession) -> None:
    """One row of the plan log a show is priced from (`show_billing_plan`)."""
    db.add(
        ShowCompanyPlanChange(
            company_id=company.id, plan=plan, changed_at=datetime.now(timezone.utc), changed_by_user_id=changed_by
        )
    )


def record_pro_plus(
    company: ShowCompany,
    *,
    starts_on: date,
    ends_on: date,
    price_cents: int,
    payment_method: str | None,
    payment_reference: str | None,
    recorded_by: UUID | None,
    db: AsyncSession,
    payment_received_on: date | None = None,
) -> ShowCompanySubscription:
    """Start a Pro+ year, in the caller's transaction. A GaitDesk admin starts
    one by hand -- paid for, owed (`payment_received_on` None, marked paid
    when the money comes) or complimentary (a price of 0) -- and a card
    processor's confirmation would call this the same way, paid. The year is
    in force from `starts_on` regardless: being paid for it is a fact about
    the money, not about what the company may use (migration 171).

    **The company is on Pro+ from now on, and renews it** (migration 175):
    when the year runs out unpaid it is frozen (`pro_plus_lapse`) until it
    pays the renewal or picks Basic or Pro -- it is not dropped onto `plan`,
    which is left as it was; the plan log records Pro+ as its choice. Answers
    every upgrade request the company has, Pro+ included. `company` must be
    loaded with its upgrade requests and subscriptions."""
    if ends_on < starts_on:
        raise HTTPException(422, "The year can't end before it starts.")
    if price_cents < 0:
        raise HTTPException(422, "The price can't be negative.")
    term = ShowCompanySubscription(
        company_id=company.id,
        plan=PRO_PLUS,
        starts_on=starts_on,
        ends_on=ends_on,
        price_cents=price_cents,
        payment_method=(payment_method or "").strip() or None,
        payment_reference=(payment_reference or "").strip() or None,
        # Nothing is owed on a complimentary year, so it is never "unpaid".
        payment_received_on=payment_received_on if price_cents else (payment_received_on or utc_today()),
        recorded_by_user_id=recorded_by,
    )
    company.subscriptions.append(term)
    if not company.renews_pro_plus:
        company.renews_pro_plus = True
        _log_plan(company, PRO_PLUS, recorded_by, db)
    for request in list(company.upgrade_requests):
        if request.feature in REQUESTABLE:
            company.upgrade_requests.remove(request)
    return term


SHOW_SETUP_LOCKED = (
    "{name} is on GaitDesk Free, which doesn't set up shows. Choose GaitDesk Basic or Pro on "
    "My Company to set one up -- nothing is charged until after the show."
)


PRO_PLUS_LAPSED = (
    "{name}'s GaitDesk Pro+ year ended on {ended}. Renew it, or choose GaitDesk Basic or Pro, on "
    "My Company to set up a show."
)


def _day(value: date) -> str:
    return f"{value:%B} {value.day}, {value.year}"


def _lapsed_refusal(companies: Iterable[tuple[UUID, UUID | None, str]], lapsed: dict[UUID, date]) -> str | None:
    """`PRO_PLUS_LAPSED` for the first of these companies whose Pro+ renewal
    is unpaid, or None. An independent's own company is "Your account"."""
    for cid, owner, name in companies:
        if cid in lapsed:
            return PRO_PLUS_LAPSED.format(
                name=name if owner is None else "Your account",
                ended=_day(lapsed[cid] - timedelta(days=1)),
            )
    return None


def show_setup_choice(
    companies: Sequence[tuple[UUID, UUID | None, str, str]],
    role: str,
    lapsed: dict[UUID, date] | None = None,
) -> UUID | None:
    """Which company a new show runs under, from the creator's companies as
    `(id, owner_user_id, name, effective plan)` -- or None, and Step 1 asks.

    Refuses outright (403) when none of them sets up shows: a Free company can
    staff itself, but a show needs a plan it will be invoiced on. Among the
    ones that do, `default_show_company` decides as before -- a company on
    Free is never picked for a show, even as somebody's only organization.
    An ADMIN is in no company and chooses on Step 1. A company whose Pro+
    renewal is unpaid is on Free until it pays or picks a plan, and `lapsed`
    (company id -> the day it lapsed) lets the refusal say so.
    """
    if role in ALL_FEATURE_ROLES or role not in SHOW_OFFICE_ROLES:
        return None
    able = [(cid, owner) for cid, owner, _name, plan in companies if sets_up_shows(plan)]
    if not able:
        # An independent's own company is named after them; "Jane Smith is on
        # Free" reads their own name back at them.
        named = next((name for _cid, owner, name, _plan in companies if owner is None), None)
        refusal = _lapsed_refusal([(cid, owner, name) for cid, owner, name, _plan in companies], lapsed or {})
        raise HTTPException(403, refusal or SHOW_SETUP_LOCKED.format(name=named or "Your account"))
    return default_show_company(able)


async def show_setup_company_for(db: AsyncSession, user_id: UUID, role: str) -> UUID | None:
    """`show_setup_choice` for the account creating a show: the gate on every
    path that makes one (a new show, a show bill's Create). Also refuses
    (403) while that company has a finished show to pay for (migration 173,
    `gaitdesk_invoices.settle_up_block`)."""
    company_id = await _show_setup_company(db, user_id, role)
    block = await settle_up_block(db, company_id)
    if block:
        raise HTTPException(403, block)
    return company_id


async def settle_up_block(db: AsyncSession, company_id: UUID | None) -> str | None:
    """Why this company cannot set up another show until it pays for one it
    ran, or None. An ADMIN's shows are never held back -- the gate is only
    asked on a show office's own paths."""
    # Imported here: gaitdesk_invoices reads PLANS and pricing from this module.
    from gaitdesk_invoices import settle_up_block as block_for

    return await block_for(db, company_id)


async def show_setup_blocked(db: AsyncSession, user_id: UUID, role: str) -> str | None:
    """What the New Show page says instead of Step 1 while the caller's company
    owes for a finished show -- never the enforcement, which is
    `show_setup_company_for`. None when nothing holds it back, including when
    the company is on Free (that wall is `can_set_up_shows`)."""
    try:
        company_id = await _show_setup_company(db, user_id, role)
    except HTTPException:
        return None
    return await settle_up_block(db, company_id)


async def _member_companies(db: AsyncSession, user_id: UUID) -> list:
    return (
        await db.execute(
            select(ShowCompany.id, ShowCompany.owner_user_id, ShowCompany.name)
            .join(ShowCompanyMember, ShowCompanyMember.company_id == ShowCompany.id)
            .where(ShowCompanyMember.user_id == user_id)
        )
    ).all()


async def pro_plus_lapsed_message(db: AsyncSession, user_id: UUID, role: str) -> str | None:
    """What the New Show page says in place of its GaitDesk Free wording when
    the caller can't set up a show because their company's Pro+ renewal is
    unpaid (migration 175) -- the words `show_setup_company_for` refuses
    with. Never the enforcement."""
    if role in ALL_FEATURE_ROLES or role not in SHOW_OFFICE_ROLES:
        return None
    rows = await _member_companies(db, user_id)
    states = await plan_states(db, [r[0] for r in rows])
    if any(sets_up_shows(plan) for plan, _lapse in states.values()):
        return None
    return _lapsed_refusal(rows, {cid: lapse for cid, (_plan, lapse) in states.items() if lapse is not None})


async def _show_setup_company(db: AsyncSession, user_id: UUID, role: str) -> UUID | None:
    if role in ALL_FEATURE_ROLES or role not in SHOW_OFFICE_ROLES:
        return None
    rows = await _member_companies(db, user_id)
    states = await plan_states(db, [r[0] for r in rows])
    return show_setup_choice(
        [(cid, owner, name, states.get(cid, (FREE, None))[0]) for cid, owner, name in rows],
        role,
        lapsed={cid: lapse for cid, (_plan, lapse) in states.items() if lapse is not None},
    )


async def can_set_up_shows(db: AsyncSession, user_id: UUID, role: str) -> bool:
    """Whether the caller may create a show at all -- what the New Show button
    asks. Never the enforcement; `show_setup_company_for` is."""
    if role in ALL_FEATURE_ROLES:
        return True
    if role not in SHOW_OFFICE_ROLES:
        return False
    company_ids = (
        await db.execute(select(ShowCompanyMember.company_id).where(ShowCompanyMember.user_id == user_id))
    ).scalars().all()
    return any(sets_up_shows(plan) for plan in (await effective_plans(db, company_ids)).values())


# ── Telling the company's show managers (migration 169) ───────────────────────


async def company_manager_emails(db: AsyncSession, company_id: UUID) -> list[str]:
    """Who hears about the company's plan: its show managers, or -- for a
    company with none, an independent secretary's own -- everybody in it."""
    rows = (
        await db.execute(
            select(User.email, User.role)
            .join(ShowCompanyMember, ShowCompanyMember.user_id == User.id)
            .where(ShowCompanyMember.company_id == company_id)
        )
    ).all()
    managers = [email for email, role in rows if role == "SHOW_MANAGER"]
    return unique_addresses(managers or [email for email, _role in rows])


def plan_confirmation_email(
    company_name: str,
    plan: str,
    *,
    term: tuple[date, date] | None = None,
    returns_to: str | None = None,
    renews: bool = False,
) -> tuple[str, str]:
    """What the company's show managers are sent once it is on a plan. For a
    Pro+ year, what follows it: Pro+ again when it `renews` (and the freeze
    while that is unpaid), else the plan it `returns_to`."""
    entry = PLANS[plan]
    lines = [f"{company_name} is now on {entry.label}.", ""]
    if plan == PRO_PLUS and term is not None:
        starts, ends = term
        lines += [
            f"Your year runs from {starts:%B %-d, %Y} through {ends:%B %-d, %Y}: unlimited shows and "
            "exhibitors, with every GaitDesk Pro feature, and no per-exhibitor charge for any show "
            "that starts in it.",
            "",
            (
                f"It renews as {entry.label} for {_dollars(entry.annual_cents)}, and we'll email you a month "
                f"before it ends. Until the renewal is paid, from the day after {ends:%B %-d, %Y} "
                f"{company_name} can't set up a show, and its shows still running or still to come are "
                "frozen. Choose GaitDesk Basic or Pro on My Company any time to follow it with one of those "
                "instead."
            )
            if renews
            else (
                f"We'll email you a month before it ends. If it isn't renewed by {ends:%B %-d, %Y}, "
                f"{company_name} moves to {plan_label(returns_to)}"
                + (f", billed {_dollars(PLANS[returns_to].rate_cents)} per exhibitor after each show." if returns_to in PLANS and PLANS[returns_to].rate_cents else ".")
            ),
        ]
    elif entry.rate_cents:
        lines += [
            f"Each show is billed {_dollars(entry.rate_cents)} per exhibitor registered to it, after the "
            "show -- nothing is charged until then. You can set up shows now; once a show has finished, "
            "it is paid for before the next one is set up. Settle up on My Company by card or bank "
            "transfer, or by check.",
        ]
    else:
        lines += ["Choose GaitDesk Basic or Pro on My Company when you're ready to set up a show."]
    lines += ["", "What it includes:"] + [f"  - {line}" for line in entry.includes]
    lines += ["", f"Your plan, any time: {public_app_url()}/admin/my-company"]
    return f"{company_name} is on {entry.label}", "\n".join(lines) + "\n"


def renewal_reminder_email(
    company_name: str, ends_on: date, returns_to: str, renews: bool = False
) -> tuple[str, str]:
    """The one reminder a month before a Pro+ year ends: what happens without
    the renewal -- the freeze when the company renews Pro+ (migration 175),
    else the plan it chose to follow it."""
    pro_plus = PLANS[PRO_PLUS]
    after = PLANS.get(returns_to) or PLANS[PRO]
    consequence = (
        f"{company_name} moves to {after.label}: it keeps setting up shows"
        + (
            f", and each show that starts after then is billed {_dollars(after.rate_cents)} per exhibitor "
            "registered to it."
            if after.rate_cents
            else "."
        )
    )
    if not after.sets_up_shows:
        consequence = f"{company_name} moves to {after.label} and can't set up new shows until it picks a plan."
    if after.features != pro_plus.features:
        consequence += " The GaitDesk Pro features -- reports, Live Boards, the show bill import and exports -- turn off."
    if renews:
        consequence = (
            f"{company_name} can't set up a show, and its shows still running or still to come are frozen -- "
            "nobody in its office, at its gate or scribing can work them -- until you renew, or choose "
            "GaitDesk Basic or Pro on My Company. Exhibitors can still sign up."
        )
    body = (
        f"{company_name}'s {pro_plus.label} year ends on {ends_on:%B %-d, %Y}.\n\n"
        f"Renew for another year of unlimited shows and exhibitors for {_dollars(pro_plus.annual_cents)}: "
        "reply to this email or contact GaitDesk, and the new year starts the day after this one ends.\n\n"
        f"If it isn't renewed by {ends_on:%B %-d, %Y}: {consequence} Nothing is lost -- your shows, "
        "entries and results stay as they are.\n\n"
        f"Your plan, any time: {public_app_url()}/admin/my-company\n"
    )
    return f"{company_name}'s {pro_plus.label} year ends {ends_on:%B %-d}", body


async def send_renewal_reminders(db: AsyncSession, today: date | None = None) -> int:
    """Send each Pro+ year's renewal reminder, once, to its company's managers.

    Each is **claimed before it is sent**: the row is marked in an UPDATE that
    only succeeds while it is unmarked, so two workers running the check at
    once send it once between them. Nothing is claimed without SMTP -- the
    renewal banner on My Company tells the company either way, and a reminder
    claimed with nowhere to send it would never go. Returns how many went."""
    from mailer import smtp_configured

    if not smtp_configured():
        return 0
    today = today or utc_today()
    window_end = today + timedelta(days=RENEWAL_NOTICE_DAYS)
    candidates = (
        await db.execute(
            select(ShowCompanySubscription).where(
                ShowCompanySubscription.renewal_reminder_sent_at.is_(None),
                ShowCompanySubscription.ends_on >= today,
                ShowCompanySubscription.ends_on <= window_end,
            )
        )
    ).scalars().all()
    sent = 0
    for term in candidates:
        terms = (
            await db.execute(
                select(ShowCompanySubscription).where(ShowCompanySubscription.company_id == term.company_id)
            )
        ).scalars().all()
        if not renewal_reminder_due(term, terms, today):
            continue
        claimed = (
            await db.execute(
                update(ShowCompanySubscription)
                .where(
                    ShowCompanySubscription.id == term.id,
                    ShowCompanySubscription.renewal_reminder_sent_at.is_(None),
                )
                .values(renewal_reminder_sent_at=datetime.now(timezone.utc))
                .returning(ShowCompanySubscription.id)
            )
        ).first()
        await db.commit()
        if claimed is None:
            continue
        company = await db.get(ShowCompany, term.company_id)
        recipients = await company_manager_emails(db, term.company_id)
        if company is None or not recipients:
            continue
        subject, body = renewal_reminder_email(company.name, term.ends_on, company.plan, company.renews_pro_plus)
        await email_admins(recipients, subject, body)
        sent += 1
    return sent


# How often the renewal check runs. Daily is enough -- a reminder is a month
# early -- and six hours means a restart never costs more than a quarter-day.
RENEWAL_CHECK_SECONDS = 6 * 60 * 60


async def renewal_reminder_loop(session_factory) -> None:
    """Run `send_renewal_reminders` now and every `RENEWAL_CHECK_SECONDS`, for
    the life of the process. One failure is logged and the loop carries on."""
    while True:
        try:
            async with session_factory() as db:
                count = await send_renewal_reminders(db)
            if count:
                logger.info("Sent %d Pro+ renewal reminder(s)", count)
        except Exception:  # noqa: BLE001 -- a bad night must not end the loop
            logger.exception("Pro+ renewal reminder check failed")
        await asyncio.sleep(RENEWAL_CHECK_SECONDS)
