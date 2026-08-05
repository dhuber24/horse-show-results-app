"""The judge registry.

A judge is a person, not a line on a show. Shows *assign* a judge from here
(see `routers/show_judges.py`) and read their name, contact details, and
association cards off the registry rather than restating them per show.

Read and create are open to show admins — a secretary hiring a judge who isn't
in the registry yet has to be able to add them. Editing an existing judge is
admin-only, because that record is shared across every show that judge has ever
worked; a typo fix in one show's setup should not silently rewrite the others.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from uuid import UUID

from database import get_db
from dependencies import require_admin, require_admin_or_show_admin
from models import Association, Judge
from schemas import JudgeCreate, JudgeOut, JudgeUpdate

router = APIRouter(prefix="/judges", tags=["Judges"])


async def _load_associations(db: AsyncSession, ids: list[UUID]) -> list[Association]:
    if not ids:
        return []
    result = await db.execute(select(Association).where(Association.id.in_(ids)))
    found = result.scalars().all()
    if len(found) != len(set(ids)):
        raise HTTPException(422, "One or more associations were not found")
    return found


async def _fetch(db: AsyncSession, judge_id: UUID) -> Judge:
    result = await db.execute(
        select(Judge).where(Judge.id == judge_id).options(selectinload(Judge.associations))
    )
    return result.scalar_one()


def _identity_clause(first_name: str, last_name: str, email: str | None):
    """Same identity rule as the unique index in migration 085: name + email."""
    return (
        func.lower(Judge.first_name) == first_name.lower(),
        func.lower(Judge.last_name) == last_name.lower(),
        func.lower(func.coalesce(Judge.email, "")) == (email or "").lower(),
    )


@router.get("/", response_model=list[JudgeOut], dependencies=[Depends(require_admin_or_show_admin)])
async def list_judges(
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Judge)
        .options(selectinload(Judge.associations))
        .order_by(Judge.last_name, Judge.first_name)
    )
    if not include_inactive:
        query = query.where(Judge.is_active.is_(True))
    return (await db.execute(query)).scalars().all()


@router.post("/", response_model=JudgeOut, status_code=201, dependencies=[Depends(require_admin_or_show_admin)])
async def create_judge(body: JudgeCreate, db: AsyncSession = Depends(get_db)):
    first = body.first_name.strip()
    last = body.last_name.strip()
    email = (body.email or "").strip() or None
    existing = await db.execute(select(Judge).where(*_identity_clause(first, last, email)))
    if existing.scalar_one_or_none():
        raise HTTPException(
            409,
            "That judge is already in the registry — pick them from the list instead.",
        )
    judge = Judge(
        first_name=first,
        last_name=last,
        email=email,
        phone=(body.phone or "").strip() or None,
    )
    judge.associations = await _load_associations(db, body.association_ids)
    db.add(judge)
    await db.commit()
    return await _fetch(db, judge.id)


@router.patch("/{judge_id}", response_model=JudgeOut, dependencies=[Depends(require_admin)])
async def update_judge(judge_id: UUID, body: JudgeUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Judge).where(Judge.id == judge_id).options(selectinload(Judge.associations))
    )
    judge = result.scalar_one_or_none()
    if not judge:
        raise HTTPException(404, "Judge not found")

    data = body.model_dump(exclude_unset=True)
    association_ids = data.pop("association_ids", None)
    for key, value in data.items():
        setattr(judge, key, value.strip() or None if isinstance(value, str) else value)
    if not judge.first_name or not judge.last_name:
        raise HTTPException(422, "First and last name are required")

    conflict = await db.execute(
        select(Judge).where(
            *_identity_clause(judge.first_name, judge.last_name, judge.email),
            Judge.id != judge_id,
        )
    )
    if conflict.scalar_one_or_none():
        raise HTTPException(409, "Another judge already has that name and email")

    if association_ids is not None:
        judge.associations = await _load_associations(db, association_ids)
    await db.commit()
    return await _fetch(db, judge_id)
