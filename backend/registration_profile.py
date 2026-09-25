"""What one show's registration holds about the exhibitor, apart from their profile.

Migration 145. The registration wizard's first three steps -- the exhibitor's
details, their memberships, their horses -- used to write the profile itself.
So taking a horse off one show's registration took it off the profile, and a
phone number corrected for one weekend was rewritten for every show. Two rules
replace that:

* **The profile prepopulates the registration and is never written by it.**
  Every registration write lands on `show_registration_profiles` and its two
  child tables.
* **Each step follows the profile until something in that step changes.** A
  `*_saved_at` of NULL means the step reads the profile live, so a registration
  nobody edited keeps up with a profile corrected afterwards, and every
  registration made before this table existed needs no backfill. The first edit
  copies that step's profile answers into the registration (`take_details`,
  `take_memberships`, `take_horses`) and applies the change to the copy. From
  then on the copy is the answer, even when it is empty -- a registration with
  every horse removed has no horses, not the profile's.

**Everything the show reads about the exhibitor goes through here** -- the
registration screen, the desk's contact block and membership sign-offs, the
association rules' date of birth, the compliance report, the APHA export. A
screen that read the profile directly would quietly drop whatever the exhibitor
changed for this show. `ShowExhibitorView` is the drop-in: an `Exhibitor` as
one show sees it, so code written against the ORM row works unchanged.

**One exception, by decision: a horse created during registration also goes on
the profile.** A brand-new horse is a new record either way, and keeping it off
the profile would mean creating it again for the next show. Removing a horse,
re-adding one, and the owner-relationship answer all stay with the show.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Iterable, Optional
from uuid import UUID

from sqlalchemy import select, union
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import (
    ExhibitorHorse,
    Horse,
    ShowRegistrationHorse,
    ShowRegistrationMembership,
    ShowRegistrationProfile,
)

#: The contact details, date of birth and emergency contact the details step
#: asks for. `full_name` is not here on purpose: it belongs to the account and
#: prints on everything, and the details step never had a box for it.
DETAIL_FIELDS = (
    "date_of_birth",
    "phone",
    "address",
    "city",
    "state",
    "zip",
    "emergency_contact_name",
    "emergency_contact_phone",
    "parent_guardian_name",
    "parent_guardian_phone",
)


def _now() -> datetime:
    # A Python value rather than `func.now()`: a server-side default comes back
    # expired after the flush, and the very next thing every caller does is read
    # `*_saved_at is not None` -- a lazy load in an async request.
    return datetime.now(timezone.utc)


# ── Which answer a step reads ─────────────────────────────────────────────────


def owns_details(copy) -> bool:
    return copy is not None and copy.details_saved_at is not None


def owns_memberships(copy) -> bool:
    return copy is not None and copy.memberships_saved_at is not None


def owns_horses(copy) -> bool:
    return copy is not None and copy.horses_saved_at is not None


class ShowExhibitorView:
    """An exhibitor as one show sees them.

    Stands in for the `Exhibitor` row anywhere the show reads details or
    memberships: the detail fields and `registrations` come from the show's copy
    when that step has one, and everything else -- `id`, `full_name`, `user`,
    `email` -- falls through to the row. Read-only on purpose: nothing written
    to this reaches either record, so a caller cannot write the profile by
    accident through it.
    """

    __slots__ = ("_exhibitor", "_copy")

    def __init__(self, exhibitor, copy=None):
        object.__setattr__(self, "_exhibitor", exhibitor)
        object.__setattr__(self, "_copy", copy)

    def __getattr__(self, name):
        copy = object.__getattribute__(self, "_copy")
        if name in DETAIL_FIELDS and owns_details(copy):
            return getattr(copy, name)
        if name == "registrations" and owns_memberships(copy):
            return copy.memberships
        return getattr(object.__getattribute__(self, "_exhibitor"), name)

    def __setattr__(self, name, value):
        raise AttributeError("ShowExhibitorView is read-only")

    @property
    def exhibitor(self):
        """The profile row underneath, for the few readers that want it."""
        return object.__getattribute__(self, "_exhibitor")


def exhibitor_views(exhibitors: Iterable, copies: dict) -> dict:
    """`{exhibitor_id: view}` for the exhibitors who have a copy at this show.

    What an association rule check over many entries passes in its context as
    `exhibitor_views` -- see `DefaultRules.exhibitor_of`. Exhibitors with no copy
    are left out, because their answer is the row the entry already carries.
    """
    out = {}
    for exhibitor in exhibitors:
        if exhibitor is None:
            continue
        copy = copies.get(exhibitor.id)
        if copy is not None:
            out[exhibitor.id] = ShowExhibitorView(exhibitor, copy)
    return out


# ── Copying a step out of the profile ─────────────────────────────────────────


def _clean(value):
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def details_match(values: dict, source) -> bool:
    """Whether a submitted details form says exactly what `source` already does.

    A blank and a missing value are the same answer, so pressing *Save &
    continue* over a form that was only prefilled keeps the registration
    following the profile rather than freezing an identical copy of it.
    """
    return all(_clean(values.get(f)) == _clean(getattr(source, f, None)) for f in DETAIL_FIELDS)


def take_details(copy, exhibitor) -> None:
    """Copy the profile's details into the registration, once."""
    if owns_details(copy):
        return
    for field in DETAIL_FIELDS:
        setattr(copy, field, getattr(exhibitor, field, None))
    copy.details_saved_at = _now()


