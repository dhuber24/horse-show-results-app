"""What scrolls along the bottom of the show's live screens.

The results board's marquee carried the posted results and nothing else. A show
office also has things to tell a room that are not placings -- "Class 22 has
moved to Ring 2", "Lunch break until 1:00", "Full results are in the GaitDesk
app" -- and the only way to say them was to walk over to the TV.

One row per show (`show_marquees`, migration 139), written from the Results Board
page and read by the board on the same 12-second poll that keeps its placings
current. Three modes: the results, the message alone, or the message repeated
between the results.

Two rules:

  * **A marquee is one line.** Newlines and runs of whitespace collapse to a
    single space on the way in, because there is no second line to break onto
    and a stored newline would render as nothing at all.
  * **It never scrolls a blank band.** Choosing the message with nothing typed
    is refused here, and `marquee_payload` falls back to the results if such a
    row ever exists anyway -- `effective_mode` is what the board reads.

The request and response models live here rather than in `schemas.py`, the way
`routers/auth.py` keeps its own: nothing else in the app reads a marquee.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import require_admin_or_show_admin, safe_uuid
from models import Show, ShowMarquee
from routers.shows import _assert_show_access

router = APIRouter(prefix="/shows/{show_id}", tags=["Live Screens"])

MarqueeMode = Literal["results", "message", "both"]

# Matches ck_show_marquees_message_length. Long enough for a sponsor list or a
# schedule change with its reason; short enough that it still reads as a
# marquee line rather than a notice somebody has to stand and wait out.
MAX_MESSAGE_CHARS = 500


class MarqueeUpdate(BaseModel):
    mode: MarqueeMode
    message: Optional[str] = None


class MarqueeOut(BaseModel):
    mode: MarqueeMode
    # What the board actually shows. Differs from `mode` only when a message
    # mode has no message behind it, which the PUT refuses to create.
    effective_mode: MarqueeMode
    message: Optional[str] = None
    updated_at: Optional[datetime] = None


def normalize_message(raw: Optional[str]) -> Optional[str]:
    """One line of text, or None when there is nothing on it."""
    if raw is None:
        return None
    text = " ".join(raw.split())
    return text or None


def marquee_payload(row: Optional[ShowMarquee]) -> dict:
    """The marquee a board should run. No row is the results, as before 139."""
    if row is None:
        return {
            "mode": "results",
            "effective_mode": "results",
            "message": None,
            "updated_at": None,
        }
    effective = row.mode if (row.mode == "results" or row.message) else "results"
    return {
        "mode": row.mode,
        "effective_mode": effective,
        "message": row.message,
        "updated_at": row.updated_at,
    }


def validate_update(mode: str, message: Optional[str]) -> None:
    """Refusals, in words the Results Board page prints as they stand."""
    if message is not None and len(message) > MAX_MESSAGE_CHARS:
        raise HTTPException(
            422,
            f"Keep the message to {MAX_MESSAGE_CHARS} characters -- this one is "
            f"{len(message)}. A marquee is read in passing.",
        )
    if mode != "results" and message is None:
        raise HTTPException(
            422,
            "Type the message to scroll, or set the marquee back to the results.",
        )


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


@router.get("/marquee", response_model=MarqueeOut)
async def get_marquee(show_id: UUID, db: AsyncSession = Depends(get_db)):
    """What the show's marquee carries. Public, like everything else on it.

    The board that reads this is staff-only, but that gate is on who may put a
    show up on a wall -- the message itself is written to be read by a lobby,
    and the results it scrolls beside come from the public `results-index`.
    """
    await _get_show_or_404(show_id, db)
    return marquee_payload(await db.get(ShowMarquee, show_id))


@router.put(
    "/marquee",
    response_model=MarqueeOut,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def set_marquee(
    show_id: UUID,
    body: MarqueeUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Set what the marquee carries. The show office's call, like the board.

    The message is stored whatever the mode, so choosing the results again takes
    an announcement down without losing it.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)

    message = normalize_message(body.message)
    validate_update(body.mode, message)

    row = await db.get(ShowMarquee, show_id)
    if row is None:
        row = ShowMarquee(show_id=show_id)
        db.add(row)
    row.mode = body.mode
    row.message = message
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by_user_id = safe_uuid(x_user_id)

    await db.commit()
    await db.refresh(row)
    return marquee_payload(row)
