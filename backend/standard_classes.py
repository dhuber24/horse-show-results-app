"""Reading an association's approved class codes.

One place, because the catalog is a view over a Type 2 dimension and every
caller that wrote its own query would eventually forget that the versions
table holds retired codes too. Everything here reads
`association_standard_classes` (the open versions); the importer in
`imports/class_codes.py` is the only thing that writes the versions table.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AssociationStandardClass, ShowType


async def show_type_id_for(db: AsyncSession, code: str) -> UUID | None:
    result = await db.execute(select(ShowType.id).where(ShowType.code == code))
    return result.scalar_one_or_none()


async def list_classes(
    db: AsyncSession,
    show_type_id: UUID,
    *,
    division: str | None = None,
    q: str | None = None,
) -> list[AssociationStandardClass]:
    """Approved classes for one association, in catalog order."""
    stmt = (
        select(AssociationStandardClass)
        .where(AssociationStandardClass.show_type_id == show_type_id)
        .order_by(AssociationStandardClass.division, AssociationStandardClass.sort_order)
    )
    if division:
        stmt = stmt.where(AssociationStandardClass.division == division)
    rows = (await db.execute(stmt)).scalars().all()
    if q:
        needle = q.lower()
        rows = [r for r in rows if needle in r.code.lower() or needle in r.name.lower()]
    return list(rows)


async def list_divisions(db: AsyncSession, show_type_id: UUID) -> list[str]:
    result = await db.execute(
        select(AssociationStandardClass.division)
        .where(AssociationStandardClass.show_type_id == show_type_id)
        .distinct()
        .order_by(AssociationStandardClass.division)
    )
    return [row[0] for row in result.all()]


async def lookup(
    db: AsyncSession, show_type_code: str, code: str
) -> AssociationStandardClass | None:
    """One approved class by association code — the validation path's lookup.

    Returns None for a code the association has retired, which is the same
    answer the old per-association tables gave for a code they never had.
    """
    if not code:
        return None
    stmt = (
        select(AssociationStandardClass)
        .join(ShowType, ShowType.id == AssociationStandardClass.show_type_id)
        .where(ShowType.code == show_type_code)
        .where(AssociationStandardClass.code == code)
    )
    return (await db.execute(stmt)).scalars().first()


async def lookup_many(
    db: AsyncSession, show_type_code: str, codes: list[str]
) -> dict[str, AssociationStandardClass]:
    """Same as `lookup` for a batch — keyed by code."""
    if not codes:
        return {}
    stmt = (
        select(AssociationStandardClass)
        .join(ShowType, ShowType.id == AssociationStandardClass.show_type_id)
        .where(ShowType.code == show_type_code)
        .where(AssociationStandardClass.code.in_(codes))
    )
    rows = (await db.execute(stmt)).scalars().all()
    return {r.code: r for r in rows}
