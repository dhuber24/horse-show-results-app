from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID

from database import get_db
from models import Division, Show, Class, StandardDivision
from schemas import DivisionCreate, DivisionUpdate, DivisionOut, DivisionBulkCreate
from routers.shows import _assert_show_access


def _infer_score_type(name: str) -> str:
    """Best-effort discipline → score_type guess for bulk-added division names
    that don't match a standard_divisions row. Mirrors migration 048's heuristic.
    """
    n = name.lower()
    if any(token in n for token in ("barrel", "pole", "stake")):
        return "time"
    if any(
        token in n
        for token in (
            "showmanship",
            "horsemanship",
            "equitation",
            "reining",
            "ranch riding",
            "ranch trail",
            "hunter hack",
            "trail",
        )
    ):
        return "pattern"
    return "placement"

router = APIRouter(prefix="/shows/{show_id}/divisions", tags=["Divisions"])


async def _get_show_or_404(show_id: UUID, db: AsyncSession):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _division_with_count(division: Division, db: AsyncSession) -> DivisionOut:
    count = await db.execute(
        select(func.count()).select_from(Class).where(Class.division_id == division.id)
    )
    return DivisionOut(
        id=division.id,
        show_id=division.show_id,
        name=division.name,
        sort_order=division.sort_order,
        default_score_type=division.default_score_type,
        class_count=count.scalar_one(),
    )


async def _next_sort_order(show_id: UUID, db: AsyncSession) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(Division.sort_order), 0)).where(Division.show_id == show_id)
    )
    return (result.scalar_one() or 0) + 10


@router.get("/", response_model=list[DivisionOut])
async def list_divisions(show_id: UUID, db: AsyncSession = Depends(get_db)):
    await _get_show_or_404(show_id, db)
    divs_res = await db.execute(
        select(Division).where(Division.show_id == show_id).order_by(Division.sort_order.nulls_last(), Division.name)
    )
    divs = divs_res.scalars().all()
    counts_res = await db.execute(
        select(Class.division_id, func.count())
        .where(Class.show_id == show_id, Class.division_id.is_not(None))
        .group_by(Class.division_id)
    )
    counts = {row[0]: row[1] for row in counts_res.all()}
    return [
        DivisionOut(
            id=d.id,
            show_id=d.show_id,
            name=d.name,
            sort_order=d.sort_order,
            default_score_type=d.default_score_type,
            class_count=counts.get(d.id, 0),
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
    sort_order = body.sort_order if body.sort_order is not None else await _next_sort_order(show_id, db)
    division = Division(
        show_id=show_id,
        name=body.name,
        sort_order=sort_order,
        default_score_type=body.default_score_type,
    )
    db.add(division)
    await db.commit()
    await db.refresh(division)
    return await _division_with_count(division, db)


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
    existing_res = await db.execute(select(Division.name).where(Division.show_id == show_id))
    existing = {row[0] for row in existing_res.all()}

    # Look up the standard discipline list so picked names inherit the curated
    # default_score_type. Names not in the standard list fall back to a
    # heuristic on the name itself.
    cleaned = [raw.strip() for raw in body.names if raw.strip()]
    std_lookup: dict[str, str] = {}
    if cleaned:
        std_res = await db.execute(
            select(StandardDivision.name, StandardDivision.default_score_type)
            .where(StandardDivision.name.in_(cleaned))
        )
        std_lookup = {row[0]: row[1] for row in std_res.all()}

    sort_order = await _next_sort_order(show_id, db)
    created: list[Division] = []
    for name in cleaned:
        if name in existing:
            continue
        existing.add(name)
        score_type = std_lookup.get(name) or _infer_score_type(name)
        division = Division(
            show_id=show_id,
            name=name,
            sort_order=sort_order,
            default_score_type=score_type,
        )
        sort_order += 10
        db.add(division)
        created.append(division)
    await db.commit()
    out: list[DivisionOut] = []
    for d in created:
        await db.refresh(d)
        out.append(await _division_with_count(d, db))
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
    if body.default_score_type is not None:
        division.default_score_type = body.default_score_type
    await db.commit()
    await db.refresh(division)
    return await _division_with_count(division, db)


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
    await db.delete(division)
    await db.commit()