def take_memberships(copy, profile_registrations: Iterable) -> None:
    """Copy the profile's memberships into the registration, once."""
    if owns_memberships(copy):
        return
    for reg in profile_registrations:
        row = ShowRegistrationMembership(
            id=uuid.uuid4(),
            association_id=reg.association_id,
            member_number=reg.member_number,
            expires_at=reg.expires_at,
        )
        # Carried across so the row serializes before the next read -- a pending
        # object has nothing to lazy-load its association from.
        association = getattr(reg, "association", None)
        if association is not None:
            row.association = association
        copy.memberships.append(row)
    copy.memberships_saved_at = _now()


def take_horses(copy, profile_links: dict) -> None:
    """Copy the profile's horses, and the relationships answered on them, once."""
    if owns_horses(copy):
        return
    for horse_id, relationship in profile_links.items():
        copy.horses.append(
            ShowRegistrationHorse(
                id=uuid.uuid4(), horse_id=horse_id, relationship_to_owner=relationship
            )
        )
    copy.horses_saved_at = _now()


def horse_links(copy, profile_links: dict) -> dict:
    """`{horse_id: stored relationship}` for the horses on this registration.

    The profile's own list while the horses step follows it; the registration's
    rows once it does not -- including when there are none.
    """
    if owns_horses(copy):
        return {h.horse_id: h.relationship_to_owner for h in copy.horses}
    return dict(profile_links)


# ── Reading ───────────────────────────────────────────────────────────────────


def _copy_options():
    return (
        selectinload(ShowRegistrationProfile.horses),
        selectinload(ShowRegistrationProfile.memberships),
    )


