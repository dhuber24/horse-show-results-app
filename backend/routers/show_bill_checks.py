"""What a show set up from its show bill still has to have checked (migration 187).

The show is created as a DRAFT from the read, and every doubt about it -- the
reader's or the app's -- is a check on its setup step and field. This router
lists them and lets the office accept one, or take an acceptance back. The
rest of a check's life is decided on read (`showbill_checks.check_state`):
changing the field it is about, or deleting its row, closes it too.

**Not a paid feature.** The show bill import is, but a show it created cannot
leave DRAFT while a check is open (`routers/shows.py`), so a company that moves
off Pro must still be able to answer them -- otherwise its show could never be
published.

Show-office tier, like the setup wizard: ADMIN, or somebody who works the show.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import require_admin_or_show_admin, safe_uuid
from routers.shows import _assert_show_access
from schemas import ShowBillCheckOut
from showbill_checks import load_checks, set_accepted

router = APIRouter(
    prefix="/shows/{show_id}/bill-checks",
    tags=["Show Setup"],
    dependencies=[Depends(require_admin_or_show_admin)],
)


@router.get("", response_model=list[ShowBillCheckOut])
async def list_bill_checks(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Every check on the show, in step order, each with its state. Empty for a
    show that was not set up from its show bill."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    return await load_checks(db, show_id)


@router.put("/{check_id}/accepted", status_code=204)
async def accept_bill_check(
    show_id: UUID,
    check_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Somebody looked at it and it is right as it stands. Who, and when, is kept."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    if not await set_accepted(db, show_id, check_id, safe_uuid(x_user_id), True):
        raise HTTPException(404, "Check not found")
    return Response(status_code=204)


@router.delete("/{check_id}/accepted", status_code=204)
async def reopen_bill_check(
    show_id: UUID,
    check_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Take an acceptance back -- a press made by mistake."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    if not await set_accepted(db, show_id, check_id, None, False):
        raise HTTPException(404, "Check not found")
    return Response(status_code=204)
