from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from uuid import UUID
from typing import Optional

from database import get_db
from dependencies import require_authenticated
from models import Exhibitor, Entry, Class, Show, Horse, Result
from placings import best_placing, reported_outcome

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/exhibitor/{user_id}")
async def get_exhibitor_dashboard(
    user_id: UUID,
    x_user_role: Optional[str] = Header(None),
    caller_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    if x_user_role != "ADMIN" and caller_id != str(user_id):
        raise HTTPException(status_code=403, detail="Forbidden")

    result = await db.execute(select(Exhibitor).where(Exhibitor.user_id == user_id))
    exhibitor = result.scalar_one_or_none()

    if not exhibitor:
        return {"exhibitor": None, "entries": []}

    entries_result = await db.execute(
        select(Entry)
        .where(Entry.exhibitor_id == exhibitor.id)
        .options(
            selectinload(Entry.class_).selectinload(Class.show).selectinload(Show.venue_rel),
            selectinload(Entry.horse),
            selectinload(Entry.results),
        )
    )
    entries = entries_result.scalars().all()

    output = []
    for entry in entries:
        class_ = entry.class_
        show = class_.show if class_ else None
        horse = entry.horse
        # A class can now be placed by several judges (migration 095), so this
        # entry may hold one card per judge. The dashboard shows a single number
        # per class, so report the best of them — identical to the old value on
        # the single-judge shows this screen was built for.
        result_row = best_placing(entry.results)

        output.append({
            "entry_id": str(entry.id),
            "back_number": entry.back_number,
            "status": entry.status,
            "is_disqualified": entry.is_disqualified,
            "entry_created_at": entry.created_at.isoformat() if entry.created_at else None,
            "show_name": show.name if show else None,
            "show_id": str(show.id) if show else None,
            "show_status": show.status if show else None,
            "show_start_date": str(show.start_date) if show else None,
            "show_end_date": str(show.end_date) if show else None,
            "show_venue": show.venue_rel.name if show and show.venue_rel else None,
            "class_number": class_.class_number if class_ else None,
            "class_name": class_.class_name if class_ else None,
            "class_id": str(class_.id) if class_ else None,
            "class_date": str(class_.class_date) if class_ else None,
            "horse_name": horse.name if horse else None,
            "place": result_row.place if result_row else None,
            "is_tie": result_row.is_tie if result_row else False,
            # What to say when no card placed the entry (migration 121). A blank
            # where a placing should be reads as "not judged yet"; "No score" is
            # what actually happened.
            "outcome": reported_outcome(entry.results),
        })

    return {
        "exhibitor": {"id": str(exhibitor.id), "full_name": exhibitor.full_name},
        "entries": sorted(output, key=lambda x: x["class_date"] or "", reverse=True),
    }
