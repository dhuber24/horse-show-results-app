from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from database import get_db
from dependencies import require_admin
from models import ShowType
from schemas import ShowTypeCreate, ShowTypeUpdate, ShowTypeOut

router = APIRouter(prefix="/show-types", tags=["ShowTypes"])


@router.get("/", response_model=list[ShowTypeOut])
async def list_show_types(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ShowType).order_by(ShowType.code))
    return result.scalars().all()


@router.post("/", response_model=ShowTypeOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_show_type(body: ShowTypeCreate, db: AsyncSession = Depends(get_db)):
    st = ShowType(**body.model_dump())
    db.add(st)
    await db.commit()
    await db.refresh(st)
    return st


@router.get("/{show_type_id}", response_model=ShowTypeOut)
async def get_show_type(show_type_id: UUID, db: AsyncSession = Depends(get_db)):
    st = await db.get(ShowType, show_type_id)
    if not st:
        raise HTTPException(404, "Show type not found")
    return st


@router.patch("/{show_type_id}", response_model=ShowTypeOut, dependencies=[Depends(require_admin)])
async def update_show_type(show_type_id: UUID, body: ShowTypeUpdate, db: AsyncSession = Depends(get_db)):
    st = await db.get(ShowType, show_type_id)
    if not st:
        raise HTTPException(404, "Show type not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(st, k, v)
    await db.commit()
    await db.refresh(st)
    return st


@router.delete("/{show_type_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_show_type(show_type_id: UUID, db: AsyncSession = Depends(get_db)):
    st = await db.get(ShowType, show_type_id)
    if not st:
        raise HTTPException(404, "Show type not found")
    await db.delete(st)
    await db.commit()
