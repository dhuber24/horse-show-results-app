from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from uuid import UUID

from billing import RESERVABLE_FEE_UNITS
from reservations import REQUIRABLE_FEE_UNITS
from database import get_db
from dependencies import require_admin_or_show_admin
from models import Show, ShowEntryReservation, ShowFee
from routers.shows import _assert_show_access
from schemas import ShowFeeCreate, ShowFeeOut, ShowFeeUpdate

router = APIRouter(prefix="/shows/{show_id}/fees", tags=["Show Fees"])

# A show has to be publicly visible before its price list is. Matches
# `show_contact.PUBLIC_SHOW_STATUSES` — same question, same answer.
PUBLIC_SHOW_STATUSES = ("PUBLISHED", "ACTIVE", "COMPLETED")


# Default starter fee items seeded when a secretary clicks "Seed common fees".
# Amounts are zero — the secretary fills in the real numbers. Labels and units
# match what we saw across AQHA / APHA / NSBA / WSCA show bills.
DEFAULT_FEE_TEMPLATES = [
    {"code": "stall",            "label": "Stall (box)",            "unit": "per_stall"},
    {"code": "stall_tie",        "label": "Stall (tie)",            "unit": "per_stall"},
    {"code": "tack_stall",       "label": "Tack stall",             "unit": "per_stall"},
    {"code": "bedding",          "label": "Shavings",               "unit": "per_bag"},
    {"code": "campsite_electric","label": "RV / electric hookup",   "unit": "per_night"},
    {"code": "campsite_dry",     "label": "Dry camping",            "unit": "per_night"},
    {"code": "late_entry",       "label": "Late entry fee",         "unit": "per_entry"},
    {"code": "post_entry",       "label": "Post-entry fee",         "unit": "per_horse"},
    {"code": "cross_entry",      "label": "Cross-entry fee",        "unit": "per_entry"},
    {"code": "stall_cleanout",   "label": "Stall cleanout penalty", "unit": "flat"},
    {"code": "drug_test",        "label": "Drug test fee",          "unit": "per_horse"},
    # The levy a breed body requires show management to collect per entry per
    # judge and forward with the results -- APHA SC-125.B is one (migration 125).
    # Named generically because every association has a version of it, and the
    # show prices its own.
    {"code": "association_assessment", "label": "Association assessment", "unit": "per_judge_per_entry"},
]


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


def _assert_early_rate_valid(
    *,
    unit: str,
    amount_cents: int,
    early_amount_cents: int | None,
    early_deadline: date | None,
) -> None:
    """Check the early-bird pair against the values the row will end up with.

    Takes the merged values rather than the ORM object because PATCH is
    partial and must be checked before anything is mutated: lowering
    `amount_cents` below an early rate already on the row has to fail the same
    way as setting a too-high early rate in the first place.

    A half-set pair is rejected outright instead of quietly ignored — a
    secretary who filled in a discount and no deadline believes the discount is
    live, and the exhibitor screen would say otherwise.
    """
    has_amount = early_amount_cents is not None
    has_deadline = early_deadline is not None
    if has_amount != has_deadline:
        raise HTTPException(
            422,
            "An early rate needs both a discounted amount and a deadline. "
            "Clear both to remove it.",
        )
    if not has_amount:
        return
    if early_amount_cents > amount_cents:
        raise HTTPException(
            422,
            "The early rate must be no more than the standard rate — it is a "
            "discount for reserving early.",
        )
    if unit not in RESERVABLE_FEE_UNITS:
        raise HTTPException(
            422,
            "An early rate only applies to fees exhibitors reserve a quantity "
            "of at sign-up (per stall, per bag, per night, per day, per show).",
        )


def _assert_min_quantity_valid(*, unit: str, min_quantity: int | None) -> None:
    """A floor only means something on a line the show can require of everybody.

    Narrower than the early-rate guard above it, which takes any reservable
    unit. A minimum is a *policy* -- "we will not have horses bedded on less
    than this", "every rig takes a stall" -- and nothing about camping is like
    that: no show requires everyone who enters to also book a spot. Setting one
    there would refuse a sign-up for not camping. See `REQUIRABLE_FEE_UNITS`.
    """
    if not min_quantity:
        return
    if unit not in REQUIRABLE_FEE_UNITS:
        raise HTTPException(
            422,
            "A minimum quantity only applies to stalls and bedding — the lines "
            "a show can require of everybody. Camping is booked by whoever "
            "wants it.",
        )


async def _reserved_counts(fee_ids: list[UUID], db: AsyncSession) -> dict[UUID, int]:
    """How many exhibitors have booked a quantity against each of these fees.

    One grouped query for the whole catalog rather than a count per row — the
    fee list is small, but this is read on every load of two editing screens.
    """
    if not fee_ids:
        return {}
    result = await db.execute(
        select(ShowEntryReservation.show_fee_id, func.count())
        .where(ShowEntryReservation.show_fee_id.in_(fee_ids))
        .group_by(ShowEntryReservation.show_fee_id)
    )
    return {fee_id: count for fee_id, count in result.all()}


