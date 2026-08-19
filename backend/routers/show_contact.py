"""Contacting a show, and the inbox where that lands.

The submit endpoint is the one place in the app a person with **no account**
writes to the database, so it is deliberately narrow:

- it takes a message about one show and nothing else;
- it accepts nothing in the *body* that names a user, an exhibitor, or an
  entry — everything the sender types is self-reported text, stored as text,
  never matched to an account;
- it refuses shows that are not publicly visible, so a DRAFT show nobody can
  see cannot be used as an anonymous drop box.

Since migration 103 it also serves the exhibitor who *is* entered. When the
caller has a session, the backend stamps `sender_user_id` /
`sender_exhibitor_id` from that session — never from the body — and the inbox
can then say "back number 42" beside the message. This does not narrow who may
write: a stranger asking about stalls is still the case the endpoint was built
for, and an anonymous message is a NULL stamp, not a rejection. It only stops
the secretary having to guess whether the name in the text is a real entrant.

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
from models import Exhibitor, Show, ShowContactMessage, ShowEntry
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
    # Identity, when the app has it. `sender_exhibitor_id` is the fact;
    # `sender_back_number` is the thing staff are actually looking for, and is
    # resolved here rather than left to the screen so the inbox and the desk
    # cannot disagree about who somebody is.
    sender_exhibitor_id: Optional[UUID] = None
    sender_back_number: Optional[int] = None
    sender_is_registered: bool = False
    handled_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ShowContactStatusBody(BaseModel):
    status: Literal["new", "read", "archived"]


async def _resolve_sender(
    x_user_id: Optional[str], db: AsyncSession
) -> tuple[Optional[UUID], Optional[UUID]]:
    """(user_id, exhibitor_id) for a signed-in sender, or (None, None).

    Read off the session header, never off the body. A caller able to name the
    exhibitor they were sending "as" could attach their question to somebody
    else's back number, which is worse than the anonymous message this replaces.

    A signed-in user with no exhibitor record — show staff, a trainer — still
    gets their user id stamped. They are a known person even though they have
    no entries.
    """
    user_id = safe_uuid(x_user_id) if x_user_id else None
    if user_id is None:
        return None, None
    result = await db.execute(select(Exhibitor).where(Exhibitor.user_id == user_id))
    exhibitor = result.scalar_one_or_none()
    return user_id, (exhibitor.id if exhibitor else None)


async def _back_numbers_for_senders(
    show_id: UUID, exhibitor_ids: set[UUID], db: AsyncSession
) -> dict[UUID, Optional[int]]:
    """Back number per sender at *this* show, for the inbox.

    Scoped to the show being read, because a back number is a per-show fact —
    the same exhibitor is 42 here and 7 next weekend. Absent from the dict means
    no `show_entries` row: they are signed in, but not entered here.
    """
    if not exhibitor_ids:
        return {}
    result = await db.execute(
        select(ShowEntry.exhibitor_id, ShowEntry.back_number).where(
            ShowEntry.show_id == show_id,
            ShowEntry.exhibitor_id.in_(exhibitor_ids),
        )
    )
    return {row.exhibitor_id: row.back_number for row in result.all()}


def _serialize_message(
    message: ShowContactMessage, back_numbers: dict[UUID, Optional[int]]
) -> dict:
    registered = (
        message.sender_exhibitor_id is not None
        and message.sender_exhibitor_id in back_numbers
    )
    return {
        "id": message.id,
        "show_id": message.show_id,
        "sender_name": message.sender_name,
        "sender_email": message.sender_email,
        "sender_phone": message.sender_phone,
        "subject": message.subject,
        "message": message.message,
        "status": message.status,
        "sender_exhibitor_id": message.sender_exhibitor_id,
        "sender_back_number": (
            back_numbers.get(message.sender_exhibitor_id) if registered else None
        ),
        "sender_is_registered": registered,
        "handled_at": message.handled_at,
        "created_at": message.created_at,
    }


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
    x_user_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """No session required. That is the whole point — the sender may have no
    account. The internal API key still gates the backend, so only the app's
    own route handler can reach it.

    A session, when there is one, is stamped onto the row rather than gating
    it: an entered exhibitor and a stranger ask the show office questions
    through the same door, and the difference belongs in what the office sees,
    not in who is allowed to knock.

    Rate limited because it is an unauthenticated write: without a cap, the one
    endpoint strangers can POST to is also the one that fills a table.
    """
    await _get_public_show_or_404(show_id, db)

    sender_user_id, sender_exhibitor_id = await _resolve_sender(x_user_id, db)

    message = ShowContactMessage(
        show_id=show_id,
        sender_name=body.sender_name.strip(),
        sender_email=str(body.sender_email).strip().lower(),
        sender_phone=(body.sender_phone or "").strip() or None,
        subject=(body.subject or "").strip() or None,
        message=body.message.strip(),
        sender_user_id=sender_user_id,
        sender_exhibitor_id=sender_exhibitor_id,
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
    messages = list(result.scalars().all())

    # One lookup for the whole page rather than one per message.
    back_numbers = await _back_numbers_for_senders(
        show_id,
        {m.sender_exhibitor_id for m in messages if m.sender_exhibitor_id is not None},
        db,
    )
    return [_serialize_message(m, back_numbers) for m in messages]


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
    back_numbers = await _back_numbers_for_senders(
        show_id,
        {message.sender_exhibitor_id} if message.sender_exhibitor_id else set(),
        db,
    )
    return _serialize_message(message, back_numbers)
