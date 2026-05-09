import csv
import io
from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from sqlalchemy.orm import selectinload
from uuid import UUID
from datetime import date
from typing import Optional

from database import get_db
from dependencies import require_admin, require_admin_or_show_admin, INTERNAL_API_KEY, safe_uuid
from models import Show, ShowAffiliation, ShowSecretary, ShowScorekeeper, ShowManager, Entry, Class, Horse, Exhibitor, ShowEntry, HorseRegistration, ShowType
from schemas import ShowCreate, ShowUpdate, ShowOut, ShowAffiliationUpdate

router = APIRouter(prefix="/shows", tags=["Shows"])


def _serialize(show: Show) -> dict:
    return {
        "id": show.id,
        "name": show.name,
        "venue": show.venue_rel.name if show.venue_rel else None,
        "venue_id": show.venue_id,
        "show_type_id": show.show_type_id,
        "show_type_code": show.show_type.code if show.show_type else None,
        "show_type_name": show.show_type.name if show.show_type else None,
        "start_date": show.start_date,
        "end_date": show.end_date,
        "status": show.status,
        "apha_show_number": show.apha_show_number,
        "affiliations": [
            {
                "show_type_id": str(a.show_type_id),
                "show_type_code": a.show_type.code,
                "show_type_name": a.show_type.name,
            }
            for a in (show.affiliations or [])
        ],
        "created_at": show.created_at,
    }


async def _get_show_with_type(db: AsyncSession, show_id: UUID) -> Show | None:
    result = await db.execute(
        select(Show).options(selectinload(Show.show_type), selectinload(Show.venue_rel)).where(Show.id == show_id)
    )
    return result.scalar_one_or_none()