async def load_copy(
    show_id: UUID, exhibitor_id: UUID, db: AsyncSession
) -> Optional[ShowRegistrationProfile]:
    """This exhibitor's copy at this show, or None while every step follows the
    profile. Refreshed rather than served from the identity map, because callers
    read it again straight after a write and a stale collection there is the
    `populate_existing` footgun in Claude.md."""
    result = await db.execute(
        select(ShowRegistrationProfile)
        .options(*_copy_options())
        .where(
            ShowRegistrationProfile.show_id == show_id,
            ShowRegistrationProfile.exhibitor_id == exhibitor_id,
        )
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def load_copies_for_show(
    show_id: UUID, db: AsyncSession, exhibitor_ids: Optional[Iterable[UUID]] = None
) -> dict:
    """`{exhibitor_id: copy}` for one show -- one query for a whole roster."""
    query = (
        select(ShowRegistrationProfile)
        .options(*_copy_options())
        .where(ShowRegistrationProfile.show_id == show_id)
    )
    if exhibitor_ids is not None:
        ids = list(exhibitor_ids)
        if not ids:
            return {}
        query = query.where(ShowRegistrationProfile.exhibitor_id.in_(ids))
    result = await db.execute(query)
    return {copy.exhibitor_id: copy for copy in result.scalars().all()}


async def load_copies_for_exhibitor(
    exhibitor_id: UUID, show_ids: Iterable[UUID], db: AsyncSession
) -> dict:
    """`{show_id: copy}` for one exhibitor across several shows."""
    ids = list(show_ids)
    if not ids:
        return {}
    result = await db.execute(
        select(ShowRegistrationProfile)
        .options(*_copy_options())
        .where(
            ShowRegistrationProfile.exhibitor_id == exhibitor_id,
            ShowRegistrationProfile.show_id.in_(ids),
        )
    )
    return {copy.show_id: copy for copy in result.scalars().all()}


async def get_or_create_copy(
    show_id: UUID, exhibitor_id: UUID, db: AsyncSession
) -> ShowRegistrationProfile:
    """The copy to write to, created on the first registration edit at this show.

    Not committed: the caller owns the transaction, and the step's first edit
    belongs in the same unit of work as the copy it lands on.
    """
    copy = await load_copy(show_id, exhibitor_id, db)
    if copy is not None:
        return copy
    copy = ShowRegistrationProfile(id=uuid.uuid4(), show_id=show_id, exhibitor_id=exhibitor_id)
    # Initialized before the flush makes the row persistent: appending to a
    # collection SQLAlchemy has never loaded is a lazy load in an async session.
    copy.horses = []
    copy.memberships = []
    db.add(copy)
    await db.flush()
    return copy


async def profile_horse_links(exhibitor_id: UUID, db: AsyncSession) -> dict:
    """`{horse_id: relationship}` for the horses on the exhibitor's profile.

    A horse reaches a profile by being created by the exhibitor or through an
    `exhibitor_horses` link -- the same two routes `/my-horses` reads. A horse
    that only names them as owner is deliberately absent, as it always was from
    the registration picker. The relationship is the one answered on the link
    row, None where nobody has answered.
    """
    created = select(Horse.id).where(Horse.created_by_exhibitor_id == exhibitor_id)
    linked = (
        select(Horse.id)
        .join(ExhibitorHorse, ExhibitorHorse.horse_id == Horse.id)
        .where(ExhibitorHorse.exhibitor_id == exhibitor_id)
    )
    combined = union(created, linked).subquery()
    ids = {row[0] for row in (await db.execute(select(combined.c.id))).all()}
    if not ids:
        return {}
    links: dict = {horse_id: None for horse_id in ids}
    rows = await db.execute(
        select(ExhibitorHorse.horse_id, ExhibitorHorse.relationship_to_owner).where(
            ExhibitorHorse.exhibitor_id == exhibitor_id,
            ExhibitorHorse.horse_id.in_(ids),
        )
    )
    for horse_id, relationship in rows.all():
        links[horse_id] = relationship
    return links


async def registration_horse_links(
    show_id: UUID, exhibitor_id: UUID, db: AsyncSession, copy=None
) -> dict:
    """The horses on this exhibitor's registration at this show, with the
    relationship stored for each. Pass `copy` when it is already loaded."""
    if copy is None:
        copy = await load_copy(show_id, exhibitor_id, db)
    if owns_horses(copy):
        return horse_links(copy, {})
    return await profile_horse_links(exhibitor_id, db)


async def relationship_for(
    show_id: UUID, exhibitor_id: UUID, horse_id: UUID, db: AsyncSession
) -> Optional[str]:
    """The relationship this show holds for one horse, for the desk's entry door.

    The registration's answer where the horse is on its own list; the profile's
    link otherwise -- which covers a registration still following the profile
    and a horse the office enters that the exhibitor never listed.
    """
    copy = await load_copy(show_id, exhibitor_id, db)
    if owns_horses(copy):
        for row in copy.horses:
            if row.horse_id == horse_id:
                return row.relationship_to_owner
    result = await db.execute(
        select(ExhibitorHorse.relationship_to_owner).where(
            ExhibitorHorse.exhibitor_id == exhibitor_id,
            ExhibitorHorse.horse_id == horse_id,
        )
    )
    return result.scalar_one_or_none()


async def add_horse(
    show_id: UUID,
    exhibitor_id: UUID,
    horse_id: UUID,
    relationship: Optional[str],
    db: AsyncSession,
) -> bool:
    """Put a profile horse on this show's registration. Not committed.

    Nothing to do while the horses step follows the profile -- the horse is
    already listed by being on it. Returns whether a row was written.
    """
    copy = await load_copy(show_id, exhibitor_id, db)
    if not owns_horses(copy):
        return False
    if any(row.horse_id == horse_id for row in copy.horses):
        return False
    copy.horses.append(
        ShowRegistrationHorse(
            id=uuid.uuid4(), horse_id=horse_id, relationship_to_owner=relationship
        )
    )
    return True


def membership_for(view, association_id) -> Optional[object]:
    """The membership this show holds for one association, or None."""
    for reg in view.registrations or []:
        if reg.association_id == association_id:
            return reg
    return None
