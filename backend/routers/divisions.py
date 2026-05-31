from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, insert
from uuid import UUID
from typing import Optional

from database import get_db
from models import Division, Show, Class, Discipline, discipline_divisions
from schemas import DivisionCreate, DivisionUpdate, DivisionOut, DivisionBulkCreate
from routers.shows import _assert_show_access

router = APIRouter(prefix="/shows/{show_id}/divisions", tags=["Divisions"])


async def _get_show_or_404(show_id: UUID, db: AsyncSession):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _validate_discipline_ids(show_id: UUID, discipline_ids: list[UUID], db: AsyncSession) -> None:
    """Confirm every discipline_id belongs to this show. Raises 422 on mismatch."""
    if not discipline_ids:
        return
    unique_ids = list({d for d in discipline_ids})
    res = await db.execute(
        select(Discipline.id).where(Discipline.show_id == show_id, Discipline.id.in_(unique_ids))
    )
    found = {row[0] for row in res.all()}
    missing = [str(d) for d in unique_ids if d not in found]
    if missing:
        raise HTTPException(422, f"Disciplines not in this show: {', '.join(missing)}")


async def _serialize(division: Division, class_count: int, db: AsyncSession) -> DivisionOut:
    disc_res = await db.execute(
        select(discipline_divisions.c.discipline_id).where(discipline_divisions.c.division_id == division.id)
    )
    return DivisionOut(
        id=division.id,
        show_id=division.show_id,
        name=division.name,
        sort_order=division.sort_order,
        class_count=class_count,
        discipline_ids=[row[0] for row in disc_res.all()],
    )


async def _next_sort_order(show_id: UUID, db: AsyncSession) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(Division.sort_order), 0)).where(Division.show_id == show_id)
    )
    return (result.scalar_one() or 0) + 10


async def _set_memberships(division_id: UUID, discipline_ids: list[UUID], db: AsyncSession) -> None:
    """Replace the membership set for one division. Caller must commit."""
    await db.execute(delete(discipline_divisions).where(discipline_divisions.c.division_id == division_id))
    unique_ids = list({d for d in discipline_ids})
    if unique_ids:
        await db.execute(
            insert(discipline_divisions),
            [{"discipline_id": d, "division_id": division_id} for d in unique_ids],
        )


@router.get("/", response_model=list[DivisionOut])
async def list_divisions(
    show_id: UUID,
    discipline_id: Optional[UUID] = Query(default=None, description="Filter to divisions that belong to this discipline"),
    db: AsyncSession = Depends(get_db),
):
    await _get_show_or_404(show_id, db)
    stmt = (
        select(Division)
        .where(Division.show_id == show_id)
        .order_by(Division.sort_order.nulls_last(), Division.name)
    )
    if discipline_id is not None:
        stmt = stmt.join(
            discipline_divisions, discipline_divisions.c.division_id == Division.id
        ).where(discipline_divisions.c.discipline_id == discipline_id)
    divs_res = await db.execute(stmt)
    divs = divs_res.scalars().all()
    if not divs:
        return []
    div_ids = [d.id for d in divs]
    counts_res = await db.execute(
        select(Class.division_id, func.count())
        .where(Class.show_id == show_id, Class.division_id.in_(div_ids))
        .group_by(Class.division_id)
    )
    counts = {row[0]: row[1] for row in counts_res.all()}
    disc_res = await db.execute(
        select(discipline_divisions.c.division_id, discipline_divisions.c.discipline_id)
        .where(discipline_divisions.c.division_id.in_(div_ids))
    )
    by_division: dict[UUID, list[UUID]] = {did: [] for did in div_ids}
    for did, disc_id in disc_res.all():
        by_division[did].append(disc_id)
    return [
        DivisionOut(
            id=d.id,
            show_id=d.show_id,
            name=d.name,
            sort_order=d.sort_order,
            class_count=counts.get(d.id, 0),
            discipline_ids=by_division.get(d.id, []),
        )
        for d in divs
    ]


@router.post("/", response_model=DivisionOut, status_code=201)
async def create_division(
    show_id: UUID,
    body: DivisionCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    await _validate_discipline_ids(show_id, body.discipline_ids, db)
    sort_order = body.sort_order if body.sort_order is not None else await _next_sort_order(show_id, db)
    division = Division(show_id=show_id, name=body.name, sort_order=sort_order)
    db.add(division)
    await db.flush()
    await _set_memberships(division.id, body.discipline_ids, db)
    await db.commit()
    await db.refresh(division)
    return await _serialize(division, 0, db)


@router.post("/bulk", response_model=list[DivisionOut], status_code=201)
async def bulk_create_divisions(
    show_id: UUID,
    body: DivisionBulkCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    await _validate_discipline_ids(show_id, body.discipline_ids, db)
    existing_res = await db.execute(select(Division.name).where(Division.show_id == show_id))
    existing = {row[0] for row in existing_res.all()}
    sort_order = await _next_sort_order(show_id, db)
    created: list[Division] = []
    for raw in body.names:
        name = raw.strip()
        if not name or name in existing:
            continue
        existing.add(name)
        division = Division(show_id=show_id, name=name, sort_order=sort_order)
        sort_order += 10
        db.add(division)
        created.append(division)
    await db.flush()
    for d in created:
        await _set_memberships(d.id, body.discipline_ids, db)
    await db.commit()
    out: list[DivisionOut] = []
    for d in created:
        await db.refresh(d)
        out.append(await _serialize(d, 0, db))
    return out


@router.patch("/{division_id}", response_model=DivisionOut)
async def update_division(
    show_id: UUID,
    division_id: UUID,
    body: DivisionUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    division = await db.get(Division, division_id)
    if not division or division.show_id != show_id:
        raise HTTPException(404, "Division not found")
    if body.name is not None:
        division.name = body.name
    if body.sort_order is not None:
        division.sort_order = body.sort_order
    if body.discipline_ids is not None:
        await _validate_discipline_ids(show_id, body.discipline_ids, db)
        # Removing a discipline a class still depends on would violate the
        # composite FK on classes(discipline_id, division_id). Block that
        # explicitly so we return 409 instead of a 500 from the DB.
        new_ids = set(body.discipline_ids)
        in_use_res = await db.execute(
            select(Class.discipline_id).where(Class.division_id == division_id).distinct()
        )
        in_use = {row[0] for row in in_use_res.all()}
        orphaned = in_use - new_ids
        if orphaned:
            raise HTTPException(
                409,
                "Cannot drop discipline memberships while classes still pair this division with them.",
            )
        await _set_memberships(division_id, body.discipline_ids, db)
    await db.commit()
    await db.refresh(division)
    count_res = await db.execute(
        select(func.count()).select_from(Class).where(Class.division_id == division_id)
    )
    return await _serialize(division, count_res.scalar_one(), db)


@router.delete("/{division_id}", status_code=204)
async def delete_division(
    show_id: UUID,
    division_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    division = await db.get(Division, division_id)
    if not division or division.show_id != show_id:
        raise HTTPException(404, "Division not found")
    in_use = await db.execute(
        select(func.count()).select_from(Class).where(Class.division_id == division_id)
    )
    if in_use.scalar_one() > 0:
        raise HTTPException(409, "Division is assigned to one or more classes — reassign or remove those classes first.")
    # Cascade clears discipline_divisions rows via ON DELETE CASCADE on the FK.
    await db.delete(division)
    await db.commit()
