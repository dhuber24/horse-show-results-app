from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from uuid import UUID

from database import get_db
from models import Exhibitor, Entry, Class, Show, Horse, Result

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/exhibitor/{user_id}")
async def get_exhibitor_dashboard(user_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Exhibitor).where(Exhibitor.user_id == user_id))
    exhibitor = result.scalar_one_or_none()

    if not exhibitor:
        return {"exhibitor": None, "entries": []}

    entries_result = await db.execute(
        select(Entry)
        .where(Entry.exhibitor_id == exhibitor.id)
        .options(
            selectinload(Entry.class_).selectinload(Class.show),
            selectinload(Entry.horse),
            selectinload(Entry.result),
        )
    )
    entries = entries_result.scalars().all()

    output = []
    for entry in entries:
        class_ = entry.class_
        show = class_.show if class_ else None
        horse = entry.horse
        result_row = entry.result

        output.append({
            "entry_id": str(entry.id),
            "back_number": entry.back_number,
            "status": entry.status,
            "show_name": show.name if show else None,
            "show_id": str(show.id) if show else None,
            "class_number": class_.class_number if class_ else None,
            "class_name": class_.class_name if class_ else None,
            "class_id": str(class_.id) if class_ else None,
            "class_date": str(class_.class_date) if class_ else None,
            "horse_name": horse.name if horse else None,
            "place": result_row.place if result_row else None,
            "is_tie": result_row.is_tie if result_row else False,
        })

    return {
        "exhibitor": {"id": str(exhibitor.id), "full_name": exhibitor.full_name},
        "entries": sorted(output, key=lambda x: x["class_date"] or "", reverse=True),
    }
