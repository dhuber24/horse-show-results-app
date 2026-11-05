"""Whether a show company has shown who it is, and who it reaches until it has
(migration 180).

Anybody can sign up as a Show Secretary or Manager, be approved at once, choose a
plan and set up a show. The office reads a person through a show it works, so
putting somebody on a roster was all it took to read their phone, home address,
emergency contact and guardian. Nothing else about that person had to be true,
not that they were at the show nor that they had ever heard of it.

So a company is **verified**, by a GaitDesk admin at Manage Subscriptions or by
paying GaitDesk for the first time (`show_companies.verify_company`). Until it is,
it reaches only:

- people on the roster of one of its shows or entered at one, who can only have
  got there by signing up, since every other way on asks here first; and
- people it typed in itself, until an account has taken the record over;

and their horses. A verified company works as it always did, and a GaitDesk admin
reaches anybody at anybody's show.

There are two questions, because there are two kinds of door. **At a show**, what
counts is the show's company, whoever is asking, since that is who gets to read the
person afterwards. **Away from a show** (a person's horse list, a horse's documents,
the staff pickers) there is no show to ask about, so what counts is the caller: the
companies they are in and the shows they work.

Every door that puts a person on a roster is pinned by
`tests/test_company_verification.py`, and a new one fails it until somebody decides.
"""
from dataclasses import dataclass
from typing import Callable, Iterable, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, or_, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies import safe_uuid
from models import (
    Class,
    Entry,
    Exhibitor,
    ExhibitorHorse,
    Horse,
    Judge,
    Show,
    ShowCompany,
    ShowCompanyMember,
    ShowEntry,
    ShowManager,
)
from show_access import SHOW_OFFICE_TABLES, worked_show_ids
from show_companies import show_company_ids

NOT_VERIFIED_CODE = "COMPANY_NOT_VERIFIED"


def not_verified() -> HTTPException:
    return HTTPException(
        403,
        {
            "code": NOT_VERIFIED_CODE,
            "message": (
                "GaitDesk hasn't verified this show's company yet. Until it has, the office "
                "can add people who signed up to one of its shows, or type somebody in. "
                "Ask for verification on My Company."
            ),
        },
    )


@dataclass(frozen=True)
class _Reach:
    """The shows whose people are within reach, and the accounts whose typed-in
    records count."""

    shows: list[UUID]
    typists: list[UUID]


def _people(reach: _Reach):
    """A SELECT of the exhibitors within reach."""
    within = union(
        select(ShowEntry.exhibitor_id.label("id")).where(ShowEntry.show_id.in_(reach.shows)),
        select(Entry.exhibitor_id.label("id"))
        .join(Class, Class.id == Entry.class_id)
        .where(Class.show_id.in_(reach.shows)),
        # Once an account has the record it is a person, not something the office
        # typed: an admin can link one, and a merge can move one onto it.
        select(Exhibitor.id.label("id")).where(
            Exhibitor.user_id.is_(None),
            Exhibitor.created_by_user_id.in_(reach.typists),
        ),
    ).subquery()
    return select(within.c.id)


def _horses(reach: _Reach, *, documents: bool = False):
    """A SELECT of the horses on those people's profiles.

    `documents` is for reading a horse's paperwork, and is narrower. Anybody can
    link a horse nobody owns to their own profile
    (`people.link_existing_horse_to_self`), so that link says nothing about whether
    its Coggins is theirs to read. A link to a horse with an owner took the owner's
    consent, so it counts either way.
    """
    people = _people(reach)
    linked = select(ExhibitorHorse.horse_id.label("id")).where(ExhibitorHorse.exhibitor_id.in_(people))
    if documents:
        linked = linked.join(Horse, Horse.id == ExhibitorHorse.horse_id).where(
            Horse.owner_exhibitor_id.is_not(None)
        )
    within = union(
        select(Horse.id.label("id")).where(
            or_(Horse.owner_exhibitor_id.in_(people), Horse.created_by_exhibitor_id.in_(people))
        ),
        linked,
    ).subquery()
    return select(within.c.id)


