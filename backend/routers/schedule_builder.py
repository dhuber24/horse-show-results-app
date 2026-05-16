"""Schedule Builder for OPEN-style shows.

Open shows are organized as a matrix: rows = class templates (Showmanship,
Western Pleasure, etc.) and columns = divisions (10 & Under, 11-17, Walk-Trot,
etc.). This router exposes the template library and a build endpoint that
materializes one (date, ring) batch of classes from a matrix of picks.
"""
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.exc import IntegrityError
from uuid import UUID

from database import get_db
from dependencies import require_admin_or_show_admin
from models import Class, ClassTemplate, Division, Ring, Show
from schemas import (
    ClassOut,
    ClassTemplateCreate,
    ClassTemplateOut,
    ScheduleBuilderBuild,
)
from routers.shows import _assert_show_access


router = APIRouter(
    prefix="/shows/{show_id}/schedule-builder",
    tags=["Schedule Builder"],
)


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


# ── Templates ──────────────────────────────────────────────────────────────────

@router.get("/templates", response_model=list[ClassTemplateOut])
async def list_templates(show_id: UUID, db: AsyncSession = Depends(get_db)):
    """Return the seed library plus any show-scoped custom templates."""
    await _get_show_or_404(show_id, db)
    result = await db.execute(
        select(ClassTemplate)
        .where(
            or_(
                ClassTemplate.show_id.is_(None),
                ClassTemplate.show_id == show_id,
            )
        )
        .order_by(ClassTemplate.sort_order, ClassTemplate.name)
    )
    return result.scalars().all()


@router.post(
    "/templates",
    response_model=ClassTemplateOut,
    status_code=201,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def create_template(
    show_id: UUID,
    body: ClassTemplateCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    max_order_result = await db.execute(
        select(func.coalesce(func.max(ClassTemplate.sort_order), 0))
        .where(ClassTemplate.show_id == show_id)
    )
    next_order = max_order_result.scalar_one() + 1000  # custom rows live after seeds
    template = ClassTemplate(
        show_id=show_id,
        name=body.name.strip(),
        default_score_type=body.default_score_type,
        category=body.category,
        sort_order=next_order,
        is_seed=False,
    )
    db.add(template)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "A template with this name already exists for this show")
    await db.refresh(template)
    return template


@router.delete(
    "/templates/{template_id}",
    status_code=204,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def delete_template(
    show_id: UUID,
    template_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    template = await db.get(ClassTemplate, template_id)
    if not template or template.show_id != show_id:
        # Seeds (show_id NULL) are never deletable from a show context
        raise HTTPException(404, "Custom template not found for this show")
    await db.delete(template)
    await db.commit()


# ── Build ──────────────────────────────────────────────────────────────────────

@router.post(
    "/build",
    response_model=list[ClassOut],
    status_code=201,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def build_schedule(
    show_id: UUID,
    body: ScheduleBuilderBuild,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Materialize one (date, ring) batch of classes from a template × division matrix.

    Names are auto-generated as "{Division} {Template}" when a division is
    picked, or just "{Template}" when no division is paired. Numbers continue
    from the show's current max sort_order.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)

    if body.class_date < show.start_date or body.class_date > show.end_date:
        raise HTTPException(
            400,
            f"Class date must be between {show.start_date} and {show.end_date}",
        )

    if body.ring_id is not None:
        ring = await db.get(Ring, body.ring_id)
        if not ring or ring.show_id != show_id:
            raise HTTPException(400, "Ring does not belong to this show")

    template_ids = [p.template_id for p in body.picks]
    template_result = await db.execute(
        select(ClassTemplate).where(ClassTemplate.id.in_(template_ids))
    )
    templates: dict[UUID, ClassTemplate] = {t.id: t for t in template_result.scalars().all()}
    missing_templates = [str(tid) for tid in template_ids if tid not in templates]
    if missing_templates:
        raise HTTPException(400, f"Unknown template ids: {', '.join(missing_templates)}")
    # Reject templates that belong to a different show.
    for t in templates.values():
        if t.show_id is not None and t.show_id != show_id:
            raise HTTPException(400, f"Template {t.id} does not belong to this show")

    division_ids = {did for p in body.picks for did in p.division_ids}
    divisions: dict[UUID, Division] = {}
    if division_ids:
        div_result = await db.execute(
            select(Division).where(Division.id.in_(division_ids))
        )
        divisions = {d.id: d for d in div_result.scalars().all()}
        missing_divs = [str(did) for did in division_ids if did not in divisions]
        if missing_divs:
            raise HTTPException(400, f"Unknown division ids: {', '.join(missing_divs)}")
        for d in divisions.values():
            if d.show_id != show_id:
                raise HTTPException(400, f"Division {d.id} does not belong to this show")

    max_order_result = await db.execute(
        select(func.coalesce(func.max(Class.sort_order), 0)).where(Class.show_id == show_id)
    )
    next_sort_order = max_order_result.scalar_one()

    created: list[Class] = []
    for pick in body.picks:
        template = templates[pick.template_id]
        score_type = pick.score_type or template.default_score_type
        # Empty division_ids → one class with just the template name.
        pick_divisions: list[Division | None] = (
            [divisions[did] for did in pick.division_ids] if pick.division_ids else [None]
        )
        for division in pick_divisions:
            next_sort_order += 1
            class_name = (
                f"{division.name} {template.name}" if division is not None else template.name
            )
            cls = Class(
                show_id=show_id,
                ring_id=body.ring_id,
                division_id=division.id if division is not None else None,
                class_name=class_name,
                class_number=str(next_sort_order),
                class_date=body.class_date,
                status="OPEN",
                score_type=score_type,
                sort_order=next_sort_order,
            )
            db.add(cls)
            created.append(cls)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "One or more class numbers already exist in this show")

    for cls in created:
        await db.refresh(cls)
    return created
