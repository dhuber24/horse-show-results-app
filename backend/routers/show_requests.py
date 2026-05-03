from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from database import get_db
from dependencies import require_admin, INTERNAL_API_KEY, safe_uuid
from models import Show, ShowManager, ShowRequest, ShowType, Venue

router = APIRouter(prefix="/show-requests", tags=["Show Requests"])


class ShowRequestCreate(BaseModel):
    show_name: str
    show_type_id: UUID
    venue_id: Optional[UUID] = None
    start_date: date
    end_date: date
    manager_association_id: Optional[str] = None
    association_approval_confirmed: bool = False
    notes: Optional[str] = None


class ShowRequestAdminAction(BaseModel):
    admin_notes: Optional[str] = None


def _serialize(req: ShowRequest) -> dict:
    return {
        "id": str(req.id),
        "requested_by_user_id": str(req.requested_by_user_id),
        "requested_by_name": req.requested_by.full_name if req.requested_by else None,
        "show_name": req.show_name,
        "show_type_id": str(req.show_type_id),
        "show_type_code": req.show_type.code if req.show_type else None,
        "show_type_name": req.show_type.name if req.show_type else None,
        "venue_id": str(req.venue_id) if req.venue_id else None,
        "venue_name": req.venue.name if req.venue else None,
        "start_date": req.start_date,
        "end_date": req.end_date,
        "manager_association_id": req.manager_association_id,
        "association_approval_confirmed": req.association_approval_confirmed,
        "notes": req.notes,
        "status": req.status,
        "admin_notes": req.admin_notes,
        "created_show_id": str(req.created_show_id) if req.created_show_id else None,
        "created_at": req.created_at,
        "updated_at": req.updated_at,
    }


async def _load_request(db: AsyncSession, request_id: UUID) -> ShowRequest | None:
    result = await db.execute(
        select(ShowRequest)
        .options(
            selectinload(ShowRequest.show_type),
            selectinload(ShowRequest.venue),
            selectinload(ShowRequest.requested_by),
        )
        .where(ShowRequest.id == request_id)
    )
    return result.scalar_one_or_none()


@router.post("/", status_code=201)
async def create_show_request(
    body: ShowRequestCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    if x_user_role != "SHOW_MANAGER":
        raise HTTPException(403, "Show Manager access required")

    if body.end_date < body.start_date:
        raise HTTPException(400, "end_date must be on or after start_date")

    st = await db.get(ShowType, body.show_type_id)
    if not st:
        raise HTTPException(400, "Unknown show type")

    if body.venue_id:
        venue = await db.get(Venue, body.venue_id)
        if not venue:
            raise HTTPException(400, "Unknown venue")

    req = ShowRequest(
        requested_by_user_id=safe_uuid(x_user_id),
        show_name=body.show_name,
        show_type_id=body.show_type_id,
        venue_id=body.venue_id,
        start_date=body.start_date,
        end_date=body.end_date,
        manager_association_id=body.manager_association_id,
        association_approval_confirmed=body.association_approval_confirmed,
        notes=body.notes,
    )
    db.add(req)
    await db.commit()

    loaded = await _load_request(db, req.id)
    return _serialize(loaded)


@router.get("/")
async def list_show_requests(
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    if x_user_role not in ("ADMIN", "SHOW_MANAGER"):
        raise HTTPException(403, "Access denied")

    query = (
        select(ShowRequest)
        .options(
            selectinload(ShowRequest.show_type),
            selectinload(ShowRequest.venue),
            selectinload(ShowRequest.requested_by),
        )
        .order_by(ShowRequest.created_at.desc())
    )

    if x_user_role == "SHOW_MANAGER":
        query = query.where(ShowRequest.requested_by_user_id == safe_uuid(x_user_id))

    result = await db.execute(query)
    return [_serialize(r) for r in result.scalars().all()]


@router.patch("/{request_id}/approve", dependencies=[Depends(require_admin)])
async def approve_show_request(
    request_id: UUID,
    body: ShowRequestAdminAction,
    db: AsyncSession = Depends(get_db),
):
    req = await _load_request(db, request_id)
    if not req:
        raise HTTPException(404, "Show request not found")
    if req.status != "PENDING":
        raise HTTPException(400, f"Cannot approve a request with status '{req.status}'")

    show = Show(
        name=req.show_name,
        show_type_id=req.show_type_id,
        venue_id=req.venue_id,
        start_date=req.start_date,
        end_date=req.end_date,
        status="DRAFT",
        created_by_user_id=req.requested_by_user_id,
    )
    db.add(show)
    await db.flush()

    db.add(ShowManager(show_id=show.id, user_id=req.requested_by_user_id))

    req.status = "APPROVED"
    req.admin_notes = body.admin_notes
    req.created_show_id = show.id
    req.updated_at = datetime.now(timezone.utc)

    await db.commit()
    loaded = await _load_request(db, request_id)
    return _serialize(loaded)


@router.patch("/{request_id}/reject", dependencies=[Depends(require_admin)])
async def reject_show_request(
    request_id: UUID,
    body: ShowRequestAdminAction,
    db: AsyncSession = Depends(get_db),
):
    req = await _load_request(db, request_id)
    if not req:
        raise HTTPException(404, "Show request not found")
    if req.status != "PENDING":
        raise HTTPException(400, f"Cannot reject a request with status '{req.status}'")

    req.status = "REJECTED"
    req.admin_notes = body.admin_notes
    req.updated_at = datetime.now(timezone.utc)

    await db.commit()
    loaded = await _load_request(db, request_id)
    return _serialize(loaded)
