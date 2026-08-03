from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from uuid import UUID
from typing import Optional

from database import get_db
from dependencies import require_admin, require_admin_or_show_admin, safe_uuid
from models import (
    AqhaStandardClass,
    Class,
    ClassAssociation,
    CogginsOverrideAudit,
    Entry,
    Exhibitor,
    Horse,
    Show,
    User,
)
from schemas import CogginsOverrideAuditOut, EntryCreate, EntryUpdate, EntryOut
from routers.horse_documents import COGGINS_VALID, coggins_error, get_coggins_status
from routers.shows import _assert_show_access, get_aqha_association_id
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
        context["aqha_association_id"] = await get_aqha_association_id(db)
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

    # skip_coggins_check is the show-staff override: a secretary or manager who
    # has physically inspected the paper Coggins can enter the horse even when
    # the uploaded record is missing, undated, or lapsed. The endpoint is already
    # limited to ADMIN / SHOW_SECRETARY / SHOW_MANAGER with access to this show,
    # so exhibitors cannot reach it. Self-registration has no equivalent.
    #
    # The status is evaluated either way so the override can be audited. Passing
    # the flag for a horse that already holds a valid Coggins overrides nothing
    # and is deliberately not recorded — the audit counts real bypasses, not
    # flag usage.
    overridden_status: Optional[str] = None
    override_actor: Optional[User] = None
    if body.horse_id:
        status = await get_coggins_status(body.horse_id, db)
        if status != COGGINS_VALID:
            if not skip_coggins_check:
                raise coggins_error(status)
            overridden_status = status
            override_actor = await db.get(User, safe_uuid(x_user_id))

    # Pattern classes (showmanship/horsemanship/trail) can have the same
    # exhibitor entered on multiple horses; rail classes cannot.
    if class_.score_type != "pattern":
        existing_exhibitor_entry = await db.execute(
            select(Entry.id).where(
                Entry.class_id == class_id,
                Entry.exhibitor_id == body.exhibitor_id,
            ).limit(1)
        )
        if existing_exhibitor_entry.scalar_one_or_none():
            raise HTTPException(409, "This exhibitor is already entered in this class.")

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
        if overridden_status:
            # Written in the same transaction as the entry: an entry that
            # bypassed the gate must never exist without the row explaining why.
            # The flush is what assigns entry.id.
            await db.flush()
            db.add(CogginsOverrideAudit(
                show_id=show_id,
                entry_id=entry.id,
                class_id=class_id,
                horse_id=horse.id if horse else None,
                horse_name=horse.name if horse else "(unknown horse)",
                coggins_status=overridden_status,
                overridden_by=override_actor.id if override_actor else None,
                overridden_by_name=override_actor.full_name if override_actor else None,
            ))
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        msg = str(exc.orig) if exc.orig is not None else ""
        if "entries_class_horse_uniq" in msg:
            raise HTTPException(409, "This horse is already entered in this class.")
        raise HTTPException(409, "Entry conflicts with an existing entry in this class.")
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


# Show-level, so the audit can be read without picking a class first. Kept in
# this module because create_entry above is what writes the rows.
coggins_audit_router = APIRouter(prefix="/shows/{show_id}", tags=["Entries"])


@coggins_audit_router.get(
    "/coggins-overrides",
    response_model=list[CogginsOverrideAuditOut],
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def list_coggins_overrides(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Every effective Coggins bypass recorded for this show, newest first."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    result = await db.execute(
        select(CogginsOverrideAudit)
        .where(CogginsOverrideAudit.show_id == show_id)
        .order_by(CogginsOverrideAudit.created_at.desc())
    )
    return result.scalars().all()
