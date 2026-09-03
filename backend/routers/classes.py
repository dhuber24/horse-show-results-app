from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from uuid import UUID

from database import get_db
from dependencies import require_admin, require_admin_or_show_admin
from models import (
    Class,
    Show,
    Entry,
    Result,
    Ring,
    ClassAssociation,
    ClassSanctioning,
    ShowSanctioning,
    ShowType,
    Discipline,
    Division,
    FuturityClass,
    discipline_divisions,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from rules.apha import zone_individual_work_note
from rules.disciplines import classify_class_name, entered_by_qualification
from schemas import (
    ClassCreate, ClassUpdate, ClassOut, ClassReorder,
    ClassAssociationCreate, ClassAssociationOut,
    ClassSanctioningReplace, ClassSanctioningOut,
    BulkClassCreate,
    ClassesFromLibraryCreate,
)
from routers.shows import _assert_show_access
import standard_classes

router = APIRouter(prefix="/shows/{show_id}/classes", tags=["Classes"])


async def _get_show_or_404(show_id: UUID, db: AsyncSession):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


UNASSIGNED_LABEL = "Unassigned"

DEFAULT_RING_NAME = "Ring 1"


async def _get_or_create_default_ring(show_id: UUID, db: AsyncSession) -> UUID:
    """Every class needs a ring. When the caller doesn't pick one, fall back
    to the show's first ring, creating a default "Ring 1" for shows that have
    no rings set up yet. Caller is responsible for db.commit()."""
    result = await db.execute(
        select(Ring)
        .where(Ring.show_id == show_id)
        .order_by(Ring.sort_order.nulls_last(), Ring.name)
    )
    ring = result.scalars().first()
    if ring is None:
        ring = Ring(show_id=show_id, name=DEFAULT_RING_NAME, sort_order=1)
        db.add(ring)
        await db.flush()
    return ring.id


async def _create_classes_auto_routed(
    show_id: UUID,
    items: list[dict],
    show_type_id: UUID | None,
    class_date,
    db: AsyncSession,
    ring_id: UUID | None = None,
) -> list[Class]:
    """Create per-show classes auto-routed into disciplines and divisions.

    items: each dict has ``name`` (required), ``bracket`` (optional string;
    None / empty → "Unassigned" division), and ``association_code`` (optional
    string; when set together with ``show_type_id`` a ClassAssociation row
    is created on the new class).

    Discipline comes from :func:`classify_class_name` against the class name,
    UNLESS the caller passes ``explicit_discipline`` on the item — used by the
    standard-library picker, which already knows the discipline and score
    type for each pick and doesn't need name-keyword inference. Division
    (bracket) always comes from ``item['bracket']``. Missing disciplines /
    divisions are created on the fly; the (discipline, division) membership
    is registered in ``discipline_divisions``.

    Caller is responsible for ``db.commit()`` and follow-up renumbering.
    """
    if ring_id is None:
        ring_id = await _get_or_create_default_ring(show_id, db)

    max_order_result = await db.execute(
        select(func.coalesce(func.max(Class.sort_order), 0)).where(Class.show_id == show_id)
    )
    next_sort_order = max_order_result.scalar_one()

    disc_rows = await db.execute(select(Discipline).where(Discipline.show_id == show_id))
    discipline_by_name: dict[str, Discipline] = {d.name: d for d in disc_rows.scalars().all()}
    div_rows = await db.execute(select(Division).where(Division.show_id == show_id))
    division_by_name: dict[str, Division] = {d.name: d for d in div_rows.scalars().all()}

    async def get_or_make_discipline(name: str, score_type: str) -> Discipline:
        existing = discipline_by_name.get(name)
        if existing is not None:
            return existing
        d = Discipline(show_id=show_id, name=name, sort_order=9000, default_score_type=score_type)
        db.add(d)
        await db.flush()
        discipline_by_name[name] = d
        return d

    async def get_or_make_division(name: str) -> Division:
        existing = division_by_name.get(name)
        if existing is not None:
            return existing
        d = Division(show_id=show_id, name=name, sort_order=9000)
        db.add(d)
        await db.flush()
        division_by_name[name] = d
        return d

    membership_seen: set[tuple[UUID, UUID]] = set()
    created: list[Class] = []

    for item in items:
        next_sort_order += 1
        name = item["name"]
        explicit_discipline = item.get("explicit_discipline")
        if explicit_discipline:
            discipline_name = explicit_discipline
            score_type = item.get("explicit_score_type") or "placement"
        else:
            classified = classify_class_name(name)
            if classified is not None:
                discipline_name, score_type = classified
            else:
                discipline_name, score_type = "Unassigned", "placement"
        bracket_name = (item.get("bracket") or "").strip() or "Unassigned"

        discipline = await get_or_make_discipline(discipline_name, score_type)
        division = await get_or_make_division(bracket_name)

        pair = (discipline.id, division.id)
        if pair not in membership_seen:
            await db.execute(
                pg_insert(discipline_divisions)
                .values(discipline_id=discipline.id, division_id=division.id)
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
            discipline_id=discipline.id,
            division_id=division.id,
            score_type=score_type,
            ring_id=ring_id,
            # Same derivation as the single-class create: an imported "Grand &
            # Reserve" class is a call-back, not something to offer an exhibitor.
            entered_by_qualification=entered_by_qualification(name),
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


async def _get_or_create_unassigned(show_id: UUID, db: AsyncSession) -> tuple[Discipline, Division]:
    """Return (and lazily create) the "Unassigned" discipline + division pair for a show.

    Used by class-creation paths that don't carry a discipline/division pick
    (APHA/AQHA bulk import; schedule builder picks with no division). The
    secretary reassigns these later in the Schedule Builder.
    """
    disc_res = await db.execute(
        select(Discipline).where(Discipline.show_id == show_id, Discipline.name == UNASSIGNED_LABEL)
    )
    discipline = disc_res.scalar_one_or_none()
    if discipline is None:
        discipline = Discipline(show_id=show_id, name=UNASSIGNED_LABEL, sort_order=9999)
        db.add(discipline)
        await db.flush()

    div_res = await db.execute(
        select(Division).where(Division.show_id == show_id, Division.name == UNASSIGNED_LABEL)
    )
    division = div_res.scalar_one_or_none()
    if division is None:
        division = Division(show_id=show_id, name=UNASSIGNED_LABEL, sort_order=9999)
        db.add(division)
        await db.flush()

    await db.execute(
        pg_insert(discipline_divisions)
        .values(discipline_id=discipline.id, division_id=division.id)
        .on_conflict_do_nothing()
    )
    return discipline, division


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


# ── Club sanctioning ──────────────────────────────────────────────────────────
#
# Declared above the "/{class_id}" routes on purpose: FastAPI matches in
# declaration order, and "sanctioning" arriving at a UUID path parameter is a
# 422 rather than a miss.


async def _show_sanctioning_or_404(
    show_id: UUID, association_id: UUID, db: AsyncSession
) -> ShowSanctioning:
    """The club must already be one this show carries.

    Designating a class for a club the show has not enrolled would create a row
    `sanction_rates` can never price, so the class would read as sanctioned on
    every screen and bill nothing.
    """
    row = await db.get(ShowSanctioning, (show_id, association_id))
    if row is None:
        raise HTTPException(
            404,
            "This show does not carry that sanctioning. Add it in setup Step 3 first.",
        )
    return row


@router.get("/sanctioning", response_model=list[ClassSanctioningOut])
async def list_class_sanctioning(show_id: UUID, db: AsyncSession = Depends(get_db)):
    """Every club this show carries, and which classes it sanctions."""
    clubs = (
        (
            await db.execute(
                select(ShowSanctioning)
                .options(selectinload(ShowSanctioning.association))
                .where(ShowSanctioning.show_id == show_id)
            )
        )
        .scalars()
        .all()
    )
    if not clubs:
        return []

    rows = (
        await db.execute(
            select(ClassSanctioning.association_id, ClassSanctioning.class_id)
            .join(Class, Class.id == ClassSanctioning.class_id)
            .where(Class.show_id == show_id)
        )
    ).all()
    by_association: dict = {}
    for association_id, class_id in rows:
        by_association.setdefault(association_id, []).append(class_id)

    return [
        ClassSanctioningOut(
            association_id=club.association_id,
            code=club.association.code if club.association else "",
            name=club.association.name if club.association else "",
            per_class_fee_cents=club.per_class_fee_cents,
            class_ids=by_association.get(club.association_id, []),
        )
        for club in clubs
    ]


@router.put(
    "/sanctioning/{association_id}",
    response_model=ClassSanctioningOut,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def replace_class_sanctioning(
    show_id: UUID,
    association_id: UUID,
    body: ClassSanctioningReplace,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Set which classes this club sanctions — the whole list, replacing what is there.

    Every id must be a class in this show. A stray one is rejected rather than
    skipped: the caller sent a set of ticked boxes, and quietly dropping one
    would leave the screen showing a designation that was never saved.
    """
    club = await _show_sanctioning_or_404(show_id, association_id, db)

    wanted = set(body.class_ids)
    if wanted:
        found = set(
            (
                await db.execute(
                    select(Class.id)
                    .where(Class.show_id == show_id)
                    .where(Class.id.in_(wanted))
                )
            )
            .scalars()
            .all()
        )
        missing = wanted - found
        if missing:
            raise HTTPException(
                422,
                f"{len(missing)} of those classes are not in this show.",
            )

    existing = set(
        (
            await db.execute(
                select(ClassSanctioning.class_id)
                .join(Class, Class.id == ClassSanctioning.class_id)
                .where(Class.show_id == show_id)
                .where(ClassSanctioning.association_id == association_id)
            )
        )
        .scalars()
        .all()
    )

    # Only the difference is written. Deleting the lot and re-inserting would
    # reset `created_at` on classes nobody touched, and this runs over a
    # 170-class show every time somebody ticks one box.
    to_remove = existing - wanted
    if to_remove:
        await db.execute(
            delete(ClassSanctioning)
            .where(ClassSanctioning.association_id == association_id)
            .where(ClassSanctioning.class_id.in_(to_remove))
        )
    for class_id in wanted - existing:
        db.add(ClassSanctioning(class_id=class_id, association_id=association_id))

    await db.commit()

    return ClassSanctioningOut(
        association_id=association_id,
        code=club.association.code if club.association else "",
        name=club.association.name if club.association else "",
        per_class_fee_cents=club.per_class_fee_cents,
        class_ids=sorted(wanted, key=str),
    )


@router.get("/")
async def list_classes(show_id: UUID, db: AsyncSession = Depends(get_db)):
    show = await _get_show_or_404(show_id, db)
    # Distinct entries, not result rows: a class judged by a panel holds one
    # row per entry *per judge* (migration 095), so counting rows would report
    # "24 placed" in an eight-horse class with three judges.
    placed_subq = (
        select(func.count(func.distinct(Result.entry_id)))
        .where(Result.class_id == Class.id)
        .correlate(Class)
        .scalar_subquery()
    )
    entry_subq = (
        select(func.count(Entry.id))
        .where(Entry.class_id == Class.id, Entry.status != "WITHDRAWN")
        .correlate(Class)
        .scalar_subquery()
    )
    # Whether this class belongs to a futurity programme. A futurity class
    # carries `entry_fee_cents = 0` by design -- the futurity's own fee tier
    # supplies the rate, which depends on the entrant's category and cannot
    # live on the class row -- so anything that offers to price classes in
    # bulk (the Entry Fees screen's default-fill) has to be able to leave
    # these alone, the same way it already leaves club-sanctioned ones alone.
    futurity_subq = (
        select(func.count(FuturityClass.futurity_id))
        .where(FuturityClass.class_id == Class.id)
        .correlate(Class)
        .scalar_subquery()
    )
    result = await db.execute(
        select(
            Class,
            placed_subq.label("placed_count"),
            entry_subq.label("entry_count"),
            futurity_subq.label("futurity_class_count"),
            Ring.name.label("ring_name"),
            Ring.sort_order.label("ring_sort_order"),
            Discipline.name.label("discipline_name"),
            Division.name.label("division_name"),
        )
        .outerjoin(Ring, Ring.id == Class.ring_id)
        .outerjoin(Discipline, Discipline.id == Class.discipline_id)
        .outerjoin(Division, Division.id == Class.division_id)
        .where(Class.show_id == show_id)
        .order_by(Class.class_date, Class.sort_order.nullslast(), Class.class_number)
    )
    return [
        {
            **ClassOut.model_validate(cls).model_dump(),
            "placed_count": placed_count,
            "entry_count": entry_count,
            "ring_name": ring_name,
            "ring_sort_order": ring_sort_order,
            "discipline_name": discipline_name,
            "division_name": division_name,
            # The association's class-procedure note for this show's zone, where it
            # has one — APHA Zones 12-14 work equitation and horsemanship
            # individually from the gate with no rail work. Computed here rather
            # than in the gate screen, so the rule lives in `rules/apha.py` and
            # every surface that shows a class quotes the same sentence.
            "procedure_note": zone_individual_work_note(show, discipline_name),
            # Which clubs sanction this class. On the payload rather than left
            # to a second request because the show bill prints it against the
            # class row — a per-class sanction fee that the bill cannot say
            # which classes carry is the thing migration 113 exists to fix.
            "sanctioning_codes": [
                row.association.code
                for row in (cls.sanctioning or [])
                if row.association is not None
            ],
            "is_futurity_class": futurity_class_count > 0,
        }
        for (
            cls,
            placed_count,
            entry_count,
            futurity_class_count,
            ring_name,
            ring_sort_order,
            discipline_name,
            division_name,
        ) in result.all()
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

    discipline = await db.get(Discipline, body.discipline_id)
    if not discipline or discipline.show_id != show_id:
        raise HTTPException(400, "Discipline does not belong to this show")

    division = await db.get(Division, body.division_id)
    if not division or division.show_id != show_id:
        raise HTTPException(400, "Division does not belong to this show")

    # Register the (discipline, division) membership on demand. Creating a
    # class is itself the statement that this division is offered under this
    # discipline, so we upsert the pair instead of rejecting it — the matrix
    # builder intentionally offers every combination, and a pair may not yet
    # have a membership row if either side was added outside the Step-2 flow.
    # The composite FK on classes(discipline_id, division_id) requires the row
    # to exist before the insert.
    await db.execute(
        pg_insert(discipline_divisions)
        .values(discipline_id=body.discipline_id, division_id=body.division_id)
        .on_conflict_do_nothing()
    )

    score_type = body.score_type or discipline.default_score_type

    # Derived from the name unless the caller said otherwise, the same shape as
    # score_type above: a class named "Grand & Reserve Geldings" is reached by
    # placing first or second in a qualifying class, so it has nothing to offer
    # an exhibitor filling in an entry form. Stored rather than re-derived on
    # read, so the class list screen can correct a guess and have it stick.
    by_qualification = (
        body.entered_by_qualification
        if body.entered_by_qualification is not None
        else entered_by_qualification(body.class_name)
    )

    max_order_result = await db.execute(
        select(func.coalesce(func.max(Class.sort_order), 0)).where(Class.show_id == show_id)
    )
    next_sort_order = max_order_result.scalar_one() + 1
    ring_id = body.ring_id or await _get_or_create_default_ring(show_id, db)
    class_ = Class(
        show_id=show_id,
        sort_order=next_sort_order,
        class_number=str(next_sort_order),
        ring_id=ring_id,
        discipline_id=body.discipline_id,
        division_id=body.division_id,
        class_name=body.class_name,
        class_date=body.class_date,
        status=body.status,
        score_type=score_type,
        entry_fee_cents=body.entry_fee_cents,
        entered_by_qualification=by_qualification,
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
    """Bulk-create classes from explicit (discipline, division) picks.

    The standard-library picker generates one pick per checked cell in the
    discipline × division matrix and submits them here. Each pick carries the
    discipline's `default_score_type` from `standard_disciplines`, so we skip
    name-keyword classification entirely. Missing per-show disciplines /
    divisions / memberships are created on the fly.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)
    if body.class_date < show.start_date or body.class_date > show.end_date:
        raise HTTPException(
            400,
            f"Class date must be between {show.start_date} and {show.end_date}",
        )

    # Dedup picks on (discipline, division) so the same checkbox toggled twice
    # in the UI doesn't try to create the same class twice.
    seen: set[tuple[str, str]] = set()
    items: list[dict] = []
    for pick in body.picks:
        disc_name = pick.discipline_name.strip()
        div_name = pick.division_name.strip()
        if not disc_name or not div_name:
            continue
        key = (disc_name.casefold(), div_name.casefold())
        if key in seen:
            continue
        seen.add(key)
        # Class name pattern: "{Division} {Discipline}" (e.g. "Youth 14-18 Western Pleasure")
        items.append({
            "name": f"{div_name} {disc_name}",
            "bracket": div_name,
            "explicit_discipline": disc_name,
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
        ring_id=body.ring_id,
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
    # Reject explicit nulls — both FK fields are NOT NULL at the DB level.
    if update_fields.get("division_id", "unset") is None:
        raise HTTPException(422, "division_id is required")
    if update_fields.get("discipline_id", "unset") is None:
        raise HTTPException(422, "discipline_id is required")
    if "division_id" in update_fields:
        division = await db.get(Division, update_fields["division_id"])
        if not division or division.show_id != show_id:
            raise HTTPException(400, "Division does not belong to this show")
    if "discipline_id" in update_fields:
        discipline = await db.get(Discipline, update_fields["discipline_id"])
        if not discipline or discipline.show_id != show_id:
            raise HTTPException(400, "Discipline does not belong to this show")
    # Validate the resulting (discipline_id, division_id) pair is a registered
    # membership — defends in depth on top of the composite FK so we return
    # a clean 422 instead of an IntegrityError.
    new_disc_id = update_fields.get("discipline_id", class_.discipline_id)
    new_div_id = update_fields.get("division_id", class_.division_id)
    pair_res = await db.execute(
        select(discipline_divisions.c.discipline_id).where(
            discipline_divisions.c.discipline_id == new_disc_id,
            discipline_divisions.c.division_id == new_div_id,
        )
    )
    if pair_res.scalar_one_or_none() is None:
        raise HTTPException(
            422,
            "Selected division is not part of the selected discipline. "
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
    standard_map = await standard_classes.lookup_many(db, show_type.code, codes)

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
