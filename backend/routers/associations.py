from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from typing import Optional

from database import get_db
from dependencies import require_admin, require_authenticated
from models import Association
from schemas import AssociationCreate, AssociationUpdate, AssociationOut

router = APIRouter(prefix="/associations", tags=["Associations"])


@router.get("/", response_model=list[AssociationOut], dependencies=[Depends(require_authenticated)])
async def list_associations(
    association_type: Optional[str] = Query(
        None, alias="type", pattern="^(breed|club)$",
        description="Filter to breed registries or club bodies; omit for both.",
    ),
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """The registry of bodies a horse or person can be affiliated with.

    This is not the same list as show types — see models.Association."""
    query = select(Association).order_by(Association.association_type, Association.name)
    if association_type:
        query = query.where(Association.association_type == association_type)
    if not include_inactive:
        query = query.where(Association.is_active.is_(True))
    return (await db.execute(query)).scalars().all()


@router.post("/", response_model=AssociationOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_association(body: AssociationCreate, db: AsyncSession = Depends(get_db)):
    code = body.code.strip().upper()
    existing = await db.execute(select(Association).where(Association.code == code))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "An association with that code already exists")
    row = Association(
        code=code,
        name=body.name.strip(),
        association_type=body.association_type,
        is_active=body.is_active,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.patch("/{association_id}", response_model=AssociationOut, dependencies=[Depends(require_admin)])
async def update_association(
    association_id: UUID,
    body: AssociationUpdate,
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(Association, association_id)
    if not row:
        raise HTTPException(404, "Association not found")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    await db.commit()
    await db.refresh(row)
    return row
