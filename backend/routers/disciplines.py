from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID

from database import get_db
from models import Discipline, Show, Class, StandardDiscipline
from schemas import DisciplineCreate, DisciplineUpdate, DisciplineOut, DisciplineBulkCreate
from routers.shows import _assert_show_access


def _infer_score_type(name: str) -> str:
    """Best-effort discipline → score_type guess for bulk-added discipline names
    that don't match a standard_disciplines row. Mirrors migration 048's heuristic.
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

router = APIRouter(prefix="/shows/{show_id}/disciplines", tags=["Disciplines"])


async def _get_show_or_404(show_id: UUID, db: AsyncSession):
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _discipline_with_count(discipline: Discipline, db: AsyncSession) -> DisciplineOut:
    count = await db.execute(
        select(func.count()).select_from(Class).where(Class.discipline_id == discipline.id)
    )
    return DisciplineOut(
        id=discipline.id,
        show_id=discipline.show_id,
        name=discipline.name,
        sort_order=discipline.sort_order,
        default_score_type=discipline.default_score_type,
        class_count=count.scalar_one(),
    )


async def _next_sort_order(show_id: UUID, db: AsyncSession) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(Discipline.sort_order), 0)).where(Discipline.show_id == show_id)
    )
    return (result.scalar_one() or 0) + 10


@router.get("/", response_model=list[DisciplineOut])
async def list_disciplines(show_id: UUID, db: AsyncSession = Depends(get_db)):
    await _get_show_or_404(show_id, db)
    discs_res = await db.execute(
        select(Discipline).where(Discipline.show_id == show_id).order_by(Discipline.sort_order.nulls_last(), Discipline.name)
    )
    discs = discs_res.scalars().all()
    counts_res = await db.execute(
        select(Class.discipline_id, func.count())
        .where(Class.show_id == show_id, Class.discipline_id.is_not(None))
        .group_by(Class.discipline_id)
    )
    counts = {row[0]: row[1] for row in counts_res.all()}
    return [
        DisciplineOut(
            id=d.id,
            show_id=d.show_id,
            name=d.name,
            sort_order=d.sort_order,
            default_score_type=d.default_score_type,
            class_count=counts.get(d.id, 0),
        )
        for d in discs
    ]


@router.post("/", response_model=DisciplineOut, status_code=201)
async def create_discipline(
    show_id: UUID,
    body: DisciplineCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    sort_order = body.sort_order if body.sort_order is not None else await _next_sort_order(show_id, db)
    discipline = Discipline(
        show_id=show_id,
        name=body.name,
        sort_order=sort_order,
        default_score_type=body.default_score_type,
    )
    db.add(discipline)
    await db.commit()
    await db.refresh(discipline)
    return await _discipline_with_count(discipline, db)


@router.post("/bulk", response_model=list[DisciplineOut], status_code=201)
async def bulk_create_disciplines(
    show_id: UUID,
    body: DisciplineBulkCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    existing_res = await db.execute(select(Discipline.name).where(Discipline.show_id == show_id))
    existing = {row[0] for row in existing_res.all()}

    cleaned = [raw.strip() for raw in body.names if raw.strip()]
    std_lookup: dict[str, str] = {}
    if cleaned:
        std_res = await db.execute(
            select(StandardDiscipline.name, StandardDiscipline.default_score_type)
            .where(StandardDiscipline.name.in_(cleaned))
        )
        std_lookup = {row[0]: row[1] for row in std_res.all()}

    sort_order = await _next_sort_order(show_id, db)
    created: list[Discipline] = []
    for name in cleaned:
        if name in existing:
            continue
        existing.add(name)
        score_type = std_lookup.get(name) or _infer_score_type(name)
        discipline = Discipline(
            show_id=show_id,
            name=name,
            sort_order=sort_order,
            default_score_type=score_type,
        )
        sort_order += 10
        db.add(discipline)
        created.append(discipline)
    await db.commit()
    out: list[DisciplineOut] = []
    for d in created:
        await db.refresh(d)
        out.append(await _discipline_with_count(d, db))
    return out


@router.patch("/{discipline_id}", response_model=DisciplineOut)
async def update_discipline(
    show_id: UUID,
    discipline_id: UUID,
    body: DisciplineUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    discipline = await db.get(Discipline, discipline_id)
    if not discipline or discipline.show_id != show_id:
        raise HTTPException(404, "Discipline not found")
    if body.name is not None:
        discipline.name = body.name
    if body.sort_order is not None:
        discipline.sort_order = body.sort_order
    if body.default_score_type is not None:
        discipline.default_score_type = body.default_score_type
    await db.commit()
    await db.refresh(discipline)
    return await _discipline_with_count(discipline, db)


@router.delete("/{discipline_id}", status_code=204)
async def delete_discipline(
    show_id: UUID,
    discipline_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    discipline = await db.get(Discipline, discipline_id)
    if not discipline or discipline.show_id != show_id:
        raise HTTPException(404, "Discipline not found")
    in_use = await db.execute(
        select(func.count()).select_from(Class).where(Class.discipline_id == discipline_id)
    )
    if in_use.scalar_one() > 0:
        raise HTTPException(409, "Discipline is assigned to one or more classes — reassign or remove those classes first.")
    await db.delete(discipline)
    await db.commit()
