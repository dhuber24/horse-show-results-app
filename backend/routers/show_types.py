from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from database import get_db
from dependencies import require_admin
from models import ShowCategory, ShowType
from schemas import ShowCategoryCreate, ShowCategoryOut, ShowTypeCreate, ShowTypeUpdate, ShowTypeOut

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


@router.get("/categories", response_model=list[ShowCategoryOut])
async def list_show_categories(db: AsyncSession = Depends(get_db)):
    """Every show category, generic and per-show-type (APHA SC-100, SC-105).

    Declared **before** `/{show_type_id}`: FastAPI matches in declaration order,
    and the other way round "categories" is parsed as a UUID and 422s. Same
    reason `/archive` precedes `/{slug}` in the show reports router.

    Returned whole rather than filtered per type, because the show edit form has
    a show-type picker beside the category one and has to re-filter the moment
    the type changes. Four rows.
    """
    result = await db.execute(
        select(ShowCategory)
        .where(ShowCategory.is_active.is_(True))
        .order_by(ShowCategory.sort_order, ShowCategory.name)
    )
    return result.scalars().all()


@router.post(
    "/categories",
    response_model=ShowCategoryOut,
    status_code=201,
    dependencies=[Depends(require_admin)],
)
async def create_show_category(body: ShowCategoryCreate, db: AsyncSession = Depends(get_db)):
    category = ShowCategory(**body.model_dump())
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


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
