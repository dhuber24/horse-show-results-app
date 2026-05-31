"""User invitation tokens.

Replaces the inline-password "create scorekeeper" flow on the Show Staff page.
A manager/secretary submits first/last/email and gets back an invite URL they
can share with the prospective scorekeeper. The invitee opens the URL,
chooses a password, and lands as a SCOREKEEPER assigned to the show that
issued the invite.

SMTP email delivery is intentionally out of scope for this pass — the
`accept_url` is returned in the create response so the issuer can paste it
into their preferred channel (text, DM, etc.). Wiring `aiosmtplib` here
when SMTP credentials become available is a one-function change.
"""
from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

import bcrypt
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from dependencies import (
    INTERNAL_API_KEY,
    require_admin_or_show_admin,
    require_api_key,
    safe_uuid,
)
from models import Show, ShowManager, ShowScorekeeper, ShowSecretary, User, UserInvite
from schemas import (
    UserInviteAcceptBody,
    UserInviteByTokenOut,
    UserInviteCreate,
    UserInviteCreateResult,
    UserInviteOut,
)

router = APIRouter(prefix="/user-invites", tags=["User Invites"])

INVITE_TTL_DAYS = 14
ROLE_ALLOWED = {"SCOREKEEPER"}


def _public_app_url() -> str:
    return os.getenv("PUBLIC_APP_URL", "http://localhost:3000").rstrip("/")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _generate_token() -> str:
    # 32 url-safe chars (~ 192 bits of entropy). Stored in plain text — the
    # token IS the secret, so leaking the DB row leaks the invite. Acceptable
    # because: short TTL, single-use, and accept flow has no privilege beyond
    # creating a SCOREKEEPER account assigned to one show.
    return secrets.token_urlsafe(32)


async def _assert_show_access(
    show_id: UUID, x_user_id: str, x_user_role: str, db: AsyncSession
) -> None:
    if x_user_role == "ADMIN":
        return
    if x_user_role == "SHOW_SECRETARY":
        row = await db.execute(
            select(ShowSecretary).where(
                ShowSecretary.show_id == show_id,
                ShowSecretary.user_id == safe_uuid(x_user_id),
            )
        )
        if row.scalar_one_or_none():
            return
    if x_user_role == "SHOW_MANAGER":
        row = await db.execute(
            select(ShowManager).where(
                ShowManager.show_id == show_id,
                ShowManager.user_id == safe_uuid(x_user_id),
            )
        )
        if row.scalar_one_or_none():
            return
    raise HTTPException(403, "Not authorized for this show")


