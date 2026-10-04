"""High point: points systems, the show's choice of one, and season circuits.

Three things, one computation (`backend/high_point.py`):

  * **Points systems** belong to a show company (migration 148): its managers
    and secretaries enter the charts their shows score by, and only the
    company's own people see or choose them. A GaitDesk admin sees and manages
    every one. A system no company owns is a **GaitDesk standard** system --
    the associations' own charts (migration 151) -- which every company may
    choose and only an admin may change. The chart
    still rides on the public leaderboards, because a leaderboard has to be
    able to say what its points mean -- what is scoped is who may pick it.
  * **A show's high point** uses the system its office picks. No pick, no
    standings -- the leaderboard says so rather than guessing a chart.
  * **A circuit** adds several shows together under its own system. Whoever
    created it manages it (or a GaitDesk admin), and a show goes on only by the
    hand of somebody who works that show, so nobody can fold another office's
    results into their season.

The request and response shapes live here rather than in `schemas.py`, the way
`routers/show_marquee.py` keeps its own: nothing else reads them.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backnumbers import back_numbers_for_show
from database import get_db
from dependencies import INTERNAL_API_KEY, require_admin_or_show_admin, safe_uuid
from high_point import (
    build_chart,
    load_cards,
    may_edit_point_system,
    may_use_point_system,
    place_limits,
    range_label,
    tally,
)
from models import (
    Association,
    Circuit,
    CircuitShow,
    PointSystem,
    PointSystemAward,
    Show,
    ShowCompany,
    ShowCompanyMember,
    ShowPointSystem,
)
from routers.shows import _assert_show_access
from show_companies import ALL_FEATURE_ROLES

router = APIRouter(tags=["High Point"])

# Enough for the longest printed association chart (a band per class size up
# to twenty-odd horses, ten places each) with room to spare.
MAX_AWARDS = 1000


class AwardIn(BaseModel):
    min_entries: int = Field(ge=1, le=500)
    place: int = Field(ge=1, le=100)
    points: Decimal = Field(gt=0, le=Decimal("99999"), decimal_places=2)


class PointSystemIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    # The show company that owns it. A caller in exactly one company may leave
    # it out; an admin leaving it out makes a system only admins can use.
    company_id: Optional[UUID] = None
    association_id: Optional[UUID] = None
    notes: Optional[str] = Field(default=None, max_length=2000)
    awards: list[AwardIn]


class ShowPointSystemIn(BaseModel):
    point_system_id: Optional[UUID] = None


class ShowChartIn(BaseModel):
    """A show's own chart (migration 153): what the office saved after pressing
    *Use this template*, or built from scratch. No company -- the show owns it."""

    name: str = Field(min_length=1, max_length=200)
    association_id: Optional[UUID] = None
    notes: Optional[str] = Field(default=None, max_length=2000)
    awards: list[AwardIn]


class CircuitIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    season: Optional[str] = Field(default=None, max_length=50)
    point_system_id: Optional[UUID] = None
    notes: Optional[str] = Field(default=None, max_length=2000)


class CircuitUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    season: Optional[str] = Field(default=None, max_length=50)
    point_system_id: Optional[UUID] = None
    notes: Optional[str] = Field(default=None, max_length=2000)


def _clean(text: Optional[str]) -> Optional[str]:
    text = (text or "").strip()
    return text or None


def _is_staff_caller(x_api_key: Optional[str]) -> bool:
    return bool(INTERNAL_API_KEY) and x_api_key == INTERNAL_API_KEY


# ── Points systems ─────────────────────────────────────────────────────────────


class Caller:
    """Who is asking, and the show companies they work for. An admin works for
    none and may use every points system."""

    def __init__(self, user_id: UUID, role: str, member_of: list[UUID]):
        self.user_id = user_id
        self.role = role
        self.member_of = member_of

    @property
    def is_admin(self) -> bool:
        return self.role in ALL_FEATURE_ROLES

    def may_use(self, system: PointSystem) -> bool:
        return may_use_point_system(self.role, system.company_id, self.member_of, system.show_id)

    def may_edit(self, system: PointSystem) -> bool:
        return may_edit_point_system(self.role, system.company_id, self.member_of, system.show_id)


async def _caller(x_user_id: str, x_user_role: str, db: AsyncSession) -> Caller:
    user_id = safe_uuid(x_user_id)
    member_of = (
        await db.execute(select(ShowCompanyMember.company_id).where(ShowCompanyMember.user_id == user_id))
    ).scalars().all()
    return Caller(user_id, x_user_role, list(member_of))


def owning_company(caller: Caller, requested: Optional[UUID]) -> Optional[UUID]:
    """Which company a points system is saved under.

    An admin may put it under any company, or under none -- a system only
    admins can use. Anybody else only under a company they work for; somebody
    in exactly one company, which is nearly everybody, need not say which.
    """
    if caller.is_admin:
        return requested
    if not caller.member_of:
        raise HTTPException(
            409,
            "Your account isn't in a show company yet, so there is nowhere to keep a points system. "
            "Ask GaitDesk to set your show company up.",
        )
    if requested is None:
        if len(caller.member_of) == 1:
            return caller.member_of[0]
        raise HTTPException(422, "You work for more than one show company. Choose which one the points system is for.")
    if requested not in caller.member_of:
        raise HTTPException(403, "You can only keep a points system for a show company you work for.")
    return requested


def _system_payload(system: PointSystem, show_count: int = 0, circuit_count: int = 0) -> dict:
    return {
        "id": str(system.id),
        "name": system.name,
        "company_id": str(system.company_id) if system.company_id else None,
        "company_name": system.company.name if system.company else None,
        # Set: this is that show's own chart (migration 153), not a library one.
        "show_id": str(system.show_id) if system.show_id else None,
        # No company and no show: a GaitDesk standard system every company may use.
        "standard": system.company_id is None and system.show_id is None,
        "association_id": str(system.association_id) if system.association_id else None,
        "association_code": system.association.code if system.association else None,
        "notes": system.notes,
        "awards": [
            {"min_entries": a.min_entries, "place": a.place, "points": float(a.points)}
            for a in sorted(system.awards, key=lambda a: (a.min_entries, a.place))
        ],
        "show_count": show_count,
        "circuit_count": circuit_count,
    }


async def _usage(db: AsyncSession) -> tuple[dict, dict]:
    shows = await db.execute(
        select(ShowPointSystem.point_system_id, func.count()).group_by(ShowPointSystem.point_system_id)
    )
    circuits = await db.execute(
        select(Circuit.point_system_id, func.count())
        .where(Circuit.point_system_id.isnot(None))
        .group_by(Circuit.point_system_id)
    )
    return dict(shows.all()), dict(circuits.all())


def _validated_awards(awards: list[AwardIn]) -> list[AwardIn]:
    if not awards:
        raise HTTPException(422, "A points system needs at least one place that earns points.")
    if len(awards) > MAX_AWARDS:
        raise HTTPException(422, f"A points system can hold at most {MAX_AWARDS} awards.")
    # A row is a range of class sizes, and may pay as many places as the
    # largest class in it (`high_point.place_limits`). Enforced here and only
    # here: the range's top is the next row's start, which a CHECK cannot see.
    limits = place_limits(award.min_entries for award in awards)
    seen = set()
    for award in awards:
        limit = limits[award.min_entries]
        if award.place > limit:
            raise HTTPException(
                422,
                f"Classes of {range_label(award.min_entries, limits)} can award at most {limit} "
                f"place{'' if limit == 1 else 's'}, not place {award.place}.",
            )
        key = (award.min_entries, award.place)
        if key in seen:
            raise HTTPException(
                422,
                f"Place {award.place} is given twice for classes of {award.min_entries} or more.",
            )
        seen.add(key)
    return awards


async def _name_taken(
    db: AsyncSession,
    name: str,
    company_id: Optional[UUID],
    except_id: Optional[UUID] = None,
    show_id: Optional[UUID] = None,
) -> bool:
    """Names are unique within their owner (migrations 148, 153): two clubs may
    each keep an "APHA Open Show Points" of their own, and a show's copy of a
    standard chart may keep the standard chart's name."""
    query = select(PointSystem.id).where(
        func.lower(func.btrim(PointSystem.name)) == name.strip().lower(),
        PointSystem.company_id.is_(None) if company_id is None else PointSystem.company_id == company_id,
        PointSystem.show_id.is_(None) if show_id is None else PointSystem.show_id == show_id,
    )
    if except_id:
        query = query.where(PointSystem.id != except_id)
    return (await db.execute(query)).first() is not None


