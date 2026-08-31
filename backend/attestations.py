"""Building the declarations recorded against an entry (migration 118).

Shared by both entry doors — the show desk (`routers/entries.py`) and the
exhibitor's own class registration (`routers/show_registration.py`) — for the
same reason the rules themselves are: a check written into one router protects
one door out of two.

The caller names the declaration it is making. The *words* come from
`rules.apha.ATTESTATION_STATEMENTS` and are copied into the row here, so a
client cannot compose the sentence it is attesting to. That mirrors the rule
that a paperwork verification never accepts its own value — with the difference
that there is nothing on file to derive a declaration from, so the backend
supplies the text rather than reading it.
"""
from __future__ import annotations

from typing import Iterable, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies import safe_uuid
from models import EntryAttestation, User
from rules.apha import ATTESTATION_STATEMENTS


async def _attester_name(user_id: Optional[str], db: AsyncSession) -> Optional[str]:
    """The declaring user's display name, snapshotted onto the row.

    Denormalized like `coggins_override_audit.overridden_by_name`: a declaration
    that becomes anonymous when the account is deleted is not much of a record.
    """
    uid = safe_uuid(user_id) if user_id else None
    if uid is None:
        return None
    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()
    if user is None:
        return None
    return user.full_name or " ".join(
        part for part in [user.first_name, user.last_name] if part
    ).strip() or None


async def build_attestations(
    kinds: Iterable[str],
    user_id: Optional[str],
    db: AsyncSession,
) -> list[EntryAttestation]:
    """Rows for the declarations named, deduplicated and in a stable order.

    Returned unattached: the caller assigns them to `entry.attestations` before
    validating, so the rules engine sees them on an entry that has not been
    written yet, and the relationship cascade writes them on commit.
    """
    wanted = [k for k in dict.fromkeys(kinds) if k in ATTESTATION_STATEMENTS]
    if not wanted:
        return []
    name = await _attester_name(user_id, db)
    uid: Optional[UUID] = safe_uuid(user_id) if user_id else None
    return [
        EntryAttestation(
            kind=kind,
            statement=ATTESTATION_STATEMENTS[kind],
            attested_by_user_id=uid,
            attested_by_name=name,
        )
        for kind in wanted
    ]
