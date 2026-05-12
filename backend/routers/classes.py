from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from uuid import UUID

from database import get_db
from dependencies import require_admin, require_admin_or_show_admin
from models import Class, Show, Result, ClassAssociation, AphaStandardClass, AqhaStandardClass, ShowType
from schemas import (
    ClassCreate, ClassUpdate, ClassOut, ClassReorder,
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


async def _renumber_classes(show_id: UUID, db: AsyncSession) -> None:
    result = await db.execute(
        select(Class)
        .where(Class.show_id == show_id)
        .order_by(Class.class_date, Class.sort_order.nullslast(), Class.class_number)
    )
    for i, cls in enumerate(result.scalars().all(), start=1):
        cls.sort_order = i
        cls.class_number = str(i)
    await db.commit()


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
        .order_by(Class.class_date, Class.sort_order.nullslast(), Class.class_number)
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
    max_order_result = await db.execute(
        select(func.coalesce(func.max(Class.sort_order), 0)).where(Class.show_id == show_id)
    )
    next_sort_order = max_order_result.scalar_one() + 1
    class_ = Class(
        show_id=show_id,
        sort_order=next_sort_order,
        class_number=str(next_sort_order),
        **body.model_dump(),
    )
    db.add(class_)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "A class with this number already exists in this show")
    await _renumber_classes(show_id, db)
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
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Failed to update class")
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
    await _renumber_classes(show_id, db)


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

    show_type = await db.get(ShowType, show.show_type_id)
    if not show_type or show_type.code not in ("APHA", "AQHA"):
        raise HTTPException(400, "Bulk import from an association class list is only available for APHA or AQHA shows")

    codes = [item.code for item in body.classes]
    standard_model = AphaStandardClass if show_type.code == "APHA" else AqhaStandardClass
    result = await db.execute(
        select(standard_model).where(standard_model.code.in_(codes))
    )
    standard_map = {sc.code: sc for sc in result.scalars().all()}

    missing = [c for c in codes if c not in standard_map]
    if missing:
        raise HTTPException(400, f"Unknown {show_type.code} class codes: {', '.join(missing)}")

    # Reject codes already present in this show's class_associations
    existing_result = await db.execute(
        select(ClassAssociation.association_class_code)
        .join(Class, Class.id == ClassAssociation.class_id)
        .where(Class.show_id == show_id)
        .where(ClassAssociation.show_type_id == show.show_type_id)
        .where(ClassAssociation.association_class_code.in_(codes))
    )
    already_used = existing_result.scalars().all()
    if already_used:
        raise HTTPException(409, f"Already in this show: {', '.join(sorted(already_used))}")

    max_order_result = await db.execute(
        select(func.coalesce(func.max(Class.sort_order), 0)).where(Class.show_id == show_id)
    )
    next_sort_order = max_order_result.scalar_one()

    created = []
    for item in body.classes:
        next_sort_order += 1
        sc = standard_map[item.code]
        cls = Class(
            show_id=show_id,
            class_number=str(next_sort_order),
            class_name=sc.name,
            class_date=body.class_date,
            status="OPEN",
            sort_order=next_sort_order,
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

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "One or more class numbers already exist in this show")

    await _renumber_classes(show_id, db)
    created_ids = [cls.id for cls in created]
    result = await db.execute(
        select(Class)
        .options(selectinload(Class.associations).selectinload(ClassAssociation.show_type))
        .where(Class.id.in_(created_ids))
        .order_by(Class.sort_order)
    )
    return result.scalars().all()


# ── Manual Schedule Ordering ────────────────────────────────────────────────────

@router.post(
    "/reorder",
    status_code=204,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def reorder_classes(
    show_id: UUID,
    body: ClassReorder,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    result = await db.execute(
        select(Class).where(Class.show_id == show_id, Class.id.in_(body.class_ids))
    )
    classes = {cls.id: cls for cls in result.scalars().all()}
    if len(classes) != len(body.class_ids):
        raise HTTPException(400, "One or more class IDs not found in this show")
    for i, class_id in enumerate(body.class_ids, start=1):
        classes[class_id].sort_order = i
        classes[class_id].class_number = str(i)
    await db.commit()


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
