"""Per-show setup mutations driven by the Standard Library matrix picker.

`POST /shows/{show_id}/setup/apply` is the one endpoint that turns a set of
matrix picks into the per-show divisions, sections, division-section
memberships, and classes. It is idempotent: rerunning with the same body
does not create duplicates — existing per-show rows with matching names are
reused, existing class codes are skipped.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from uuid import UUID

from database import get_db
from dependencies import require_admin_or_show_admin
from models import (
    Show, Ring, Division, Section, Class, ClassAssociation,
    StandardDivision, StandardSection, StandardClass,
    division_sections,
)
from schemas import SetupApplyRequest, SetupApplyResult
from routers.shows import _assert_show_access

router = APIRouter(prefix="/shows/{show_id}/setup", tags=["Show Setup"])


@router.post(
    "/apply",
    response_model=SetupApplyResult,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def apply_setup_picks(
    show_id: UUID,
    body: SetupApplyRequest,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")

    result = SetupApplyResult()

    # ── 1. Rings ────────────────────────────────────────────────────────────
    if body.rings:
        existing_rings = (await db.execute(
            select(Ring).where(Ring.show_id == show_id)
        )).scalars().all()
        existing_ring_by_name = {r.name.casefold(): r for r in existing_rings}
        max_ring_sort = max((r.sort_order or 0) for r in existing_rings) if existing_rings else 0

        for ring_pick in body.rings:
            key = ring_pick.name.strip().casefold()
            if not key:
                continue
            if key in existing_ring_by_name:
                continue
            max_ring_sort += 10
            ring = Ring(
                show_id=show_id,
                name=ring_pick.name.strip(),
                sort_order=ring_pick.sort_order or max_ring_sort,
            )
            db.add(ring)
            await db.flush()
            existing_ring_by_name[key] = ring
            result.created_ring_ids.append(ring.id)

    # ── 2. Resolve picks into (std_div, std_sec, std_class?) triples ────────
    std_class_ids = [p.standard_class_id for p in body.picks if p.standard_class_id]
    std_classes_by_id: dict[UUID, StandardClass] = {}
    if std_class_ids:
        rows = (await db.execute(
            select(StandardClass).where(StandardClass.id.in_(std_class_ids))
        )).scalars().all()
        std_classes_by_id = {c.id: c for c in rows}
        if len(std_classes_by_id) != len(set(std_class_ids)):
            raise HTTPException(404, "One or more standard_class_id values not found")
        for c in std_classes_by_id.values():
            if c.show_type_id != show.show_type_id:
                raise HTTPException(
                    422,
                    f"Standard class {c.id} belongs to a different show type than this show",
                )

    # Collect every (std_div_id, std_sec_id) pair we'll need.
    needed_pairs: set[tuple[UUID, UUID]] = set()
    for pick in body.picks:
        if pick.standard_class_id:
            c = std_classes_by_id[pick.standard_class_id]
            needed_pairs.add((c.standard_division_id, c.standard_section_id))
        else:
            needed_pairs.add((pick.standard_division_id, pick.standard_section_id))

    if not needed_pairs and not body.rings:
        return result

    # Load all standard divisions and sections referenced by the picks.
    std_div_ids = {pair[0] for pair in needed_pairs}
    std_sec_ids = {pair[1] for pair in needed_pairs}
    std_divs_by_id: dict[UUID, StandardDivision] = {}
    std_secs_by_id: dict[UUID, StandardSection] = {}
    if std_div_ids:
        for d in (await db.execute(
            select(StandardDivision).where(StandardDivision.id.in_(std_div_ids))
        )).scalars().all():
            std_divs_by_id[d.id] = d
        if len(std_divs_by_id) != len(std_div_ids):
            raise HTTPException(404, "One or more standard_division_id values not found")
    if std_sec_ids:
        for s in (await db.execute(
            select(StandardSection).where(StandardSection.id.in_(std_sec_ids))
        )).scalars().all():
            std_secs_by_id[s.id] = s
        if len(std_secs_by_id) != len(std_sec_ids):
            raise HTTPException(404, "One or more standard_section_id values not found")

    # ── 3. Ensure per-show divisions and sections (matched by name) ─────────
    existing_divs = (await db.execute(
        select(Division).where(Division.show_id == show_id)
    )).scalars().all()
    div_by_name: dict[str, Division] = {d.name.casefold(): d for d in existing_divs}
    next_div_sort = max((d.sort_order or 0) for d in existing_divs) if existing_divs else 0

    existing_secs = (await db.execute(
        select(Section).where(Section.show_id == show_id)
    )).scalars().all()
    sec_by_name: dict[str, Section] = {s.name.casefold(): s for s in existing_secs}
    next_sec_sort = max((s.sort_order or 0) for s in existing_secs) if existing_secs else 0

    std_div_to_show_div: dict[UUID, Division] = {}
    for std_div in std_divs_by_id.values():
        key = std_div.name.casefold()
        existing = div_by_name.get(key)
        if existing is not None:
            std_div_to_show_div[std_div.id] = existing
            continue
        next_div_sort += 10
        d = Division(
            show_id=show_id,
            name=std_div.name,
            sort_order=next_div_sort,
            default_score_type=std_div.default_score_type,
        )
        db.add(d)
        await db.flush()
        div_by_name[key] = d
        std_div_to_show_div[std_div.id] = d
        result.created_division_ids.append(d.id)

    std_sec_to_show_sec: dict[UUID, Section] = {}
    for std_sec in std_secs_by_id.values():
        key = std_sec.name.casefold()
        existing = sec_by_name.get(key)
        if existing is not None:
            std_sec_to_show_sec[std_sec.id] = existing
            continue
        next_sec_sort += 10
        s = Section(
            show_id=show_id,
            name=std_sec.name,
            sort_order=next_sec_sort,
        )
        db.add(s)
        await db.flush()
        sec_by_name[key] = s
        std_sec_to_show_sec[std_sec.id] = s
        result.created_section_ids.append(s.id)

    # ── 4. Register division_sections memberships ───────────────────────────
    for std_div_id, std_sec_id in needed_pairs:
        d = std_div_to_show_div[std_div_id]
        s = std_sec_to_show_sec[std_sec_id]
        await db.execute(
            pg_insert(division_sections)
            .values(division_id=d.id, section_id=s.id)
            .on_conflict_do_nothing()
        )

    # ── 5. Create classes for picks that referenced a standard_class ────────
    class_picks = [p for p in body.picks if p.standard_class_id]
    if class_picks:
        # Existing class numbers for dedup.
        existing_numbers = set((await db.execute(
            select(Class.class_number).where(Class.show_id == show_id)
        )).scalars().all())
        existing_codes = set((await db.execute(
            select(ClassAssociation.association_class_code)
            .join(Class, Class.id == ClassAssociation.class_id)
            .where(
                Class.show_id == show_id,
                ClassAssociation.show_type_id == show.show_type_id,
            )
        )).scalars().all())
        next_sort = (await db.execute(
            select(func.coalesce(func.max(Class.sort_order), 0))
            .where(Class.show_id == show_id)
        )).scalar_one()

        for pick in class_picks:
            std_cls = std_classes_by_id[pick.standard_class_id]
            if std_cls.class_code and std_cls.class_code in existing_codes:
                continue
            # Generate a class_number unique to this show. Prefer class_code
            # when present, otherwise increment from current max sort_order.
            next_sort += 1
            candidate_number = std_cls.class_code or str(next_sort)
            number = candidate_number
            n = 2
            while number in existing_numbers:
                number = f"{candidate_number}-{n}"
                n += 1
            existing_numbers.add(number)

            cls = Class(
                show_id=show_id,
                class_number=number,
                class_name=std_cls.class_name,
                class_date=show.start_date,
                status="OPEN",
                sort_order=next_sort,
                division_id=std_div_to_show_div[std_cls.standard_division_id].id,
                section_id=std_sec_to_show_sec[std_cls.standard_section_id].id,
                score_type=std_cls.default_score_type,
                entry_fee_cents=std_cls.default_entry_fee_cents,
                ring_id=None,
            )
            db.add(cls)
            await db.flush()
            if std_cls.class_code:
                db.add(ClassAssociation(
                    class_id=cls.id,
                    show_type_id=show.show_type_id,
                    association_class_code=std_cls.class_code,
                ))
                existing_codes.add(std_cls.class_code)
            result.created_class_ids.append(cls.id)

    await db.commit()
    return result
