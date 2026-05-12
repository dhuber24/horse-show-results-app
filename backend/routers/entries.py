from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from uuid import UUID
from typing import Optional

from database import get_db
from dependencies import require_admin, require_admin_or_show_admin
from models import (
    AqhaStandardClass,
    Class,
    ClassAssociation,
    Entry,
    Exhibitor,
    Horse,
    HorseDocument,
    Show,
)
from schemas import EntryCreate, EntryUpdate, EntryOut
from routers.shows import _assert_show_access
from rules import get_rules

router = APIRouter(prefix="/shows/{show_id}/classes/{class_id}/entries", tags=["Entries"])


async def _get_class_or_404(show_id: UUID, class_id: UUID, db: AsyncSession):
    result = await db.execute(
        select(Class)
        .options(selectinload(Class.associations).selectinload(ClassAssociation.show_type))
        .where(Class.id == class_id)
    )
    class_ = result.scalar_one_or_none()
    if not class_ or class_.show_id != show_id:
        raise HTTPException(404, "Class not found")
    return class_


async def _get_show_or_404(show_id: UUID, db: AsyncSession):
    result = await db.execute(
        select(Show)
        .options(selectinload(Show.show_type))
        .where(Show.id == show_id)
    )
    show = result.scalar_one_or_none()
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _get_horse_or_404(horse_id: UUID, db: AsyncSession):
    result = await db.execute(
        select(Horse)
        .options(selectinload(Horse.registrations))
        .where(Horse.id == horse_id)
    )
    horse = result.scalar_one_or_none()
    if not horse:
        raise HTTPException(404, "Horse not found")
    return horse


async def _get_exhibitor_or_404(exhibitor_id: UUID, db: AsyncSession):
    result = await db.execute(
        select(Exhibitor)
        .options(selectinload(Exhibitor.registrations))
        .where(Exhibitor.id == exhibitor_id)
    )
    exhibitor = result.scalar_one_or_none()
    if not exhibitor:
        raise HTTPException(404, "Exhibitor not found")
    return exhibitor


def _aqha_class_code(show: Show, class_: Class) -> str | None:
    for assoc in class_.associations or []:
        if assoc.show_type_id == show.show_type_id or (assoc.show_type and assoc.show_type.code == "AQHA"):
            return assoc.association_class_code
    return None


async def _association_validation_context(show: Show, class_: Class, db: AsyncSession):
    context = {}
    if show.show_type and show.show_type.code == "AQHA":
        aqha_code = _aqha_class_code(show, class_)
        context["aqha_show_type_id"] = show.show_type_id
        context["aqha_class_code"] = aqha_code
        context["aqha_class"] = await db.get(AqhaStandardClass, aqha_code) if aqha_code else None
    return context


def _raise_for_validation_errors(issues: list[dict]) -> None:
    errors = [issue for issue in issues if issue.get("severity") == "error"]
    if errors:
        raise HTTPException(
            422,
            {
                "code": "ASSOCIATION_VALIDATION_FAILED",
                "message": "Entry fails association validation",
                "issues": issues,
            },
        )


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
    show = await _get_show_or_404(show_id, db)
    class_ = await _get_class_or_404(show_id, class_id, db)
    if class_.status == "CLOSED":
        raise HTTPException(400, "This class is closed and is not accepting entries")
    horse = await _get_horse_or_404(body.horse_id, db)
    exhibitor = await _get_exhibitor_or_404(body.exhibitor_id, db)
    if body.apha_division == "OPEN":
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
    entry.class_ = class_
    entry.horse = horse
    entry.exhibitor = exhibitor
    rules = get_rules(show.show_type.code if show.show_type else None)
    issues = rules.validate_entry(
        entry,
        show,
        class_,
        await _association_validation_context(show, class_, db),
    )
    _raise_for_validation_errors(issues)

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
    show = await _get_show_or_404(show_id, db)
    result = await db.execute(
        select(Entry)
        .options(
            selectinload(Entry.class_).selectinload(Class.associations).selectinload(ClassAssociation.show_type),
            selectinload(Entry.horse).selectinload(Horse.registrations),
            selectinload(Entry.exhibitor).selectinload(Exhibitor.registrations),
        )
        .where(Entry.id == entry_id)
    )
    entry = result.scalar_one_or_none()
    if not entry or entry.class_id != class_id:
        raise HTTPException(404, "Entry not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(entry, k, v)
    class_ = entry.class_
    rules = get_rules(show.show_type.code if show.show_type else None)
    issues = rules.validate_entry(
        entry,
        show,
        class_,
        await _association_validation_context(show, class_, db),
    )
    _raise_for_validation_errors(issues)
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
