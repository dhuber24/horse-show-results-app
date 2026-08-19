from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from pydantic import BaseModel

from database import get_db
from dependencies import require_admin, safe_uuid, INTERNAL_API_KEY
from models import Show, User, ShowSecretary, ShowScribe, ShowManager, ShowGateSteward
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
    """Raises 403 unless caller is ADMIN, an assigned Show Secretary, or an assigned Show Manager."""
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
    if x_user_role == "SHOW_MANAGER":
        row = await db.execute(
            select(ShowManager).where(
                ShowManager.show_id == show_id,
                ShowManager.user_id == safe_uuid(x_user_id),
            )
        )
        if row.scalar_one_or_none():
            return
    raise HTTPException(status_code=403, detail="Not authorized for this show")


# ── Show Secretaries ───────────────────────────────────────────────────────────

@router.get("/shows/{show_id}/admins", response_model=list[UserOut])
async def list_show_secretaries(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    await _get_show_or_404(show_id, db)
    await _assert_show_admin_access(show_id, x_user_id, x_user_role, db)
    result = await db.execute(
        select(User)
        .join(ShowSecretary, ShowSecretary.user_id == User.id)
        .where(ShowSecretary.show_id == show_id)
        .order_by(User.full_name)
    )
    return result.scalars().all()


@router.post("/shows/{show_id}/admins", response_model=UserOut, status_code=201)
async def add_show_admin(
    show_id: UUID,
    body: UserAssignBody,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    await _get_show_or_404(show_id, db)
    await _assert_show_admin_access(show_id, x_user_id, x_user_role, db)
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


@router.delete("/shows/{show_id}/admins/{user_id}", status_code=204)
async def remove_show_admin(
    show_id: UUID,
    user_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    await _assert_show_admin_access(show_id, x_user_id, x_user_role, db)
    row = await db.execute(
        select(ShowSecretary).where(ShowSecretary.show_id == show_id, ShowSecretary.user_id == user_id)
    )
    entry = row.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Show admin assignment not found")
    await db.delete(entry)
    await db.commit()


# ── Show Scribes ───────────────────────────────────────────────────────────────

@router.get("/shows/{show_id}/scribes", response_model=list[UserOut])
async def list_show_scribes(
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
        .join(ShowScribe, ShowScribe.user_id == User.id)
        .where(ShowScribe.show_id == show_id)
        .order_by(User.full_name)
    )
    return result.scalars().all()


@router.post("/shows/{show_id}/scribes", response_model=UserOut, status_code=201)
async def add_show_scribe(
    show_id: UUID,
    body: UserAssignBody,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """
    ADMIN can assign any existing scribe.
    SHOW_SECRETARY can only assign scribes they created (i.e., where the scribe
    has no show_scribes rows yet — meaning they're brand new).
    """
    from dependencies import INTERNAL_API_KEY
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    await _get_show_or_404(show_id, db)
    await _assert_show_admin_access(show_id, x_user_id, x_user_role, db)

    user = await _get_user_or_404(body.user_id, db)
    if user.role != "SCRIBE":
        raise HTTPException(400, "User must have SCRIBE role")

    if x_user_role == "SHOW_SECRETARY":
        existing_assignments = await db.execute(
            select(ShowScribe).where(ShowScribe.user_id == user.id)
        )
        if existing_assignments.scalar_one_or_none():
            raise HTTPException(403, "Show Secretaries can only assign scribes they created")
    # SHOW_MANAGER (like ADMIN) can assign any existing scribe — no restriction

    already = await db.execute(
        select(ShowScribe).where(ShowScribe.show_id == show_id, ShowScribe.user_id == user.id)
    )
    if already.scalar_one_or_none():
        raise HTTPException(409, "Scribe already assigned to this show")

    db.add(ShowScribe(show_id=show_id, user_id=user.id))
    await db.commit()
    return user


@router.delete("/shows/{show_id}/scribes/{user_id}", status_code=204)
async def remove_show_scribe(
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
        select(ShowScribe).where(ShowScribe.show_id == show_id, ShowScribe.user_id == user_id)
    )
    entry = row.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Scribe assignment not found")
    await db.delete(entry)
    await db.commit()


# ── Show Gate Stewards ─────────────────────────────────────────────────────────

@router.get("/shows/{show_id}/gate-stewards", response_model=list[UserOut])
async def list_show_gate_stewards(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    await _get_show_or_404(show_id, db)
    await _assert_show_admin_access(show_id, x_user_id, x_user_role, db)
    result = await db.execute(
        select(User)
        .join(ShowGateSteward, ShowGateSteward.user_id == User.id)
        .where(ShowGateSteward.show_id == show_id)
        .order_by(User.full_name)
    )
    return result.scalars().all()


@router.post("/shows/{show_id}/gate-stewards", response_model=UserOut, status_code=201)
async def add_show_gate_steward(
    show_id: UUID,
    body: UserAssignBody,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    await _get_show_or_404(show_id, db)
    await _assert_show_admin_access(show_id, x_user_id, x_user_role, db)

    user = await _get_user_or_404(body.user_id, db)
    if user.role != "GATE_STEWARD":
        raise HTTPException(400, "User must have GATE_STEWARD role")

    already = await db.execute(
        select(ShowGateSteward).where(ShowGateSteward.show_id == show_id, ShowGateSteward.user_id == user.id)
    )
    if already.scalar_one_or_none():
        raise HTTPException(409, "Gate steward already assigned to this show")

    db.add(ShowGateSteward(show_id=show_id, user_id=user.id))
    await db.commit()
    return user


@router.delete("/shows/{show_id}/gate-stewards/{user_id}", status_code=204)
async def remove_show_gate_steward(
    show_id: UUID,
    user_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    await _assert_show_admin_access(show_id, x_user_id, x_user_role, db)
    row = await db.execute(
        select(ShowGateSteward).where(ShowGateSteward.show_id == show_id, ShowGateSteward.user_id == user_id)
    )
    entry = row.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Gate steward assignment not found")
    await db.delete(entry)
    await db.commit()


# ── Show Managers ──────────────────────────────────────────────────────────────
#
# A show gets its first manager for free: whoever created it (`shows.py`). These
# endpoints are how a second one is added — a co-manager, or a handover when the
# original manager stops running the series.

@router.get("/shows/{show_id}/managers", response_model=list[UserOut])
async def list_show_managers(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    await _get_show_or_404(show_id, db)
    await _assert_show_admin_access(show_id, x_user_id, x_user_role, db)
    result = await db.execute(
        select(User)
        .join(ShowManager, ShowManager.user_id == User.id)
        .where(ShowManager.show_id == show_id)
        .order_by(User.full_name)
    )
    return result.scalars().all()


@router.post("/shows/{show_id}/managers", response_model=UserOut, status_code=201)
async def add_show_manager(
    show_id: UUID,
    body: UserAssignBody,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    await _get_show_or_404(show_id, db)
    await _assert_show_admin_access(show_id, x_user_id, x_user_role, db)

    user = await _get_user_or_404(body.user_id, db)
    if user.role != "SHOW_MANAGER":
        raise HTTPException(400, "User must have SHOW_MANAGER role")

    already = await db.execute(
        select(ShowManager).where(ShowManager.show_id == show_id, ShowManager.user_id == user.id)
    )
    if already.scalar_one_or_none():
        raise HTTPException(409, "Manager already assigned to this show")

    db.add(ShowManager(show_id=show_id, user_id=user.id))
    await db.commit()
    return user


@router.delete("/shows/{show_id}/managers/{user_id}", status_code=204)
async def remove_show_manager(
    show_id: UUID,
    user_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    await _assert_show_admin_access(show_id, x_user_id, x_user_role, db)
    rows = (
        await db.execute(select(ShowManager).where(ShowManager.show_id == show_id))
    ).scalars().all()
    entry = next((r for r in rows if r.user_id == user_id), None)
    if not entry:
        raise HTTPException(404, "Manager assignment not found")
    # A manager reaches this show through `show_managers` and nothing else, so
    # removing the last one hides the show from every manager's list and leaves
    # only ADMIN able to open it — including from the manager who just did it.
    if len(rows) == 1:
        raise HTTPException(
            409,
            "This is the show's only manager. Add another before removing this one.",
        )
    await db.delete(entry)
    await db.commit()
