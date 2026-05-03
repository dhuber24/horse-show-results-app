from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from uuid import UUID

from database import get_db
from dependencies import require_admin, require_admin_or_show_admin
from models import Class, Show, Result, ClassAssociation, AphaStandardClass, ShowType
from schemas import (
    ClassCreate, ClassUpdate, ClassOut,
    ClassAssociationCreate, ClassAssociationOut,
    BulkClassCreate,
)
from routers.shows import _assert_show_access

router = APIRouter(prefix="/shows/{show_id}/classes", tags=["Classes"])


async def _get_show_or_404(show_id: UUID, db: AsyncSession):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


@router.get("/")
async def list_classes(show_id: UUID, db: AsyncSession = Depends(get_db)):
    await _get_show_or_404(show_id, db)
    placed_subq = (
        select(func.count(Result.id))
        .where(Result.class_id == Class.id)
        .correlate(Class)
        .scalar_subquery()
    )
    result = await db.execute(
        select(Class, placed_subq.label("placed_count"))
        .where(Class.show_id == show_id)
        .order_by(Class.class_number)
    )
    return [
        {**ClassOut.model_validate(cls).model_dump(), "placed_count": placed_count}
        for cls, placed_count in result.all()
    ]


@router.post("/", response_model=ClassOut, status_code=201, dependencies=[Depends(require_admin_or_show_admin)])
async def create_class(
    show_id: UUID,
    body: ClassCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)
    if body.class_date < show.start_date or body.class_date > show.end_date:
        raise HTTPException(
            400,
            f"Class date must be between {show.start_date} and {show.end_date}",
        )
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


@router.patch("/{class_id}", response_model=ClassOut, dependencies=[Depends(require_admin_or_show_admin)])
async def update_class(
    show_id: UUID,
    class_id: UUID,
    body: ClassUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)
    class_ = await db.get(Class, class_id)
    if not class_ or class_.show_id != show_id:
        raise HTTPException(404, "Class not found")
    if body.class_date is not None and (body.class_date < show.start_date or body.class_date > show.end_date):
        raise HTTPException(
            400,
            f"Class date must be between {show.start_date} and {show.end_date}",
        )
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(class_, k, v)
    await db.commit()
    await db.refresh(class_)
    return class_


@router.delete("/{class_id}", status_code=204, dependencies=[Depends(require_admin_or_show_admin)])
async def delete_class(
    show_id: UUID,
    class_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    result = await db.execute(
        select(Class)
        .options(selectinload(Class.entries), selectinload(Class.results))
        .where(Class.id == class_id)
    )
    class_ = result.scalar_one_or_none()
    if not class_ or class_.show_id != show_id:
        raise HTTPException(404, "Class not found")
    await db.delete(class_)
    await db.commit()


# ── Bulk Class Import from APHA Standard Classes ────────────────────────────────

@router.post(
    "/bulk",
    response_model=list[ClassOut],
    status_code=201,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def bulk_create_classes(
    show_id: UUID,
    body: BulkClassCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)

    if body.class_date < show.start_date or body.class_date > show.end_date:
        raise HTTPException(
            400,
            f"Class date must be between {show.start_date} and {show.end_date}",
        )

    # Resolve APHA show type id from the show's own show_type
    show_type = await db.get(ShowType, show.show_type_id)
    if not show_type or show_type.code != "APHA":
        raise HTTPException(400, "Bulk import from APHA class list is only available for APHA shows")

    # Look up all requested APHA codes
    codes = [item.apha_code for item in body.classes]
    result = await db.execute(
        select(AphaStandardClass).where(AphaStandardClass.code.in_(codes))
    )
    standard_map = {sc.code: sc for sc in result.scalars().all()}

    missing = [c for c in codes if c not in standard_map]
    if missing:
        raise HTTPException(400, f"Unknown APHA class codes: {', '.join(missing)}")

    created = []
    for item in body.classes:
        sc = standard_map[item.apha_code]
        cls = Class(
            show_id=show_id,
            class_number=item.class_number,
            class_name=sc.name,
            class_date=body.class_date,
            status="OPEN",
        )
        db.add(cls)
        await db.flush()  # populate cls.id before creating association
        assoc = ClassAssociation(
            class_id=cls.id,
            show_type_id=show.show_type_id,
            association_class_code=sc.code,
        )
        db.add(assoc)
        created.append(cls)

    await db.commit()
    for cls in created:
        await db.refresh(cls)
    return created


# ── Class Associations (per-association class codes for dual-sanction shows) ──

async def _get_class_or_404(show_id: UUID, class_id: UUID, db: AsyncSession) -> Class:
    class_ = await db.get(Class, class_id)
    if not class_ or class_.show_id != show_id:
        raise HTTPException(404, "Class not found")
    return class_


@router.get("/{class_id}/associations", response_model=list[ClassAssociationOut])
async def list_class_associations(
    show_id: UUID,
    class_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    await _get_class_or_404(show_id, class_id, db)
    result = await db.execute(
        select(ClassAssociation)
        .where(ClassAssociation.class_id == class_id)
        .order_by(ClassAssociation.created_at)
    )
    return result.scalars().all()


@router.post(
    "/{class_id}/associations",
    response_model=ClassAssociationOut,
    status_code=201,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def create_class_association(
    show_id: UUID,
    class_id: UUID,
    body: ClassAssociationCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_class_or_404(show_id, class_id, db)
    assoc = ClassAssociation(class_id=class_id, **body.model_dump())
    db.add(assoc)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "This class already has a code for that association")
    await db.refresh(assoc)
    return assoc


@router.delete(
    "/{class_id}/associations/{assoc_id}",
    status_code=204,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def delete_class_association(
    show_id: UUID,
    class_id: UUID,
    assoc_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_class_or_404(show_id, class_id, db)
    assoc = await db.get(ClassAssociation, assoc_id)
    if not assoc or assoc.class_id != class_id:
        raise HTTPException(404, "Association not found")
    await db.delete(assoc)
    await db.commit()