async def _get_system_or_404(system_id: UUID, db: AsyncSession) -> PointSystem:
    system = (
        await db.execute(
            select(PointSystem)
            .where(PointSystem.id == system_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if system is None:
        raise HTTPException(404, "Points system not found")
    return system


async def _usable_system_or_404(system_id: UUID, caller: Caller, db: AsyncSession) -> PointSystem:
    """A system the caller may see. Another company's is a 404, not a 403: its
    name is that company's business."""
    system = await _get_system_or_404(system_id, db)
    if not caller.may_use(system):
        raise HTTPException(404, "Points system not found")
    return system


async def _editable_system_or_404(system_id: UUID, caller: Caller, db: AsyncSession) -> PointSystem:
    """A system the caller may change. Another company's is a 404; a standard
    one they can see is a 403 that says what to do instead."""
    system = await _usable_system_or_404(system_id, caller, db)
    if not caller.may_edit(system):
        raise HTTPException(
            403,
            f"{system.name} is a GaitDesk standard points system, which only GaitDesk changes. "
            "Use it as a template to make one of your own.",
        )
    return system


async def _apply_system(
    system: PointSystem, body: "PointSystemIn | ShowChartIn", company_id: Optional[UUID], db: AsyncSession
) -> None:
    """Write a name and a chart onto a system. A show's own chart passes no
    company: its owner is `system.show_id`, which this never changes."""
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Give the points system a name.")
    if company_id is not None and not await db.get(ShowCompany, company_id):
        raise HTTPException(422, "That show company does not exist.")
    if await _name_taken(db, name, company_id, system.id, system.show_id):
        raise HTTPException(409, f"There is already a points system called {name}.")
    if body.association_id and not await db.get(Association, body.association_id):
        raise HTTPException(422, "That association does not exist.")
    awards = _validated_awards(body.awards)
    system.name = name
    system.company_id = company_id
    system.association_id = body.association_id
    system.notes = _clean(body.notes)
    system.updated_at = datetime.now(timezone.utc)
    # The old chart goes before the new one arrives: the rows share a primary
    # key, and one flush holding both a delete and an insert of it is a
    # uniqueness race nobody should have to reason about.
    system.awards.clear()
    await db.flush()
    system.awards = [
        PointSystemAward(min_entries=a.min_entries, place=a.place, points=a.points) for a in awards
    ]


@router.get("/point-systems", dependencies=[Depends(require_admin_or_show_admin)])
async def list_point_systems(
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The points systems the caller may use -- their companies' and the
    GaitDesk standard ones, or every one for an admin -- with how many shows
    and circuits use each."""
    caller = await _caller(x_user_id, x_user_role, db)
    # A show's own chart is never part of the library, an admin's included.
    query = select(PointSystem).where(PointSystem.show_id.is_(None)).order_by(func.lower(PointSystem.name))
    if not caller.is_admin:
        query = query.where(
            PointSystem.company_id.is_(None) | PointSystem.company_id.in_(caller.member_of)
        )
    systems = (await db.execute(query)).scalars().all()
    shows, circuits = await _usage(db)
    return [_system_payload(s, shows.get(s.id, 0), circuits.get(s.id, 0)) for s in systems]


@router.get("/point-systems/companies", dependencies=[Depends(require_admin_or_show_admin)])
async def point_system_owners(
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The companies the caller may keep a points system under: their own, or
    every company for an admin. Organizations first -- an admin's list holds one
    own company per independent, and those are rarely the ones meant."""
    caller = await _caller(x_user_id, x_user_role, db)
    query = select(ShowCompany)
    if not caller.is_admin:
        query = query.where(ShowCompany.id.in_(caller.member_of))
    companies = (await db.execute(query)).scalars().all()
    companies = sorted(companies, key=lambda c: (c.owner_user_id is not None, c.name.lower()))
    return [
        {"id": str(c.id), "name": c.name, "personal": c.owner_user_id is not None}
        for c in companies
    ]


@router.post("/point-systems", status_code=201, dependencies=[Depends(require_admin_or_show_admin)])
async def create_point_system(
    body: PointSystemIn,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    caller = await _caller(x_user_id, x_user_role, db)
    company_id = owning_company(caller, body.company_id)
    system = PointSystem(created_by_user_id=caller.user_id, awards=[])
    await _apply_system(system, body, company_id, db)
    db.add(system)
    await db.commit()
    return _system_payload(await _get_system_or_404(system.id, db))


@router.put("/point-systems/{system_id}", dependencies=[Depends(require_admin_or_show_admin)])
async def update_point_system(
    system_id: UUID,
    body: PointSystemIn,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Replace the chart. Every leaderboard using it recomputes on its next read.
    Only the owning company's people, or an admin, and only into a company the
    caller works for."""
    caller = await _caller(x_user_id, x_user_role, db)
    system = await _editable_system_or_404(system_id, caller, db)
    company_id = owning_company(caller, body.company_id if caller.is_admin else (body.company_id or system.company_id))
    await _apply_system(system, body, company_id, db)
    await db.commit()
    shows, circuits = await _usage(db)
    system = await _get_system_or_404(system_id, db)
    return _system_payload(system, shows.get(system.id, 0), circuits.get(system.id, 0))


@router.delete(
    "/point-systems/{system_id}", status_code=204, dependencies=[Depends(require_admin_or_show_admin)]
)
async def delete_point_system(
    system_id: UUID,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Refused while a show or a circuit uses it: deleting it would empty a
    public leaderboard as a side effect of tidying a list."""
    caller = await _caller(x_user_id, x_user_role, db)
    system = await _editable_system_or_404(system_id, caller, db)
    shows, circuits = await _usage(db)
    in_use = shows.get(system.id, 0) + circuits.get(system.id, 0)
    if in_use:
        raise HTTPException(
            409,
            {
                "code": "POINT_SYSTEM_IN_USE",
                "message": (
                    f"{system.name} is used by {shows.get(system.id, 0)} show(s) and "
                    f"{circuits.get(system.id, 0)} circuit(s). Choose another system for them first."
                ),
            },
        )
    await db.delete(system)
    await db.commit()
    return Response(status_code=204)


# ── A show's high point ────────────────────────────────────────────────────────


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if show is None:
        raise HTTPException(404, "Show not found")
    return show


def _circuit_summary(circuit: Circuit) -> dict:
    return {"id": str(circuit.id), "name": circuit.name, "season": circuit.season}


@router.get("/shows/{show_id}/leaderboard")
async def show_leaderboard(show_id: UUID, db: AsyncSession = Depends(get_db)):
    """The show's high-point standings from its posted classes. Public."""
    await _get_show_or_404(show_id, db)
    choice = await db.get(ShowPointSystem, show_id)
    system = await _get_system_or_404(choice.point_system_id, db) if choice else None

    circuits = (
        await db.execute(
            select(Circuit)
            .join(CircuitShow, CircuitShow.circuit_id == Circuit.id)
            .where(CircuitShow.show_id == show_id)
            .order_by(func.lower(Circuit.name))
        )
    ).scalars().all()

    divisions: list[dict] = []
    cards, posted = await load_cards(db, [show_id])
    if system is not None:
        divisions = tally(cards, build_chart(system.awards))
        # The number worn at this show, for the results board -- the
        # exhibitor's, or the horse's where the show numbers horses. Here
        # rather than in `tally`, which a circuit shares: across several shows
        # one exhibitor has several numbers, and none of them is theirs.
        numbers = await back_numbers_for_show(show_id, db)
        for division in divisions:
            for row in division["standings"]:
                row["back_number"] = numbers.resolve(
                    UUID(row["exhibitor_id"]),
                    UUID(row["horse_id"]) if row["horse_id"] else None,
                )

    return {
        "show_id": str(show_id),
        "point_system": _system_payload(system) if system else None,
        "posted_class_count": posted,
        "divisions": divisions,
        "circuits": [_circuit_summary(c) for c in circuits],
    }


async def _show_chart(show_id: UUID, db: AsyncSession) -> Optional[PointSystem]:
    """The show's own chart, if it has one (migration 153 allows at most one)."""
    return (
        await db.execute(
            select(PointSystem)
            .where(PointSystem.show_id == show_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


@router.get("/shows/{show_id}/high-point", dependencies=[Depends(require_admin_or_show_admin)])
async def get_show_point_system(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The chart the show scores by, or none -- without the standings.

    The setup wizard reads this on every step (whether Scoring is done, and
    whether the High Point tile is greyed out), and the public leaderboard
    computes every posted class's points to answer the same question.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    choice = await db.get(ShowPointSystem, show_id)
    system = await _get_system_or_404(choice.point_system_id, db) if choice else None
    return {"point_system": _system_payload(system) if system else None}


@router.put("/shows/{show_id}/high-point", dependencies=[Depends(require_admin_or_show_admin)])
async def set_show_point_system(
    show_id: UUID,
    body: ShowPointSystemIn,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Score the show by a library system as it stands, or turn high point off.

    Moving off the show's own chart deletes it: nothing else can use a show's
    chart, so once its show stops scoring by it, it is unreachable. The screen
    confirms before it asks for this.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)

    row = await db.get(ShowPointSystem, show_id)
    own = await _show_chart(show_id, db)
    if own is not None and body.point_system_id == own.id:
        return {"point_system_id": str(own.id)}

    if body.point_system_id is None:
        if row is not None:
            await db.delete(row)
    else:
        # Only one of the caller's companies' systems. A show already on
        # another company's system keeps it until somebody chooses again.
        await _usable_system_or_404(body.point_system_id, await _caller(x_user_id, x_user_role, db), db)
        if row is None:
            row = ShowPointSystem(show_id=show_id)
            db.add(row)
        row.point_system_id = body.point_system_id
        row.chosen_by_user_id = safe_uuid(x_user_id)
        row.chosen_at = datetime.now(timezone.utc)
    if own is not None:
        # The choice has to stop pointing at the chart before the chart goes.
        await db.flush()
        await db.delete(own)
    await db.commit()
    return {"point_system_id": str(body.point_system_id) if body.point_system_id else None}


@router.put("/shows/{show_id}/high-point/chart", dependencies=[Depends(require_admin_or_show_admin)])
async def save_show_chart(
    show_id: UUID,
    body: ShowChartIn,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Save the show's own chart and score the show by it (migration 153).

    The office presses *Use this template* on a library system -- or on Custom,
    which is an empty chart -- adjusts the grid, and saves. The first save
    creates the show's chart; every later one, including starting again from a
    different template, replaces it in place, so a show has one chart at most.
    The library system it started from is untouched: the show took a copy.

    Same validation as a library system (`_validated_awards`), because the
    leaderboard reads both the same way.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)

    chart = await _show_chart(show_id, db)
    created = chart is None
    if created:
        chart = PointSystem(show_id=show_id, created_by_user_id=safe_uuid(x_user_id), awards=[])
    await _apply_system(chart, body, None, db)
    if created:
        db.add(chart)
    await db.flush()

    row = await db.get(ShowPointSystem, show_id)
    if row is None:
        row = ShowPointSystem(show_id=show_id)
        db.add(row)
    if row.point_system_id != chart.id:
        row.point_system_id = chart.id
        row.chosen_by_user_id = safe_uuid(x_user_id)
        row.chosen_at = datetime.now(timezone.utc)
    await db.commit()
    return _system_payload(await _get_system_or_404(chart.id, db))


# ── Circuits ───────────────────────────────────────────────────────────────────


async def _get_circuit_or_404(circuit_id: UUID, db: AsyncSession) -> Circuit:
    circuit = (
        await db.execute(
            select(Circuit)
            .where(Circuit.id == circuit_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if circuit is None:
        raise HTTPException(404, "Circuit not found")
    return circuit


def _assert_circuit_owner(circuit: Circuit, x_user_id: str, x_user_role: str) -> None:
    if x_user_role == "ADMIN":
        return
    if circuit.created_by_user_id and circuit.created_by_user_id == safe_uuid(x_user_id):
        return
    raise HTTPException(403, "Only whoever created this circuit, or a GaitDesk admin, may change it.")


async def _shows_by_id(circuits: list[Circuit], db: AsyncSession, include_drafts: bool) -> dict:
    """Every show the circuits name, in one query rather than one per circuit."""
    show_ids = {cs.show_id for c in circuits for cs in c.circuit_shows}
    if not show_ids:
        return {}
    query = select(Show).where(Show.id.in_(show_ids))
    if not include_drafts:
        query = query.where(Show.status != "DRAFT")
    return {s.id: s for s in (await db.execute(query)).scalars().all()}


def _circuit_body(circuit: Circuit, shows_by_id: dict) -> dict:
    shows = sorted(
        (shows_by_id[cs.show_id] for cs in circuit.circuit_shows if cs.show_id in shows_by_id),
        key=lambda s: (s.start_date, s.name.lower()),
    )
    return {
        "id": str(circuit.id),
        "name": circuit.name,
        "season": circuit.season,
        "notes": circuit.notes,
        "created_by_user_id": str(circuit.created_by_user_id) if circuit.created_by_user_id else None,
        "point_system": (
            {"id": str(circuit.point_system.id), "name": circuit.point_system.name}
            if circuit.point_system else None
        ),
        "shows": [
            {
                "id": str(s.id),
                "name": s.name,
                "start_date": s.start_date.isoformat() if s.start_date else None,
                "end_date": s.end_date.isoformat() if s.end_date else None,
                "status": s.status,
            }
            for s in shows
        ],
    }


async def _circuit_payload(circuit: Circuit, db: AsyncSession, include_drafts: bool) -> dict:
    return _circuit_body(circuit, await _shows_by_id([circuit], db, include_drafts))


async def _check_point_system(
    point_system_id: Optional[UUID], x_user_id: str, x_user_role: str, db: AsyncSession
) -> None:
    """A circuit may only be scored by a system its owner may use."""
    if point_system_id is not None:
        await _usable_system_or_404(point_system_id, await _caller(x_user_id, x_user_role, db), db)


@router.get("/circuits")
async def list_circuits(
    x_api_key: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Every circuit. Public; a DRAFT show is listed only to staff callers."""
    circuits = (
        await db.execute(select(Circuit).order_by(Circuit.season.desc().nulls_last(), func.lower(Circuit.name)))
    ).scalars().all()
    shows_by_id = await _shows_by_id(list(circuits), db, _is_staff_caller(x_api_key))
    return [_circuit_body(c, shows_by_id) for c in circuits]


@router.get("/circuits/{circuit_id}")
async def get_circuit(
    circuit_id: UUID,
    x_api_key: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    circuit = await _get_circuit_or_404(circuit_id, db)
    return await _circuit_payload(circuit, db, _is_staff_caller(x_api_key))


@router.get("/circuits/{circuit_id}/leaderboard")
async def circuit_leaderboard(circuit_id: UUID, db: AsyncSession = Depends(get_db)):
    """Season standings: every posted class at every show in the circuit, under
    the circuit's own points system. Public."""
    circuit = await _get_circuit_or_404(circuit_id, db)
    payload = await _circuit_payload(circuit, db, include_drafts=False)
    system = await _get_system_or_404(circuit.point_system_id, db) if circuit.point_system_id else None

    cards, posted = await load_cards(db, [UUID(s["id"]) for s in payload["shows"]])
    payload["point_system"] = _system_payload(system) if system else None
    payload["posted_class_count"] = posted
    payload["divisions"] = tally(cards, build_chart(system.awards)) if system else []
    return payload


@router.post("/circuits", status_code=201, dependencies=[Depends(require_admin_or_show_admin)])
async def create_circuit(
    body: CircuitIn,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Give the circuit a name.")
    await _check_point_system(body.point_system_id, x_user_id, x_user_role, db)
    circuit = Circuit(
        name=name,
        season=_clean(body.season),
        point_system_id=body.point_system_id,
        notes=_clean(body.notes),
        created_by_user_id=safe_uuid(x_user_id),
        circuit_shows=[],
    )
    db.add(circuit)
    await db.commit()
    return await _circuit_payload(await _get_circuit_or_404(circuit.id, db), db, include_drafts=True)


@router.patch("/circuits/{circuit_id}", dependencies=[Depends(require_admin_or_show_admin)])
async def update_circuit(
    circuit_id: UUID,
    body: CircuitUpdate,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    circuit = await _get_circuit_or_404(circuit_id, db)
    _assert_circuit_owner(circuit, x_user_id, x_user_role)
    fields = body.model_fields_set
    if "name" in fields:
        name = (body.name or "").strip()
        if not name:
            raise HTTPException(422, "Give the circuit a name.")
        circuit.name = name
    if "season" in fields:
        circuit.season = _clean(body.season)
    if "notes" in fields:
        circuit.notes = _clean(body.notes)
    if "point_system_id" in fields and body.point_system_id != circuit.point_system_id:
        await _check_point_system(body.point_system_id, x_user_id, x_user_role, db)
        circuit.point_system_id = body.point_system_id
    await db.commit()
    return await _circuit_payload(await _get_circuit_or_404(circuit_id, db), db, include_drafts=True)


@router.delete("/circuits/{circuit_id}", status_code=204, dependencies=[Depends(require_admin_or_show_admin)])
async def delete_circuit(
    circuit_id: UUID,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Deleting a circuit removes the season standings, never any show's results."""
    circuit = await _get_circuit_or_404(circuit_id, db)
    _assert_circuit_owner(circuit, x_user_id, x_user_role)
    await db.delete(circuit)
    await db.commit()
    return Response(status_code=204)


@router.put(
    "/circuits/{circuit_id}/shows/{show_id}",
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def add_circuit_show(
    circuit_id: UUID,
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Count a show toward the circuit. The circuit's owner, working that show."""
    circuit = await _get_circuit_or_404(circuit_id, db)
    _assert_circuit_owner(circuit, x_user_id, x_user_role)
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    if await db.get(CircuitShow, (circuit_id, show_id)) is None:
        db.add(CircuitShow(circuit_id=circuit_id, show_id=show_id, added_by_user_id=safe_uuid(x_user_id)))
        await db.commit()
    return await _circuit_payload(await _get_circuit_or_404(circuit_id, db), db, include_drafts=True)


@router.delete(
    "/circuits/{circuit_id}/shows/{show_id}",
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def remove_circuit_show(
    circuit_id: UUID,
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Take a show out of the circuit. The circuit's owner may, and so may the
    show's own office -- a show must be able to leave a season it was put in."""
    circuit = await _get_circuit_or_404(circuit_id, db)
    try:
        _assert_circuit_owner(circuit, x_user_id, x_user_role)
    except HTTPException:
        await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    row = await db.get(CircuitShow, (circuit_id, show_id))
    if row is not None:
        await db.delete(row)
        await db.commit()
    return await _circuit_payload(await _get_circuit_or_404(circuit_id, db), db, include_drafts=True)
