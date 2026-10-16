"""Contacting GaitDesk itself, and the admins' inbox where that lands.

`routers/show_contact.py` is the door to one show's office. This is the door to
GaitDesk: a club thinking about running its shows here, somebody who cannot get
into their account, a problem to report. It follows the show inbox's rules, for
the same reasons:

- **No session required.** The sender may have no account -- a club that has
  not signed up yet is exactly who this is for. The internal API key still
  gates the backend, so only the app's own route handler reaches it.
- **Stored first, then emailed to every admin.** `mailer.py` does nothing
  without SMTP, so a form that only sent mail could say "sent" and lose the
  message. The row is what `/admin/contact-messages` reads and what the admin
  home counts; then every ADMIN account that is not locked
  (`show_companies.admin_emails`) is sent its own copy after the response,
  one at a time with a retry (`show_companies.email_admins`), with Reply-To
  set to the sender so Reply answers them.
- **Self-reported, except the session.** Everything typed is text and is
  stored as text. `sender_user_id` is written from the session header, never
  from the body, so "signed in as" is the one thing the inbox can believe.
- **Rate limited**, because it is an unauthenticated write. The limit is
  per endpoint rather than per sender (see the note in `routers/auth.py`), so
  it bounds how fast the table fills rather than isolating one sender.

A filled-in `website` field is a form-filling bot: it is a field no person can
see, so it is answered as if the message went through and nothing is stored or
mailed. Telling a bot it failed only teaches it to try again.
"""
# No `from __future__ import annotations` here on purpose: slowapi's @limit
# decorator re-wraps the endpoint, and with postponed annotations FastAPI can no
# longer resolve `UUID` on the rewrapped signature. See show_contact.py.
from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr, Field, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from dependencies import require_admin, require_api_key, safe_uuid
from mailer import public_app_url
from models import GaitDeskContactMessage, User
from show_companies import admin_emails, email_admins

router = APIRouter(prefix="/gaitdesk-contact", tags=["GaitDesk Contact"])

limiter = Limiter(key_func=get_remote_address)

# What a message is about, in the words the form shows, in the order it shows
# them. The keys are stored; a new topic is a line here, not a migration. The
# form reads this list from `GET /gaitdesk-contact/topics` rather than keeping
# a copy, so the two cannot drift.
TOPICS: dict[str, str] = {
    "running_shows": "Running our shows on GaitDesk",
    "pricing": "Pricing and paid features",
    "account": "My account or signing in",
    "problem": "Reporting a problem",
    "feedback": "Ideas and feedback",
    "other": "Something else",
}


class GaitDeskContactCreate(BaseModel):
    topic: str
    sender_name: str = Field(min_length=1, max_length=120)
    sender_email: EmailStr
    sender_phone: Optional[str] = Field(default=None, max_length=40)
    organization: Optional[str] = Field(default=None, max_length=150)
    subject: Optional[str] = Field(default=None, max_length=150)
    # Bounded so the form cannot push arbitrary volume into the table.
    message: str = Field(min_length=1, max_length=4000)
    # The honeypot. Hidden from people by the form; see the module docstring.
    website: Optional[str] = Field(default=None, max_length=500)

    @field_validator("topic")
    @classmethod
    def _known_topic(cls, value: str) -> str:
        if value not in TOPICS:
            raise ValueError("Choose what your message is about.")
        return value


class SenderAccountOut(BaseModel):
    """The account the message was sent from, read off the session's user --
    not anything the sender typed."""
    id: UUID
    name: str
    email: str
    role: str


class GaitDeskContactMessageOut(BaseModel):
    id: UUID
    topic: str
    topic_label: str
    sender_name: str
    sender_email: str
    sender_phone: Optional[str] = None
    organization: Optional[str] = None
    subject: Optional[str] = None
    message: str
    status: str
    sender_account: Optional[SenderAccountOut] = None
    handled_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class GaitDeskContactStatusBody(BaseModel):
    status: Literal["new", "read", "archived"]


def topic_label(topic: str) -> str:
    # A key since retired from TOPICS still reads as something.
    return TOPICS.get(topic, topic.replace("_", " ").capitalize())


def is_bot(body: GaitDeskContactCreate) -> bool:
    return bool((body.website or "").strip())


def _one_line(value: str) -> str:
    """Text safe for an email header: whatever the sender typed, on one line."""
    return " ".join(value.split())


def notification_email(message: GaitDeskContactMessage, sender: Optional[User]) -> tuple[str, str]:
    """The courtesy email to each admin. The subject carries the topic and the
    sender's name, so an inbox shows what it is before it is opened; both are
    folded onto one line, since a newline in a header is either an error or an
    injected header."""
    subject = _one_line(f"GaitDesk contact: {topic_label(message.topic)} — {message.sender_name}")
    lines = [
        f"{message.sender_name} sent GaitDesk a message from the contact form.",
        "",
        f"Topic: {topic_label(message.topic)}",
        f"Email: {message.sender_email}",
    ]
    if message.sender_phone:
        lines.append(f"Phone: {message.sender_phone}")
    if message.organization:
        lines.append(f"Club or company: {message.organization}")
    lines.append(
        f"Signed in as: {sender.full_name} ({sender.email}, {sender.role})"
        if sender
        else "Not signed in."
    )
    if message.subject:
        lines += ["", f"Subject: {message.subject}"]
    lines += [
        "",
        message.message,
        "",
        f"Replying to this email goes to {message.sender_email}. Every admin gets",
        "their own copy, and every message is also kept at",
        f"{public_app_url()}/admin/contact-messages",
    ]
    return subject, "\n".join(lines)


