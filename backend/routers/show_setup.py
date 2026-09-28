"""Which setup steps the show office said do not apply (migration 154).

The wizard's optional steps offer a *Skip*. Until this, pressing it only went to
the next step, so nothing downstream could tell "this show runs no side pots"
from "nobody has set the side pots up yet". Now the skip is recorded here, and
three places read it: the wizard minimizes the step, the setup hub folds it to
one line, and the show dashboard greys out the tile for the feature.

**Recorded, never enforced.** A skip refuses nothing: the step stays reachable,
and anything added on it simply makes the skip stop counting -- the frontend
treats a step as skipped only while it is also empty (`buildSteps`), because
somebody who sets a side pot up after skipping the step has changed their mind
and should not have to say so twice.

Show-office tier, like the setup wizard itself: ADMIN, or the SHOW_MANAGER /
SHOW_SECRETARY assigned to the show.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import require_admin_or_show_admin, safe_uuid
from models import ShowSetupSkip
from routers.shows import _assert_show_access

router = APIRouter(
    prefix="/shows/{show_id}/setup-skips",
    tags=["Show Setup"],
    dependencies=[Depends(require_admin_or_show_admin)],
)

# What may be declined: a key per step whose empty state is a real answer, plus
# the second feature of each step that sets up two -- `sidepots` (on Futurities
# & Side Pots) and `highpoint` (on Scoring, beside the judge cards) -- each
# declined on its own there, since each has its own dashboard tile. Mirrors
# `SkipKey` in `frontend/app/admin/shows/_wizard/steps.ts`. Basics, the Class
# Builder, Paperwork and the Show Bill have none: a show cannot do without them.
SKIPPABLE_STEPS = frozenset({
    "judges",
    "lodging",
    "sanctioning",
    "futurities",
    "sidepots",
    "fees",
    "judgecards",
    "highpoint",
})


def _checked_step(step: str) -> str:
    if step not in SKIPPABLE_STEPS:
        raise HTTPException(422, f"'{step}' is not a setup step that can be skipped.")
    return step


@router.get("")
async def list_setup_skips(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The steps skipped at this show. Whether each still counts depends on the
    step being empty, which the caller already knows."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    rows = (
        await db.execute(select(ShowSetupSkip.step).where(ShowSetupSkip.show_id == show_id))
    ).scalars().all()
    # A key a later release stopped offering is not reported: nothing can draw it.
    return {"steps": sorted(step for step in rows if step in SKIPPABLE_STEPS)}


@router.put("/{step}", status_code=204)
async def skip_setup_step(
    show_id: UUID,
    step: str,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Record that this step does not apply. Idempotent: skipping twice is one skip."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    _checked_step(step)
    if await db.get(ShowSetupSkip, (show_id, step)) is None:
        db.add(ShowSetupSkip(
            show_id=show_id,
            step=step,
            skipped_by_user_id=safe_uuid(x_user_id),
            skipped_at=datetime.now(timezone.utc),
        ))
        await db.commit()
    return Response(status_code=204)


@router.delete("/{step}", status_code=204)
async def restore_setup_step(
    show_id: UUID,
    step: str,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Bring a skipped step back without adding anything to it."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    _checked_step(step)
    row = await db.get(ShowSetupSkip, (show_id, step))
    if row is not None:
        await db.delete(row)
        await db.commit()
    return Response(status_code=204)
