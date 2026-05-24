from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from database import get_db
from dependencies import require_admin_or_show_admin
from models import Show, ShowFee
from routers.shows import _assert_show_access
from schemas import ShowFeeCreate, ShowFeeOut, ShowFeeUpdate

router = APIRouter(prefix="/shows/{show_id}/fees", tags=["Show Fees"])


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
]


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


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
    for k, v in body.model_dump(exclude_unset=True).items():
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
