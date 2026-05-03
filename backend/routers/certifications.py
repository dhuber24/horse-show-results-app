from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from database import get_db
from dependencies import require_api_key
from models import CertOrgUser

router = APIRouter(prefix="/certifications", tags=["Certifications"])


@router.get("/verify", dependencies=[Depends(require_api_key)])
async def verify_certification(
    email: str = Query(...),
    org: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CertOrgUser).where(
            func.lower(CertOrgUser.email) == email.strip().lower(),
            func.lower(CertOrgUser.org) == org.strip().lower(),
        )
    )
    record = result.scalar_one_or_none()

    if not record:
        return {"found": False}

    expired = bool(record.expiration and record.expiration < date.today())

    return {
        "found": True,
        "first_name": record.first_name,
        "last_name": record.last_name,
        "state_province": record.state_province,
        "country": record.country,
        "completion_date": record.completion_date,
        "expiration_date": record.expiration,
        "expired": expired,
    }
