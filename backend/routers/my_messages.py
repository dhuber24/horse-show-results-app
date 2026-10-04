"""Every show's inbox at once, for the people who work them.

A show's inbox (`routers/show_contact.py`) is read one show at a time, which is
right on that show's pages and wrong everywhere else: somebody running three
shows had to open each one to learn whether anybody had written. This is the
same messages, across every show the caller works, so the envelope in the top
bar can carry a count on every office page and open one list.

**Read-only, and scoped exactly as the per-show inbox is.** The shows are the
ones `show_access.py` says the caller works -- a per-show row or membership of
the company that runs the show -- or every show for an ADMIN. Marking a message
read or archived still goes through the per-show endpoint, with the show the
message belongs to, so there is one writer and one access check for it.
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backnumbers import back_numbers_for_show
from database import get_db
from dependencies import require_admin_or_show_admin, safe_uuid
from models import Show, ShowContactMessage, ShowEntry
from routers.show_contact import ShowContactMessageOut, _serialize_message
from show_access import worked_show_ids

router = APIRouter(prefix="/my-messages", tags=["Show Contact"])


class MyContactMessageOut(ShowContactMessageOut):
    # Which show it was sent to -- the list mixes shows, and the answer to a
    # question about stalls depends on which weekend it was about.
    show_name: str


def _scoped(query, user_id: Optional[UUID], role: str):
    """Only the shows this caller works. ADMIN works every show."""
    if role == "ADMIN":
        return query
    return query.where(ShowContactMessage.show_id.in_(worked_show_ids(user_id, role)))


@router.get(
    "",
    response_model=list[MyContactMessageOut],
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def list_my_messages(
    status: Optional[str] = None,
    # Bounded because an ADMIN reads every show's mail. Newest first, so the
    # cap only ever drops the oldest, which the per-show inbox still has.
    limit: int = Query(default=500, ge=1, le=2000),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Messages to every show the caller works, newest first."""
    query = select(ShowContactMessage, Show.name).join(
        Show, Show.id == ShowContactMessage.show_id
    )
    query = _scoped(query, safe_uuid(x_user_id), x_user_role)
    if status:
        query = query.where(ShowContactMessage.status == status)
    result = await db.execute(
        query.order_by(ShowContactMessage.created_at.desc()).limit(limit)
    )
    rows = result.all()

    # Back numbers are per show -- the same exhibitor is 42 here and 7 next
    # weekend -- so one read for the whole page, keyed by (show, exhibitor).
    senders = {
        m.sender_exhibitor_id for m, _name in rows if m.sender_exhibitor_id is not None
    }
    by_show: dict[UUID, dict[UUID, Optional[int]]] = {}
    if senders:
        entries = await db.execute(
            select(ShowEntry.show_id, ShowEntry.exhibitor_id).where(
                ShowEntry.exhibitor_id.in_(senders),
                ShowEntry.show_id.in_({m.show_id for m, _name in rows}),
            )
        )
        # Read through `backnumbers` so a show that numbers horses (migration
        # 161) reports the lowest number the sender wears there.
        numbers_by_show = {}
        for show_id, exhibitor_id in entries.all():
            if show_id not in numbers_by_show:
                numbers_by_show[show_id] = await back_numbers_for_show(show_id, db)
            by_show.setdefault(show_id, {})[exhibitor_id] = (
                numbers_by_show[show_id].first_for_exhibitor(exhibitor_id)
            )

    return [
        {**_serialize_message(m, by_show.get(m.show_id, {})), "show_name": name}
        for m, name in rows
    ]


@router.get("/unread-count", dependencies=[Depends(require_admin_or_show_admin)])
async def my_unread_count(
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The envelope's number away from a show: unread messages across every
    show the caller works."""
    query = (
        select(func.count())
        .select_from(ShowContactMessage)
        .where(ShowContactMessage.status == "new")
    )
    query = _scoped(query, safe_uuid(x_user_id), x_user_role)
    result = await db.execute(query)
    return {"unread": result.scalar_one()}
