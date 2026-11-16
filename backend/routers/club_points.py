"""Saddle clubs and saddle-club high point: the office's setup, the shared club
list, and each rider's club(s) at a show (migration 193). The rules are
`backend/club_points.py`'s."""
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from club_points import (
    CLUBS_PER_RIDER_MAX,
    add_saddle_club,
    club_names,
    declared_clubs,
    held_clubs,
    load_settings,
    save_settings,
    set_rider_clubs,
    settings_out,
)
from database import get_db
from dependencies import INTERNAL_API_KEY, require_admin_or_show_admin, safe_uuid
from models import Exhibitor, Show, ShowEntry
from routers.shows import _assert_show_access
from self_entry import SELF_ENTRY_STATUSES

router = APIRouter(tags=["Saddle Clubs"])


class ClubPointsIn(BaseModel):
    enabled: bool
    clubs_per_rider: int = Field(default=1, ge=1, le=CLUBS_PER_RIDER_MAX)
    team_rule: Literal["each_rider", "entrant", "none"] = "each_rider"
    club_ids: list[UUID] = Field(default_factory=list, max_length=500)


class SaddleClubIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class RiderClubsIn(BaseModel):
    club_ids: list[UUID] = Field(default_factory=list, max_length=CLUBS_PER_RIDER_MAX)
    primary_id: Optional[UUID] = None


@router.get("/shows/{show_id}/club-points", dependencies=[Depends(require_admin_or_show_admin)])
async def get_club_points(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The show's saddle-club high point setup."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    return await settings_out(db, await load_settings(db, show_id))


@router.put("/shows/{show_id}/club-points", dependencies=[Depends(require_admin_or_show_admin)])
async def put_club_points(
    show_id: UUID,
    body: ClubPointsIn,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Replace the setup: whether the show keeps club standings, which clubs
    compete, how many a rider may ride for, and how team classes count."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await save_settings(
        db,
        show_id,
        enabled=body.enabled,
        clubs_per_rider=body.clubs_per_rider,
        team_rule=body.team_rule,
        club_ids=body.club_ids,
    )
    await db.commit()
    return await settings_out(db, await load_settings(db, show_id))


@router.post("/saddle-clubs", status_code=201, dependencies=[Depends(require_admin_or_show_admin)])
async def create_saddle_club(
    body: SaddleClubIn,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Add a saddle club that is not listed, kept for every show after. A club
    already on file under that name is returned rather than added twice.

    A name is no personal detail, so this is open to anybody in a show office,
    like the club picker it feeds.
    """
    club = await add_saddle_club(db, body.name, safe_uuid(x_user_id) if x_user_id else None)
    await db.commit()
    return {"id": str(club.id), "code": club.code, "name": club.name, "association_type": "saddle_club"}


async def _clubs_payload(db: AsyncSession, show_id: UUID, exhibitor_id: UUID) -> dict:
    """What a rider's club choice needs: the setup, the competing clubs they
    hold a membership with, and what they have declared."""
    settings = await load_settings(db, show_id)
    out = await settings_out(db, settings)
    if settings is None:
        return {**out, "held": [], "declared": None}
    competing = {c.association_id for c in settings.clubs}
    held = (await held_clubs(db, show_id, [exhibitor_id], competing)).get(exhibitor_id, [])
    declared = (await declared_clubs(db, show_id)).get(exhibitor_id)
    names = await club_names(db, list(held) + (list(declared.clubs) if declared else []))
    return {
        **out,
        "held": [{"id": str(cid), "name": names.get(cid, "")} for cid in held],
        "declared": (
            {
                "club_ids": [str(cid) for cid in declared.clubs],
                "primary_id": str(declared.primary) if declared.primary else None,
                "derived": declared.derived,
            }
            if declared
            else None
        ),
    }


async def _roster_row(db: AsyncSession, show_id: UUID, exhibitor_id: UUID) -> ShowEntry:
    row = (
        await db.execute(
            select(ShowEntry).where(ShowEntry.show_id == show_id, ShowEntry.exhibitor_id == exhibitor_id)
        )
    ).scalar_one_or_none()
    if row is None or row.cancelled_at is not None:
        raise HTTPException(404, "That rider is not on this show's roster.")
    return row


@router.put(
    "/shows/{show_id}/desk/exhibitors/{exhibitor_id}/clubs",
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def desk_set_rider_clubs(
    show_id: UUID,
    exhibitor_id: UUID,
    body: RiderClubsIn,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The desk sets which club(s) a rider rides for here."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    row = await _roster_row(db, show_id, exhibitor_id)
    await set_rider_clubs(db, show_id, row, body.club_ids, body.primary_id)
    await db.commit()
    return await _clubs_payload(db, show_id, exhibitor_id)


async def _caller(show_id: UUID, x_api_key: str, x_user_id: str, db: AsyncSession) -> Exhibitor:
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    show = await db.get(Show, show_id)
    if show is None or show.status not in SELF_ENTRY_STATUSES:
        raise HTTPException(403, "This show is not taking entries.")
    exhibitor = (
        await db.execute(select(Exhibitor).where(Exhibitor.user_id == safe_uuid(x_user_id)))
    ).scalar_one_or_none()
    if exhibitor is None:
        raise HTTPException(403, "Only exhibitors declare a club.")
    return exhibitor


@router.get("/shows/{show_id}/register/clubs")
async def my_clubs(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    exhibitor = await _caller(show_id, x_api_key, x_user_id, db)
    return await _clubs_payload(db, show_id, exhibitor.id)


@router.put("/shows/{show_id}/register/clubs")
async def set_my_clubs(
    show_id: UUID,
    body: RiderClubsIn,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The rider declares the club(s) they ride for at this show."""
    exhibitor = await _caller(show_id, x_api_key, x_user_id, db)
    row = await _roster_row(db, show_id, exhibitor.id)
    await set_rider_clubs(db, show_id, row, body.club_ids, body.primary_id)
    await db.commit()
    return await _clubs_payload(db, show_id, exhibitor.id)
