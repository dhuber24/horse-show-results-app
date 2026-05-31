"""Read-only lookup endpoints for the show setup picker.

Exposes curated lists of standard ring names, disciplines (overarching riding
styles), and divisions (age/skill brackets). Rows with show_type_id NULL are
the generic fallback used when no curated list exists for a given show type.

The /catalog endpoint is the primary entry point for the matrix setup UI —
it returns disciplines, divisions, and (discipline × division) cells with
their standard classes in a single response.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from uuid import UUID
from collections import defaultdict

from database import get_db
from models import (
    StandardRing, StandardDiscipline, StandardDivision, StandardClass,
    ShowType, standard_discipline_divisions,
)
from schemas import (
    StandardRingOut, StandardDisciplineOut, StandardDivisionOut, StandardClassOut,
    StandardCatalogOut, StandardCatalogDiscipline, StandardCatalogDivision,
    StandardCatalogCell,
)

router = APIRouter(prefix="/standard-setup", tags=["Standard Setup"])


@router.get("/rings", response_model=list[StandardRingOut])
async def list_standard_rings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(StandardRing).order_by(StandardRing.sort_order, StandardRing.name)
    )
    return result.scalars().all()


@router.get("/disciplines", response_model=list[StandardDisciplineOut])
async def list_standard_disciplines(
    show_type_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Return disciplines for the given show type, plus the generic fallback set."""
    stmt = select(StandardDiscipline)
    if show_type_id is not None:
        stmt = stmt.where(
            or_(
                StandardDiscipline.show_type_id == show_type_id,
                StandardDiscipline.show_type_id.is_(None),
            )
        )
    stmt = stmt.order_by(StandardDiscipline.sort_order, StandardDiscipline.name)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/divisions", response_model=list[StandardDivisionOut])
async def list_standard_divisions(
    show_type_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Return divisions for the given show type, plus the generic fallback set."""
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


class StandardPairOut(BaseModel):
    discipline_name: str
    division_name: str
    score_type: str


@router.get("/pairs", response_model=list[StandardPairOut])
async def list_standard_pairs(
    show_type_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Return valid (discipline, division) pairs from standard_discipline_divisions.

    Only pairs whose discipline and division both match the requested show
    type (or are the generic NULL fallback) are returned. The Standard Library
    picker uses this instead of computing a full cartesian product, so
    invalid combos like Walk-Trot Halter never appear.
    """
    sdd = standard_discipline_divisions
    stmt = (
        select(
            StandardDiscipline.name.label("discipline_name"),
            StandardDiscipline.default_score_type.label("score_type"),
            StandardDivision.name.label("division_name"),
            StandardDivision.sort_order.label("division_sort"),
        )
        .join(sdd, StandardDiscipline.id == sdd.c.standard_discipline_id)
        .join(StandardDivision, StandardDivision.id == sdd.c.standard_division_id)
    )
    if show_type_id is not None:
        stmt = stmt.where(
            or_(
                StandardDiscipline.show_type_id == show_type_id,
                StandardDiscipline.show_type_id.is_(None),
            )
        ).where(
            or_(
                StandardDivision.show_type_id == show_type_id,
                StandardDivision.show_type_id.is_(None),
            )
        )
    stmt = stmt.order_by(
        StandardDiscipline.sort_order,
        StandardDiscipline.name,
        StandardDivision.sort_order,
        StandardDivision.name,
    )
    result = await db.execute(stmt)
    return [
        StandardPairOut(
            discipline_name=row.discipline_name,
            division_name=row.division_name,
            score_type=row.score_type,
        )
        for row in result.all()
    ]


@router.get("/catalog", response_model=StandardCatalogOut)
async def get_standard_catalog(
    show_type_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Single payload for the Matrix setup UI: disciplines, divisions, and
    (disc × div) cells with their standard classes — scoped to one show type.

    Generic NULL-show_type_id rows are intentionally excluded; per-show-type
    seeding is the contract. If a show type has no standard library yet, the
    response will be empty and the UI should fall back to "add custom" panels.
    """
    show_type = (await db.execute(
        select(ShowType).where(ShowType.id == show_type_id)
    )).scalar_one_or_none()
    if show_type is None:
        raise HTTPException(status_code=404, detail="show type not found")

    disc_rows = (await db.execute(
        select(StandardDiscipline)
        .where(StandardDiscipline.show_type_id == show_type_id)
        .order_by(StandardDiscipline.sort_order, StandardDiscipline.name)
    )).scalars().all()
    div_rows = (await db.execute(
        select(StandardDivision)
        .where(StandardDivision.show_type_id == show_type_id)
        .order_by(StandardDivision.sort_order, StandardDivision.name)
    )).scalars().all()
    class_rows = (await db.execute(
        select(StandardClass)
        .where(StandardClass.show_type_id == show_type_id)
        .order_by(StandardClass.sort_order, StandardClass.class_name)
    )).scalars().all()

    cells_map: dict[tuple[UUID, UUID], list[StandardClassOut]] = defaultdict(list)
    for c in class_rows:
        cells_map[(c.standard_discipline_id, c.standard_division_id)].append(
            StandardClassOut.model_validate(c)
        )

    return StandardCatalogOut(
        show_type_id=show_type_id,
        show_type_code=show_type.code,
        disciplines=[
            StandardCatalogDiscipline(
                id=d.id, name=d.name, sort_order=d.sort_order,
                default_score_type=d.default_score_type,
            ) for d in disc_rows
        ],
        divisions=[
            StandardCatalogDivision(id=d.id, name=d.name, sort_order=d.sort_order)
            for d in div_rows
        ],
        cells=[
            StandardCatalogCell(
                standard_discipline_id=disc_id,
                standard_division_id=div_id,
                classes=classes,
            )
            for (disc_id, div_id), classes in cells_map.items()
        ],
    )
