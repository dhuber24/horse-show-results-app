"""Team classes, and the riders on a team (migration 192).

Some classes are ridden by a team rather than one rider on one horse: Tandem
Bareback and Rescue Race are two riders on one horse, Ribbon Race two riders on
two horses, 4-In-A-Line four riders each on their own horse. A class says so with
`classes.team_size`.

The decisions, settled once here so the two doors cannot disagree:

* **The entry stays the team's.** Its exhibitor and horse are the team's first
  rider -- the one who entered it and pays, whose back number the team wears --
  so the entry fee, the gate, the scribe screens and posting all work per entry
  exactly as they did. `entry_team_members` names the rest. That is also how a
  show bill prices one: WSCA charges a two-rider class as one "double" entry.
* **A teammate is somebody at the show**: signed up, or added by the office at
  the desk, and not cancelled (`at_show`). That puts them on the desk, where the
  release and an emergency contact are asked of everybody who rides whichever
  class they ride, and it means naming a team never reaches anybody the show did
  not already have -- the reach rule of `company_verification.py` holds without
  a new door. A rider only coming for the team class signs up, or the office
  adds them, first. Not `cancellations.is_on_roster`: that leaves out the
  office's own additions, which is exactly how the second rider of a tandem
  team who shows nothing else usually arrives.
* **A teammate's horse is one of theirs at this show**, or none: blank means
  they ride the team's horse, which is the whole of Tandem Bareback.
* **A short team is a flag, not a refusal.** The office may only learn the
  second rider's name on the morning, so a team can be entered, numbered and
  paid for with nobody named yet; the desk and the class page say who is
  missing. Only what no screen could sort out refuses: too many riders, somebody
  on the team twice, or a class that is not ridden by a team.
* **Whoever entered names the team, and the office can change it.** The
  exhibitor's door closes with their other class doors -- once the class is
  under way the team is what went into the ring.
* **A rider is on one team in a rail class** (`rides_together`): Tandem
  Bareback has every team in the ring at once, so somebody already riding in
  the class -- on their own entry or on another team -- is refused, the same
  reason an exhibitor cannot enter a rail class twice. A timed or pattern class
  runs one team at a time, and WSCA lets a rider ride on two 4-In-A-Line teams,
  so there it is taken and the desk shows it (`team_overlaps`).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from class_numbers import class_label
from models import Class, Entry, EntryTeamMember, Exhibitor, Horse, ShowEntry
from registration_profile import registration_horse_links

TEAM_SIZE_MIN = 2
# Mirrors `ck_classes_team_size`. A quadrille is the biggest team in sight; the
# cap only stops a typo making a "team of 400".
TEAM_SIZE_MAX = 12
# How a team is read out wherever one rider's name would be.
NAME_JOINER = " / "


def at_show(show_entry) -> bool:
    """Whether this `show_entries` row is somebody who may ride on a team here:
    signed up or added by the office, and not cancelled."""
    return show_entry is not None and show_entry.cancelled_at is None


def is_team_class(class_) -> bool:
    size = getattr(class_, "team_size", None)
    return bool(size and size >= TEAM_SIZE_MIN)


def rides_together(class_) -> bool:
    """Every team is in the ring at once -- a rail (placing) class, Tandem
    Bareback -- so a rider is on one team in it."""
    return getattr(class_, "score_type", None) == "placement"


def seats_for(class_) -> int:
    """How many riders join the one who entered: a team of 2 is them and one more."""
    return class_.team_size - 1 if is_team_class(class_) else 0


def team_shortfall(class_, teammate_count: int) -> int:
    """Riders still to be named on a team in this class; 0 for a full team or
    an ordinary class."""
    return max(0, seats_for(class_) - teammate_count)


# ── Reading a team ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Teammate:
    exhibitor_id: UUID
    name: str
    horse_id: Optional[UUID]
    horse_name: Optional[str]
    position: int


def teammates_of(entry) -> list[Teammate]:
    """The rest of a team, off an entry loaded through the ORM."""
    return [
        Teammate(
            exhibitor_id=member.exhibitor_id,
            name=(member.exhibitor.full_name if member.exhibitor else None) or "(unnamed)",
            horse_id=member.horse_id,
            horse_name=member.horse.name if member.horse else None,
            position=member.position,
        )
        for member in (getattr(entry, "team_members", None) or [])
    ]


async def load_teammates(db: AsyncSession, entry_ids: Iterable[UUID]) -> dict[UUID, list[Teammate]]:
    """`{entry_id: [Teammate]}` for the entries that have any, in one query.

    For the readers that select columns rather than entries -- the results
    index, the program index, the gate -- and so never see `Entry.team_members`.
    """
    ids = list(dict.fromkeys(entry_ids))
    if not ids:
        return {}
    rows = await db.execute(
        select(
            EntryTeamMember.entry_id,
            EntryTeamMember.exhibitor_id,
            Exhibitor.full_name,
            EntryTeamMember.horse_id,
            Horse.name,
            EntryTeamMember.position,
        )
        .join(Exhibitor, Exhibitor.id == EntryTeamMember.exhibitor_id)
        .outerjoin(Horse, Horse.id == EntryTeamMember.horse_id)
        .where(EntryTeamMember.entry_id.in_(ids))
        .order_by(EntryTeamMember.entry_id, EntryTeamMember.position)
    )
    teams: dict[UUID, list[Teammate]] = {}
    for entry_id, exhibitor_id, name, horse_id, horse_name, position in rows.all():
        teams.setdefault(entry_id, []).append(
            Teammate(exhibitor_id, name or "(unnamed)", horse_id, horse_name, position)
        )
    return teams


def rider_label(name: Optional[str], teammates: Iterable[Teammate]) -> str:
    """The team as it is read out -- "Bella Drevlow / Jennifer Peterson" -- or the
    one rider's name on an ordinary entry.

    Used wherever an entry's rider is named (the results, the program, the gate,
    the reports), so a teammate is found by name on every screen that searches
    one, and the leaderboard and the public class page read the same team.
    """
    names = [name or "(unnamed)"] + [t.name for t in teammates]
    return NAME_JOINER.join(names)


def horse_label(horse_name: Optional[str], teammates: Iterable[Teammate]) -> Optional[str]:
    """The horses a team rides: the team's own, then each one a teammate brought.

    A teammate riding the team's horse adds nothing, so Tandem Bareback reads as
    the one horse it is.
    """
    names: list[str] = []
    for candidate in [horse_name] + [t.horse_name for t in teammates if t.horse_id]:
        if candidate and candidate not in names:
            names.append(candidate)
    return NAME_JOINER.join(names) or None


def team_out(class_, teammates: list[Teammate], seat_clubs: Optional[dict] = None, entry=None) -> dict:
    """What a screen needs about one entry's team: who is on it, and how many
    are still to be named. Empty for an entry in an ordinary class.

    `seat_clubs` (`club_points.seat_clubs_for`) adds the club each seat rides
    for where it is not the rider's primary (migration 193).
    """
    seat_clubs = seat_clubs or {}
    entry_id = getattr(entry, "id", None)
    out = {
        "team_members": [
            {
                "exhibitor_id": t.exhibitor_id,
                "exhibitor_name": t.name,
                "horse_id": t.horse_id,
                "horse_name": t.horse_name,
                "position": t.position,
                "club_id": seat_clubs.get((entry_id, t.exhibitor_id)),
            }
            for t in teammates
        ],
        "team_short": team_shortfall(class_, len(teammates)),
    }
    if entry is not None:
        out["entrant_club_id"] = seat_clubs.get((entry_id, entry.exhibitor_id))
    return out


# ── Naming a team ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class TeammateRequest:
    exhibitor_id: UUID
    horse_id: Optional[UUID] = None


def _refuse(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message})


def check_request(
    class_, entrant_id: UUID, team_horse_id: Optional[UUID], requested: list[TeammateRequest]
) -> list[TeammateRequest]:
    """What can be judged from the request alone, and the request tidied.

    A teammate sent with the team's own horse is stored as riding it (no horse
    of their own), so a team is never read as two horses when it is one.
    """
    label = class_label(class_)
    if not is_team_class(class_):
        raise _refuse(
            409,
            "NOT_A_TEAM_CLASS",
            f"{label} is ridden by one rider, so it has no team. The show office sets "
            "which classes a team rides on the Class Builder.",
        )
    seats = seats_for(class_)
    if len(requested) > seats:
        raise _refuse(
            422,
            "TEAM_TOO_LARGE",
            f"A team in {label} is {class_.team_size} riders: the rider who entered "
            f"it and {seats} more.",
        )
    seen: set[UUID] = set()
    for teammate in requested:
        if teammate.exhibitor_id == entrant_id:
            raise _refuse(
                422,
                "TEAMMATE_IS_ENTRANT",
                "The rider who entered the team is already on it.",
            )
        if teammate.exhibitor_id in seen:
            raise _refuse(422, "TEAMMATE_TWICE", "A rider is on this team twice.")
        seen.add(teammate.exhibitor_id)
    return [
        TeammateRequest(
            t.exhibitor_id, None if t.horse_id is not None and t.horse_id == team_horse_id else t.horse_id
        )
        for t in requested
    ]


async def horses_at_show(db: AsyncSession, show_id: UUID, exhibitor_id: UUID) -> set[UUID]:
    """The horses this rider has at this show: on their registration, or entered
    in one of its classes (the desk may enter a horse a registration never
    listed)."""
    linked = await registration_horse_links(show_id, exhibitor_id, db)
    entered = await db.execute(
        select(Entry.horse_id)
        .join(Class, Class.id == Entry.class_id)
        .where(
            Class.show_id == show_id,
            Entry.exhibitor_id == exhibitor_id,
            Entry.horse_id.isnot(None),
        )
    )
    return set(linked) | {horse_id for (horse_id,) in entered.all()}


async def riders_in_class(
    db: AsyncSession, class_id: UUID, exclude_entry_id: Optional[UUID] = None
) -> dict[UUID, Optional[str]]:
    """Everybody riding in a class, other than on `exclude_entry_id`.

    `{exhibitor_id: whose team}` -- None for a rider on their own entry, and the
    name of whoever entered the team for a teammate. Scratched entries ride in
    nothing.
    """
    query = (
        select(Entry.id, Entry.exhibitor_id, Exhibitor.full_name)
        .join(Exhibitor, Exhibitor.id == Entry.exhibitor_id)
        .where(Entry.class_id == class_id, Entry.status != "WITHDRAWN")
    )
    if exclude_entry_id is not None:
        query = query.where(Entry.id != exclude_entry_id)
    entrants: dict[UUID, str] = {}
    riding: dict[UUID, Optional[str]] = {}
    for entry_id, exhibitor_id, name in (await db.execute(query)).all():
        entrants[entry_id] = name or "another rider"
        riding[exhibitor_id] = None
    if entrants:
        seats = await db.execute(
            select(EntryTeamMember.entry_id, EntryTeamMember.exhibitor_id).where(
                EntryTeamMember.entry_id.in_(list(entrants))
            )
        )
        for entry_id, exhibitor_id in seats.all():
            riding.setdefault(exhibitor_id, entrants[entry_id])
    return riding


def already_riding(class_, name: Optional[str], whose_team: Optional[str]) -> HTTPException:
    """The refusal for a second ride in a class every team rides at once.

    `name` None is the exhibitor asking for themselves, who is told "you".
    """
    label = class_label(class_)
    if name is None:
        where = f"on {whose_team}'s team" if whose_team else "on your own entry"
        said = f"You already ride in {label}, {where}."
    else:
        where = f"on {whose_team}'s team" if whose_team else "on their own entry"
        said = f"{name} already rides in {label}, {where}."
    return _refuse(
        409,
        "ALREADY_RIDING",
        f"{said} Every team in this class is in the ring at once, so a rider is on one team.",
    )


async def _names(db: AsyncSession, exhibitor_ids: list[UUID]) -> dict[UUID, str]:
    rows = await db.execute(
        select(Exhibitor.id, Exhibitor.full_name).where(Exhibitor.id.in_(exhibitor_ids))
    )
    return {exhibitor_id: name or "(unnamed)" for exhibitor_id, name in rows.all()}


async def replace_team(
    db: AsyncSession, show_id: UUID, entry, class_, requested: list[TeammateRequest]
) -> None:
    """Make the team on `entry` exactly `requested`, in that order.

    `entry` arrives with `team_members` loaded (the relationship is selectin).
    The caller commits, and reloads the entry for its response.
    """
    requested = check_request(class_, entry.exhibitor_id, entry.horse_id, requested)
    ids = [t.exhibitor_id for t in requested]
    if ids:
        roster = await db.execute(
            select(ShowEntry).where(ShowEntry.show_id == show_id, ShowEntry.exhibitor_id.in_(ids))
        )
        here = {row.exhibitor_id for row in roster.scalars().all() if at_show(row)}
        names = await _names(db, ids)
        riding = await riders_in_class(db, class_.id, entry.id) if rides_together(class_) else {}
        for teammate in requested:
            name = names.get(teammate.exhibitor_id)
            if name is None:
                raise _refuse(404, "TEAMMATE_NOT_FOUND", "A rider named on this team was not found.")
            if teammate.exhibitor_id not in here:
                raise _refuse(
                    409,
                    "TEAMMATE_NOT_AT_SHOW",
                    f"{name} is not on this show's roster. Every rider on a team signs "
                    "up first, or the show office adds them at the desk.",
                )
            if teammate.exhibitor_id in riding:
                raise already_riding(class_, name, riding[teammate.exhibitor_id])
            if teammate.horse_id is not None and teammate.horse_id not in await horses_at_show(
                db, show_id, teammate.exhibitor_id
            ):
                raise _refuse(
                    422,
                    "TEAMMATE_HORSE",
                    f"That horse is not one of {name}'s horses at this show. Pick one "
                    "they brought, or leave it blank if they ride the team's horse.",
                )

    # The old rows go in a flush of their own before the new ones are added:
    # a unit of work inserts before it deletes, and a seat filled again would
    # collide with the row still holding it.
    entry.team_members.clear()
    await db.flush()
    for position, teammate in enumerate(requested, start=TEAM_SIZE_MIN):
        entry.team_members.append(
            EntryTeamMember(
                exhibitor_id=teammate.exhibitor_id,
                horse_id=teammate.horse_id,
                position=position,
            )
        )
    await db.flush()


async def reload_entry(db: AsyncSession, entry_id: UUID):
    """The entry again, with its team freshly read, for a response.

    `populate_existing`: the team was just replaced in this session, and the
    identity map's copy of the collection is the one being answered for.
    """
    result = await db.execute(
        select(Entry).where(Entry.id == entry_id).execution_options(populate_existing=True)
    )
    return result.scalar_one()
