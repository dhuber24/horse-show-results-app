from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from uuid import UUID

from database import get_db
from models import Rider, Entry, Class, Show, Horse, Result

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/rider/{user_id}")
async def get_rider_dashboard(user_id: UUID, db: AsyncSession = Depends(get_db)):
    # Find rider linked to this user
    result = await db.execute(select(Rider).where(Rider.user_id == user_id))
    rider = result.scalar_one_or_none()

    if not rider:
        return {"rider": None, "entries": []}

    # Get all entries for this rider
    entries_result = await db.execute(
        select(Entry).where(Entry.rider_id == rider.id)
    )
    entries = entries_result.scalars().all()

    output = []
    for entry in entries:
        class_ = await db.get(Class, entry.class_id)
        show = await db.get(Show, class_.show_id) if class_ else None
        horse = await db.get(Horse, entry.horse_id)

        result_row = await db.execute(
            select(Result).where(Result.entry_id == entry.id)
        )
        result = result_row.scalar_one_or_none()

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
            "place": result.place if result else None,
            "is_tie": result.is_tie if result else False,
        })

    return {
        "rider": {"id": str(rider.id), "full_name": rider.full_name},
        "entries": sorted(output, key=lambda x: x["class_date"] or "", reverse=True),
    }
