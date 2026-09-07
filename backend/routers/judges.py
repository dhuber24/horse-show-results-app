"""The judge registry.

A judge is a person, not a line on a show. Shows *assign* a judge from here
(see `routers/show_judges.py`) and read their name, contact details, and
association cards off the registry rather than restating them per show.

Read and create are open to show admins — a secretary hiring a judge who isn't
in the registry yet has to be able to add them. Editing an existing judge is
admin-only, because that record is shared across every show that judge has ever
worked; a typo fix in one show's setup should not silently rewrite the others.
"""

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from uuid import UUID

from database import get_db
from dependencies import require_admin, require_admin_or_show_admin
from models import Association, Judge, User
from schemas import JudgeCreate, JudgeOut, JudgeUpdate, JudgeUserCreate

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
    # populate_existing because the row is already in the identity map on every
    # path that calls this — the options would otherwise be dropped and the
    # first attribute read would be lazy IO in an async request.
    result = await db.execute(
        select(Judge)
        .where(Judge.id == judge_id)
        .options(selectinload(Judge.associations), selectinload(Judge.user))
        .execution_options(populate_existing=True)
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


@router.post(
    "/{judge_id}/user",
    response_model=JudgeOut,
    status_code=201,
    dependencies=[Depends(require_admin)],
)
async def create_judge_user(
    judge_id: UUID, body: JudgeUserCreate, db: AsyncSession = Depends(get_db)
):
    """Give a registry judge a login.

    Admin-only for the same reason `PATCH` is: the registry row is shared by
    every show that judge has ever worked, and an account attached to the wrong
    one is not a typo somebody notices.

    The name comes off the registry row, never off the request — the judge is
    already on file and this is an account *for that person*. Creating the user
    and linking it are one transaction, because the two halves apart are a
    login nobody can find and a registry row pointing at nothing.
    """
    result = await db.execute(
        select(Judge)
        .where(Judge.id == judge_id)
        .options(selectinload(Judge.associations), selectinload(Judge.user))
    )
    judge = result.scalar_one_or_none()
    if not judge:
        raise HTTPException(404, "Judge not found")
    if judge.user_id:
        raise HTTPException(409, "That judge already has an account.")

    email = ((body.email or judge.email) or "").strip().lower()
    if not email:
        raise HTTPException(
            422,
            "This judge has no email on file — add one to the registry, or supply one here.",
        )

    existing = await db.execute(select(User).where(func.lower(User.email) == email))
    if existing.scalar_one_or_none():
        # Deliberately not "link it anyway". An address already in use belongs
        # to somebody with a role of their own — a judge who also shows horses
        # holds an EXHIBITOR account — and quietly re-roling it would take away
        # what they signed up for. The admin decides.
        raise HTTPException(409, f"{email} already has an account.")

    user = User(
        email=email,
        first_name=judge.first_name,
        last_name=judge.last_name,
        full_name=f"{judge.first_name} {judge.last_name}".strip(),
        role="JUDGE",
        hashed_password=bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode(),
        is_approved=True,
    )
    db.add(user)
    await db.flush()
    judge.user_id = user.id
    await db.commit()
    return await _fetch(db, judge_id)
