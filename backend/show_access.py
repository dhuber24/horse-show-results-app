"""Who works a show from the office: the one place that is written down.

A show manager or secretary works a show two ways (migration 156):

  * **through its company** -- every member of `shows.company_id` works every
    show the company runs, with nothing per show. Adding somebody to the
    company reaches all of them; removing them takes them off all of them.
  * **through a per-show row** -- `show_managers` / `show_secretaries`, which is
    how somebody from outside the company works one show (a freelance secretary
    hired for the weekend), and how a show with no company is staffed at all.

The role still decides which of the two tables a per-show row may be in -- a
secretary is never read out of `show_managers` -- but company membership does
not care which of the two office roles somebody holds. Only those two roles
ever qualify: a scribe or a gate steward is staffed per show, and being in a
company (which only an admin could arrange) does not make them show office.

Every access check reads this module rather than asking the two tables itself.
Five of them did, and a check that forgot the company would lock a club's own
secretary out of one screen of a show they could open everywhere else.
"""
from uuid import UUID

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select, union
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import INTERNAL_API_KEY, safe_uuid
from models import Show, ShowCompanyMember, ShowManager, ShowSecretary, User

# The per-show table each office role may be assigned through.
SHOW_OFFICE_TABLES = {"SHOW_MANAGER": ShowManager, "SHOW_SECRETARY": ShowSecretary}


async def in_show_company(db: AsyncSession, show_id: UUID, user_id: UUID) -> bool:
    """Whether the account works for the company that runs this show."""
    row = await db.execute(
        select(ShowCompanyMember.id)
        .join(Show, Show.company_id == ShowCompanyMember.company_id)
        .where(Show.id == show_id, ShowCompanyMember.user_id == user_id)
    )
    return row.first() is not None


async def works_show(db: AsyncSession, show_id: UUID, user_id: UUID | None, role: str | None) -> bool:
    """Whether this caller is the show's office: ADMIN, a per-show row for
    their role, or a member of the company that runs it."""
    if role == "ADMIN":
        return True
    table = SHOW_OFFICE_TABLES.get(role or "")
    if table is None or user_id is None:
        return False
    assigned = await db.execute(
        select(table.id).where(table.show_id == show_id, table.user_id == user_id)
    )
    if assigned.first() is not None:
        return True
    return await in_show_company(db, show_id, user_id)



async def require_scoring_access(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str | None = Header(None),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
) -> None:
    """A dependency for a scribe's work at a show: entering placings and scores,
    posting a class, the judge's card and its photo.

    ADMIN and SCRIBE at any show, by role, as it has always been -- a scribe is
    staffed per show but the results routes never asked which. A show manager
    or secretary does the same work at the shows they work, and only there: a
    secretary at one company is not a scribe at another's show. Reads the
    `show_id` path parameter, so it only goes on a route under a show; a frozen
    show is still refused by `refuse_frozen_show` beside it.
    """
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    if x_user_role in ("ADMIN", "SCRIBE"):
        return
    if x_user_role in SHOW_OFFICE_TABLES:
        user_id = safe_uuid(x_user_id) if x_user_id else None
        if await works_show(db, show_id, user_id, x_user_role):
            return
        raise HTTPException(403, "Not authorized for this show")
    raise HTTPException(403, "Scribe or show office access required")

def worked_show_ids(user_id: UUID, role: str):
    """A SELECT of every show id this show manager or secretary works, for
    filtering a list of shows. The caller checks the role first."""
    table = SHOW_OFFICE_TABLES[role]
    return union(
        select(table.show_id.label("show_id")).where(table.user_id == user_id),
        select(Show.id.label("show_id"))
        .join(ShowCompanyMember, ShowCompanyMember.company_id == Show.company_id)
        .where(ShowCompanyMember.user_id == user_id),
    )


async def show_office_users(db: AsyncSession, show: Show) -> list[User]:
    """Everybody who works this show from the office -- its company's managers
    and secretaries and anybody assigned to it by hand -- once each."""
    by_id: dict[UUID, User] = {}
    for table in SHOW_OFFICE_TABLES.values():
        rows = await db.execute(
            select(User).join(table, table.user_id == User.id).where(table.show_id == show.id)
        )
        by_id.update({u.id: u for u in rows.scalars().all()})
    if show.company_id is not None:
        rows = await db.execute(
            select(User)
            .join(ShowCompanyMember, ShowCompanyMember.user_id == User.id)
            .where(
                ShowCompanyMember.company_id == show.company_id,
                User.role.in_(tuple(SHOW_OFFICE_TABLES)),
            )
        )
        by_id.update({u.id: u for u in rows.scalars().all()})
    return list(by_id.values())
