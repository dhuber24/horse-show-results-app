from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from uuid import UUID

from database import get_db
from dependencies import INTERNAL_API_KEY, require_admin_or_show_admin, safe_uuid
from models import Show, ShowJudge, ShowType, ShowManager, ShowSecretary
from routers.shows import _assert_show_access
from schemas import ShowJudgeCreate, ShowJudgeOut, ShowJudgeUpdate

router = APIRouter(prefix="/shows/{show_id}/judges", tags=["Show Judges"])

# Separate top-level router for cross-show judge lookups (e.g. the wizard's
# "pick an existing judge" dropdown). Lives in the same file because it's
# the same domain as ShowJudge.
known_judges_router = APIRouter(prefix="/judges", tags=["Show Judges"])


@known_judges_router.get("/known")
async def list_known_judges(
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Deduplicated list of judges drawn from past shows, scoped to what the
    caller can already see. Admin sees all; Show Manager / Show Secretary
    see judges from shows they are assigned to."""
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    if x_user_role not in ("ADMIN", "SHOW_MANAGER", "SHOW_SECRETARY"):
        raise HTTPException(403, "Insufficient permissions")

    if x_user_role == "ADMIN":
        query = (
            select(ShowJudge)
            .options(selectinload(ShowJudge.affiliations))
            .order_by(ShowJudge.last_name, ShowJudge.first_name)
        )
    elif x_user_role == "SHOW_MANAGER":
        query = (
            select(ShowJudge)
            .join(ShowManager, ShowManager.show_id == ShowJudge.show_id)
            .where(ShowManager.user_id == safe_uuid(x_user_id))
            .options(selectinload(ShowJudge.affiliations))
            .order_by(ShowJudge.last_name, ShowJudge.first_name)
        )
    else:
        query = (
            select(ShowJudge)
            .join(ShowSecretary, ShowSecretary.show_id == ShowJudge.show_id)
            .where(ShowSecretary.user_id == safe_uuid(x_user_id))
            .options(selectinload(ShowJudge.affiliations))
            .order_by(ShowJudge.last_name, ShowJudge.first_name)
        )

    rows = (await db.execute(query)).scalars().all()
    seen: set[tuple[str, str, str]] = set()
    out: list[dict] = []
    for j in rows:
        key = (
            (j.first_name or "").strip().lower(),
            (j.last_name or "").strip().lower(),
            (j.email or "").strip().lower(),
        )
        if not key[0] or not key[1] or key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "first_name": j.first_name,
                "last_name": j.last_name,
                "email": j.email,
                "phone": j.phone,
                "affiliation_ids": [str(a.id) for a in (j.affiliations or [])],
            }
        )
    return out


def _serialize(j: ShowJudge) -> dict:
    return {
        "id": j.id,
        "show_id": j.show_id,
        "first_name": j.first_name,
        "last_name": j.last_name,
        "email": j.email,
        "phone": j.phone,
        "affiliations": [{"id": a.id, "code": a.code, "name": a.name} for a in (j.affiliations or [])],
        "sort_order": j.sort_order,
        "created_at": j.created_at,
    }


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _load_show_types(db: AsyncSession, ids: list[UUID]) -> list[ShowType]:
    if not ids:
        return []
    result = await db.execute(select(ShowType).where(ShowType.id.in_(ids)))
    return result.scalars().all()


async def _fetch_judge(db: AsyncSession, judge_id: UUID) -> ShowJudge:
    result = await db.execute(
        select(ShowJudge)
        .where(ShowJudge.id == judge_id)
        .options(selectinload(ShowJudge.affiliations))
    )
    return result.scalar_one()


@router.get("/", response_model=list[ShowJudgeOut])
async def list_show_judges(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    result = await db.execute(
        select(ShowJudge)
        .where(ShowJudge.show_id == show_id)
        .options(selectinload(ShowJudge.affiliations))
        .order_by(ShowJudge.sort_order, ShowJudge.created_at)
    )
    return [_serialize(j) for j in result.scalars().all()]


@router.post("/", response_model=ShowJudgeOut, status_code=201, dependencies=[Depends(require_admin_or_show_admin)])
async def create_show_judge(
    show_id: UUID,
    body: ShowJudgeCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    judge = ShowJudge(
        show_id=show_id,
        first_name=body.first_name,
        last_name=body.last_name,
        email=body.email,
        phone=body.phone,
        sort_order=body.sort_order,
    )
    judge.affiliations = await _load_show_types(db, body.affiliation_ids)
    db.add(judge)
    await db.commit()
    return _serialize(await _fetch_judge(db, judge.id))


@router.patch("/{judge_id}", response_model=ShowJudgeOut, dependencies=[Depends(require_admin_or_show_admin)])
async def update_show_judge(
    show_id: UUID,
    judge_id: UUID,
    body: ShowJudgeUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    result = await db.execute(
        select(ShowJudge)
        .where(ShowJudge.id == judge_id, ShowJudge.show_id == show_id)
        .options(selectinload(ShowJudge.affiliations))
    )
    judge = result.scalar_one_or_none()
    if not judge:
        raise HTTPException(404, "Judge not found")
    data = body.model_dump(exclude_unset=True)
    affiliation_ids = data.pop("affiliation_ids", None)
    for k, v in data.items():
        setattr(judge, k, v)
    if affiliation_ids is not None:
        judge.affiliations = await _load_show_types(db, affiliation_ids)
    await db.commit()
    return _serialize(await _fetch_judge(db, judge_id))


@router.delete("/{judge_id}", status_code=204, dependencies=[Depends(require_admin_or_show_admin)])
async def delete_show_judge(
    show_id: UUID,
    judge_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    judge = await db.get(ShowJudge, judge_id)
    if not judge or judge.show_id != show_id:
        raise HTTPException(404, "Judge not found")
    await db.delete(judge)
    await db.commit()
