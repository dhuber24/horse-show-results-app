from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from pydantic import BaseModel

from database import get_db
from dependencies import require_admin, safe_uuid
from models import Show, User, ShowSecretary, ShowScorekeeper
from schemas import UserOut

router = APIRouter(tags=["Show Staff"])


class UserAssignBody(BaseModel):
    user_id: UUID


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _get_user_or_404(user_id: UUID, db: AsyncSession) -> User:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return user


async def _assert_show_admin_access(show_id: UUID, x_user_id: str, x_user_role: str, db: AsyncSession):
    """Raises 403 unless caller is ADMIN or an assigned Show Secretary of this show."""
    if x_user_role == "ADMIN":
        return
    if x_user_role == "SHOW_SECRETARY":
        row = await db.execute(
            select(ShowSecretary).where(
                ShowSecretary.show_id == show_id,
                ShowSecretary.user_id == safe_uuid(x_user_id),
            )
        )
        if row.scalar_one_or_none():
            return
    raise HTTPException(status_code=403, detail="Not authorized for this show")


# ── Show Secretaries ───────────────────────────────────────────────────────────

@router.get("/shows/{show_id}/admins", response_model=list[UserOut], dependencies=[Depends(require_admin)])
async def list_show_secretaries(show_id: UUID, db: AsyncSession = Depends(get_db)):
    await _get_show_or_404(show_id, db)
    result = await db.execute(
        select(User)
        .join(ShowSecretary, ShowSecretary.user_id == User.id)
        .where(ShowSecretary.show_id == show_id)
        .order_by(User.full_name)
    )
    return result.scalars().all()


@router.post("/shows/{show_id}/admins", response_model=UserOut, status_code=201, dependencies=[Depends(require_admin)])
async def add_show_admin(show_id: UUID, body: UserAssignBody, db: AsyncSession = Depends(get_db)):
    await _get_show_or_404(show_id, db)
    user = await _get_user_or_404(body.user_id, db)
    if user.role != "SHOW_SECRETARY":
        raise HTTPException(400, "User must have SHOW_SECRETARY role")
    existing = await db.execute(
        select(ShowSecretary).where(ShowSecretary.show_id == show_id, ShowSecretary.user_id == user.id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "User is already an admin of this show")
    db.add(ShowSecretary(show_id=show_id, user_id=user.id))
    await db.commit()
    return user


@router.delete("/shows/{show_id}/admins/{user_id}", status_code=204, dependencies=[Depends(require_admin)])
async def remove_show_admin(show_id: UUID, user_id: UUID, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        select(ShowSecretary).where(ShowSecretary.show_id == show_id, ShowSecretary.user_id == user_id)
    )
    entry = row.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Show admin assignment not found")
    await db.delete(entry)
    await db.commit()


# ── Show Scorekeepers ──────────────────────────────────────────────────────────

@router.get("/shows/{show_id}/scorekeepers", response_model=list[UserOut])
async def list_show_scorekeepers(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    from dependencies import INTERNAL_API_KEY
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    await _get_show_or_404(show_id, db)
    await _assert_show_admin_access(show_id, x_user_id, x_user_role, db)
    result = await db.execute(
        select(User)
        .join(ShowScorekeeper, ShowScorekeeper.user_id == User.id)
        .where(ShowScorekeeper.show_id == show_id)
        .order_by(User.full_name)
    )
    return result.scalars().all()


@router.post("/shows/{show_id}/scorekeepers", response_model=UserOut, status_code=201)
async def add_show_scorekeeper(
    show_id: UUID,
    body: UserAssignBody,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """
    ADMIN can assign any existing scorekeeper.
    SHOW_SECRETARY can only assign scorekeepers they created (i.e., where the scorekeeper
    has no show_scorekeepers rows yet — meaning they're brand new).
    """
    from dependencies import INTERNAL_API_KEY
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    await _get_show_or_404(show_id, db)
    await _assert_show_admin_access(show_id, x_user_id, x_user_role, db)

    user = await _get_user_or_404(body.user_id, db)
    if user.role != "SCOREKEEPER":
        raise HTTPException(400, "User must have SCOREKEEPER role")

    if x_user_role == "SHOW_SECRETARY":
        existing_assignments = await db.execute(
            select(ShowScorekeeper).where(ShowScorekeeper.user_id == user.id)
        )
        if existing_assignments.scalar_one_or_none():
            raise HTTPException(403, "Show Secretaries can only assign scorekeepers they created")

    already = await db.execute(
        select(ShowScorekeeper).where(ShowScorekeeper.show_id == show_id, ShowScorekeeper.user_id == user.id)
    )
    if already.scalar_one_or_none():
        raise HTTPException(409, "Scorekeeper already assigned to this show")

    db.add(ShowScorekeeper(show_id=show_id, user_id=user.id))
    await db.commit()
    return user


@router.delete("/shows/{show_id}/scorekeepers/{user_id}", status_code=204)
async def remove_show_scorekeeper(
    show_id: UUID,
    user_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    from dependencies import INTERNAL_API_KEY
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    await _assert_show_admin_access(show_id, x_user_id, x_user_role, db)
    row = await db.execute(
        select(ShowScorekeeper).where(ShowScorekeeper.show_id == show_id, ShowScorekeeper.user_id == user_id)
    )
    entry = row.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Scorekeeper assignment not found")
    await db.delete(entry)
    await db.commit()
