"""Read-only lookup endpoints for the show setup picker.

Exposes curated lists of standard ring names, discipline-style division
names, and bracket-style section names. Rows with show_type_id NULL are
the generic fallback used when no curated list exists for a given show
type.

The /catalog endpoint is the primary entry point for the new Matrix
setup UI — it returns divisions, sections, and (division × section)
cells with their standard classes in a single response.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from uuid import UUID
from collections import defaultdict

from database import get_db
from models import (
    StandardRing, StandardDivision, StandardSection, StandardClass,
    ShowType, standard_division_sections,
)
from schemas import (
    StandardRingOut, StandardDivisionOut, StandardSectionOut, StandardClassOut,
    StandardCatalogOut, StandardCatalogDivision, StandardCatalogSection,
    StandardCatalogCell,
)

router = APIRouter(prefix="/standard-setup", tags=["Standard Setup"])


@router.get("/rings", response_model=list[StandardRingOut])
async def list_standard_rings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(StandardRing).order_by(StandardRing.sort_order, StandardRing.name)
    )
    return result.scalars().all()


@router.get("/divisions", response_model=list[StandardDivisionOut])
async def list_standard_divisions(
    show_type_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Return divisions for the given show type, plus the generic fallback set.

    The frontend can deduplicate by name or display them as one merged list.
    """
    stmt = select(StandardDivision)
    if show_type_id is not None:
        stmt = stmt.where(
            or_(
                StandardDivision.show_type_id == show_type_id,
                StandardDivision.show_type_id.is_(None),
            )
        )
    stmt = stmt.order_by(StandardDivision.sort_order, StandardDivision.name)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/sections", response_model=list[StandardSectionOut])
async def list_standard_sections(
    show_type_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Return sections for the given show type, plus the generic fallback set."""
    stmt = select(StandardSection)
    if show_type_id is not None:
        stmt = stmt.where(
            or_(
                StandardSection.show_type_id == show_type_id,
                StandardSection.show_type_id.is_(None),
            )
        )
    stmt = stmt.order_by(StandardSection.sort_order, StandardSection.name)
    result = await db.execute(stmt)
    return result.scalars().all()


class StandardPairOut(BaseModel):
    division_name: str
    section_name: str
    score_type: str


@router.get("/pairs", response_model=list[StandardPairOut])
async def list_standard_pairs(
    show_type_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Return valid (division, section) pairs from standard_division_sections.

    Only pairs whose division and section both match the requested show type
    (or are the generic NULL fallback) are returned. The Standard Library picker
    uses this instead of computing a full cartesian product, so invalid combos
    like Walk-Trot Halter never appear.
    """
    sds = standard_division_sections
    stmt = (
        select(
            StandardDivision.name.label("division_name"),
            StandardDivision.default_score_type.label("score_type"),
            StandardSection.name.label("section_name"),
            StandardSection.sort_order.label("section_sort"),
        )
        .join(sds, StandardDivision.id == sds.c.standard_division_id)
        .join(StandardSection, StandardSection.id == sds.c.standard_section_id)
    )
    if show_type_id is not None:
        stmt = stmt.where(
            or_(
                StandardDivision.show_type_id == show_type_id,
                StandardDivision.show_type_id.is_(None),
            )
        ).where(
            or_(
                StandardSection.show_type_id == show_type_id,
                StandardSection.show_type_id.is_(None),
            )
        )
    stmt = stmt.order_by(
        StandardDivision.sort_order,
        StandardDivision.name,
        StandardSection.sort_order,
        StandardSection.name,
    )
    result = await db.execute(stmt)
    return [
        StandardPairOut(division_name=row.division_name, section_name=row.section_name, score_type=row.score_type)
        for row in result.all()
    ]


@router.get("/catalog", response_model=StandardCatalogOut)
async def get_standard_catalog(
    show_type_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Single payload for the Matrix setup UI: divisions, sections, and
    (div × sec) cells with their standard classes — scoped to one show type.

    Generic NULL-show_type_id rows are intentionally excluded; per-show-type
    seeding is the contract for the new Setup page. If a show type has no
    standard library yet, the response will be empty and the UI should fall
    back to "add custom" panels.
    """
    show_type = (await db.execute(
        select(ShowType).where(ShowType.id == show_type_id)
    )).scalar_one_or_none()
    if show_type is None:
        raise HTTPException(status_code=404, detail="show type not found")

    div_rows = (await db.execute(
        select(StandardDivision)
        .where(StandardDivision.show_type_id == show_type_id)
        .order_by(StandardDivision.sort_order, StandardDivision.name)
    )).scalars().all()
    sec_rows = (await db.execute(
        select(StandardSection)
        .where(StandardSection.show_type_id == show_type_id)
        .order_by(StandardSection.sort_order, StandardSection.name)
    )).scalars().all()
    class_rows = (await db.execute(
        select(StandardClass)
        .where(StandardClass.show_type_id == show_type_id)
        .order_by(StandardClass.sort_order, StandardClass.class_name)
    )).scalars().all()

    cells_map: dict[tuple[UUID, UUID], list[StandardClassOut]] = defaultdict(list)
    for c in class_rows:
        cells_map[(c.standard_division_id, c.standard_section_id)].append(
            StandardClassOut.model_validate(c)
        )

    return StandardCatalogOut(
        show_type_id=show_type_id,
        show_type_code=show_type.code,
        divisions=[
            StandardCatalogDivision(
                id=d.id, name=d.name, sort_order=d.sort_order,
                default_score_type=d.default_score_type,
            ) for d in div_rows
        ],
        sections=[
            StandardCatalogSection(id=s.id, name=s.name, sort_order=s.sort_order)
            for s in sec_rows
        ],
        cells=[
            StandardCatalogCell(
                standard_division_id=div_id,
                standard_section_id=sec_id,
                classes=classes,
            )
            for (div_id, sec_id), classes in cells_map.items()
        ],
    )