async def _any_verified(db: AsyncSession, company_ids: Iterable[UUID]) -> bool:
    company_ids = list(company_ids)
    if not company_ids:
        return False
    found = await db.scalar(
        select(func.count())
        .select_from(ShowCompany)
        .where(ShowCompany.id.in_(company_ids), ShowCompany.verified_at.is_not(None))
    )
    return bool(found)


async def _members(db: AsyncSession, company_ids: Iterable[UUID]) -> list[UUID]:
    rows = await db.execute(
        select(ShowCompanyMember.user_id).where(ShowCompanyMember.company_id.in_(list(company_ids)))
    )
    return list(rows.scalars().all())


async def _companies_of(db: AsyncSession, user_id: UUID) -> list[UUID]:
    rows = await db.execute(
        select(ShowCompanyMember.company_id).where(ShowCompanyMember.user_id == user_id)
    )
    return list(rows.scalars().all())


# ── At a show: the show's company ──────────────────────────────────────────


async def show_is_verified(db: AsyncSession, show_id: UUID) -> bool:
    return await _any_verified(db, await show_company_ids(db, show_id))


async def show_reaches_everybody(db: AsyncSession, show_id: UUID, role: str) -> bool:
    """Whether the office at this show may bring anybody to it."""
    return role == "ADMIN" or await show_is_verified(db, show_id)


async def _show_reach(db: AsyncSession, show_id: UUID, user_id: str) -> _Reach:
    company_ids = await show_company_ids(db, show_id)
    shows = await db.execute(
        select(Show.id).where(or_(Show.id == show_id, Show.company_id.in_(company_ids)))
    )
    return _Reach(
        shows=list(shows.scalars().all()),
        # The caller too: a secretary at this one show need not be in its company.
        typists=[safe_uuid(user_id), *await _members(db, company_ids)],
    )


async def people_within_reach_of_show(db: AsyncSession, show_id: UUID, user_id: str):
    """A SELECT of who this show's company may reach, for filtering a list. The
    caller asks `show_reaches_everybody` first."""
    return _people(await _show_reach(db, show_id, user_id))


async def _within(db: AsyncSession, reach: _Reach, exhibitor_ids: set[UUID]) -> set[UUID]:
    rows = await db.execute(
        select(Exhibitor.id).where(Exhibitor.id.in_(exhibitor_ids), Exhibitor.id.in_(_people(reach)))
    )
    return set(rows.scalars().all())


async def exhibitors_out_of_reach(
    db: AsyncSession, show_id: UUID, exhibitor_ids: Iterable[UUID], user_id: str, role: str
) -> set[UUID]:
    """Which of these people this show's office may not reach."""
    wanted = set(exhibitor_ids)
    if not wanted or await show_reaches_everybody(db, show_id, role):
        return set()
    return wanted - await _within(db, await _show_reach(db, show_id, user_id), wanted)


async def assert_may_reach_exhibitors(
    db: AsyncSession, show_id: UUID, exhibitor_ids: Iterable[UUID], user_id: str, role: str
) -> None:
    if await exhibitors_out_of_reach(db, show_id, exhibitor_ids, user_id, role):
        raise not_verified()


async def assert_may_reach_horse(
    db: AsyncSession, show_id: UUID, horse_id: UUID, user_id: str, role: str
) -> None:
    """A horse brought to this show has to be on the profile of somebody the office
    may reach, so that a typed-in name cannot be used to reach any horse."""
    if await show_reaches_everybody(db, show_id, role):
        return
    reach = await _show_reach(db, show_id, user_id)
    within = await db.scalar(select(Horse.id).where(Horse.id == horse_id, Horse.id.in_(_horses(reach))))
    if within is None:
        raise not_verified()


