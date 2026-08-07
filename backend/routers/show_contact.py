"""Contacting a show, and the inbox where that lands.

The submit endpoint is the one place in the app a person with **no account**
writes to the database, so it is deliberately narrow:

- it takes a message about one show and nothing else;
- it accepts nothing that names a user, an exhibitor, or an entry — the body is
  self-reported contact text, stored as text, never matched to an account;
- it refuses shows that are not publicly visible, so a DRAFT show nobody can
  see cannot be used as an anonymous drop box.

Messages are stored, not forwarded. `mailer.py` is best-effort and does nothing
without SMTP configured, so a forward-only contact form would accept a message,
tell the visitor it was sent, and lose it. Staff read these on the show's
Messages screen; a notification on top is additive and would not change this.
"""
# No `from __future__ import annotations` here on purpose: slowapi's @limit
# decorator re-wraps the endpoint, and with postponed annotations FastAPI can
# no longer resolve `UUID` on the rewrapped signature (PydanticUserError at
# request time, not import time). auth.py omits it for the same reason.
from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import require_admin_or_show_admin, require_api_key, safe_uuid
from models import Show, ShowContactMessage
from routers.shows import _assert_show_access

router = APIRouter(prefix="/shows/{show_id}/contact", tags=["Show Contact"])

limiter = Limiter(key_func=get_remote_address)

# A show has to be publicly visible before strangers can write to it about it.
PUBLIC_SHOW_STATUSES = ("PUBLISHED", "ACTIVE", "COMPLETED")


class ShowContactCreate(BaseModel):
    sender_name: str = Field(min_length=1, max_length=120)
    sender_email: EmailStr
    sender_phone: Optional[str] = Field(default=None, max_length=40)
    subject: Optional[str] = Field(default=None, max_length=150)
    # Bounded so the form cannot be used to push arbitrary volume into the
    # table. Long enough for a real question about stalls or class eligibility.
    message: str = Field(min_length=1, max_length=4000)


class ShowContactMessageOut(BaseModel):
    id: UUID
    show_id: UUID
    sender_name: str
    sender_email: str
    sender_phone: Optional[str] = None
    subject: Optional[str] = None
    message: str
    status: str
    handled_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ShowContactStatusBody(BaseModel):
    status: Literal["new", "read", "archived"]


async def _get_public_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show or show.status not in PUBLIC_SHOW_STATUSES:
        # Same answer for "no such show" and "not published": a stranger
        # probing ids should not learn which drafts exist.
        raise HTTPException(404, "Show not found")
    return show


@router.post("/", status_code=201, dependencies=[Depends(require_api_key)])
@limiter.limit("5/minute")
async def send_contact_message(
    request: Request,
    show_id: UUID,
    body: ShowContactCreate,
    db: AsyncSession = Depends(get_db),
):
    """Public: no session required. This is the whole point — the sender has no
    account yet. The internal API key still gates the backend, so only the app's
    own route handler can reach it.

    Rate limited because it is an unauthenticated write: without a cap, the one
    endpoint strangers can POST to is also the one that fills a table.
    """
    await _get_public_show_or_404(show_id, db)

    message = ShowContactMessage(
        show_id=show_id,
        sender_name=body.sender_name.strip(),
        sender_email=str(body.sender_email).strip().lower(),
        sender_phone=(body.sender_phone or "").strip() or None,
        subject=(body.subject or "").strip() or None,
        message=body.message.strip(),
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    return {"id": str(message.id), "created_at": message.created_at}


@router.get(
    "/messages",
    response_model=list[ShowContactMessageOut],
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def list_contact_messages(
    show_id: UUID,
    status: Optional[str] = None,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The show's inbox. Scoped to staff with access to this show, so one
    show's secretary cannot read another show's mail."""
    if not await db.get(Show, show_id):
        raise HTTPException(404, "Show not found")
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)

    query = select(ShowContactMessage).where(ShowContactMessage.show_id == show_id)
    if status:
        query = query.where(ShowContactMessage.status == status)
    result = await db.execute(query.order_by(ShowContactMessage.created_at.desc()))
    return result.scalars().all()


@router.get("/messages/unread-count", dependencies=[Depends(require_admin_or_show_admin)])
async def unread_contact_count(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Just the badge number, so the show dashboard doesn't pull every message
    body to render a count."""
    if not await db.get(Show, show_id):
        raise HTTPException(404, "Show not found")
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)

    result = await db.execute(
        select(func.count())
        .select_from(ShowContactMessage)
        .where(ShowContactMessage.show_id == show_id, ShowContactMessage.status == "new")
    )
    return {"unread": result.scalar_one()}


@router.patch(
    "/messages/{message_id}",
    response_model=ShowContactMessageOut,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def set_contact_message_status(
    show_id: UUID,
    message_id: UUID,
    body: ShowContactStatusBody,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Mark a message read or archived — or back to new, because 'I opened that
    by accident and still need to deal with it' is a real thing."""
    if not await db.get(Show, show_id):
        raise HTTPException(404, "Show not found")
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)

    message = await db.get(ShowContactMessage, message_id)
    if not message or message.show_id != show_id:
        raise HTTPException(404, "Message not found")

    message.status = body.status
    if body.status == "new":
        message.handled_by_user_id = None
        message.handled_at = None
    else:
        message.handled_by_user_id = safe_uuid(x_user_id)
        message.handled_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(message)
    return message
