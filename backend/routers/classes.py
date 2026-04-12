from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from database import get_db
from models import Class, Show
from schemas import ClassCreate, ClassUpdate, ClassOut

router = APIRouter(prefix="/shows/{show_id}/classes", tags=["Classes"])


async def _get_show_or_404(show_id: UUID, db: AsyncSession):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


@router.get("/", response_model=list[ClassOut])
async def list_classes(show_id: UUID, db: AsyncSession = Depends(get_db)):
    await _get_show_or_404(show_id, db)
    result = await db.execute(
        select(Class).where(Class.show_id == show_id).order_by(Class.class_number)
    )
    return result.scalars().all()


@router.post("/", response_model=ClassOut, status_code=201)
async def create_class(show_id: UUID, body: ClassCreate, db: AsyncSession = Depends(get_db)):
    await _get_show_or_404(show_id, db)
    class_ = Class(show_id=show_id, **body.model_dump())
    db.add(class_)
    await db.commit()
    await db.refresh(class_)
    return class_


@router.get("/{class_id}", response_model=ClassOut)
async def get_class(show_id: UUID, class_id: UUID, db: AsyncSession = Depends(get_db)):
    class_ = await db.get(Class, class_id)
    if not class_ or class_.show_id != show_id:
        raise HTTPException(404, "Class not found")
    return class_


@router.patch("/{class_id}", response_model=ClassOut)
async def update_class(show_id: UUID, class_id: UUID, body: ClassUpdate, db: AsyncSession = Depends(get_db)):
    class_ = await db.get(Class, class_id)
    if not class_ or class_.show_id != show_id:
        raise HTTPException(404, "Class not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(class_, k, v)
    await db.commit()
    await db.refresh(class_)
    return class_


@router.delete("/{class_id}", status_code=204)
async def delete_class(show_id: UUID, class_id: UUID, db: AsyncSession = Depends(get_db)):
    class_ = await db.get(Class, class_id)
    if not class_ or class_.show_id != show_id:
        raise HTTPException(404, "Class not found")
    await db.delete(class_)
    await db.commit()
