from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID

from database import get_db
from models import Section, Show, Class
from schemas import SectionCreate, SectionUpdate, SectionOut, SectionBulkCreate
from routers.shows import _assert_show_access

router = APIRouter(prefix="/shows/{show_id}/sections", tags=["Sections"])


async def _get_show_or_404(show_id: UUID, db: AsyncSession):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _section_with_count(section: Section, db: AsyncSession) -> SectionOut:
    count = await db.execute(
        select(func.count()).select_from(Class).where(Class.section_id == section.id)
    )
    return SectionOut(
        id=section.id,
        show_id=section.show_id,
        name=section.name,
        sort_order=section.sort_order,
        class_count=count.scalar_one(),
    )


async def _next_sort_order(show_id: UUID, db: AsyncSession) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(Section.sort_order), 0)).where(Section.show_id == show_id)
    )
    return (result.scalar_one() or 0) + 10


@router.get("/", response_model=list[SectionOut])
async def list_sections(show_id: UUID, db: AsyncSession = Depends(get_db)):
    await _get_show_or_404(show_id, db)
    secs_res = await db.execute(
        select(Section).where(Section.show_id == show_id).order_by(Section.sort_order.nulls_last(), Section.name)
    )
    secs = secs_res.scalars().all()
    counts_res = await db.execute(
        select(Class.section_id, func.count())
        .where(Class.show_id == show_id, Class.section_id.is_not(None))
        .group_by(Class.section_id)
    )
    counts = {row[0]: row[1] for row in counts_res.all()}
    return [
        SectionOut(
            id=s.id,
            show_id=s.show_id,
            name=s.name,
            sort_order=s.sort_order,
            class_count=counts.get(s.id, 0),
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
    sort_order = body.sort_order if body.sort_order is not None else await _next_sort_order(show_id, db)
    section = Section(show_id=show_id, name=body.name, sort_order=sort_order)
    db.add(section)
    await db.commit()
    await db.refresh(section)
    return await _section_with_count(section, db)


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
    await db.commit()
    out: list[SectionOut] = []
    for s in created:
        await db.refresh(s)
        out.append(await _section_with_count(s, db))
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
    await db.commit()
    await db.refresh(section)
    return await _section_with_count(section, db)


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
    await db.delete(section)
    await db.commit()
