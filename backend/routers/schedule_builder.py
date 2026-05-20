"""Schedule Builder.

The Schedule Builder lays out a show as a matrix:
    rows    = divisions (disciplines: Halter, Showmanship, Western Pleasure...)
    columns = sections (age/skill brackets: 10 & Under, Walk-Trot, ...)
Each checked cell materializes one Class. Class names are auto-generated as
"{Section} {Division}" when a section is paired, or just "{Division}" when
no section is selected. Numbers continue from the show's current sort_order.
score_type comes from the division's default_score_type, with an optional
per-pick override.
"""
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from uuid import UUID

from database import get_db
from dependencies import require_admin_or_show_admin
from models import Class, Division, Ring, Section, Show
from schemas import (
    ClassOut,
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
    """Materialize one (date, ring) batch of classes from a division × section matrix."""
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

    division_ids = [p.division_id for p in body.picks]
    div_result = await db.execute(
        select(Division).where(Division.id.in_(division_ids))
    )
    divisions: dict[UUID, Division] = {d.id: d for d in div_result.scalars().all()}
    missing_divs = [str(did) for did in division_ids if did not in divisions]
    if missing_divs:
        raise HTTPException(400, f"Unknown division ids: {', '.join(missing_divs)}")
    for d in divisions.values():
        if d.show_id != show_id:
            raise HTTPException(400, f"Division {d.id} does not belong to this show")

    section_ids = {sid for p in body.picks for sid in p.section_ids}
    sections: dict[UUID, Section] = {}
    if section_ids:
        sec_result = await db.execute(
            select(Section).where(Section.id.in_(section_ids))
        )
        sections = {s.id: s for s in sec_result.scalars().all()}
        missing_secs = [str(sid) for sid in section_ids if sid not in sections]
        if missing_secs:
            raise HTTPException(400, f"Unknown section ids: {', '.join(missing_secs)}")
        for s in sections.values():
            if s.show_id != show_id:
                raise HTTPException(400, f"Section {s.id} does not belong to this show")

    max_order_result = await db.execute(
        select(func.coalesce(func.max(Class.sort_order), 0)).where(Class.show_id == show_id)
    )
    next_sort_order = max_order_result.scalar_one()

    created: list[Class] = []
    for pick in body.picks:
        division = divisions[pick.division_id]
        score_type = pick.score_type or division.default_score_type
        # Empty section_ids → one class with just the division name.
        pick_sections: list[Section | None] = (
            [sections[sid] for sid in pick.section_ids] if pick.section_ids else [None]
        )
        for section in pick_sections:
            next_sort_order += 1
            class_name = (
                f"{section.name} {division.name}" if section is not None else division.name
            )
            cls = Class(
                show_id=show_id,
                ring_id=body.ring_id,
                division_id=division.id,
                section_id=section.id if section is not None else None,
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
