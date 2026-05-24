from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from uuid import UUID

from database import get_db
from dependencies import require_admin, require_admin_or_show_admin
from models import (
    Class,
    Show,
    Result,
    ClassAssociation,
    AphaStandardClass,
    AqhaStandardClass,
    ShowType,
    Division,
    Section,
    division_sections,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from rules.disciplines import classify_class_name
from schemas import (
    ClassCreate, ClassUpdate, ClassOut, ClassReorder,
    ClassAssociationCreate, ClassAssociationOut,
    BulkClassCreate,
    ClassesFromLibraryCreate,
)
from routers.shows import _assert_show_access

router = APIRouter(prefix="/shows/{show_id}/classes", tags=["Classes"])


async def _get_show_or_404(show_id: UUID, db: AsyncSession):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


UNASSIGNED_LABEL = "Unassigned"


async def _create_classes_auto_routed(
    show_id: UUID,
    items: list[dict],
    show_type_id: UUID | None,
    class_date,
    db: AsyncSession,
) -> list[Class]:
    """Create per-show classes auto-routed into divisions and sections.

    items: each dict has ``name`` (required), ``bracket`` (optional string;
    None / empty → "Unassigned" section), and ``association_code`` (optional
    string; when set together with ``show_type_id`` a ClassAssociation row
    is created on the new class).

    Discipline (Division) comes from :func:`classify_class_name` against the
    class name, UNLESS the caller passes ``explicit_division`` on the item —
    used by the standard-library picker, which already knows the division and
    score type for each pick and doesn't need name-keyword inference. Bracket
    (Section) always comes from ``item['bracket']``. Missing divisions /
    sections are created on the fly; the (div, sec) membership is registered
    in ``division_sections``.

    Caller is responsible for ``db.commit()`` and follow-up renumbering.
    """
    max_order_result = await db.execute(
        select(func.coalesce(func.max(Class.sort_order), 0)).where(Class.show_id == show_id)
    )
    next_sort_order = max_order_result.scalar_one()

    div_rows = await db.execute(select(Division).where(Division.show_id == show_id))
    division_by_name: dict[str, Division] = {d.name: d for d in div_rows.scalars().all()}
    sec_rows = await db.execute(select(Section).where(Section.show_id == show_id))
    section_by_name: dict[str, Section] = {s.name: s for s in sec_rows.scalars().all()}

    async def get_or_make_division(name: str, score_type: str) -> Division:
        existing = division_by_name.get(name)
        if existing is not None:
            return existing
        d = Division(show_id=show_id, name=name, sort_order=9000, default_score_type=score_type)
        db.add(d)
        await db.flush()
        division_by_name[name] = d
        return d

    async def get_or_make_section(name: str) -> Section:
        existing = section_by_name.get(name)
        if existing is not None:
            return existing
        s = Section(show_id=show_id, name=name, sort_order=9000)
        db.add(s)
        await db.flush()
        section_by_name[name] = s
        return s

    membership_seen: set[tuple[UUID, UUID]] = set()
    created: list[Class] = []

    for item in items:
        next_sort_order += 1
        name = item["name"]
        explicit_division = item.get("explicit_division")
        if explicit_division:
            discipline_name = explicit_division
            score_type = item.get("explicit_score_type") or "placement"
        else:
            classified = classify_class_name(name)
            if classified is not None:
                discipline_name, score_type = classified
            else:
                discipline_name, score_type = "Unassigned", "placement"
        bracket_name = (item.get("bracket") or "").strip() or "Unassigned"

        division = await get_or_make_division(discipline_name, score_type)
        section = await get_or_make_section(bracket_name)

        pair = (division.id, section.id)
        if pair not in membership_seen:
            await db.execute(
                pg_insert(division_sections)
                .values(division_id=division.id, section_id=section.id)
                .on_conflict_do_nothing()
            )
            membership_seen.add(pair)

        cls = Class(
            show_id=show_id,
            class_number=str(next_sort_order),
            class_name=name,
            class_date=class_date,
            status="OPEN",
            sort_order=next_sort_order,
            division_id=division.id,
            section_id=section.id,
            score_type=score_type,
        )
        db.add(cls)
        await db.flush()
        assoc_code = item.get("association_code")
        if assoc_code and show_type_id is not None:
            db.add(ClassAssociation(
                class_id=cls.id,
                show_type_id=show_type_id,
                association_class_code=assoc_code,
            ))
        created.append(cls)

    return created


async def _get_or_create_unassigned(show_id: UUID, db: AsyncSession) -> tuple[Division, Section]:
    """Return (and lazily create) the "Unassigned" division + section pair for a show.

    Used by class-creation paths that don't carry a division/section pick
    (APHA/AQHA bulk import; schedule builder picks with no section). The
    secretary reassigns these later in the Schedule Builder.
    """
    div_res = await db.execute(
        select(Division).where(Division.show_id == show_id, Division.name == UNASSIGNED_LABEL)
    )
    division = div_res.scalar_one_or_none()
    if division is None:
        division = Division(show_id=show_id, name=UNASSIGNED_LABEL, sort_order=9999)
        db.add(division)
        await db.flush()

    sec_res = await db.execute(
        select(Section).where(Section.show_id == show_id, Section.name == UNASSIGNED_LABEL)
    )
    section = sec_res.scalar_one_or_none()
    if section is None:
        section = Section(show_id=show_id, name=UNASSIGNED_LABEL, sort_order=9999)
        db.add(section)
        await db.flush()

    await db.execute(
        pg_insert(division_sections)
        .values(division_id=division.id, section_id=section.id)
        .on_conflict_do_nothing()
    )
    return division, section


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

    division = await db.get(Division, body.division_id)
    if not division or division.show_id != show_id:
        raise HTTPException(400, "Division does not belong to this show")

    section = await db.get(Section, body.section_id)
    if not section or section.show_id != show_id:
        raise HTTPException(400, "Section does not belong to this show")

    pair_res = await db.execute(
        select(division_sections.c.division_id).where(
            division_sections.c.division_id == body.division_id,
            division_sections.c.section_id == body.section_id,
        )
    )
    if pair_res.scalar_one_or_none() is None:
        raise HTTPException(
            422,
            f"Section '{section.name}' is not part of division '{division.name}'. "
            "Add it to the division on the Setup page first.",
        )

    score_type = body.score_type or division.default_score_type

    max_order_result = await db.execute(
        select(func.coalesce(func.max(Class.sort_order), 0)).where(Class.show_id == show_id)
    )
    next_sort_order = max_order_result.scalar_one() + 1
    class_ = Class(
        show_id=show_id,
        sort_order=next_sort_order,
        class_number=str(next_sort_order),
        ring_id=body.ring_id,
        division_id=body.division_id,
        section_id=body.section_id,
        class_name=body.class_name,
        class_date=body.class_date,
        status=body.status,
        score_type=score_type,
        entry_fee_cents=body.entry_fee_cents,
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


@router.post(
    "/from-library",
    response_model=list[ClassOut],
    status_code=201,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def bulk_create_classes_from_library(
    show_id: UUID,
    body: ClassesFromLibraryCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Bulk-create classes from explicit (division, section) picks.

    The standard-library picker generates one pick per checked cell in the
    discipline × bracket matrix and submits them here. Each pick carries the
    discipline's `default_score_type` from `standard_divisions`, so we skip
    name-keyword classification entirely. Missing per-show divisions /
    sections / memberships are created on the fly.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)
    if body.class_date < show.start_date or body.class_date > show.end_date:
        raise HTTPException(
            400,
            f"Class date must be between {show.start_date} and {show.end_date}",
        )

    # Dedup picks on (division, section) so the same checkbox toggled twice
    # in the UI doesn't try to create the same class twice.
    seen: set[tuple[str, str]] = set()
    items: list[dict] = []
    for pick in body.picks:
        div_name = pick.division_name.strip()
        sec_name = pick.section_name.strip()
        if not div_name or not sec_name:
            continue
        key = (div_name.casefold(), sec_name.casefold())
        if key in seen:
            continue
        seen.add(key)
        # Class name pattern matches Schedule Builder: "{Section} {Division}"
        items.append({
            "name": f"{sec_name} {div_name}",
            "bracket": sec_name,
            "explicit_division": div_name,
            "explicit_score_type": pick.default_score_type,
        })
    if not items:
        raise HTTPException(422, "At least one pick is required")

    created = await _create_classes_auto_routed(
        show_id=show_id,
        items=items,
        show_type_id=None,
        class_date=body.class_date,
        db=db,
    )
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
    update_fields = body.model_dump(exclude_unset=True)
    # Reject explicit nulls — both fields are NOT NULL at the DB level.
    if update_fields.get("section_id", "unset") is None:
        raise HTTPException(422, "section_id is required")
    if update_fields.get("division_id", "unset") is None:
        raise HTTPException(422, "division_id is required")
    if "section_id" in update_fields:
        section = await db.get(Section, update_fields["section_id"])
        if not section or section.show_id != show_id:
            raise HTTPException(400, "Section does not belong to this show")
    if "division_id" in update_fields:
        division = await db.get(Division, update_fields["division_id"])
        if not division or division.show_id != show_id:
            raise HTTPException(400, "Division does not belong to this show")
    # Validate the resulting (division_id, section_id) pair is a registered
    # membership — defends in depth on top of the composite FK so we return
    # a clean 422 instead of an IntegrityError.
    new_div_id = update_fields.get("division_id", class_.division_id)
    new_sec_id = update_fields.get("section_id", class_.section_id)
    pair_res = await db.execute(
        select(division_sections.c.division_id).where(
            division_sections.c.division_id == new_div_id,
            division_sections.c.section_id == new_sec_id,
        )
    )
    if pair_res.scalar_one_or_none() is None:
        raise HTTPException(
            422,
            "Selected section is not part of the selected division. "
            "Add the membership on the Setup page first.",
        )
    for k, v in update_fields.items():
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

    routed_items = [
        {"name": standard_map[item.code].name,
         "bracket": standard_map[item.code].division,
         "association_code": standard_map[item.code].code}
        for item in body.classes
    ]
    created = await _create_classes_auto_routed(
        show_id=show_id,
        items=routed_items,
        show_type_id=show.show_type_id,
        class_date=body.class_date,
        db=db,
    )

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
