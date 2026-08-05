"""Which registry judges officiate which show.

`show_judges` is an assignment, nothing more: the judge's name, contact details
and association cards are read from `judges` (see `routers/judges.py`). Show
setup picks a judge and cannot edit their details, so the same person reads the
same way across every show they work.
"""

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from uuid import UUID

from database import get_db
from dependencies import require_admin_or_show_admin
from models import Judge, Show, ShowJudge
from routers.shows import _assert_show_access
from schemas import ShowJudgeCreate, ShowJudgeOut, ShowJudgeUpdate

router = APIRouter(prefix="/shows/{show_id}/judges", tags=["Show Judges"])


def _serialize(sj: ShowJudge) -> dict:
    judge = sj.judge
    return {
        "id": sj.id,
        "show_id": sj.show_id,
        "judge_id": sj.judge_id,
        "first_name": judge.first_name,
        "last_name": judge.last_name,
        "email": judge.email,
        "phone": judge.phone,
        "associations": [
            {"id": a.id, "code": a.code, "name": a.name} for a in (judge.associations or [])
        ],
        "sort_order": sj.sort_order,
        "created_at": sj.created_at,
    }


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _fetch_assignment(db: AsyncSession, assignment_id: UUID) -> ShowJudge:
    result = await db.execute(
        select(ShowJudge)
        .where(ShowJudge.id == assignment_id)
        .options(selectinload(ShowJudge.judge).selectinload(Judge.associations))
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
        .options(selectinload(ShowJudge.judge).selectinload(Judge.associations))
        .order_by(ShowJudge.sort_order, ShowJudge.created_at)
    )
    return [_serialize(sj) for sj in result.scalars().all()]


@router.post("/", response_model=ShowJudgeOut, status_code=201, dependencies=[Depends(require_admin_or_show_admin)])
async def add_show_judge(
    show_id: UUID,
    body: ShowJudgeCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)

    judge = await db.get(Judge, body.judge_id)
    if not judge:
        raise HTTPException(404, "Judge not found in the registry")

    existing = await db.execute(
        select(ShowJudge).where(
            ShowJudge.show_id == show_id, ShowJudge.judge_id == body.judge_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "That judge is already assigned to this show")

    assignment = ShowJudge(show_id=show_id, judge_id=body.judge_id, sort_order=body.sort_order)
    db.add(assignment)
    await db.commit()
    return _serialize(await _fetch_assignment(db, assignment.id))


@router.patch("/{assignment_id}", response_model=ShowJudgeOut, dependencies=[Depends(require_admin_or_show_admin)])
async def update_show_judge(
    show_id: UUID,
    assignment_id: UUID,
    body: ShowJudgeUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Only the running order is a per-show fact. Judge details are edited on
    the registry, not here."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    result = await db.execute(
        select(ShowJudge)
        .where(ShowJudge.id == assignment_id, ShowJudge.show_id == show_id)
        .options(selectinload(ShowJudge.judge).selectinload(Judge.associations))
    )
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(404, "Judge not found")
    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(assignment, key, value)
    await db.commit()
    return _serialize(await _fetch_assignment(db, assignment_id))


@router.delete("/{assignment_id}", status_code=204, dependencies=[Depends(require_admin_or_show_admin)])
async def delete_show_judge(
    show_id: UUID,
    assignment_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Unassigns the judge from the show. The registry record is untouched."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    assignment = await db.get(ShowJudge, assignment_id)
    if not assignment or assignment.show_id != show_id:
        raise HTTPException(404, "Judge not found")
    await db.delete(assignment)
    await db.commit()
