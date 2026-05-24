from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy import select, func, delete, insert
from uuid import UUID
from typing import Optional

from database import get_db
from models import Section, Show, Class, Division, division_sections
from schemas import SectionCreate, SectionUpdate, SectionOut, SectionBulkCreate
from routers.shows import _assert_show_access

router = APIRouter(prefix="/shows/{show_id}/sections", tags=["Sections"])


async def _get_show_or_404(show_id: UUID, db: AsyncSession):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _validate_division_ids(show_id: UUID, division_ids: list[UUID], db: AsyncSession) -> None:
    """Confirm every division_id belongs to this show. Raises 422 on mismatch."""
    if not division_ids:
        return
    unique_ids = list({d for d in division_ids})
    res = await db.execute(
        select(Division.id).where(Division.show_id == show_id, Division.id.in_(unique_ids))
    )
    found = {row[0] for row in res.all()}
    missing = [str(d) for d in unique_ids if d not in found]
    if missing:
        raise HTTPException(422, f"Divisions not in this show: {', '.join(missing)}")


async def _serialize(section: Section, class_count: int, db: AsyncSession) -> SectionOut:
    div_res = await db.execute(
        select(division_sections.c.division_id).where(division_sections.c.section_id == section.id)
    )
    return SectionOut(
        id=section.id,
        show_id=section.show_id,
        name=section.name,
        sort_order=section.sort_order,
        class_count=class_count,
        division_ids=[row[0] for row in div_res.all()],
    )


async def _next_sort_order(show_id: UUID, db: AsyncSession) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(Section.sort_order), 0)).where(Section.show_id == show_id)
    )
    return (result.scalar_one() or 0) + 10


async def _set_memberships(section_id: UUID, division_ids: list[UUID], db: AsyncSession) -> None:
    """Replace the membership set for one section. Caller must commit."""
    await db.execute(delete(division_sections).where(division_sections.c.section_id == section_id))
    unique_ids = list({d for d in division_ids})
    if unique_ids:
        await db.execute(
            insert(division_sections),
            [{"division_id": d, "section_id": section_id} for d in unique_ids],
        )


@router.get("/", response_model=list[SectionOut])
async def list_sections(
    show_id: UUID,
    division_id: Optional[UUID] = Query(default=None, description="Filter to sections that belong to this division"),
    db: AsyncSession = Depends(get_db),
):
    await _get_show_or_404(show_id, db)
    stmt = (
        select(Section)
        .where(Section.show_id == show_id)
        .order_by(Section.sort_order.nulls_last(), Section.name)
    )
    if division_id is not None:
        stmt = stmt.join(
            division_sections, division_sections.c.section_id == Section.id
        ).where(division_sections.c.division_id == division_id)
    secs_res = await db.execute(stmt)
    secs = secs_res.scalars().all()
    if not secs:
        return []
    sec_ids = [s.id for s in secs]
    counts_res = await db.execute(
        select(Class.section_id, func.count())
        .where(Class.show_id == show_id, Class.section_id.in_(sec_ids))
        .group_by(Class.section_id)
    )
    counts = {row[0]: row[1] for row in counts_res.all()}
    div_res = await db.execute(
        select(division_sections.c.section_id, division_sections.c.division_id)
        .where(division_sections.c.section_id.in_(sec_ids))
    )
    by_section: dict[UUID, list[UUID]] = {sid: [] for sid in sec_ids}
    for sid, did in div_res.all():
        by_section[sid].append(did)
    return [
        SectionOut(
            id=s.id,
            show_id=s.show_id,
            name=s.name,
            sort_order=s.sort_order,
            class_count=counts.get(s.id, 0),
            division_ids=by_section.get(s.id, []),
        )
        for s in secs
    ]


@router.post("/", response_model=SectionOut, status_code=201)
async def create_section(
    show_id: UUID,
    body: SectionCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    await _validate_division_ids(show_id, body.division_ids, db)
    sort_order = body.sort_order if body.sort_order is not None else await _next_sort_order(show_id, db)
    section = Section(show_id=show_id, name=body.name, sort_order=sort_order)
    db.add(section)
    await db.flush()
    await _set_memberships(section.id, body.division_ids, db)
    await db.commit()
    await db.refresh(section)
    return await _serialize(section, 0, db)


@router.post("/bulk", response_model=list[SectionOut], status_code=201)
async def bulk_create_sections(
    show_id: UUID,
    body: SectionBulkCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    await _validate_division_ids(show_id, body.division_ids, db)
    existing_res = await db.execute(select(Section.name).where(Section.show_id == show_id))
    existing = {row[0] for row in existing_res.all()}
    sort_order = await _next_sort_order(show_id, db)
    created: list[Section] = []
    for raw in body.names:
        name = raw.strip()
        if not name or name in existing:
            continue
        existing.add(name)
        section = Section(show_id=show_id, name=name, sort_order=sort_order)
        sort_order += 10
        db.add(section)
        created.append(section)
    await db.flush()
    for s in created:
        await _set_memberships(s.id, body.division_ids, db)
    await db.commit()
    out: list[SectionOut] = []
    for s in created:
        await db.refresh(s)
        out.append(await _serialize(s, 0, db))
    return out


@router.patch("/{section_id}", response_model=SectionOut)
async def update_section(
    show_id: UUID,
    section_id: UUID,
    body: SectionUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    section = await db.get(Section, section_id)
    if not section or section.show_id != show_id:
        raise HTTPException(404, "Section not found")
    if body.name is not None:
        section.name = body.name
    if body.sort_order is not None:
        section.sort_order = body.sort_order
    if body.division_ids is not None:
        await _validate_division_ids(show_id, body.division_ids, db)
        # Removing a division a class still depends on would violate the composite
        # FK on classes(division_id, section_id). Block that explicitly so we
        # return 409 instead of a 500 from the DB.
        new_ids = set(body.division_ids)
        in_use_res = await db.execute(
            select(Class.division_id).where(Class.section_id == section_id).distinct()
        )
        in_use = {row[0] for row in in_use_res.all()}
        orphaned = in_use - new_ids
        if orphaned:
            raise HTTPException(
                409,
                "Cannot drop division memberships while classes still pair this section with them.",
            )
        await _set_memberships(section_id, body.division_ids, db)
    await db.commit()
    await db.refresh(section)
    count_res = await db.execute(
        select(func.count()).select_from(Class).where(Class.section_id == section_id)
    )
    return await _serialize(section, count_res.scalar_one(), db)


@router.delete("/{section_id}", status_code=204)
async def delete_section(
    show_id: UUID,
    section_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    section = await db.get(Section, section_id)
    if not section or section.show_id != show_id:
        raise HTTPException(404, "Section not found")
    in_use = await db.execute(
        select(func.count()).select_from(Class).where(Class.section_id == section_id)
    )
    if in_use.scalar_one() > 0:
        raise HTTPException(409, "Section is assigned to one or more classes — reassign or remove those classes first.")
    # Cascade clears division_sections rows via ON DELETE CASCADE on the FK.
    await db.delete(section)
    await db.commit()
