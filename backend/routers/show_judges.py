"""Which registry judges officiate which show.

`show_judges` is an assignment, nothing more: the judge's name, contact details
and association cards are read from `judges` (see `routers/judges.py`). Show
setup picks a judge and cannot edit their details, so the same person reads the
same way across every show they work.
"""

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from uuid import UUID

from database import get_db
from dependencies import require_admin_or_show_admin
from models import Judge, Result, Show, ShowJudge
from routers.shows import _assert_show_access
from schemas import (
    PublicShowJudgeOut,
    ShowJudgeCreate,
    ShowJudgeOut,
    ShowJudgeUpdate,
)

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


@router.get("/public", response_model=list[PublicShowJudgeOut])
async def list_show_judges_public(show_id: UUID, db: AsyncSession = Depends(get_db)):
    """The show's judging panel, names only, no auth.

    Results are published per judge, so the public class page has to label its
    columns with something. Who judged a show is program information — it is
    printed on the show bill — but contact details are not, so this returns the
    name and the running order and stops there.

    Declared above `/{assignment_id}` so "public" is not parsed as a UUID.
    """
    await _get_show_or_404(show_id, db)
    result = await db.execute(
        select(ShowJudge)
        .where(ShowJudge.show_id == show_id)
        .options(selectinload(ShowJudge.judge))
        .order_by(ShowJudge.sort_order, ShowJudge.created_at)
    )
    return [
        {
            "id": sj.id,
            "judge_id": sj.judge_id,
            "first_name": sj.judge.first_name,
            "last_name": sj.judge.last_name,
            "sort_order": sj.sort_order,
        }
        for sj in result.scalars().all()
    ]


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

    # Placings point at the assignment (migration 095) under an ON DELETE
    # RESTRICT. Checking here turns what would surface as a raw FK violation
    # into an answerable message — and the answer is never "delete the card",
    # so the office is told to clear it deliberately rather than by side effect.
    placed = await db.execute(
        select(func.count()).select_from(Result).where(Result.judge_id == assignment_id)
    )
    placed_count = placed.scalar_one()
    if placed_count:
        raise HTTPException(
            409,
            f"This judge has placings recorded in {placed_count} "
            f"{'entry' if placed_count == 1 else 'entries'} at this show. "
            "Clear their cards before unassigning them.",
        )

    await db.delete(assignment)
    await db.commit()