@router.get("/", response_model=list[ShowFeeOut])
async def list_show_fees(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    result = await db.execute(
        select(ShowFee)
        .where(ShowFee.show_id == show_id)
        .order_by(ShowFee.sort_order, ShowFee.created_at)
    )
    fees = result.scalars().all()
    # `reserved_count` is what the fee editors need to know before offering to
    # change a row's unit — see `update_show_fee`.
    counts = await _reserved_counts([fee.id for fee in fees], db)
    return [
        ShowFeeOut.model_validate(fee).model_copy(
            update={"reserved_count": counts.get(fee.id, 0)}
        )
        for fee in fees
    ]


@router.get("/public", response_model=list[ShowFeeOut])
async def list_show_fees_public(show_id: UUID, db: AsyncSession = Depends(get_db)):
    """The show's fee schedule, no auth — what the show bill prints.

    Stalls, shavings, camping, late fees and their early-bird rates are the
    published price list: an exhibitor reads them to decide whether to enter,
    and a show bill that quotes a number the app is keeping behind a login is
    two sources of truth waiting to disagree. The staff endpoint above stays
    for editing; this is the read.

    Gated on the show being publicly visible for the same reason as the contact
    form — a DRAFT show is not offering anything to anyone yet. Declared above
    `/{fee_id}` so "public" is never parsed as one.
    """
    show = await _get_show_or_404(show_id, db)
    if show.status not in PUBLIC_SHOW_STATUSES:
        # Same answer as a missing show: a stranger probing ids should not
        # learn which drafts exist.
        raise HTTPException(404, "Show not found")
    result = await db.execute(
        select(ShowFee)
        .where(ShowFee.show_id == show_id)
        .order_by(ShowFee.sort_order, ShowFee.created_at)
    )
    return result.scalars().all()


@router.post("/", response_model=ShowFeeOut, status_code=201, dependencies=[Depends(require_admin_or_show_admin)])
async def create_show_fee(
    show_id: UUID,
    body: ShowFeeCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    _assert_early_rate_valid(
        unit=body.unit,
        amount_cents=body.amount_cents,
        early_amount_cents=body.early_amount_cents,
        early_deadline=body.early_deadline,
    )
    _assert_min_quantity_valid(unit=body.unit, min_quantity=body.min_quantity)
    fee = ShowFee(show_id=show_id, **body.model_dump())
    db.add(fee)
    await db.commit()
    await db.refresh(fee)
    return fee


@router.post("/seed", response_model=list[ShowFeeOut], status_code=201, dependencies=[Depends(require_admin_or_show_admin)])
async def seed_default_fees(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Add any default fee templates that aren't already present on this show."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)

    existing_result = await db.execute(
        select(ShowFee.code).where(ShowFee.show_id == show_id)
    )
    existing_codes = {code for (code,) in existing_result.all()}

    created: list[ShowFee] = []
    for sort_index, template in enumerate(DEFAULT_FEE_TEMPLATES):
        if template["code"] in existing_codes:
            continue
        fee = ShowFee(
            show_id=show_id,
            code=template["code"],
            label=template["label"],
            unit=template["unit"],
            amount_cents=0,
            sort_order=sort_index,
        )
        db.add(fee)
        created.append(fee)
    await db.commit()
    for fee in created:
        await db.refresh(fee)
    return created


@router.patch("/{fee_id}", response_model=ShowFeeOut, dependencies=[Depends(require_admin_or_show_admin)])
async def update_show_fee(
    show_id: UUID,
    fee_id: UUID,
    body: ShowFeeUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    fee = await db.get(ShowFee, fee_id)
    if not fee or fee.show_id != show_id:
        raise HTTPException(404, "Fee not found")
    updates = body.model_dump(exclude_unset=True)
    _assert_early_rate_valid(
        unit=updates.get("unit", fee.unit),
        amount_cents=updates.get("amount_cents", fee.amount_cents),
        early_amount_cents=updates.get("early_amount_cents", fee.early_amount_cents),
        early_deadline=updates.get("early_deadline", fee.early_deadline),
    )
    _assert_min_quantity_valid(
        unit=updates.get("unit", fee.unit),
        min_quantity=updates.get("min_quantity", fee.min_quantity),
    )
    # A booked quantity has no meaning apart from the unit it was booked under.
    # `build_bill` multiplies rate x quantity and never reads the unit, so
    # flipping camping from per_night to per_show turns "3 nights" into "3
    # spots" and reprices every exhibitor holding one — with nothing on the
    # screen or in the data to say it happened. The price may change freely;
    # what the number counts may not.
    new_unit = updates.get("unit", fee.unit)
    if new_unit != fee.unit:
        reserved = (await _reserved_counts([fee.id], db)).get(fee.id, 0)
        if reserved:
            raise HTTPException(
                409,
                f"{reserved} exhibitor(s) have already reserved this fee as "
                f"\"{fee.unit.replace('_', ' ')}\". Changing the unit would "
                "silently reprice their bookings. Remove this fee and add it "
                "again to start over, or leave the unit as it is.",
            )
    for k, v in updates.items():
        setattr(fee, k, v)
    await db.commit()
    await db.refresh(fee)
    return fee


@router.delete("/{fee_id}", status_code=204, dependencies=[Depends(require_admin_or_show_admin)])
async def delete_show_fee(
    show_id: UUID,
    fee_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    fee = await db.get(ShowFee, fee_id)
    if not fee or fee.show_id != show_id:
        raise HTTPException(404, "Fee not found")
    await db.delete(fee)
    await db.commit()
