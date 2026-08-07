"""Owner consent for a horse changing hands (migration 087).

Two flows, one table, one approve/decline path:

  kind='link'      An exhibitor wants a horse they don't own on their profile.
                   The owner approves. Approval writes the `exhibitor_horses`
                   link the old one-click endpoint used to write outright.

  kind='transfer'  The owner is handing ownership to someone else. The
                   recipient accepts. Acceptance moves `owner_exhibitor_id`
                   and puts the horse on the recipient's profile.

`approver_exhibitor_id` is always "whoever must press the button", which is why
both flows share `respond_to_request` below.

Authorization on the approve page is the token, matching `user_invites`: it is
emailed to the approver and also handed to the requester for copy/paste,
because SMTP is optional here (see `mailer.py`) and an undelivered email must
not be the reason a sale can't be recorded. The token is single-use with a
short TTL, and it grants exactly one decision about one horse.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from dependencies import require_api_key, require_authenticated, safe_uuid
from mailer import public_app_url, send_email
from models import Exhibitor, ExhibitorHorse, Horse, HorseAccessRequest, User

router = APIRouter(prefix="/horse-access-requests", tags=["Horse Access Requests"])

REQUEST_TTL_DAYS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _generate_token() -> str:
    # 32 url-safe chars (~192 bits). The token IS the authorization, so it is
    # sized to be unguessable; the short TTL and single use bound the exposure.
    return secrets.token_urlsafe(32)


def approval_url(token: str) -> str:
    return f"{public_app_url()}/horse-requests/{token}"


async def _caller_exhibitor(user_id: str, db: AsyncSession) -> Exhibitor:
    result = await db.execute(
        select(Exhibitor).where(Exhibitor.user_id == safe_uuid(user_id))
    )
    exhibitor = result.scalar_one_or_none()
    if not exhibitor:
        raise HTTPException(403, "Only exhibitors can manage horse access requests")
    return exhibitor


async def _exhibitor_email(exhibitor: Exhibitor, db: AsyncSession) -> Optional[str]:
    if not exhibitor.user_id:
        return None
    user = await db.get(User, exhibitor.user_id)
    return user.email if user else None


def _expire_if_stale(request: HorseAccessRequest) -> None:
    """Lazily age out pending requests. Nothing sweeps the table on a timer, so
    a request only becomes 'expired' the next time somebody looks at it."""
    if request.status == "pending" and request.expires_at < _now():
        request.status = "expired"


# ── Request / response schemas ────────────────────────────────────────────────

class HorseAccessRequestCreate(BaseModel):
    horse_id: UUID
    kind: Literal["link", "transfer"]
    # Transfer only: who is receiving the horse. Must be an exhibitor with a
    # linked user account — you cannot hand a horse to somebody who can't sign in.
    to_exhibitor_id: Optional[UUID] = None
    message: Optional[str] = Field(default=None, max_length=500)


class HorseAccessRequestOut(BaseModel):
    id: UUID
    kind: str
    status: str
    horse_id: UUID
    horse_name: str
    requested_by_name: str
    approver_name: str
    approver_email: Optional[str] = None
    message: Optional[str] = None
    email_sent: Optional[bool] = None
    expires_at: datetime
    responded_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    # Direction relative to the caller, so the UI doesn't recompute it.
    is_mine_to_approve: bool = False
    # Only populated for requests the caller *sent*: they were handed this link
    # at create time to pass along, and closing that page shouldn't lose it.
    # Never included for requests waiting on the caller — the token is the
    # approver's own, and they hold it via email.
    approval_url: Optional[str] = None

    class Config:
        from_attributes = True


class HorseAccessRequestCreateResult(HorseAccessRequestOut):
    approval_url: str


class HorseAccessRequestByToken(BaseModel):
    kind: str
    status: str
    horse_name: str
    requested_by_name: str
    approver_name: str
    message: Optional[str] = None
    expires_at: datetime


class HorseAccessRespondBody(BaseModel):
    action: Literal["approve", "decline"]


def _out(request: HorseAccessRequest, caller_exhibitor_id: UUID | None = None) -> dict:
    is_requester = (
        caller_exhibitor_id is not None
        and request.requester_exhibitor_id == caller_exhibitor_id
    )
    return {
        "approval_url": (
            approval_url(request.token)
            if is_requester and request.status == "pending"
            else None
        ),
        "id": request.id,
        "kind": request.kind,
        "status": request.status,
        "horse_id": request.horse_id,
        "horse_name": request.horse_name,
        "requested_by_name": request.requested_by_name,
        "approver_name": request.approver_name,
        "approver_email": request.approver_email,
        "message": request.message,
        "email_sent": request.email_sent,
        "expires_at": request.expires_at,
        "responded_at": request.responded_at,
        "created_at": request.created_at,
        "is_mine_to_approve": (
            caller_exhibitor_id is not None
            and request.approver_exhibitor_id == caller_exhibitor_id
        ),
    }


# ── Notification copy ─────────────────────────────────────────────────────────

def _email_body(request: HorseAccessRequest) -> tuple[str, str]:
    url = approval_url(request.token)
    note = f"\n\nThey added a note:\n{request.message}\n" if request.message else "\n"
    if request.kind == "link":
        subject = f"{request.requested_by_name} wants to add {request.horse_name} to their profile"
        body = (
            f"Hi {request.approver_name},\n\n"
            f"{request.requested_by_name} has asked to add your horse "
            f"{request.horse_name} to their exhibitor profile, so they can enter "
            f"it in shows.{note}\n"
            f"Approve or decline here:\n{url}\n\n"
            f"Nothing changes unless you approve. This link expires in "
            f"{REQUEST_TTL_DAYS} days.\n"
        )
    else:
        subject = f"{request.requested_by_name} is transferring {request.horse_name} to you"
        body = (
            f"Hi {request.approver_name},\n\n"
            f"{request.requested_by_name} would like to transfer ownership of "
            f"{request.horse_name} to you. Accepting makes you the owner of "
            f"record and puts the horse on your profile.{note}\n"
            f"Accept or decline here:\n{url}\n\n"
            f"Nothing changes unless you accept. This link expires in "
            f"{REQUEST_TTL_DAYS} days.\n"
        )
    return subject, body


# ── Opening a request ─────────────────────────────────────────────────────────

async def build_access_request(
    kind: str,
    horse: Horse,
    requester: Exhibitor,
    approver: Exhibitor,
    db: AsyncSession,
    message: Optional[str] = None,
) -> HorseAccessRequest:
    """Stage a pending request. Added to the session but neither flushed nor
    committed, so the unique-pending-per-horse constraint surfaces on the
    caller's commit where it can be turned into a 409 — and so a caller
    creating the horse in the same transaction gets both rows or neither.

    Shared with `people.create_horse_for_exhibitor`, which reaches this when a
    rider files a horse against an owner who already has an account: the record
    is new, but putting it on the rider's profile is the same question this
    table exists to ask.
    """
    request = HorseAccessRequest(
        token=_generate_token(),
        kind=kind,
        horse_id=horse.id,
        horse_name=horse.name,
        requester_exhibitor_id=requester.id,
        requested_by_name=requester.full_name,
        approver_exhibitor_id=approver.id,
        approver_name=approver.full_name,
        approver_email=await _exhibitor_email(approver, db),
        message=message,
        expires_at=_now() + timedelta(days=REQUEST_TTL_DAYS),
    )
    db.add(request)
    return request


async def notify_request(request: HorseAccessRequest, db: AsyncSession) -> None:
    """Mail the approver and record whether it went out. Commits.

    Called only after the request itself is committed: the request exists
    whether or not the mail does, and every caller hands the approval link back
    for copy/paste, so an unset SMTP_HOST is never the reason a horse can't
    change hands.
    """
    subject, mail_body = _email_body(request)
    request.email_sent = await send_email(request.approver_email, subject, mail_body)
    await db.commit()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/", response_model=HorseAccessRequestCreateResult, status_code=201)
async def create_request(
    body: HorseAccessRequestCreate,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    requester = await _caller_exhibitor(user_id, db)
    horse = await db.get(Horse, body.horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")

    if body.kind == "link":
        if horse.owner_exhibitor_id is None:
            raise HTTPException(
                400,
                "This horse has no owner on the platform, so there is nobody to "
                "approve the request. Add it to your profile directly.",
            )
        if horse.owner_exhibitor_id == requester.id:
            raise HTTPException(400, "You already own this horse")
        approver = await db.get(Exhibitor, horse.owner_exhibitor_id)
    else:
        if horse.owner_exhibitor_id != requester.id:
            raise HTTPException(403, "Only the current owner can transfer this horse")
        if body.to_exhibitor_id is None:
            raise HTTPException(400, "to_exhibitor_id is required for a transfer")
        if body.to_exhibitor_id == requester.id:
            raise HTTPException(400, "You already own this horse")
        approver = await db.get(Exhibitor, body.to_exhibitor_id)
        if approver and approver.user_id is None:
            raise HTTPException(
                400,
                "You can only transfer a horse to someone with an account on the "
                "platform — they have to be able to accept it.",
            )

    if not approver:
        raise HTTPException(404, "The person who needs to approve this was not found")

    request = await build_access_request(
        body.kind, horse, requester, approver, db, message=body.message
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            409,
            "There is already a pending request for this horse. Wait for a "
            "response, or cancel it first.",
        )
    await db.refresh(request)

    await notify_request(request, db)
    await db.refresh(request)

    return {**_out(request, requester.id), "approval_url": approval_url(request.token)}


@router.get("/", response_model=list[HorseAccessRequestOut])
async def list_my_requests(
    status: Optional[str] = None,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Every request the caller is a party to, in either direction.

    `is_mine_to_approve` on each row tells the UI which list it belongs in.
    """
    exhibitor = await _caller_exhibitor(user_id, db)
    query = (
        select(HorseAccessRequest)
        .where(
            or_(
                HorseAccessRequest.requester_exhibitor_id == exhibitor.id,
                HorseAccessRequest.approver_exhibitor_id == exhibitor.id,
            )
        )
        .order_by(HorseAccessRequest.created_at.desc())
    )
    if status:
        query = query.where(HorseAccessRequest.status == status)
    rows = list((await db.execute(query)).scalars().all())

    changed = False
    for row in rows:
        before = row.status
        _expire_if_stale(row)
        changed = changed or row.status != before
    if changed:
        await db.commit()

    return [_out(row, exhibitor.id) for row in rows]