@router.get("/")
async def list_shows(
    x_api_key: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    x_user_role: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    is_authenticated = x_api_key and x_api_key == INTERNAL_API_KEY

    if is_authenticated and x_user_role == "ADMIN":
        # Admins see all shows including DRAFTs
        query = select(Show).options(selectinload(Show.show_type), selectinload(Show.venue_rel)).order_by(Show.start_date)
    elif is_authenticated and x_user_role == "SHOW_SECRETARY" and x_user_id:
        # Secretaries see their own assigned shows (including DRAFTs)
        query = (
            select(Show)
            .options(selectinload(Show.show_type), selectinload(Show.venue_rel))
            .join(ShowSecretary, ShowSecretary.show_id == Show.id)
            .where(ShowSecretary.user_id == safe_uuid(x_user_id))
            .order_by(Show.start_date)
        )
    elif is_authenticated and x_user_role == "SHOW_MANAGER" and x_user_id:
        # Show Managers see shows they are assigned to manage (including DRAFTs)
        query = (
            select(Show)
            .options(selectinload(Show.show_type), selectinload(Show.venue_rel))
            .join(ShowManager, ShowManager.show_id == Show.id)
            .where(ShowManager.user_id == safe_uuid(x_user_id))
            .order_by(Show.start_date)
        )
    elif is_authenticated and x_user_role == "SCOREKEEPER" and x_user_id:
        # Scorekeepers see their assigned shows, but not DRAFTs
        query = (
            select(Show)
            .options(selectinload(Show.show_type), selectinload(Show.venue_rel))
            .join(ShowScorekeeper, ShowScorekeeper.show_id == Show.id)
            .where(ShowScorekeeper.user_id == safe_uuid(x_user_id), Show.status != "DRAFT")
            .order_by(Show.start_date)
        )
    else:
        # Public / exhibitors — no DRAFTs
        query = (
            select(Show)
            .options(selectinload(Show.show_type), selectinload(Show.venue_rel))
            .where(Show.status != "DRAFT")
            .order_by(Show.start_date)
        )

    result = await db.execute(query)
    return [_serialize(s) for s in result.scalars().all()]


@router.post("/", response_model=ShowOut, status_code=201)
async def create_show(
    body: ShowCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    if x_user_role not in ("ADMIN", "SHOW_SECRETARY", "SHOW_MANAGER"):
        raise HTTPException(403, "Admin or Show Secretary access required")

    show = Show(**body.model_dump(), created_by_user_id=safe_uuid(x_user_id))
    db.add(show)
    await db.commit()

    if x_user_role == "SHOW_SECRETARY":
        db.add(ShowSecretary(show_id=show.id, user_id=safe_uuid(x_user_id)))
        await db.commit()
    elif x_user_role == "SHOW_MANAGER":
        db.add(ShowManager(show_id=show.id, user_id=safe_uuid(x_user_id)))
        await db.commit()

    show = await _get_show_with_type(db, show.id)
    return _serialize(show)


@router.get("/{show_id}", response_model=ShowOut)
async def get_show(show_id: UUID, db: AsyncSession = Depends(get_db)):
    show = await _get_show_with_type(db, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return _serialize(show)


async def _assert_show_access(show_id: UUID, x_api_key: str, x_user_id: str, x_user_role: str, db: AsyncSession):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    if x_user_role == "ADMIN":
        return
    if x_user_role == "SHOW_SECRETARY":
        row = await db.execute(
            select(ShowSecretary).where(ShowSecretary.show_id == show_id, ShowSecretary.user_id == safe_uuid(x_user_id))
        )
        if row.scalar_one_or_none():
            return
    if x_user_role == "SHOW_MANAGER":
        row = await db.execute(
            select(ShowManager).where(ShowManager.show_id == show_id, ShowManager.user_id == safe_uuid(x_user_id))
        )
        if row.scalar_one_or_none():
            return
    raise HTTPException(403, "Not authorized for this show")


async def _count_show_classes(db: AsyncSession, show_id: UUID) -> int:
    result = await db.execute(
        select(func.count()).select_from(Class).where(Class.show_id == show_id)
    )
    return result.scalar_one()


@router.patch("/{show_id}", response_model=ShowOut)
async def update_show(
    show_id: UUID,
    body: ShowUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")

    updates = body.model_dump(exclude_unset=True)
    new_status = updates.get("status")

    # Publishing gates (data integrity)
    if new_status == "PUBLISHED":
        effective_venue_id = updates.get("venue_id", show.venue_id)
        if not effective_venue_id:
            raise HTTPException(400, "Cannot publish: a venue must be selected before publishing.")
        class_count = await _count_show_classes(db, show_id)
        if class_count == 0:
            raise HTTPException(400, "Cannot publish: the show must have at least one class before publishing.")

    # In Progress gate: current date must fall within the show's date range
    if new_status == "ACTIVE":
        today = date.today()
        effective_start = updates.get("start_date", show.start_date)
        effective_end = updates.get("end_date", show.end_date)
        if not (effective_start <= today <= effective_end):
            raise HTTPException(
                400,
                "Cannot set status to In Progress: the current date is outside the show's date range.",
            )

    for k, v in updates.items():
        setattr(show, k, v)
    await db.commit()
    show = await _get_show_with_type(db, show_id)
    return _serialize(show)


@router.delete("/{show_id}", status_code=204)
async def delete_show(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    result = await db.execute(
        select(Show)
        .options(
            selectinload(Show.classes),
            selectinload(Show.rings),
            selectinload(Show.divisions),
            selectinload(Show.show_secretaries),
            selectinload(Show.show_scorekeepers),
            selectinload(Show.show_entries),
        )
        .where(Show.id == show_id)
    )
    show = result.scalar_one_or_none()
    if not show:
        raise HTTPException(404, "Show not found")
    if show.status != "DRAFT":
        raise HTTPException(
            400,
            "Only shows in DRAFT status can be deleted. Transition the show back to DRAFT first.",
        )
    await db.delete(show)
    await db.commit()


@router.put("/{show_id}/affiliations", status_code=200, dependencies=[Depends(require_admin_or_show_admin)])
async def set_show_affiliations(
    show_id: UUID,
    body: ShowAffiliationUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    await db.execute(delete(ShowAffiliation).where(ShowAffiliation.show_id == show_id))
    for show_type_id in body.show_type_ids:
        db.add(ShowAffiliation(show_id=show_id, show_type_id=show_type_id))
    await db.commit()
    return {"ok": True}


@router.get("/{show_id}/apha-export")
async def apha_export(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_with_type(db, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    if not show.show_type or show.show_type.code != "APHA":
        raise HTTPException(400, "This show is not an APHA sanctioned show")
    if not show.apha_show_number:
        raise HTTPException(400, "Set the APHA Show Number on the show before exporting")

    # Load APHA show type id for registration lookup
    apha_type_result = await db.execute(
        select(ShowType).where(ShowType.code == "APHA")
    )
    apha_show_type = apha_type_result.scalar_one_or_none()

    # Fetch all entries for this show with related data
    entries_result = await db.execute(
        select(Entry)
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id)
        .options(
            selectinload(Entry.class_),
            selectinload(Entry.exhibitor),
            selectinload(Entry.horse).selectinload(Horse.registrations),
        )
        .order_by(Entry.exhibitor_id, Class.class_number)
    )
    entries = entries_result.scalars().all()

    # Look up the APHA class code per class via the class_associations table.
    apha_code_by_class: dict = {}
    if apha_show_type:
        for entry in entries:
            cls = entry.class_
            if cls.id in apha_code_by_class:
                continue
            code = ""
            for assoc in cls.associations:
                if assoc.show_type_id == apha_show_type.id:
                    code = assoc.association_class_code or ""
                    break
            apha_code_by_class[cls.id] = code

    # Build exhibitor → back number map from show_entries
    show_entries_result = await db.execute(
        select(ShowEntry).where(ShowEntry.show_id == show_id)
    )
    back_number_map: dict = {
        se.exhibitor_id: se.back_number for se in show_entries_result.scalars().all()
    }

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "SHOW NBR", "SHOW YR", "BACK#", "REG NUMBER",
        "HORSE'S NAME", "CLASS CODE", "CLASS DESCRIPTION",
        "EXHIBITOR ID", "EXHIBITOR'S NAME",
    ])

    show_yr = show.start_date.year if show.start_date else ""

    for entry in entries:
        if entry.horse is None:
            writer.writerow([
                show.apha_show_number,
                show_yr,
                back_number_map.get(entry.exhibitor_id, ""),
                "",
                "",
                apha_code_by_class.get(entry.class_.id, ""),
                entry.class_.class_name,
                entry.exhibitor.apha_member_number or "",
                entry.exhibitor.full_name,
            ])
            continue

        reg_number = ""
        if apha_show_type:
            for reg in entry.horse.registrations:
                if reg.show_type_id == apha_show_type.id:
                    reg_number = reg.registration_number
                    break

        writer.writerow([
            show.apha_show_number,
            show_yr,
            back_number_map.get(entry.exhibitor_id, ""),
            reg_number,
            entry.horse.name,
            apha_code_by_class.get(entry.class_.id, ""),
            entry.class_.class_name,
            entry.exhibitor.apha_member_number or "",
            entry.exhibitor.full_name,
        ])

    csv_content = output.getvalue()
    filename = f"apha_results_{show_id}.csv"

    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