def _serialize(message: GaitDeskContactMessage) -> dict:
    sender = message.sender_user
    return {
        "id": message.id,
        "topic": message.topic,
        "topic_label": topic_label(message.topic),
        "sender_name": message.sender_name,
        "sender_email": message.sender_email,
        "sender_phone": message.sender_phone,
        "organization": message.organization,
        "subject": message.subject,
        "message": message.message,
        "status": message.status,
        "sender_account": (
            {"id": sender.id, "name": sender.full_name or "", "email": sender.email, "role": sender.role}
            if sender
            else None
        ),
        "handled_at": message.handled_at,
        "created_at": message.created_at,
    }


@router.get("/topics", dependencies=[Depends(require_api_key)])
async def list_topics():
    """The form's topic list, in order. No session: the form is public."""
    return [{"key": key, "label": label} for key, label in TOPICS.items()]


@router.post("/", status_code=201, dependencies=[Depends(require_api_key)])
@limiter.limit("5/minute")
async def send_gaitdesk_message(
    request: Request,
    body: GaitDeskContactCreate,
    background: BackgroundTasks,
    x_user_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """No session required -- the sender may have no account. A session, when
    there is one, is stamped onto the row rather than gating it."""
    if is_bot(body):
        return {"id": None, "created_at": None}

    sender = None
    user_id = safe_uuid(x_user_id) if x_user_id else None
    if user_id is not None:
        # Looked up rather than trusted: an account deleted since the session
        # was issued would otherwise fail the foreign key and lose the message.
        sender = await db.get(User, user_id)

    message = GaitDeskContactMessage(
        topic=body.topic,
        sender_name=body.sender_name.strip(),
        sender_email=str(body.sender_email).strip().lower(),
        sender_phone=(body.sender_phone or "").strip() or None,
        organization=(body.organization or "").strip() or None,
        subject=(body.subject or "").strip() or None,
        message=body.message.strip(),
        sender_user_id=sender.id if sender else None,
    )
    db.add(message)
    recipients = await admin_emails(db)
    await db.commit()
    await db.refresh(message)

    if recipients:
        subject, mail_body = notification_email(message, sender)
        # Reply-To is the sender, so an admin answers by pressing Reply rather
        # than copying an address out of the body. The address passed EmailStr.
        background.add_task(email_admins, recipients, subject, mail_body, message.sender_email)
    return {"id": str(message.id), "created_at": message.created_at}


@router.get(
    "/messages",
    response_model=list[GaitDeskContactMessageOut],
    dependencies=[Depends(require_admin)],
)
async def list_gaitdesk_messages(
    status: Optional[str] = None,
    # Newest first, so the cap only ever drops the oldest.
    limit: int = Query(default=500, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
):
    query = select(GaitDeskContactMessage).options(selectinload(GaitDeskContactMessage.sender_user))
    if status:
        query = query.where(GaitDeskContactMessage.status == status)
    result = await db.execute(query.order_by(GaitDeskContactMessage.created_at.desc()).limit(limit))
    return [_serialize(m) for m in result.scalars().all()]


@router.get("/messages/unread-count", dependencies=[Depends(require_admin)])
async def unread_gaitdesk_count(db: AsyncSession = Depends(get_db)):
    """Just the number, for the tile on the admin home."""
    result = await db.execute(
        select(func.count())
        .select_from(GaitDeskContactMessage)
        .where(GaitDeskContactMessage.status == "new")
    )
    return {"unread": result.scalar_one()}


@router.patch(
    "/messages/{message_id}",
    response_model=GaitDeskContactMessageOut,
    dependencies=[Depends(require_admin)],
)
async def set_gaitdesk_message_status(
    message_id: UUID,
    body: GaitDeskContactStatusBody,
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Mark a message read or archived -- or back to new, for one opened by
    accident that still needs dealing with."""
    message = await db.get(GaitDeskContactMessage, message_id)
    if not message:
        raise HTTPException(404, "Message not found")

    message.status = body.status
    if body.status == "new":
        message.handled_by_user_id = None
        message.handled_at = None
    else:
        message.handled_by_user_id = safe_uuid(x_user_id)
        message.handled_at = datetime.now(timezone.utc)
    await db.commit()

    # Re-read with the sender loaded: the row is already in the session, so
    # `db.get(..., options=...)` would drop the option (Claude.md conventions).
    result = await db.execute(
        select(GaitDeskContactMessage)
        .options(selectinload(GaitDeskContactMessage.sender_user))
        .where(GaitDeskContactMessage.id == message_id)
        .execution_options(populate_existing=True)
    )
    return _serialize(result.scalar_one())
