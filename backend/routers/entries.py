from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from uuid import UUID
from typing import Optional

from database import get_db
from dependencies import require_admin, require_admin_or_show_admin
from models import Entry, Class, Horse, HorseDocument
from schemas import EntryCreate, EntryUpdate, EntryOut
from routers.shows import _assert_show_access

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


@router.post("/", response_model=EntryOut, status_code=201, dependencies=[Depends(require_admin_or_show_admin)])
async def create_entry(
    show_id: UUID,
    class_id: UUID,
    body: EntryCreate,
    skip_coggins_check: bool = Query(False),
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_class_or_404(show_id, class_id, db)
    if body.apha_division == "OPEN":
        horse = await db.get(Horse, body.horse_id)
        if horse and horse.is_solid_paint_bred:
            raise HTTPException(400, "Solid Paint-Bred horses may not enter Open division classes (APHA SC-325.A.1)")

    _RELATIONSHIP_REQUIRED = {"AMATEUR", "NOVICE_AMATEUR", "YOUTH", "NOVICE_YOUTH"}
    if body.apha_division in _RELATIONSHIP_REQUIRED and not body.relationship_to_owner:
        raise HTTPException(400, f"relationship_to_owner is required for {body.apha_division} division entries")

    if body.horse_id and not skip_coggins_check:
        coggins = await db.execute(
            select(HorseDocument).where(
                HorseDocument.horse_id == body.horse_id,
                HorseDocument.document_type == "COGGINS",
            )
        )
        coggins_docs = coggins.scalars().all()
        today = date.today()
        has_valid = any(
            doc.expiry_date is None or doc.expiry_date >= today
            for doc in coggins_docs
        )
        if not has_valid:
            msg = "No valid Coggins on file for this horse" if not coggins_docs else "Coggins on file has expired"
            raise HTTPException(422, {"code": "COGGINS_EXPIRED", "message": msg})

    entry = Entry(class_id=class_id, **body.model_dump())
    db.add(entry)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Entry already exists for this exhibitor/horse/class combination")
    await db.refresh(entry)
    return entry


@router.patch("/{entry_id}", response_model=EntryOut, dependencies=[Depends(require_admin_or_show_admin)])
async def update_entry(
    show_id: UUID, class_id: UUID, entry_id: UUID,
    body: EntryUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    entry = await db.get(Entry, entry_id)
    if not entry or entry.class_id != class_id:
        raise HTTPException(404, "Entry not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(entry, k, v)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=204, dependencies=[Depends(require_admin_or_show_admin)])
async def delete_entry(
    show_id: UUID, class_id: UUID, entry_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    entry = await db.get(Entry, entry_id)
    if not entry or entry.class_id != class_id:
        raise HTTPException(404, "Entry not found")
    await db.delete(entry)
    await db.commit()
