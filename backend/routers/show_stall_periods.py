"""A show's stall periods (migration 194): the windows its stalls are sold for,
and the only place a show's move-in is set.

Set on the Lodging step, which sends the whole list at once (`PUT`): a period
it leaves out is deleted, and a stall line sold for it becomes a whole-show
line (`ON DELETE SET NULL`). The same write keeps `shows.stalls_open_*` to the
first period's move-in (`stabling.stalls_open_from`). Read publicly with the
price list, because an exhibitor deciding between a full-show stall and a
pleasure-days stall needs to know when each one moves in and out.

Which days a period covers for a horse's classes is `stabling.period_days`.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import require_admin_or_show_admin
from models import Show, ShowEntryReservation, ShowFee, ShowStallPeriod
from routers.shows import _assert_show_access
from schemas import StallPeriodOut, StallPeriodsPut
from stabling import load_stall_periods, stalls_open_from

router = APIRouter(prefix="/shows/{show_id}/stall-periods", tags=["Show Fees"])

# The same answer `show_fees.list_show_fees_public` gives: a draft is offering
# nothing to anybody yet.
PUBLIC_SHOW_STATUSES = ("PUBLISHED", "ACTIVE", "COMPLETED")


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


@router.get("", response_model=list[StallPeriodOut])
async def list_stall_periods(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    return await load_stall_periods(db, show_id)


@router.get("/public", response_model=list[StallPeriodOut])
async def list_stall_periods_public(show_id: UUID, db: AsyncSession = Depends(get_db)):
    """The periods, no auth -- printed beside the stall lines on the show page
    and the generated show bill, as the public price list is."""
    show = await _get_show_or_404(show_id, db)
    if show.status not in PUBLIC_SHOW_STATUSES:
        raise HTTPException(404, "Show not found")
    return await load_stall_periods(db, show_id)


@router.put(
    "",
    response_model=list[StallPeriodOut],
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def replace_stall_periods(
    show_id: UUID,
    body: StallPeriodsPut,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Replace the show's periods with this list, in this order.

    Returned in the order sent, so the step can match a period it just created
    to the stall lines that name it before it has an id.

    Two periods may not share a name: an exhibitor picks between them by name.
    A period must touch the show -- moving in after its last day, or out before
    its first, is a date typed in the wrong box. Moving the show's own dates is
    never refused over a period, as it is not over `stalls_open_date`.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)

    seen: set[str] = set()
    for item in body.periods:
        name = item.name.strip()
        if not name:
            raise HTTPException(422, "Every stall period needs a name.")
        if name.casefold() in seen:
            raise HTTPException(422, f'Two stall periods are both called "{name}".')
        seen.add(name.casefold())
        if item.move_out_date < item.move_in_date:
            raise HTTPException(422, f"{name}: move-out can't be before move-in.")
        if show.end_date and item.move_in_date > show.end_date:
            raise HTTPException(422, f"{name}: move-in is after the show's last day.")
        if show.start_date and item.move_out_date < show.start_date:
            raise HTTPException(422, f"{name}: move-out is before the show's first day.")

    existing = {period.id: period for period in await load_stall_periods(db, show_id)}
    kept: list[ShowStallPeriod] = []
    for index, item in enumerate(body.periods):
        if item.id is not None:
            period = existing.get(item.id)
            if period is None:
                raise HTTPException(422, "That stall period is not on this show.")
        else:
            period = ShowStallPeriod(show_id=show_id)
            db.add(period)
        period.name = item.name.strip()
        period.move_in_date = item.move_in_date
        period.move_in_time = item.move_in_time
        period.move_out_date = item.move_out_date
        period.move_out_time = item.move_out_time
        period.move_out_note = (item.move_out_note or "").strip() or None
        period.move_in_notes = item.move_in_notes
        period.sort_order = index
        kept.append(period)

    # A period exhibitors hold stalls in cannot go: its lines would become
    # whole-show lines, which changes what they bought -- the same reason a
    # booked line's period cannot change (`show_fees.update_show_fee`).
    kept_ids = {period.id for period in kept if period.id is not None}
    dropped = [period for period_id, period in existing.items() if period_id not in kept_ids]
    if dropped:
        booked = await db.execute(
            select(ShowFee.stall_period_id)
            .join(ShowEntryReservation, ShowEntryReservation.show_fee_id == ShowFee.id)
            .where(
                ShowFee.stall_period_id.in_([period.id for period in dropped]),
                ShowEntryReservation.quantity > 0,
            )
            .limit(1)
        )
        held = booked.scalar_one_or_none()
        if held is not None:
            name = next(period.name for period in dropped if period.id == held)
            raise HTTPException(
                409,
                f"Exhibitors have booked stalls in {name}. Stop selling those stall "
                "types before removing the period.",
            )
    for period in dropped:
        await db.delete(period)

    # Move-in is set only by period, so "stalls open" is the earliest of their
    # move-ins rather than a second day the office keeps in step by hand -- and
    # with the last period gone, nothing: a day left behind would still be
    # printed on Show Details, the show bill and every arrival check.
    show.stalls_open_date, show.stalls_open_time = stalls_open_from(kept)

    await db.commit()
    for period in kept:
        await db.refresh(period)
    return kept