async def assert_may_enter(
    db: AsyncSession, show_id: UUID, exhibitor_id: UUID, horse_id: UUID, user_id: str, role: str
) -> None:
    """The office entering somebody on a horse. One check for a verified company,
    since this runs at a counter with a queue behind it."""
    if await show_reaches_everybody(db, show_id, role):
        return
    reach = await _show_reach(db, show_id, user_id)
    if not await _within(db, reach, {exhibitor_id}):
        raise not_verified()
    within = await db.scalar(select(Horse.id).where(Horse.id == horse_id, Horse.id.in_(_horses(reach))))
    if within is None:
        raise not_verified()


# ── Away from a show: the caller ────────────────────────────────────────────


async def _worked_shows(db: AsyncSession, caller: UUID, role: str) -> list[UUID]:
    return list((await db.execute(worked_show_ids(caller, role))).scalars().all())


async def caller_is_verified(db: AsyncSession, user_id: str, role: str) -> bool:
    """Whether this office account answers to a verified company: by being in one,
    or by working a show of one, which a verified company asked them to."""
    if role == "ADMIN":
        return True
    if role not in SHOW_OFFICE_TABLES:
        return False
    caller = safe_uuid(user_id)
    worked = await _worked_shows(db, caller, role)
    companies = await db.execute(
        union(
            select(Show.company_id.label("id")).where(Show.id.in_(worked), Show.company_id.is_not(None)),
            # A show from before shows had companies is on its managers' companies.
            select(ShowCompanyMember.company_id.label("id"))
            .join(ShowManager, ShowManager.user_id == ShowCompanyMember.user_id)
            .join(Show, Show.id == ShowManager.show_id)
            .where(Show.id.in_(worked), Show.company_id.is_(None)),
        )
    )
    return await _any_verified(db, {*companies.scalars().all(), *await _companies_of(db, caller)})


async def _caller_reach(db: AsyncSession, user_id: str, role: str) -> _Reach:
    caller = safe_uuid(user_id)
    return _Reach(
        shows=await _worked_shows(db, caller, role),
        typists=[caller, *await _members(db, await _companies_of(db, caller))],
    )


async def caller_may_reach_exhibitor(db: AsyncSession, user_id: str, role: str, exhibitor_id: UUID) -> bool:
    if await caller_is_verified(db, user_id, role):
        return True
    if role not in SHOW_OFFICE_TABLES:
        return False
    return bool(await _within(db, await _caller_reach(db, user_id, role), {exhibitor_id}))


async def caller_may_read_horse_documents(db: AsyncSession, user_id: str, role: str, horse_id: UUID) -> bool:
    if await caller_is_verified(db, user_id, role):
        return True
    if role not in SHOW_OFFICE_TABLES:
        return False
    reach = await _caller_reach(db, user_id, role)
    within = await db.scalar(
        select(Horse.id).where(Horse.id == horse_id, Horse.id.in_(_horses(reach, documents=True)))
    )
    return within is not None


async def colleagues_of(db: AsyncSession, user_id: str) -> list[UUID]:
    """Everybody in the caller's companies, the caller among them."""
    caller = safe_uuid(user_id)
    return [caller, *await _members(db, await _companies_of(db, caller))]


# ── A judge's contact details ───────────────────────────────────────────────


async def judge_contact_rule(
    db: AsyncSession, user_id: str, role: str, show_id: Optional[UUID] = None
) -> Callable[[Judge], bool]:
    """Whose contact details this caller may read, as a test on a judge. Everybody's
    at a verified company; otherwise only a judge somebody there typed in, since the
    registry is everybody's judges and a name is all that picking one takes."""
    if show_id is None:
        everybody = await caller_is_verified(db, user_id, role)
    else:
        everybody = await show_reaches_everybody(db, show_id, role)
    if everybody:
        return lambda _judge: True
    reach = await (_caller_reach(db, user_id, role) if show_id is None else _show_reach(db, show_id, user_id))
    typists = set(reach.typists)
    return lambda judge: judge.created_by_user_id in typists