@router.get("/for-horse/{horse_id}", response_model=list[HorseAccessRequestOut])
async def list_requests_for_horse(
    horse_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Pending requests about one horse, for the horse detail screen. Scoped to
    requests the caller is a party to — this is not a window into other
    people's negotiations over the same horse."""
    exhibitor = await _caller_exhibitor(user_id, db)
    result = await db.execute(
        select(HorseAccessRequest)
        .where(
            HorseAccessRequest.horse_id == horse_id,
            HorseAccessRequest.status == "pending",
            or_(
                HorseAccessRequest.requester_exhibitor_id == exhibitor.id,
                HorseAccessRequest.approver_exhibitor_id == exhibitor.id,
            ),
        )
        .order_by(HorseAccessRequest.created_at.desc())
    )
    return [_out(row, exhibitor.id) for row in result.scalars().all()]


@router.delete("/{request_id}", status_code=204)
async def cancel_request(
    request_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Withdraw a request you sent. The approver declines rather than cancels —
    both end the request, but the distinction is worth keeping in the history."""
    exhibitor = await _caller_exhibitor(user_id, db)
    request = await db.get(HorseAccessRequest, request_id)
    if not request:
        raise HTTPException(404, "Request not found")
    if request.requester_exhibitor_id != exhibitor.id:
        raise HTTPException(403, "You can only cancel requests you sent")
    if request.status != "pending":
        raise HTTPException(409, f"Request is already {request.status}")
    request.status = "cancelled"
    request.responded_at = _now()
    await db.commit()


@router.get(
    "/by-token/{token}",
    response_model=HorseAccessRequestByToken,
    dependencies=[Depends(require_api_key)],
)
async def get_request_by_token(token: str, db: AsyncSession = Depends(get_db)):
    """Render the decision page. Needs only the internal API key — the approver
    may not have signed in, and for a transfer they may not have visited the app
    before at all."""
    result = await db.execute(
        select(HorseAccessRequest).where(HorseAccessRequest.token == token)
    )
    request = result.scalar_one_or_none()
    if not request:
        raise HTTPException(404, "Request not found")
    before = request.status
    _expire_if_stale(request)
    if request.status != before:
        await db.commit()
    return {
        "kind": request.kind,
        "status": request.status,
        "horse_name": request.horse_name,
        "requested_by_name": request.requested_by_name,
        "approver_name": request.approver_name,
        "message": request.message,
        "expires_at": request.expires_at,
    }


def _by_token_out(request: HorseAccessRequest) -> dict:
    return {
        "kind": request.kind,
        "status": request.status,
        "horse_name": request.horse_name,
        "requested_by_name": request.requested_by_name,
        "approver_name": request.approver_name,
        "message": request.message,
        "expires_at": request.expires_at,
    }


async def _apply_decision(
    request: HorseAccessRequest, action: str, db: AsyncSession
) -> dict:
    """The one place a request is actually answered.

    Shared by the emailed-token path and the signed-in path so the two can't
    drift on what approval means. Commits.
    """
    if request.status != "pending":
        raise HTTPException(409, f"This request has already been {request.status}")
    if request.expires_at < _now():
        request.status = "expired"
        await db.commit()
        raise HTTPException(410, "This request has expired")

    if action == "decline":
        request.status = "declined"
        request.responded_at = _now()
        await db.commit()
        return _by_token_out(request)

    horse = request.horse
    if not horse:
        raise HTTPException(404, "The horse in this request no longer exists")

    if request.kind == "link":
        if request.requester_exhibitor_id is None:
            raise HTTPException(409, "The exhibitor who asked no longer has an account")
        await _ensure_profile_link(request.requester_exhibitor_id, horse.id, db)
    else:
        if request.approver_exhibitor_id is None:
            raise HTTPException(409, "The recipient no longer has an account")
        # The former owner keeps whatever profile access they already had — a
        # sale shouldn't erase the horse from the seller's record mid-show — but
        # they stop being the owner of record.
        horse.owner_exhibitor_id = request.approver_exhibitor_id
        await _ensure_profile_link(request.approver_exhibitor_id, horse.id, db)

    request.status = "approved"
    request.responded_at = _now()
    await db.commit()
    return _by_token_out(request)


@router.post(
    "/by-token/{token}/respond",
    response_model=HorseAccessRequestByToken,
    dependencies=[Depends(require_api_key)],
)
async def respond_to_request_by_token(
    token: str,
    body: HorseAccessRespondBody,
    db: AsyncSession = Depends(get_db),
):
    """Approve or decline from the emailed link. Single-use: the status guard
    makes a replayed link a 409 rather than a second transfer."""
    result = await db.execute(
        select(HorseAccessRequest)
        .options(selectinload(HorseAccessRequest.horse))
        .where(HorseAccessRequest.token == token)
    )
    request = result.scalar_one_or_none()
    if not request:
        raise HTTPException(404, "Request not found")
    return await _apply_decision(request, body.action, db)


@router.post("/{request_id}/respond", response_model=HorseAccessRequestByToken)
async def respond_to_request_signed_in(
    request_id: UUID,
    body: HorseAccessRespondBody,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Approve or decline from inside the app.

    Being signed in as the approver is at least as strong a claim as holding
    the emailed token, so the app doesn't make someone go hunting through their
    inbox for a decision it can already attribute to them.
    """
    exhibitor = await _caller_exhibitor(user_id, db)
    result = await db.execute(
        select(HorseAccessRequest)
        .options(selectinload(HorseAccessRequest.horse))
        .where(HorseAccessRequest.id == request_id)
    )
    request = result.scalar_one_or_none()
    if not request:
        raise HTTPException(404, "Request not found")
    if request.approver_exhibitor_id != exhibitor.id:
        raise HTTPException(403, "This request is not yours to answer")
    return await _apply_decision(request, body.action, db)


async def _ensure_profile_link(exhibitor_id: UUID, horse_id: UUID, db: AsyncSession) -> None:
    """Put the horse on an exhibitor's profile, tolerating one already being
    there — approving twice-over is not an error worth surfacing."""
    existing = await db.execute(
        select(ExhibitorHorse).where(
            ExhibitorHorse.exhibitor_id == exhibitor_id,
            ExhibitorHorse.horse_id == horse_id,
        )
    )
    if existing.scalar_one_or_none():
        return
    db.add(ExhibitorHorse(exhibitor_id=exhibitor_id, horse_id=horse_id))
