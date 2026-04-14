from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from uuid import UUID

from database import get_db
from dependencies import require_admin
from models import Entry, Class
from schemas import EntryCreate, EntryUpdate, EntryOut

router = APIRouter(prefix="/shows/{show_id}/classes/{class_id}/entries", tags=["Entries"])


async def _get_class_or_404(show_id: UUID, class_id: UUID, db: AsyncSession):
    class_ = await db.get(Class, class_id)
    if not class_ or class_.show_id != show_id:
        raise HTTPException(404, "Class not found")
    return class_


@router.get("/", response_model=list[EntryOut])
async def list_entries(show_id: UUID, class_id: UUID, db: AsyncSession = Depends(get_db)):
    await _get_class_or_404(show_id, class_id, db)
    result = await db.execute(
        select(Entry).where(Entry.class_id == class_id).order_by(Entry.back_number)
    )
    return result.scalars().all()


@router.post("/", response_model=EntryOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_entry(
    show_id: UUID, class_id: UUID, body: EntryCreate, db: AsyncSession = Depends(get_db)
):
    await _get_class_or_404(show_id, class_id, db)
    entry = Entry(class_id=class_id, **body.model_dump())
    db.add(entry)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Entry already exists for this rider/horse/class combination")
    await db.refresh(entry)
    return entry


@router.patch("/{entry_id}", response_model=EntryOut, dependencies=[Depends(require_admin)])
async def update_entry(
    show_id: UUID, class_id: UUID, entry_id: UUID,
    body: EntryUpdate, db: AsyncSession = Depends(get_db)
):
    entry = await db.get(Entry, entry_id)
    if not entry or entry.class_id != class_id:
        raise HTTPException(404, "Entry not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(entry, k, v)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_entry(
    show_id: UUID, class_id: UUID, entry_id: UUID, db: AsyncSession = Depends(get_db)
):
    entry = await db.get(Entry, entry_id)
    if not entry or entry.class_id != class_id:
        raise HTTPException(404, "Entry not found")
    await db.delete(entry)
    await db.commit()
