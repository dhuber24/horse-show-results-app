"""Saddle clubs, and saddle-club high point (migration 193).

WSCA's members are saddle clubs, and its Championship Show awards high point
"to the Saddle Club and Individuals". A rider's club is a membership on their
profile (`exhibitor_registrations`, an `associations` row of type
`saddle_club`), which the desk verifies like any other. The rest is the show
office's to set up, because shows score clubs differently:

* **Whether the show keeps club standings, and which clubs compete**
  (`show_club_points`, `show_club_point_clubs`). No row: no club standings.
* **How many clubs one rider may ride for** (`clubs_per_rider`). WSCA has a
  rider declare a primary club for the high-point award, and lets them ride for
  a second club in team events -- so 2 there, 1 at a show that wants one club
  per rider.
* **How a team class credits clubs** (`team_rule`): each rider's own club
  (the default -- WSCA's results list a club against every rider on a team),
  the entering rider's club, or none.

A rider's clubs for the show are `show_entry_clubs`, one of them primary. Taken
from their memberships when they hold exactly one competing club, so nobody has
to declare the obvious. **An individual placing counts for the primary club
only** -- never split across two clubs, never counted for both. A team seat may
ride for the rider's other declared club (`entry_rider_clubs`). A club earns a
team's placing once, however many of its riders are on the team.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Iterable, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import (
    Association,
    Class,
    Entry,
    EntryRiderClub,
    Exhibitor,
    ShowClubPoints,
    ShowEntry,
    ShowEntryClub,
)
from registration_profile import ShowExhibitorView, load_copies_for_show

TEAM_RULES = ("each_rider", "entrant", "none")
CLUBS_PER_RIDER_MAX = 5
CLUB_STANDINGS_NAME = "Saddle Club High Point"


def _refuse(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message})


# ── The show's setup ──────────────────────────────────────────────────────────


async def load_settings(db: AsyncSession, show_id: UUID) -> Optional[ShowClubPoints]:
    return (
        await db.execute(
            select(ShowClubPoints)
            .where(ShowClubPoints.show_id == show_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def competing_club_ids(db: AsyncSession, show_id: UUID) -> set[UUID]:
    settings = await load_settings(db, show_id)
    return {c.association_id for c in settings.clubs} if settings else set()


async def club_names(db: AsyncSession, ids: Iterable[UUID]) -> dict[UUID, str]:
    ids = list(set(ids))
    if not ids:
        return {}
    rows = await db.execute(select(Association.id, Association.name).where(Association.id.in_(ids)))
    return dict(rows.all())


async def settings_out(db: AsyncSession, settings: Optional[ShowClubPoints]) -> dict:
    if settings is None:
        return {"enabled": False, "clubs_per_rider": 1, "team_rule": "each_rider", "clubs": []}
    names = await club_names(db, (c.association_id for c in settings.clubs))
    return {
        "enabled": True,
        "clubs_per_rider": settings.clubs_per_rider,
        "team_rule": settings.team_rule,
        "clubs": sorted(
            ({"id": str(cid), "name": name} for cid, name in names.items()),
            key=lambda c: c["name"].lower(),
        ),
    }


async def save_settings(
    db: AsyncSession,
    show_id: UUID,
    *,
    enabled: bool,
    clubs_per_rider: int,
    team_rule: str,
    club_ids: list[UUID],
) -> None:
    """Replace the show's club setup. Turning it off forgets which clubs
    competed, and leaves the riders' declared clubs where they are, so turning
    it back on restores them. The caller commits."""
    settings = await load_settings(db, show_id)
    if not enabled:
        if settings is not None:
            await db.delete(settings)
        return
    if team_rule not in TEAM_RULES:
        raise _refuse(422, "TEAM_RULE", "Choose how team classes count for clubs.")
    if not 1 <= clubs_per_rider <= CLUBS_PER_RIDER_MAX:
        raise _refuse(422, "CLUBS_PER_RIDER", f"A rider may ride for 1 to {CLUBS_PER_RIDER_MAX} clubs.")
    wanted = set(club_ids)
    if wanted:
        found = await db.execute(
            select(Association.id).where(
                Association.id.in_(wanted), Association.association_type == "saddle_club"
            )
        )
        if {row[0] for row in found.all()} != wanted:
            raise _refuse(422, "NOT_A_SADDLE_CLUB", "Only saddle clubs compete for club high point.")
    if settings is None:
        settings = ShowClubPoints(show_id=show_id)
        settings.clubs = []
        db.add(settings)
    settings.clubs_per_rider = clubs_per_rider
    settings.team_rule = team_rule
    from models import ShowClubPointClub  # local: only this function writes it

    settings.clubs = [ShowClubPointClub(show_id=show_id, association_id=cid) for cid in sorted(wanted)]
    await db.flush()


# ── The shared saddle club list ───────────────────────────────────────────────


def _code_for(name: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", name.upper())
    return ("SC-" + "-".join(words))[:20] or "SC"


async def add_saddle_club(
    db: AsyncSession, name: str, user_id: Optional[UUID], member_of: Optional[UUID] = None
) -> Association:
    """A saddle club the show office adds, kept for every show after.

    The same name (case and spacing aside) is the club already on file rather
    than a second one, so two offices adding "Dassel Saddle Club" share it. The
    caller commits.
    """
    clean = " ".join(name.split())
    if not clean:
        raise _refuse(422, "CLUB_NAME", "Give the club a name.")
    existing = (
        await db.execute(
            select(Association).where(
                Association.association_type == "saddle_club",
                func.lower(Association.name) == clean.lower(),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    if member_of is None:
        member_of = (
            await db.execute(select(Association.id).where(Association.code == "WSCA"))
        ).scalar_one_or_none()
    base = _code_for(clean)
    code, n = base, 1
    while (await db.execute(select(Association.id).where(Association.code == code))).first():
        n += 1
        suffix = f"-{n}"
        code = base[: 20 - len(suffix)] + suffix
    club = Association(
        code=code,
        name=clean,
        association_type="saddle_club",
        is_active=True,
        member_of_association_id=member_of,
        created_by_user_id=user_id,
    )
    db.add(club)
    await db.flush()
    return club


# ── A rider's clubs at a show ─────────────────────────────────────────────────


@dataclass(frozen=True)
class Declared:
    primary: Optional[UUID]
    clubs: tuple
    # True where nobody declared: the rider holds exactly one competing club.
    derived: bool = False


async def held_clubs(
    db: AsyncSession, show_id: UUID, exhibitor_ids: Iterable[UUID], competing: set[UUID]
) -> dict[UUID, list[UUID]]:
    """The competing clubs each rider holds a membership with, as this show
    holds their memberships (their registration's copy, else their profile)."""
    ids = list(set(exhibitor_ids))
    if not ids or not competing:
        return {}
    exhibitors = (
        await db.execute(
            select(Exhibitor).options(selectinload(Exhibitor.registrations)).where(Exhibitor.id.in_(ids))
        )
    ).scalars().all()
    copies = await load_copies_for_show(show_id, db, ids)
    out: dict[UUID, list[UUID]] = {}
    for exhibitor in exhibitors:
        view = ShowExhibitorView(exhibitor, copies.get(exhibitor.id))
        out[exhibitor.id] = sorted(
            {r.association_id for r in (view.registrations or []) if r.association_id in competing},
            key=str,
        )
    return out


async def declared_clubs(db: AsyncSession, show_id: UUID) -> dict[UUID, Declared]:
    """Every rider's club(s) at this show: what they declared, or the one
    competing club they hold."""
    settings = await load_settings(db, show_id)
    if settings is None:
        return {}
    competing = {c.association_id for c in settings.clubs}
    roster = (
        await db.execute(
            select(ShowEntry.id, ShowEntry.exhibitor_id).where(
                ShowEntry.show_id == show_id, ShowEntry.cancelled_at.is_(None)
            )
        )
    ).all()
    exhibitor_by_entry = dict(roster)
    rows = (
        await db.execute(
            select(ShowEntryClub).where(ShowEntryClub.show_entry_id.in_(list(exhibitor_by_entry) or [None]))
        )
    ).scalars().all()
    declared: dict[UUID, list] = {}
    for row in rows:
        declared.setdefault(exhibitor_by_entry[row.show_entry_id], []).append(row)
    held = await held_clubs(db, show_id, exhibitor_by_entry.values(), competing)
    out: dict[UUID, Declared] = {}
    for exhibitor_id in exhibitor_by_entry.values():
        # A declaration holds only while the membership behind it is on file --
        # the membership is what the desk verifies.
        mine = [
            r for r in declared.get(exhibitor_id, [])
            if r.association_id in competing and r.association_id in held.get(exhibitor_id, [])
        ]
        if mine:
            primary = next((r.association_id for r in mine if r.is_primary), mine[0].association_id)
            out[exhibitor_id] = Declared(primary, tuple(r.association_id for r in mine))
        elif len(held.get(exhibitor_id, [])) == 1:
            only = held[exhibitor_id][0]
            out[exhibitor_id] = Declared(only, (only,), derived=True)
    return out


async def set_rider_clubs(
    db: AsyncSession, show_id: UUID, show_entry: ShowEntry, club_ids: list[UUID], primary_id: Optional[UUID]
) -> None:
    """Declare the club(s) a rider rides for at this show. The caller commits."""
    settings = await load_settings(db, show_id)
    if settings is None:
        raise _refuse(409, "CLUB_POINTS_OFF", "This show keeps no saddle-club standings.")
    competing = {c.association_id for c in settings.clubs}
    wanted = list(dict.fromkeys(club_ids))
    if len(wanted) > settings.clubs_per_rider:
        most = settings.clubs_per_rider
        raise _refuse(
            422, "TOO_MANY_CLUBS",
            f"At this show a rider rides for {'one club' if most == 1 else f'up to {most} clubs'}.",
        )
    if any(cid not in competing for cid in wanted):
        raise _refuse(422, "NOT_COMPETING", "That club is not competing for club high point at this show.")
    held = (await held_clubs(db, show_id, [show_entry.exhibitor_id], competing)).get(
        show_entry.exhibitor_id, []
    )
    if any(cid not in held for cid in wanted):
        names = await club_names(db, [cid for cid in wanted if cid not in held])
        raise _refuse(
            422, "NOT_A_MEMBER",
            f"There is no {', '.join(names.values())} membership on file. Add it to the rider's "
            "memberships first — that is what the desk verifies.",
        )
    if wanted and primary_id is None:
        primary_id = wanted[0]
    if primary_id is not None and primary_id not in wanted:
        raise _refuse(422, "PRIMARY_CLUB", "The primary club must be one of the rider's clubs.")
    await db.execute(delete(ShowEntryClub).where(ShowEntryClub.show_entry_id == show_entry.id))
    for cid in wanted:
        db.add(ShowEntryClub(show_entry_id=show_entry.id, association_id=cid, is_primary=cid == primary_id))
    await db.flush()


async def set_seat_clubs(
    db: AsyncSession, show_id: UUID, entry_id: UUID, seats: dict[UUID, Optional[UUID]]
) -> None:
    """Which declared club each rider on a team rides for, where it is not their
    primary. A club the rider has not declared at this show is refused. The
    caller commits."""
    await db.execute(delete(EntryRiderClub).where(EntryRiderClub.entry_id == entry_id))
    wanted = {rider: club for rider, club in seats.items() if club is not None}
    if not wanted:
        return
    declared = await declared_clubs(db, show_id)
    for rider_id, club_id in wanted.items():
        mine = declared.get(rider_id)
        if mine is None or club_id not in mine.clubs:
            names = await club_names(db, [club_id])
            raise _refuse(
                422, "SEAT_CLUB",
                f"A rider on this team has not declared {names.get(club_id, 'that club')} at this show.",
            )
        if club_id != mine.primary:
            db.add(EntryRiderClub(entry_id=entry_id, exhibitor_id=rider_id, association_id=club_id))
    await db.flush()


async def seat_clubs_for(db: AsyncSession, entry_ids: Iterable[UUID]) -> dict:
    """`{(entry_id, exhibitor_id): club_id}` for team seats riding for a club
    other than the rider's primary."""
    ids = list(set(entry_ids))
    if not ids:
        return {}
    rows = await db.execute(
        select(EntryRiderClub.entry_id, EntryRiderClub.exhibitor_id, EntryRiderClub.association_id).where(
            EntryRiderClub.entry_id.in_(ids)
        )
    )
    return {(entry_id, exhibitor_id): club_id for entry_id, exhibitor_id, club_id in rows.all()}


async def save_team_clubs(db: AsyncSession, show_id: UUID, entry, body) -> None:
    """The team doors' half of `set_seat_clubs`, at a show that keeps club
    points; elsewhere there is nothing to ride for and nothing is written."""
    if await load_settings(db, show_id) is None:
        return
    seats = {entry.exhibitor_id: getattr(body, "entrant_club_id", None)}
    seats.update({m.exhibitor_id: m.club_id for m in body.members})
    await set_seat_clubs(db, show_id, entry.id, seats)


# ── Club standings ────────────────────────────────────────────────────────────


@dataclass
class ClubContext:
    """Everything the club tally needs, for the shows that keep club points."""

    primary: dict = field(default_factory=dict)  # (show_id, exhibitor_id) -> club
    seat: dict = field(default_factory=dict)  # (entry_id, exhibitor_id) -> club
    team_rule: dict = field(default_factory=dict)  # show_id -> rule
    names: dict = field(default_factory=dict)  # club_id -> name

    def club_for(self, show_id: UUID, entry_id: Optional[UUID], rider_id: UUID) -> Optional[UUID]:
        if entry_id is not None and (entry_id, rider_id) in self.seat:
            return self.seat[(entry_id, rider_id)]
        return self.primary.get((show_id, rider_id))


async def load_club_context(db: AsyncSession, show_ids: list[UUID]) -> Optional[ClubContext]:
    """None where none of the shows keeps club standings."""
    settings = (
        await db.execute(select(ShowClubPoints).where(ShowClubPoints.show_id.in_(show_ids or [None])))
    ).scalars().all()
    if not settings:
        return None
    ctx = ClubContext()
    for s in settings:
        ctx.team_rule[s.show_id] = s.team_rule
        for exhibitor_id, declared in (await declared_clubs(db, s.show_id)).items():
            if declared.primary is not None:
                ctx.primary[(s.show_id, exhibitor_id)] = declared.primary
    seats = await db.execute(
        select(EntryRiderClub.entry_id, EntryRiderClub.exhibitor_id, EntryRiderClub.association_id)
        .join(Entry, Entry.id == EntryRiderClub.entry_id)
        .join(Class, Class.id == Entry.class_id)
        .where(Class.show_id.in_(list(ctx.team_rule)))
    )
    for entry_id, exhibitor_id, club_id in seats.all():
        ctx.seat[(entry_id, exhibitor_id)] = club_id
    ctx.names = await club_names(db, list(ctx.primary.values()) + list(ctx.seat.values()))
    return ctx


def tally_clubs(cards: Iterable, chart, ctx: Optional[ClubContext]) -> Optional[dict]:
    """The Saddle Club High Point standing, or None where no show keeps one.

    A card's points go to the club its rider rides for -- the primary club for
    an individual placing, never split and never counted twice. A team card
    follows the show's team rule, and a club earns one team's placing once,
    however many of its riders are on the team.
    """
    if ctx is None:
        return None
    from high_point import is_placed, points_for, rank  # local: high_point imports teams

    totals: dict[UUID, dict] = {}
    for card in cards:
        if card.show_id not in ctx.team_rule or not is_placed(card):
            continue
        earned = points_for(chart, card.place, card.class_size)
        if earned <= 0:
            continue
        if card.team_class:
            rule = ctx.team_rule[card.show_id]
            if rule == "none":
                continue
            riders = [card.exhibitor_id]
            if rule == "each_rider":
                riders += [rider_id for rider_id, _name in card.teammates]
            credited = {ctx.club_for(card.show_id, card.entry_id, r) for r in riders}
        else:
            credited = {ctx.club_for(card.show_id, None, card.exhibitor_id)}
        for club_id in credited - {None}:
            club = totals.setdefault(
                club_id, {"points": Decimal(0), "class_ids": set(), "show_ids": set()}
            )
            club["points"] += earned
            club["class_ids"].add(card.class_id)
            club["show_ids"].add(card.show_id)
    ordered = sorted(
        totals.items(), key=lambda item: (-item[1]["points"], ctx.names.get(item[0], "").lower())
    )
    ranks = rank([club["points"] for _cid, club in ordered])
    return {
        "name": CLUB_STANDINGS_NAME,
        "standings": [
            {
                "rank": r,
                "club_id": str(club_id),
                "club_name": ctx.names.get(club_id, "(club)"),
                "points": float(club["points"]),
                "class_count": len(club["class_ids"]),
                "show_count": len(club["show_ids"]),
            }
            for r, (club_id, club) in zip(ranks, ordered)
        ],
    }