@router.post(
    "/",
    response_model=UserInviteCreateResult,
    status_code=201,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def create_invite(
    body: UserInviteCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if body.role not in ROLE_ALLOWED:
        raise HTTPException(400, f"Invite role must be one of: {', '.join(sorted(ROLE_ALLOWED))}")
    if body.role == "SCOREKEEPER" and body.show_id is None:
        raise HTTPException(400, "show_id is required for scorekeeper invites")

    if body.show_id is not None:
        if not await db.get(Show, body.show_id):
            raise HTTPException(404, "Show not found")
        await _assert_show_access(body.show_id, x_user_id, x_user_role, db)

    email_norm = body.email.strip().lower()
    # Outstanding pending invite for the same (email, role, show)?
    existing = await db.execute(
        select(UserInvite).where(
            UserInvite.email == email_norm,
            UserInvite.role == body.role,
            UserInvite.show_id == body.show_id,
            UserInvite.status == "pending",
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "A pending invite for this email and show already exists")

    # Already a user with this email? Block — they don't need an invite.
    existing_user = await db.execute(
        select(User).where(User.email == email_norm)
    )
    if existing_user.scalar_one_or_none():
        raise HTTPException(
            409,
            "A user with this email already exists. Use 'Assign existing scorekeeper' instead.",
        )

    invite = UserInvite(
        token=_generate_token(),
        email=email_norm,
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
        role=body.role,
        show_id=body.show_id,
        expires_at=_now() + timedelta(days=INVITE_TTL_DAYS),
        invited_by_user_id=safe_uuid(x_user_id),
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)

    accept_url = f"{_public_app_url()}/invite/{invite.token}"
    return {
        **UserInviteOut.model_validate(invite, from_attributes=True).model_dump(),
        "token": invite.token,
        "accept_url": accept_url,
    }


@router.get(
    "/by-show/{show_id}",
    response_model=list[UserInviteOut],
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def list_invites_for_show(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not await db.get(Show, show_id):
        raise HTTPException(404, "Show not found")
    await _assert_show_access(show_id, x_user_id, x_user_role, db)
    result = await db.execute(
        select(UserInvite)
        .where(UserInvite.show_id == show_id, UserInvite.status == "pending")
        .order_by(UserInvite.created_at.desc())
    )
    return result.scalars().all()


@router.delete(
    "/{invite_id}",
    status_code=204,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def cancel_invite(
    invite_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    invite = await db.get(UserInvite, invite_id)
    if not invite:
        raise HTTPException(404, "Invite not found")
    if invite.status != "pending":
        raise HTTPException(409, f"Invite is already {invite.status}")
    if invite.show_id is not None:
        await _assert_show_access(invite.show_id, x_user_id, x_user_role, db)
    invite.status = "cancelled"
    await db.commit()
    return None


@router.get(
    "/by-token/{token}",
    response_model=UserInviteByTokenOut,
    dependencies=[Depends(require_api_key)],
)
async def get_invite_by_token(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Public-ish: requires only the internal API key, not a user session.
    The accept page calls this to render the invitee's details before they
    set their password."""
    invite_q = await db.execute(
        select(UserInvite)
        .where(UserInvite.token == token)
        .options(selectinload(UserInvite.show))
    )
    invite = invite_q.scalar_one_or_none()
    if not invite:
        raise HTTPException(404, "Invite not found")
    if invite.status == "pending" and invite.expires_at < _now():
        invite.status = "expired"
        await db.commit()
    return {
        "first_name": invite.first_name,
        "last_name": invite.last_name,
        "email": invite.email,
        "role": invite.role,
        "show_id": invite.show_id,
        "show_name": invite.show.name if invite.show else None,
        "expires_at": invite.expires_at,
        "status": invite.status,
    }


@router.post(
    "/by-token/{token}/accept",
    response_model=UserInviteOut,
    dependencies=[Depends(require_api_key)],
)
async def accept_invite(
    token: str,
    body: UserInviteAcceptBody,
    db: AsyncSession = Depends(get_db),
):
    """Public-ish: anyone with a valid token can complete this. Creates a
    new User row, optionally assigns them to the issuing show, and marks
    the invite accepted. Idempotent on repeat calls — the second call hits
    the status guard and returns 409."""
    invite_q = await db.execute(
        select(UserInvite).where(UserInvite.token == token)
    )
    invite = invite_q.scalar_one_or_none()
    if not invite:
        raise HTTPException(404, "Invite not found")
    if invite.status != "pending":
        raise HTTPException(409, f"Invite is already {invite.status}")
    if invite.expires_at < _now():
        invite.status = "expired"
        await db.commit()
        raise HTTPException(410, "Invite has expired")

    # If a user with this email exists, block — they already have an account.
    existing_user_q = await db.execute(
        select(User).where(User.email == invite.email)
    )
    if existing_user_q.scalar_one_or_none():
        raise HTTPException(
            409,
            "An account already exists for this email. Log in with your existing password.",
        )

    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    user = User(
        email=invite.email,
        first_name=invite.first_name,
        last_name=invite.last_name,
        role=invite.role,
        hashed_password=hashed,
        is_approved=True,
    )
    db.add(user)
    await db.flush()

    if invite.role == "SCOREKEEPER" and invite.show_id is not None:
        # Auto-assign as scorekeeper for the issuing show.
        db.add(ShowScorekeeper(show_id=invite.show_id, user_id=user.id))

    invite.status = "accepted"
    invite.accepted_at = _now()
    invite.accepted_user_id = user.id

    await db.commit()
    await db.refresh(invite)
    return invite
