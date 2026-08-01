from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone
from uuid import UUID
from typing import Optional

from database import get_db
from dependencies import require_admin, require_admin_or_show_admin, require_authenticated, safe_uuid
from models import (
    Association,
    SanctionedAssociationRequest,
    ShowSanctioning,
    Show,
)
from routers.shows import _assert_show_access
from schemas import (
    SanctionedAssociationCreate,
    SanctionedAssociationUpdate,
    SanctionedAssociationOut,
    SanctionedAssociationRequestCreate,
    SanctionedAssociationRequestReview,
    SanctionedAssociationRequestOut,
    ShowSanctioningReplace,
    ShowSanctioningOut,
)


# ── Registry ──────────────────────────────────────────────────────────────────

registry_router = APIRouter(prefix="/sanctioned-associations", tags=["Sanctioned Associations"])


@registry_router.get("/", response_model=list[SanctionedAssociationOut])
async def list_sanctioned_associations(
    include_inactive: bool = False,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await require_authenticated(x_api_key=x_api_key, x_user_id=x_user_id)
    # Clubs are the sanctioning bodies; breed registries are not shows' sanctioners.
    query = (
        select(Association)
        .where(Association.association_type == 'club')
        .order_by(Association.name)
    )
    if not include_inactive:
        query = query.where(Association.is_active.is_(True))
    rows = (await db.execute(query)).scalars().all()
    return rows


@registry_router.post(
    "/",
    response_model=SanctionedAssociationOut,
    status_code=201,
    dependencies=[Depends(require_admin)],
)
async def create_sanctioned_association(
    body: SanctionedAssociationCreate,
    db: AsyncSession = Depends(get_db),
):
    code = body.code.strip().upper()
    existing = await db.execute(
        select(Association).where(Association.code == code)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "An association with that code already exists")
    row = Association(
        code=code, name=body.name.strip(), association_type='club', is_active=body.is_active
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@registry_router.patch(
    "/{association_id}",
    response_model=SanctionedAssociationOut,
    dependencies=[Depends(require_admin)],
)
async def update_sanctioned_association(
    association_id: UUID,
    body: SanctionedAssociationUpdate,
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(Association, association_id)
    if not row or row.association_type != 'club':
        raise HTTPException(404, "Sanctioned association not found")
    data = body.model_dump(exclude_unset=True)
    if "code" in data and data["code"]:
        data["code"] = data["code"].strip().upper()
    for k, v in data.items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return row


# ── User-submitted requests ───────────────────────────────────────────────────

requests_router = APIRouter(
    prefix="/sanctioned-association-requests", tags=["Sanctioned Association Requests"]
)


@requests_router.post(
    "/",
    response_model=SanctionedAssociationRequestOut,
    status_code=201,
)
async def submit_request(
    body: SanctionedAssociationRequestCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if x_user_role not in ("ADMIN", "SHOW_SECRETARY", "SHOW_MANAGER"):
        raise HTTPException(403, "Not authorized")
    await require_authenticated(x_api_key=x_api_key, x_user_id=x_user_id)
    row = SanctionedAssociationRequest(
        requested_name=body.requested_name.strip(),
        requested_by_user_id=safe_uuid(x_user_id),
        show_id=body.show_id,
        notes=body.notes,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@requests_router.get(
    "/",
    response_model=list[SanctionedAssociationRequestOut],
    dependencies=[Depends(require_admin)],
)
async def list_requests(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(SanctionedAssociationRequest).order_by(
        SanctionedAssociationRequest.created_at.desc()
    )
    if status:
        query = query.where(SanctionedAssociationRequest.status == status)
    rows = (await db.execute(query)).scalars().all()
    return rows


@requests_router.post(
    "/{request_id}/review",
    response_model=SanctionedAssociationRequestOut,
    dependencies=[Depends(require_admin)],
)
async def review_request(
    request_id: UUID,
    body: SanctionedAssociationRequestReview,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(SanctionedAssociationRequest, request_id)
    if not row:
        raise HTTPException(404, "Request not found")
    if row.status != "pending":
        raise HTTPException(409, f"Request is already {row.status}")

    if body.action == "approve":
        code = body.code.strip().upper()
        existing = await db.execute(
            select(Association).where(Association.code == code)
        )
        existing_row = existing.scalar_one_or_none()
        if existing_row:
            assoc = existing_row
        else:
            assoc = Association(
                code=code, name=row.requested_name, association_type='club', is_active=True
            )
            db.add(assoc)
            await db.flush()
        row.status = "approved"
        row.approved_association_id = assoc.id
    else:
        row.status = "rejected"

    row.notes = body.notes if body.notes is not None else row.notes
    row.reviewed_at = datetime.now(timezone.utc)
    row.reviewed_by_user_id = safe_uuid(x_user_id)
    await db.commit()
    await db.refresh(row)
    return row


# ── Per-show sanctioning ──────────────────────────────────────────────────────

show_router = APIRouter(prefix="/shows/{show_id}/sanctioning", tags=["Show Sanctioning"])


def _serialize_show_sanctioning(row: ShowSanctioning) -> dict:
    return {
        "association_id": row.association_id,
        "code": row.association.code if row.association else "",
        "name": row.association.name if row.association else "",
        "per_class_fee_cents": row.per_class_fee_cents,
    }


@show_router.get("/", response_model=list[ShowSanctioningOut])
async def get_show_sanctioning(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    if not await db.get(Show, show_id):
        raise HTTPException(404, "Show not found")
    result = await db.execute(
        select(ShowSanctioning)
        .where(ShowSanctioning.show_id == show_id)
        .options(selectinload(ShowSanctioning.association))
    )
    return [_serialize_show_sanctioning(r) for r in result.scalars().all()]


@show_router.put(
    "/",
    response_model=list[ShowSanctioningOut],
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def replace_show_sanctioning(
    show_id: UUID,
    body: ShowSanctioningReplace,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    if not await db.get(Show, show_id):
        raise HTTPException(404, "Show not found")

    # Validate referenced associations exist and are active
    if body.items:
        ids = [item.association_id for item in body.items]
        existing = await db.execute(
            select(Association.id).where(
                Association.id.in_(ids),
                Association.association_type == 'club',
                Association.is_active.is_(True),
            )
        )
        valid_ids = {r[0] for r in existing.all()}
        invalid = [str(i) for i in ids if i not in valid_ids]
        if invalid:
            raise HTTPException(
                422,
                f"Unknown or inactive club associations: {', '.join(invalid)}",
            )

    # Replace: delete then re-insert
    await db.execute(delete(ShowSanctioning).where(ShowSanctioning.show_id == show_id))
    for item in body.items:
        db.add(
            ShowSanctioning(
                show_id=show_id,
                association_id=item.association_id,
                per_class_fee_cents=item.per_class_fee_cents,
            )
        )
    await db.commit()

    result = await db.execute(
        select(ShowSanctioning)
        .where(ShowSanctioning.show_id == show_id)
        .options(selectinload(ShowSanctioning.association))
    )
    return [_serialize_show_sanctioning(r) for r in result.scalars().all()]
