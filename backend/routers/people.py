from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, union
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from uuid import UUID
from typing import Optional
from pydantic import BaseModel, EmailStr
import bcrypt

from database import get_db
from dependencies import require_admin, require_admin_or_show_admin, require_authenticated, require_api_key, safe_uuid
from models import User, Horse, Exhibitor, Entry, ExhibitorHorse, HorseRegistration, ExhibitorRegistration
from schemas import (
    UserCreate, UserOut,
    HorseCreate, HorseUpdate, HorseOut,
    HorseRegistrationCreate, HorseRegistrationOut,
    HorseRiderOut, HorseRiderCreate,
    ExhibitorCreate, ExhibitorUpdate, ExhibitorOut, ExhibitorCreateWithUser,
    ExhibitorRegistrationCreate, ExhibitorRegistrationOut,
)

VALID_ROLES = {"ADMIN", "SHOW_MANAGER", "SHOW_SECRETARY", "SCOREKEEPER", "EXHIBITOR"}

# ── Users ──────────────────────────────────────────────────────────────────────

users_router = APIRouter(prefix="/users", tags=["Users"])

@users_router.get("/", response_model=list[UserOut], dependencies=[Depends(require_admin)])
async def list_users(
    limit: Optional[int] = Query(None, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    q = select(User).order_by(User.full_name).offset(offset)
    if limit is not None:
        q = q.limit(limit)
    result = await db.execute(q)
    return result.scalars().all()

@users_router.post("/", response_model=UserOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_user(body: UserCreate, db: AsyncSession = Depends(get_db)):
    user = User(**body.model_dump())
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


class UserWithPasswordCreate(BaseModel):
    email: EmailStr
    full_name: str
    role: str
    password: str


@users_router.post("/with-password", response_model=UserOut, status_code=201)
async def create_user_with_password(
    body: UserWithPasswordCreate,
    x_api_key: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """
    ADMIN can create any role. SHOW_SECRETARY can only create SCOREKEEPER accounts.
    """
    from dependencies import INTERNAL_API_KEY
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if x_user_role == "SHOW_SECRETARY" and body.role != "SCOREKEEPER":
        raise HTTPException(status_code=403, detail="Show Secretaries can only create Scorekeeper accounts")
    if x_user_role not in ("ADMIN", "SHOW_SECRETARY"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    user = User(email=body.email, full_name=body.full_name, role=body.role, hashed_password=hashed)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


class RoleUpdate(BaseModel):
    role: str


class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


@users_router.get("/me", response_model=UserOut)
async def get_current_user(
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, safe_uuid(user_id))
    if not user:
        raise HTTPException(404, "User not found")
    return user


@users_router.patch("/me", response_model=UserOut)
async def update_current_user(
    body: UserProfileUpdate,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, safe_uuid(user_id))
    if not user:
        raise HTTPException(404, "User not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(user, k, v)
    try:
        await db.commit()
        await db.refresh(user)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Email already in use")
    return user


@users_router.patch("/me/password", status_code=204)
async def change_current_user_password(
    body: PasswordChange,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    if len(body.new_password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    user = await db.get(User, safe_uuid(user_id))
    if not user:
        raise HTTPException(404, "User not found")
    if not user.hashed_password or not bcrypt.checkpw(body.current_password.encode(), user.hashed_password.encode()):
        raise HTTPException(400, "Current password is incorrect")
    user.hashed_password = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
    await db.commit()


@users_router.patch("/{user_id}", response_model=UserOut, dependencies=[Depends(require_admin)])
async def update_user(user_id: UUID, body: UserProfileUpdate, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(user, k, v)
    try:
        await db.commit()
        await db.refresh(user)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Email already in use")
    return user


class PasswordReset(BaseModel):
    new_password: str


@users_router.patch("/{user_id}/password", status_code=204, dependencies=[Depends(require_admin)])
async def reset_user_password(user_id: UUID, body: PasswordReset, db: AsyncSession = Depends(get_db)):
    if len(body.new_password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.hashed_password = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
    await db.commit()


@users_router.patch("/{user_id}/role", response_model=UserOut, dependencies=[Depends(require_admin)])
async def update_user_role(user_id: UUID, body: RoleUpdate, db: AsyncSession = Depends(get_db)):
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.role = body.role
    await db.commit()
    await db.refresh(user)
    return user


@users_router.get("/{user_id}", response_model=UserOut, dependencies=[Depends(require_admin)])
async def get_user(user_id: UUID, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return user


@users_router.patch("/{user_id}/approve", response_model=UserOut, dependencies=[Depends(require_admin)])
async def approve_user(user_id: UUID, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.is_approved:
        raise HTTPException(409, "User is already approved")
    user.is_approved = True
    await db.commit()
    await db.refresh(user)
    return user


@users_router.delete("/{user_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_user(user_id: UUID, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    await db.delete(user)
    await db.commit()


# ── Horses ─────────────────────────────────────────────────────────────────────

horses_router = APIRouter(prefix="/horses", tags=["Horses"])

_horse_options = [selectinload(Horse.breed), selectinload(Horse.color)]


async def _check_horse_access(horse: Horse, user_id: str, role: str, db: AsyncSession):
    """Raises 403 if caller is not ADMIN and is not the owner of this horse.
    Only the registered owner (an exhibitor) can modify a horse."""
    if role == 'ADMIN':
        return
    result = await db.execute(select(Exhibitor).where(Exhibitor.user_id == safe_uuid(user_id)))
    exhibitor = result.scalar_one_or_none()
    if not exhibitor or horse.owner_exhibitor_id != exhibitor.id:
        raise HTTPException(403, "Only the owner of this horse can modify it")

@horses_router.get("/", response_model=list[HorseOut], dependencies=[Depends(require_admin_or_show_admin)])
async def list_horses(
    limit: Optional[int] = Query(None, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    q = select(Horse).options(*_horse_options).order_by(Horse.name).offset(offset)
    if limit is not None:
        q = q.limit(limit)
    result = await db.execute(q)
    return result.scalars().all()

@horses_router.get("/registrations/lookup", dependencies=[Depends(require_authenticated)])
async def lookup_horse_registration(
    show_type_id: UUID,
    registration_number: str,
    db: AsyncSession = Depends(get_db),
):
    """Find an existing horse by association + registration number.
    Used by create/edit forms to warn before creating a duplicate.
    Returns minimal horse info or 404."""
    number = (registration_number or "").strip()
    if not number:
        raise HTTPException(400, "registration_number is required")
    result = await db.execute(
        select(HorseRegistration, Horse)
        .join(Horse, Horse.id == HorseRegistration.horse_id)
        .where(
            HorseRegistration.show_type_id == show_type_id,
            HorseRegistration.registration_number == number,
        )
        .limit(1)
    )
    row = result.first()
    if not row:
        raise HTTPException(404, "No matching horse")
    _, horse = row
    return {
        "horse_id": str(horse.id),
        "horse_name": horse.name,
        "owner_name": horse.owner_name,
    }


@horses_router.post("/", response_model=HorseOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_horse(body: HorseCreate, db: AsyncSession = Depends(get_db)):
    horse = Horse(**body.model_dump())
    db.add(horse)
    await db.commit()
    result = await db.execute(select(Horse).options(*_horse_options).where(Horse.id == horse.id))
    return result.scalar_one()

@horses_router.get("/{horse_id}", response_model=HorseOut, dependencies=[Depends(require_api_key)])
async def get_horse(horse_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Horse).options(*_horse_options).where(Horse.id == horse_id))
    horse = result.scalar_one_or_none()
    if not horse:
        raise HTTPException(404, "Horse not found")
    return horse

@horses_router.patch("/{horse_id}", response_model=HorseOut)
async def update_horse(
    horse_id: UUID,
    body: HorseUpdate,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Horse).options(*_horse_options).where(Horse.id == horse_id))
    horse = result.scalar_one_or_none()
    if not horse:
        raise HTTPException(404, "Horse not found")
    await _check_horse_access(horse, user_id, x_user_role, db)
    update_data = body.model_dump(exclude_unset=True)
    # Exhibitors cannot reassign ownership
    if x_user_role != 'ADMIN':
        update_data.pop('owner_exhibitor_id', None)
    for k, v in update_data.items():
        setattr(horse, k, v)
    await db.commit()
    result = await db.execute(select(Horse).options(*_horse_options).where(Horse.id == horse_id))
    return result.scalar_one()

@horses_router.delete("/{horse_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_horse(horse_id: UUID, db: AsyncSession = Depends(get_db)):
    horse = await db.get(Horse, horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    await db.delete(horse)
    await db.commit()


# ── Horse Registrations ─────────────────────────────────────────────────────────

@horses_router.get("/{horse_id}/registrations", response_model=list[HorseRegistrationOut])
async def list_horse_registrations(horse_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(HorseRegistration)
        .options(selectinload(HorseRegistration.show_type))
        .where(HorseRegistration.horse_id == horse_id)
        .order_by(HorseRegistration.created_at)
    )
    return result.scalars().all()


async def _registration_conflict_message(
    show_type_id: UUID,
    registration_number: str,
    horse_id: UUID,
    db: AsyncSession,
) -> str:
    """After an IntegrityError on horse_registrations, figure out which constraint hit
    and produce a useful message."""
    # Same registration number already exists for some horse?
    result = await db.execute(
        select(Horse)
        .join(HorseRegistration, HorseRegistration.horse_id == Horse.id)
        .where(
            HorseRegistration.show_type_id == show_type_id,
            HorseRegistration.registration_number == registration_number.strip(),
        )
        .limit(1)
    )
    other = result.scalar_one_or_none()
    if other and other.id != horse_id:
        suffix = f" (owner: {other.owner_name})" if other.owner_name else ""
        return (
            f"Registration number {registration_number} is already on file for horse "
            f"'{other.name}'{suffix}. If this is the same horse, contact your show secretary."
        )
    return "This horse already has a registration for that association"


@horses_router.post("/{horse_id}/registrations", response_model=HorseRegistrationOut, status_code=201)
async def create_horse_registration(
    horse_id: UUID,
    body: HorseRegistrationCreate,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    horse = await db.get(Horse, horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    await _check_horse_access(horse, user_id, x_user_role, db)
    number = body.registration_number.strip()

    # Application-level uniqueness check — runs even if the DB-level UNIQUE
    # constraint hasn't been applied. Same association+number cannot belong to
    # two different horses.
    existing_q = await db.execute(
        select(HorseRegistration, Horse)
        .join(Horse, Horse.id == HorseRegistration.horse_id)
        .where(
            HorseRegistration.show_type_id == body.show_type_id,
            HorseRegistration.registration_number == number,
        )
        .limit(1)
    )
    existing_row = existing_q.first()
    if existing_row:
        _, other_horse = existing_row
        if other_horse.id != horse_id:
            suffix = f" (owner: {other_horse.owner_name})" if other_horse.owner_name else ""
            raise HTTPException(
                409,
                f"Registration number {number} is already on file for horse "
                f"'{other_horse.name}'{suffix}. If this is the same horse, contact your show secretary.",
            )
        # Same horse already has this exact registration
        raise HTTPException(409, "This horse already has that registration")

    # Per-horse uniqueness on (horse_id, show_type_id) — one number per horse per association
    same_assoc_q = await db.execute(
        select(HorseRegistration).where(
            HorseRegistration.horse_id == horse_id,
            HorseRegistration.show_type_id == body.show_type_id,
        )
    )
    if same_assoc_q.scalar_one_or_none():
        raise HTTPException(409, "This horse already has a registration for that association")

    reg = HorseRegistration(
        horse_id=horse_id,
        show_type_id=body.show_type_id,
        registration_number=number,
    )
    db.add(reg)
    try:
        await db.commit()
    except IntegrityError:
        # Race-condition safety net (concurrent insert won the application check)
        await db.rollback()
        msg = await _registration_conflict_message(
            body.show_type_id, body.registration_number, horse_id, db
        )
        raise HTTPException(409, msg)
    result = await db.execute(
        select(HorseRegistration)
        .options(selectinload(HorseRegistration.show_type))
        .where(HorseRegistration.id == reg.id)
    )
    return result.scalar_one()

@horses_router.delete("/{horse_id}/registrations/{reg_id}", status_code=204)
async def delete_horse_registration(
    horse_id: UUID,
    reg_id: UUID,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    horse = await db.get(Horse, horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    await _check_horse_access(horse, user_id, x_user_role, db)
    result = await db.execute(
        select(HorseRegistration).where(
            HorseRegistration.id == reg_id,
            HorseRegistration.horse_id == horse_id,
        )
    )
    reg = result.scalar_one_or_none()
    if not reg:
        raise HTTPException(404, "Registration not found")
    await db.delete(reg)
    await db.commit()



# ── Horse Riders ────────────────────────────────────────────────────────────────

@horses_router.get("/{horse_id}/riders", response_model=list[HorseRiderOut], dependencies=[Depends(require_api_key)])
async def list_horse_riders(horse_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ExhibitorHorse)
        .options(selectinload(ExhibitorHorse.exhibitor))
        .where(ExhibitorHorse.horse_id == horse_id)
        .order_by(ExhibitorHorse.created_at)
    )
    rows = result.scalars().all()
    return [HorseRiderOut(exhibitor_id=r.exhibitor_id, full_name=r.exhibitor.full_name) for r in rows]

@horses_router.post("/{horse_id}/riders", response_model=HorseRiderOut, status_code=201)
async def add_horse_rider(
    horse_id: UUID,
    body: HorseRiderCreate,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    horse = await db.get(Horse, horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    await _check_horse_access(horse, user_id, x_user_role, db)
    exhibitor = await db.get(Exhibitor, body.exhibitor_id)
    if not exhibitor:
        raise HTTPException(404, "Exhibitor not found")
    link = ExhibitorHorse(horse_id=horse_id, exhibitor_id=body.exhibitor_id)
    db.add(link)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "This exhibitor is already a rider for this horse")
    return HorseRiderOut(exhibitor_id=exhibitor.id, full_name=exhibitor.full_name)

@horses_router.delete("/{horse_id}/riders/{exhibitor_id}", status_code=204)
async def remove_horse_rider(
    horse_id: UUID,
    exhibitor_id: UUID,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    horse = await db.get(Horse, horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    await _check_horse_access(horse, user_id, x_user_role, db)
    result = await db.execute(
        select(ExhibitorHorse).where(
            ExhibitorHorse.horse_id == horse_id,
            ExhibitorHorse.exhibitor_id == exhibitor_id,
        )
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Rider not found")
    await db.delete(link)
    await db.commit()


# ── Exhibitors ─────────────────────────────────────────────────────────────────

class ExhibitorLink(BaseModel):
    user_id: UUID

exhibitors_router = APIRouter(prefix="/exhibitors", tags=["Exhibitors"])

@exhibitors_router.get("/", response_model=list[ExhibitorOut], dependencies=[Depends(require_admin_or_show_admin)])
async def list_exhibitors(
    limit: Optional[int] = Query(None, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    q = select(Exhibitor).order_by(Exhibitor.full_name).offset(offset)
    if limit is not None:
        q = q.limit(limit)
    result = await db.execute(q)
    return result.scalars().all()

@exhibitors_router.post("/", response_model=ExhibitorOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_exhibitor(body: ExhibitorCreateWithUser, db: AsyncSession = Depends(get_db)):
    exhibitor = Exhibitor(**body.model_dump())
    db.add(exhibitor)
    await db.commit()
    await db.refresh(exhibitor)
    return exhibitor

@exhibitors_router.post("/me", response_model=ExhibitorOut, status_code=201)
async def create_my_exhibitor_profile(
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Create the exhibitor record for the calling EXHIBITOR user if one doesn't exist yet."""
    if x_user_role != "EXHIBITOR":
        raise HTTPException(403, "Only EXHIBITOR accounts can use this endpoint")
    uid = safe_uuid(user_id)
    existing = await db.execute(select(Exhibitor).where(Exhibitor.user_id == uid))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Exhibitor profile already exists")
    user = await db.get(User, uid)
    if not user:
        raise HTTPException(404, "User not found")
    exhibitor = Exhibitor(user_id=uid, full_name=user.full_name)
    db.add(exhibitor)
    await db.commit()
    await db.refresh(exhibitor)
    return exhibitor


@exhibitors_router.get("/by-user/{user_id}", response_model=ExhibitorOut, dependencies=[Depends(require_api_key)])
async def get_exhibitor_by_user(user_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Exhibitor).where(Exhibitor.user_id == user_id))
    exhibitor = result.scalar_one_or_none()
    if not exhibitor:
        raise HTTPException(404, "No exhibitor record found for this user")
    return exhibitor

@exhibitors_router.get("/{exhibitor_id}", response_model=ExhibitorOut, dependencies=[Depends(require_api_key)])
async def get_exhibitor(exhibitor_id: UUID, db: AsyncSession = Depends(get_db)):
    exhibitor = await db.get(Exhibitor, exhibitor_id)
    if not exhibitor:
        raise HTTPException(404, "Exhibitor not found")
    return exhibitor

@exhibitors_router.patch("/{exhibitor_id}", response_model=ExhibitorOut, dependencies=[Depends(require_admin)])
async def update_exhibitor(exhibitor_id: UUID, body: ExhibitorUpdate, db: AsyncSession = Depends(get_db)):
    exhibitor = await db.get(Exhibitor, exhibitor_id)
    if not exhibitor:
        raise HTTPException(404, "Exhibitor not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(exhibitor, k, v)
    await db.commit()
    await db.refresh(exhibitor)
    return exhibitor

class ExhibitorHorseAttach(BaseModel):
    horse_id: UUID

@exhibitors_router.get("/{exhibitor_id}/horses", response_model=list[HorseOut])
async def get_exhibitor_horses(exhibitor_id: UUID, db: AsyncSession = Depends(get_db)):
    """Returns horses owned by, directly attached to, or entered by this exhibitor."""
    from_ownership = select(Horse.id).where(Horse.owner_exhibitor_id == exhibitor_id)
    from_link = select(Horse.id).join(ExhibitorHorse, ExhibitorHorse.horse_id == Horse.id).where(ExhibitorHorse.exhibitor_id == exhibitor_id)
    from_entry = select(Horse.id).join(Entry, Entry.horse_id == Horse.id).where(Entry.exhibitor_id == exhibitor_id)
    combined = union(from_ownership, from_link, from_entry).subquery()
    result = await db.execute(
        select(Horse).options(*_horse_options).where(Horse.id.in_(select(combined.c.id))).order_by(Horse.name)
    )
    return result.scalars().all()

@exhibitors_router.get("/{exhibitor_id}/owned-horses", response_model=list[HorseOut])
async def get_exhibitor_owned_horses(exhibitor_id: UUID, db: AsyncSession = Depends(get_db)):
    """Horses where this exhibitor is the registered owner."""
    result = await db.execute(
        select(Horse).options(*_horse_options)
        .where(Horse.owner_exhibitor_id == exhibitor_id)
        .order_by(Horse.name)
    )
    return result.scalars().all()

@exhibitors_router.post("/{exhibitor_id}/owned-horses", response_model=HorseOut, status_code=201)
async def create_owned_horse(
    exhibitor_id: UUID,
    body: HorseCreate,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Create a horse and set this exhibitor as owner. Caller must own this exhibitor record."""
    result = await db.execute(
        select(Exhibitor).where(Exhibitor.id == exhibitor_id, Exhibitor.user_id == safe_uuid(user_id))
    )
    if not result.scalar_one_or_none():
        raise HTTPException(403, "You can only add horses to your own profile")
    horse = Horse(**body.model_dump(exclude={'owner_exhibitor_id'}), owner_exhibitor_id=exhibitor_id)
    db.add(horse)
    await db.commit()
    result = await db.execute(select(Horse).options(*_horse_options).where(Horse.id == horse.id))
    return result.scalar_one()

@exhibitors_router.delete("/{exhibitor_id}/owned-horses/{horse_id}", status_code=204)
async def remove_owned_horse(
    exhibitor_id: UUID,
    horse_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Clear ownership of a horse. Caller must own this exhibitor record."""
    result = await db.execute(
        select(Exhibitor).where(Exhibitor.id == exhibitor_id, Exhibitor.user_id == safe_uuid(user_id))
    )
    if not result.scalar_one_or_none():
        raise HTTPException(403, "You can only remove horses from your own profile")
    horse = await db.get(Horse, horse_id)
    if not horse or horse.owner_exhibitor_id != exhibitor_id:
        raise HTTPException(404, "Horse not found in your profile")
    horse.owner_exhibitor_id = None
    await db.commit()

@exhibitors_router.get("/{exhibitor_id}/created-horses", response_model=list[HorseOut])
async def get_exhibitor_created_horses(
    exhibitor_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Horses created by this exhibitor (they manage the profile regardless of ownership)."""
    result = await db.execute(
        select(Horse).options(*_horse_options)
        .where(Horse.created_by_exhibitor_id == exhibitor_id)
        .order_by(Horse.name)
    )
    return result.scalars().all()


@exhibitors_router.delete("/{exhibitor_id}/created-horses/{horse_id}", status_code=204)
async def remove_created_horse_from_profile(
    exhibitor_id: UUID,
    horse_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Remove a created horse from the calling exhibitor's profile without deleting the horse.
    Clears created_by_exhibitor_id (and owner_exhibitor_id if it matches this exhibitor)."""
    result = await db.execute(
        select(Exhibitor).where(Exhibitor.id == exhibitor_id, Exhibitor.user_id == safe_uuid(user_id))
    )
    if not result.scalar_one_or_none():
        raise HTTPException(403, "You can only remove horses from your own profile")
    horse = await db.get(Horse, horse_id)
    if not horse or horse.created_by_exhibitor_id != exhibitor_id:
        raise HTTPException(404, "Horse not found on your profile")
    horse.created_by_exhibitor_id = None
    if horse.owner_exhibitor_id == exhibitor_id:
        horse.owner_exhibitor_id = None
    await db.commit()


@exhibitors_router.get("/{exhibitor_id}/my-horses", response_model=list[HorseOut])
async def get_exhibitor_my_horses(
    exhibitor_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """All horses on this exhibitor's profile: created by them OR linked via exhibitor_horses."""
    from_creator = select(Horse.id).where(Horse.created_by_exhibitor_id == exhibitor_id)
    from_link = select(Horse.id).join(ExhibitorHorse, ExhibitorHorse.horse_id == Horse.id).where(ExhibitorHorse.exhibitor_id == exhibitor_id)
    combined = union(from_creator, from_link).subquery()
    result = await db.execute(
        select(Horse).options(*_horse_options).where(Horse.id.in_(select(combined.c.id))).order_by(Horse.name)
    )
    return result.scalars().all()


class LinkedHorseAttach(BaseModel):
    horse_id: UUID


@exhibitors_router.post("/{exhibitor_id}/linked-horses", response_model=HorseOut, status_code=201)
async def link_existing_horse_to_self(
    exhibitor_id: UUID,
    body: LinkedHorseAttach,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Self-service: link an existing horse to the calling exhibitor's profile."""
    result = await db.execute(
        select(Exhibitor).where(Exhibitor.id == exhibitor_id, Exhibitor.user_id == safe_uuid(user_id))
    )
    if not result.scalar_one_or_none():
        raise HTTPException(403, "You can only link horses to your own profile")
    horse = await db.get(Horse, body.horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    link = ExhibitorHorse(exhibitor_id=exhibitor_id, horse_id=body.horse_id)
    db.add(link)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "This horse is already on your profile")
    result = await db.execute(select(Horse).options(*_horse_options).where(Horse.id == body.horse_id))
    return result.scalar_one()


@exhibitors_router.delete("/{exhibitor_id}/linked-horses/{horse_id}", status_code=204)
async def unlink_horse_from_self(
    exhibitor_id: UUID,
    horse_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Self-service: remove a linked horse from the calling exhibitor's profile.
    Does not delete the horse — only removes the rider link."""
    result = await db.execute(
        select(Exhibitor).where(Exhibitor.id == exhibitor_id, Exhibitor.user_id == safe_uuid(user_id))
    )
    if not result.scalar_one_or_none():
        raise HTTPException(403, "You can only unlink horses from your own profile")
    result = await db.execute(
        select(ExhibitorHorse).where(
            ExhibitorHorse.exhibitor_id == exhibitor_id,
            ExhibitorHorse.horse_id == horse_id,
        )
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Horse is not linked to your profile")
    await db.delete(link)
    await db.commit()


@exhibitors_router.post("/{exhibitor_id}/created-horses", response_model=HorseOut, status_code=201)
async def create_horse_for_exhibitor(
    exhibitor_id: UUID,
    body: HorseCreate,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Create a horse profile via self-service. The caller must be the owner of the horse —
    they cannot create a profile for a horse owned by someone else."""
    result = await db.execute(
        select(Exhibitor).where(Exhibitor.id == exhibitor_id, Exhibitor.user_id == safe_uuid(user_id))
    )
    if not result.scalar_one_or_none():
        raise HTTPException(403, "You can only create horses for your own profile")

    # Reject any attempt to set a different owner — exhibitors may only register horses they own.
    if body.owner_exhibitor_id is not None and body.owner_exhibitor_id != exhibitor_id:
        raise HTTPException(403, "You cannot create a horse you do not own. Only the owner of the horse can register it.")

    horse = Horse(
        **body.model_dump(exclude={'owner_exhibitor_id'}),
        created_by_exhibitor_id=exhibitor_id,
        owner_exhibitor_id=exhibitor_id,
    )
    db.add(horse)
    await db.commit()
    result = await db.execute(select(Horse).options(*_horse_options).where(Horse.id == horse.id))
    return result.scalar_one()


@exhibitors_router.post("/{exhibitor_id}/horses", response_model=HorseOut, status_code=201, dependencies=[Depends(require_admin)])
async def attach_horse_to_exhibitor(exhibitor_id: UUID, body: ExhibitorHorseAttach, db: AsyncSession = Depends(get_db)):
    exhibitor = await db.get(Exhibitor, exhibitor_id)
    if not exhibitor:
        raise HTTPException(404, "Exhibitor not found")
    horse = await db.get(Horse, body.horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    link = ExhibitorHorse(exhibitor_id=exhibitor_id, horse_id=body.horse_id)
    db.add(link)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Horse is already attached to this exhibitor")
    return horse

@exhibitors_router.delete("/{exhibitor_id}/horses/{horse_id}", status_code=204, dependencies=[Depends(require_admin)])
async def detach_horse_from_exhibitor(exhibitor_id: UUID, horse_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ExhibitorHorse).where(ExhibitorHorse.exhibitor_id == exhibitor_id, ExhibitorHorse.horse_id == horse_id)
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Horse is not attached to this exhibitor")
    await db.delete(link)
    await db.commit()

@exhibitors_router.patch("/{exhibitor_id}/link", response_model=ExhibitorOut, dependencies=[Depends(require_admin)])
async def link_exhibitor(exhibitor_id: UUID, body: ExhibitorLink, db: AsyncSession = Depends(get_db)):
    exhibitor = await db.get(Exhibitor, exhibitor_id)
    if not exhibitor:
        raise HTTPException(404, "Exhibitor not found")
    exhibitor.user_id = body.user_id
    await db.commit()
    await db.refresh(exhibitor)
    return exhibitor

@exhibitors_router.delete("/{exhibitor_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_exhibitor(exhibitor_id: UUID, db: AsyncSession = Depends(get_db)):
    exhibitor = await db.get(Exhibitor, exhibitor_id)
    if not exhibitor:
        raise HTTPException(404, "Exhibitor not found")
    await db.delete(exhibitor)
    await db.commit()


# ── Exhibitor Registrations ───────────────────────────────────────────────────

def _exhibitor_reg_out(reg: ExhibitorRegistration) -> ExhibitorRegistrationOut:
    return ExhibitorRegistrationOut(
        id=reg.id,
        show_type_id=reg.show_type_id,
        show_type_code=reg.show_type.code,
        show_type_name=reg.show_type.name,
        member_number=reg.member_number,
    )

async def _check_exhibitor_access(exhibitor_id: UUID, x_user_id: str, x_user_role: str, db: AsyncSession):
    if x_user_role == "ADMIN":
        return
    exhibitor = await db.get(Exhibitor, exhibitor_id)
    if not exhibitor or str(exhibitor.user_id) != x_user_id:
        raise HTTPException(403, "Access denied")

@exhibitors_router.get("/{exhibitor_id}/registrations", response_model=list[ExhibitorRegistrationOut], dependencies=[Depends(require_api_key)])
async def list_exhibitor_registrations(exhibitor_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ExhibitorRegistration)
        .where(ExhibitorRegistration.exhibitor_id == exhibitor_id)
        .options(selectinload(ExhibitorRegistration.show_type))
        .order_by(ExhibitorRegistration.created_at)
    )
    return [_exhibitor_reg_out(r) for r in result.scalars().all()]

@exhibitors_router.post("/{exhibitor_id}/registrations", response_model=ExhibitorRegistrationOut, status_code=201)
async def add_exhibitor_registration(
    exhibitor_id: UUID,
    body: ExhibitorRegistrationCreate,
    db: AsyncSession = Depends(get_db),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    x_api_key: str = Header(...),
):
    await _check_exhibitor_access(exhibitor_id, x_user_id, x_user_role, db)
    reg = ExhibitorRegistration(
        exhibitor_id=exhibitor_id,
        show_type_id=body.show_type_id,
        member_number=body.member_number.strip(),
    )
    db.add(reg)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Registration for this association already exists")
    await db.refresh(reg)
    result = await db.execute(
        select(ExhibitorRegistration)
        .where(ExhibitorRegistration.id == reg.id)
        .options(selectinload(ExhibitorRegistration.show_type))
    )
    return _exhibitor_reg_out(result.scalar_one())

@exhibitors_router.delete("/{exhibitor_id}/registrations/{reg_id}", status_code=204)
async def delete_exhibitor_registration(
    exhibitor_id: UUID,
    reg_id: UUID,
    db: AsyncSession = Depends(get_db),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    x_api_key: str = Header(...),
):
    await _check_exhibitor_access(exhibitor_id, x_user_id, x_user_role, db)
    reg = await db.get(ExhibitorRegistration, reg_id)
    if not reg or reg.exhibitor_id != exhibitor_id:
        raise HTTPException(404, "Registration not found")
    await db.delete(reg)
    await db.commit()
