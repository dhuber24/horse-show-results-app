import re
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, union, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload, load_only
from uuid import UUID
from typing import Optional
from pydantic import BaseModel, EmailStr
from datetime import date, datetime, timezone
import bcrypt

from database import get_db
from dependencies import require_admin, require_admin_or_show_admin, require_authenticated, require_api_key, safe_uuid
from routers.horse_access import approval_url, build_access_request, notify_request
from routers.auth import clear_security_answer_throttle, hash_security_answer
from models import User, Horse, Breed, Exhibitor, Entry, ExhibitorHorse, HorseRegistration, HorseDocument, ExhibitorRegistration, Trainer, Association, Class, Show
from schemas import (
    UserCreate, UserOut,
    CreatedHorseResult,
    HorseCreate, HorseCreateWithRegistrations, HorseWithRegistrationsBase,
    HorseUpdate, HorseOut, MyHorseOut, HorseSearchMatch,
    HorseRegistrationCreate, HorseRegistrationOut,
    HorseRiderOut, HorseRiderCreate,
    ExhibitorCreate, ExhibitorUpdate, ExhibitorOut, ExhibitorCreateWithUser,
    ExhibitorRegistrationCreate, ExhibitorRegistrationOut,
)

VALID_ROLES = {"ADMIN", "SHOW_MANAGER", "SHOW_SECRETARY", "SCRIBE", "GATE_STEWARD", "EXHIBITOR", "TRAINER"}


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _display_name(first_name: str, last_name: str) -> str:
    return f"{first_name.strip()} {last_name.strip()}".strip()


def _split_person_name(value: str) -> tuple[str, str]:
    first, _, last = value.strip().partition(" ")
    return first.strip(), last.strip()


def _validate_name_parts(first_name: Optional[str], last_name: Optional[str]) -> None:
    if first_name is not None and not first_name.strip():
        raise HTTPException(400, "First name is required")
    if last_name is not None and not last_name.strip():
        raise HTTPException(400, "Last name is required")


async def _ensure_role_profile(user: User, db: AsyncSession):
    if user.role == "EXHIBITOR":
        existing = await db.execute(select(Exhibitor).where(Exhibitor.user_id == user.id))
        if not existing.scalar_one_or_none():
            db.add(Exhibitor(full_name=_display_name(user.first_name, user.last_name), user_id=user.id))
    if user.role == "TRAINER":
        existing = await db.execute(select(Trainer).where(Trainer.user_id == user.id))
        if not existing.scalar_one_or_none():
            db.add(Trainer(first_name=user.first_name, last_name=user.last_name, user_id=user.id))

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


@users_router.get("/by-role", response_model=list[UserOut])
async def list_users_by_role(
    role: str = Query(..., min_length=1),
    x_api_key: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Approved users with a given role. Used by the show-setup wizard's
    select-secretary / select-judge pickers, which need to be callable by
    Show Managers as well as Admins."""
    from dependencies import INTERNAL_API_KEY
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    if x_user_role not in ("ADMIN", "SHOW_MANAGER", "SHOW_SECRETARY"):
        raise HTTPException(403, "Insufficient permissions")
    if role not in VALID_ROLES:
        raise HTTPException(400, f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")
    result = await db.execute(
        select(User)
        .where(User.role == role, User.is_approved.is_(True))
        .order_by(User.full_name)
    )
    return result.scalars().all()

@users_router.post("/", response_model=UserOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_user(body: UserCreate, db: AsyncSession = Depends(get_db)):
    _validate_name_parts(body.first_name, body.last_name)
    data = body.model_dump()
    data["email"] = _normalize_email(data["email"])
    user = User(**data)
    db.add(user)
    await db.flush()
    await _ensure_role_profile(user, db)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Email already registered")
    await db.refresh(user)
    return user


class UserWithPasswordCreate(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
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
    ADMIN can create any role. SHOW_SECRETARY can only create SCRIBE accounts.
    """
    from dependencies import INTERNAL_API_KEY
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if x_user_role == "SHOW_SECRETARY" and body.role != "SCRIBE":
        raise HTTPException(status_code=403, detail="Show Secretaries can only create Scribe accounts")
    if x_user_role == "SHOW_MANAGER" and body.role != "SHOW_SECRETARY":
        raise HTTPException(status_code=403, detail="Show Managers can only create Show Secretary accounts")
    if x_user_role not in ("ADMIN", "SHOW_SECRETARY", "SHOW_MANAGER"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    _validate_name_parts(body.first_name, body.last_name)

    email = _normalize_email(body.email)
    existing = await db.execute(select(User).where(func.lower(User.email) == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    user = User(
        email=email,
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
        role=body.role,
        hashed_password=hashed,
    )
    db.add(user)
    await db.flush()
    await _ensure_role_profile(user, db)
    await db.commit()
    await db.refresh(user)
    return user


class RoleUpdate(BaseModel):
    role: str


class UserProfileUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None


class AdminUserProfileUpdate(UserProfileUpdate):
    aqha_management_workshop_completed_at: Optional[date] = None


class CurrentUserProfileUpdate(UserProfileUpdate):
    current_password: Optional[str] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class SecurityQuestionSet(BaseModel):
    question: str
    answer: str
    current_password: str


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
    body: CurrentUserProfileUpdate,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, safe_uuid(user_id))
    if not user:
        raise HTTPException(404, "User not found")

    # Email is the login identifier — require password confirmation to change it.
    new_email = _normalize_email(body.email) if body.email is not None else None
    if new_email is not None and new_email != user.email.lower():
        if not body.current_password:
            raise HTTPException(400, "Confirm your password to change your email.")
        if not user.hashed_password or not bcrypt.checkpw(body.current_password.encode(), user.hashed_password.encode()):
            raise HTTPException(400, "Password is incorrect.")

    updates = body.model_dump(exclude_unset=True, exclude={'current_password'})
    if "email" in updates and updates["email"] is not None:
        updates["email"] = _normalize_email(updates["email"])
    _validate_name_parts(updates.get("first_name"), updates.get("last_name"))
    for k, v in updates.items():
        setattr(user, k, v.strip() if isinstance(v, str) else v)
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


@users_router.get("/me/security-question")
async def get_current_user_security_question(
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """The question only, never the answer — there is nothing to return for the
    answer, since only its bcrypt hash is stored. Kept off UserOut on purpose: a
    question people write themselves tends to hint at its own answer, and UserOut
    is what the admin user list renders."""
    user = await db.get(User, safe_uuid(user_id))
    if not user:
        raise HTTPException(404, "User not found")
    return {
        "question": user.security_question,
        "set_at": user.security_answer_set_at,
    }


@users_router.put("/me/security-question", status_code=204)
async def set_current_user_security_question(
    body: SecurityQuestionSet,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Setting the question needs the current password, for the same reason
    changing the email does: this is a second way into the account. Without the
    check, anyone who found an unlocked laptop could install a question they know
    the answer to and own the account from anywhere, later."""
    question = body.question.strip()
    answer = body.answer.strip()
    if len(question) < 8:
        raise HTTPException(400, "Write a question of at least 8 characters")
    if not question.endswith("?"):
        raise HTTPException(400, "Write the prompt as a question, ending in '?'")
    if len(answer) < 3:
        raise HTTPException(400, "Answer must be at least 3 characters")

    user = await db.get(User, safe_uuid(user_id))
    if not user:
        raise HTTPException(404, "User not found")
    if not user.hashed_password or not bcrypt.checkpw(body.current_password.encode(), user.hashed_password.encode()):
        raise HTTPException(400, "Current password is incorrect")
    # An answer that *is* the password turns one secret into two copies of itself:
    # the reset route would then accept the password in a field that is stored,
    # displayed unmasked while typing, and guessed against with a 5-try budget.
    if bcrypt.checkpw(answer.encode(), user.hashed_password.encode()):
        raise HTTPException(400, "Your answer can't be your password")

    user.security_question = question
    user.security_answer_hash = hash_security_answer(answer)
    user.security_answer_set_at = datetime.now(timezone.utc)
    clear_security_answer_throttle(user)
    await db.commit()


@users_router.delete("/me/security-question", status_code=204)
async def clear_current_user_security_question(
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Removing the question closes the self-serve reset route for this account,
    which is a legitimate thing to want — it is one more way in."""
    user = await db.get(User, safe_uuid(user_id))
    if not user:
        raise HTTPException(404, "User not found")
    user.security_question = None
    user.security_answer_hash = None
    user.security_answer_set_at = None
    clear_security_answer_throttle(user)
    await db.commit()


@users_router.patch("/{user_id}", response_model=UserOut, dependencies=[Depends(require_admin)])
async def update_user(user_id: UUID, body: AdminUserProfileUpdate, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    updates = body.model_dump(exclude_unset=True)
    if "email" in updates and updates["email"] is not None:
        updates["email"] = _normalize_email(updates["email"])
    _validate_name_parts(updates.get("first_name"), updates.get("last_name"))
    for k, v in updates.items():
        setattr(user, k, v.strip() if isinstance(v, str) else v)
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
    # The admin has just handed them a working password, so any security-answer
    # lockout has served its purpose. Leaving it set would strand the user on the
    # reset route the next time they need it, for a guessing spree that is over.
    clear_security_answer_throttle(user)
    await db.commit()


@users_router.get("/{user_id}/security-question", dependencies=[Depends(require_admin)])
async def get_user_security_question_status(user_id: UUID, db: AsyncSession = Depends(get_db)):
    """Whether the account has a question and whether its reset route is locked —
    deliberately *not* the question text. An admin never needs to read it, and a
    self-written question usually hints at its own answer; admins can already
    reset the password outright, so showing it would add a leak and no capability."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return {
        "has_question": user.security_question is not None,
        "set_at": user.security_answer_set_at,
        "failed_attempts": user.security_answer_failed_attempts or 0,
        "locked_until": user.security_answer_locked_until,
    }


@users_router.delete("/{user_id}/security-question", status_code=204, dependencies=[Depends(require_admin)])
async def clear_user_security_question(user_id: UUID, db: AsyncSession = Depends(get_db)):
    """For the user who forgot their *answer*. Clearing beats editing: an admin
    setting a replacement question would have to know the new answer too, which
    hands a second credential for someone else's account to whoever is at the
    keyboard. Cleared, the user sets their own on next sign-in."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.security_question = None
    user.security_answer_hash = None
    user.security_answer_set_at = None
    clear_security_answer_throttle(user)
    await db.commit()


@users_router.patch("/{user_id}/role", response_model=UserOut, dependencies=[Depends(require_admin)])
async def update_user_role(user_id: UUID, body: RoleUpdate, db: AsyncSession = Depends(get_db)):
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.role = body.role
    await _ensure_role_profile(user, db)
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
    linked_trainer = await db.execute(select(Trainer).where(Trainer.user_id == user_id))
    trainer = linked_trainer.scalar_one_or_none()
    if trainer:
        await db.delete(trainer)
    await db.delete(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            409,
            "Cannot delete user: still referenced by other records. "
            "Remove the dependent records first.",
        )


# ── Horses ─────────────────────────────────────────────────────────────────────

horses_router = APIRouter(prefix="/horses", tags=["Horses"])

_horse_options = [
    selectinload(Horse.breed),
    selectinload(Horse.breeds),
    selectinload(Horse.color),
    selectinload(Horse.pattern),
    selectinload(Horse.owner_exhibitor),
    selectinload(Horse.trainer),
]

# Adds what MyHorseOut needs. The document load_only is deliberate: HorseDocument
# carries the file bytes, and this list must never drag them into memory.
_my_horse_options = _horse_options + [
    selectinload(Horse.registrations).selectinload(HorseRegistration.association),
    selectinload(Horse.documents).load_only(
        HorseDocument.document_type,
        HorseDocument.issue_date,
        HorseDocument.expiry_date,
    ),
]


def _my_horse_out(horse: Horse, exhibitor_id: UUID) -> MyHorseOut:
    """Serialize for the profile horse list. Document status is owner-only, matching
    the access rule on the horse documents endpoints."""
    out = MyHorseOut.model_validate(horse)
    if horse.owner_exhibitor_id != exhibitor_id:
        out.documents = []
    return out


def _digits_only(value: Optional[str]) -> str:
    if not value:
        return ""
    return re.sub(r"\D", "", value)


async def assert_registrations_available(
    registrations: list[HorseRegistrationCreate], db: AsyncSession
) -> None:
    """Every registration number is free and each association appears once.

    Checked up front, before anything is inserted, so a number that is already
    on file for a different horse never leaves a half-created horse behind.
    Shared by the exhibitor's own add-a-horse wizard and the show office's
    on-behalf-of path (`routers/show_office.py`).
    """
    seen_association_ids: set[UUID] = set()
    for reg in registrations:
        number = reg.registration_number.strip()
        if not number:
            raise HTTPException(400, "Registration number cannot be empty")
        if reg.association_id in seen_association_ids:
            raise HTTPException(409, "Each association can only have one registration number")
        seen_association_ids.add(reg.association_id)

        conflict = await db.execute(
            select(Horse)
            .join(HorseRegistration, HorseRegistration.horse_id == Horse.id)
            .where(
                HorseRegistration.association_id == reg.association_id,
                HorseRegistration.registration_number == number,
            )
            .limit(1)
        )
        other = conflict.scalar_one_or_none()
        if other:
            suffix = f" (owner: {other.owner_name})" if other.owner_name else ""
            raise HTTPException(
                409,
                f"Registration {number} is already on file for horse '{other.name}'{suffix}. "
                f"If this is the same horse, contact your show secretary.",
            )


async def build_horse_with_registrations(
    body: HorseWithRegistrationsBase,
    owner_exhibitor_id: Optional[UUID],
    created_by_exhibitor_id: Optional[UUID],
    created_by_user_id: Optional[UUID],
    db: AsyncSession,
) -> Horse:
    """Insert the horse and its registrations, flushed but not committed.

    Left uncommitted so the caller owns the transaction — the registrations must
    land with the horse or not at all, and a caller may have more to write in the
    same unit of work. `assert_registrations_available` is expected to have run
    first; the IntegrityError handling on commit is the race backstop.
    """
    # Take the horse's own fields and nothing else. Owner selection is resolved
    # by the caller and passed explicitly, so no request shape — self-service or
    # staff — can point the horse at an owner through the body.
    dumped = body.model_dump()
    horse_data = {
        key: value
        for key, value in dumped.items()
        if key in HorseCreate.model_fields and key != 'owner_exhibitor_id'
    }
    breeds = await _pop_resolved_horse_breeds(horse_data, db)
    await _resolve_horse_trainer_fields(horse_data, db)
    horse = Horse(
        **horse_data,
        created_by_exhibitor_id=created_by_exhibitor_id,
        created_by_user_id=created_by_user_id,
        owner_exhibitor_id=owner_exhibitor_id,
    )
    if breeds is not None:
        horse.breeds = breeds
    db.add(horse)
    await db.flush()

    for reg in body.registrations:
        db.add(HorseRegistration(
            horse_id=horse.id,
            association_id=reg.association_id,
            registration_number=reg.registration_number.strip(),
        ))
    return horse


async def load_my_horse(horse_id: UUID, exhibitor_id: UUID, db: AsyncSession) -> MyHorseOut:
    """Re-read a horse with everything MyHorseOut serializes."""
    result = await db.execute(select(Horse).options(*_my_horse_options).where(Horse.id == horse_id))
    return _my_horse_out(result.scalar_one(), exhibitor_id)


async def _find_or_create_trainer_by_name_email(
    first_name: str, last_name: str, email: str, db: AsyncSession
) -> Trainer:
    # Match exact first name + last name + email, case-insensitively. Email is
    # the validation key for "Other" trainer rows so we avoid creating duplicate
    # registry records when the trainer already exists.
    first_norm = first_name.strip()
    last_norm = last_name.strip()
    email_norm = email.strip().lower()
    existing = await db.execute(
        select(Trainer).where(
            func.lower(Trainer.first_name) == first_norm.lower(),
            func.lower(Trainer.last_name) == last_norm.lower(),
            func.lower(Trainer.email) == email_norm,
        )
    )
    trainer = existing.scalar_one_or_none()
    if trainer:
        return trainer
    trainer = Trainer(
        first_name=first_norm,
        last_name=last_norm,
        email=email_norm,
        user_id=None,
    )
    db.add(trainer)
    await db.flush()
    return trainer


async def _resolve_horse_trainer_fields(data: dict, db: AsyncSession) -> None:
    """In-place: resolve transient trainer fields into horse storage columns.

    Rules:
    - trainer_id set: keep it, clear free-text fallback.
    - trainer_first_name + trainer_last_name + trainer_email, no trainer_id:
      find-or-create a registry row and link to it.
    - trainer_name only (legacy): keep as free-text fallback.
    - Pops transient trainer fields so they don't leak into Horse(**data).
    """
    trainer_phone = data.pop("trainer_phone", None)
    trainer_first_name = data.pop("trainer_first_name", None)
    trainer_last_name = data.pop("trainer_last_name", None)
    trainer_email = data.pop("trainer_email", None)
    if data.get("trainer_id"):
        data["trainer_name"] = None
        return
    if trainer_first_name and trainer_last_name and trainer_email:
        trainer = await _find_or_create_trainer_by_name_email(
            trainer_first_name, trainer_last_name, str(trainer_email), db
        )
        data["trainer_id"] = trainer.id
        data["trainer_name"] = None
        return
    name = data.get("trainer_name")
    if name and trainer_phone:
        first_name, last_name = _split_person_name(name)
        if not last_name:
            return
        trainer = Trainer(
            first_name=first_name,
            last_name=last_name,
            phone=trainer_phone.strip(),
            user_id=None,
        )
        db.add(trainer)
        await db.flush()
        data["trainer_id"] = trainer.id
        data["trainer_name"] = None


async def _pop_resolved_horse_breeds(data: dict, db: AsyncSession) -> Optional[list[Breed]]:
    """Return selected breeds and remove plural-only input from Horse column data."""
    has_breed_ids = "breed_ids" in data
    breed_ids = data.pop("breed_ids", None)

    if not has_breed_ids:
        if "breed_id" not in data:
            return None
        breed_ids = [data["breed_id"]] if data["breed_id"] else []
    elif breed_ids is None:
        breed_ids = [data["breed_id"]] if data.get("breed_id") else []

    unique_ids = list(dict.fromkeys(breed_ids))
    if not unique_ids:
        data["breed_id"] = None
        return []

    result = await db.execute(select(Breed).where(Breed.id.in_(unique_ids)))
    breeds_by_id = {breed.id: breed for breed in result.scalars().all()}
    missing = [breed_id for breed_id in unique_ids if breed_id not in breeds_by_id]
    if missing:
        raise HTTPException(400, "One or more selected breeds are not valid.")

    data["breed_id"] = unique_ids[0]
    return [breeds_by_id[breed_id] for breed_id in unique_ids]


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
    association_id: UUID,
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
            HorseRegistration.association_id == association_id,
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


@horses_router.get("/search", response_model=list[HorseSearchMatch], dependencies=[Depends(require_authenticated)])
async def search_horses_by_name(
    q: str = Query(min_length=2, max_length=100),
    limit: int = Query(10, ge=1, le=25),
    db: AsyncSession = Depends(get_db),
):
    """Find horses already in the system by registered name, barn name, or
    registration number, so an exhibitor can link one to their profile without
    knowing the exact association number. Barn name is matched because that is
    frequently the only name a rider knows the horse by. Returns the same minimal
    identifying info as the registration lookup."""
    term = q.strip()
    if len(term) < 2:
        raise HTTPException(400, "Enter at least 2 characters to search")
    pattern = f"%{term}%"
    result = await db.execute(
        select(Horse)
        .options(
            selectinload(Horse.breeds),
            selectinload(Horse.breed),
            selectinload(Horse.owner_exhibitor),
            selectinload(Horse.registrations).selectinload(HorseRegistration.association),
        )
        .outerjoin(HorseRegistration, HorseRegistration.horse_id == Horse.id)
        .where(or_(
            Horse.name.ilike(pattern),
            Horse.barn_name.ilike(pattern),
            HorseRegistration.registration_number.ilike(pattern),
        ))
        .order_by(Horse.name)
        .distinct()
        .limit(limit)
    )
    horses = result.scalars().unique().all()
    return [
        HorseSearchMatch(
            horse_id=h.id,
            horse_name=h.name,
            barn_name=h.barn_name,
            owner_name=h.owner_exhibitor.full_name if h.owner_exhibitor else h.owner_name,
            sex=h.sex,
            breed_name=', '.join(b.name for b in h.breeds) or (h.breed.name if h.breed else None),
            registrations=[
                {
                    "association_id": r.association_id,
                    "association_code": r.association.code if r.association else "",
                    "association_type": r.association.association_type if r.association else "breed",
                    "registration_number": r.registration_number,
                }
                for r in h.registrations
            ],
        )
        for h in horses
    ]


@horses_router.post("/", response_model=HorseOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_horse(body: HorseCreate, db: AsyncSession = Depends(get_db)):
    if body.owner_exhibitor_id is not None and not await db.get(Exhibitor, body.owner_exhibitor_id):
        raise HTTPException(400, "Selected owner is not a valid exhibitor.")
    if body.trainer_id is not None and not await db.get(Trainer, body.trainer_id):
        raise HTTPException(400, "Selected trainer is not in the registry.")
    data = body.model_dump()
    breeds = await _pop_resolved_horse_breeds(data, db)
    await _resolve_horse_trainer_fields(data, db)
    horse = Horse(**data)
    if breeds is not None:
        horse.breeds = breeds
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
    if 'owner_exhibitor_id' in update_data and update_data['owner_exhibitor_id'] is not None:
        if not await db.get(Exhibitor, update_data['owner_exhibitor_id']):
            raise HTTPException(400, "Selected owner is not a valid exhibitor.")
    if 'trainer_id' in update_data and update_data['trainer_id'] is not None:
        if not await db.get(Trainer, update_data['trainer_id']):
            raise HTTPException(400, "Selected trainer is not in the registry.")
    breeds = await _pop_resolved_horse_breeds(update_data, db)
    # If the caller is switching/clearing the trainer, resolve trainer_id or
    # transient trainer identity fields into the columns we store. The legacy
    # name-only path keeps the free-text fallback for backwards compatibility.
    if (
        'trainer_id' in update_data
        or 'trainer_name' in update_data
        or 'trainer_phone' in update_data
        or 'trainer_first_name' in update_data
        or 'trainer_last_name' in update_data
        or 'trainer_email' in update_data
    ):
        if update_data.get('trainer_id'):
            update_data['trainer_name'] = None
        elif (
            update_data.get('trainer_first_name')
            and update_data.get('trainer_last_name')
            and update_data.get('trainer_email')
        ) or (update_data.get('trainer_name') and update_data.get('trainer_phone')):
            await _resolve_horse_trainer_fields(update_data, db)
        else:
            update_data.pop('trainer_phone', None)
            update_data.pop('trainer_first_name', None)
            update_data.pop('trainer_last_name', None)
            update_data.pop('trainer_email', None)
            if 'trainer_name' in update_data and update_data.get('trainer_name'):
                update_data['trainer_id'] = None
    for k, v in update_data.items():
        setattr(horse, k, v)
    if breeds is not None:
        horse.breeds = breeds
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
        .options(selectinload(HorseRegistration.association))
        .where(HorseRegistration.horse_id == horse_id)
        .order_by(HorseRegistration.created_at)
    )
    return result.scalars().all()


async def _registration_conflict_message(
    association_id: UUID,
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
            HorseRegistration.association_id == association_id,
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
            HorseRegistration.association_id == body.association_id,
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

    # Per-horse uniqueness on (horse_id, association_id) — one number per horse per association
    same_assoc_q = await db.execute(
        select(HorseRegistration).where(
            HorseRegistration.horse_id == horse_id,
            HorseRegistration.association_id == body.association_id,
        )
    )
    if same_assoc_q.scalar_one_or_none():
        raise HTTPException(409, "This horse already has a registration for that association")

    reg = HorseRegistration(
        horse_id=horse_id,
        association_id=body.association_id,
        registration_number=number,
    )
    db.add(reg)
    try:
        await db.commit()
    except IntegrityError:
        # Race-condition safety net (concurrent insert won the application check)
        await db.rollback()
        msg = await _registration_conflict_message(
            body.association_id, body.registration_number, horse_id, db
        )
        raise HTTPException(409, msg)
    result = await db.execute(
        select(HorseRegistration)
        .options(selectinload(HorseRegistration.association))
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


def _normalize_name(name: str) -> str:
    """Collapse whitespace and lower-case for dedup key."""
    return re.sub(r'\s+', ' ', (name or '').strip()).lower()


def _dedup_exhibitors(rows: list) -> list:
    """Deduplicate by normalized full_name, preferring user-linked records."""
    seen: dict[str, object] = {}
    for ex in rows:
        key = _normalize_name(ex.full_name)
        if not key:
            continue
        if key not in seen or (ex.user_id is not None and seen[key].user_id is None):  # type: ignore[union-attr]
            seen[key] = ex
    return sorted(seen.values(), key=lambda e: _normalize_name(e.full_name))  # type: ignore[arg-type]


class ExhibitorBasic(BaseModel):
    id: UUID
    full_name: str

    class Config:
        from_attributes = True


@exhibitors_router.get("/names", response_model=list[ExhibitorBasic])
async def list_exhibitor_names(
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Minimal name+id list for owner-selection dropdowns. Only returns exhibitors with a
    linked user account — orphaned/test records without accounts are excluded. Use the
    'Enter owner information' mode for owners who don't have an account."""
    result = await db.execute(
        select(Exhibitor)
        .where(Exhibitor.user_id.is_not(None))
        .order_by(Exhibitor.full_name)
    )
    return _dedup_exhibitors(list(result.scalars().all()))


@exhibitors_router.get("/", response_model=list[ExhibitorOut], dependencies=[Depends(require_admin_or_show_admin)])
async def list_exhibitors(
    limit: Optional[int] = Query(None, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    with_user: bool = Query(False, description="Only return exhibitors with a linked user account"),
    db: AsyncSession = Depends(get_db),
):
    q = select(Exhibitor).order_by(Exhibitor.full_name).offset(offset)
    if with_user:
        q = q.where(Exhibitor.user_id.is_not(None))
    if limit is not None:
        q = q.limit(limit)
    result = await db.execute(q)
    rows = list(result.scalars().all())
    return _dedup_exhibitors(rows)

@exhibitors_router.post("/", response_model=ExhibitorOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_exhibitor(body: ExhibitorCreateWithUser, db: AsyncSession = Depends(get_db)):
    exhibitor = Exhibitor(**body.model_dump())
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

_EXHIBITOR_SELF_SERVICE_FIELDS = {
    'date_of_birth', 'phone', 'address', 'city', 'state', 'zip',
    'emergency_contact_name', 'emergency_contact_phone',
    'parent_guardian_name', 'parent_guardian_phone',
}

@exhibitors_router.patch("/{exhibitor_id}", response_model=ExhibitorOut)
async def update_exhibitor(
    exhibitor_id: UUID,
    body: ExhibitorUpdate,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    exhibitor = await db.get(Exhibitor, exhibitor_id)
    if not exhibitor:
        raise HTTPException(404, "Exhibitor not found")
    if x_user_role != 'ADMIN' and str(exhibitor.user_id) != user_id:
        raise HTTPException(403, "You can only update your own profile")
    updates = body.model_dump(exclude_unset=True)
    if x_user_role != 'ADMIN':
        updates = {k: v for k, v in updates.items() if k in _EXHIBITOR_SELF_SERVICE_FIELDS}
    for k, v in updates.items():
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
    horse_data = body.model_dump(exclude={'owner_exhibitor_id'})
    breeds = await _pop_resolved_horse_breeds(horse_data, db)
    await _resolve_horse_trainer_fields(horse_data, db)
    horse = Horse(**horse_data, owner_exhibitor_id=exhibitor_id)
    if breeds is not None:
        horse.breeds = breeds
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


async def _assert_horse_not_entered(exhibitor_id: UUID, horse_id: UUID, db: AsyncSession) -> None:
    """Refuse to take a horse off a profile while it is entered in a show ahead.

    Taking a horse off a profile does not delete it, and it does not delete the
    entries either -- so without this the exhibitor is left entered on a horse
    that has vanished from every picker they can reach, billed for classes they
    can no longer withdraw from, and the office reads a card with a horse on it
    that its rider no longer manages. Removing the wrong horse is exactly the
    accident the registration screen's Remove button exists for, so the guard
    belongs on the endpoint rather than on the one screen that has a control.

    Scoped to shows that have not finished. An entry at a show last spring is
    history, and refusing forever would mean a horse could never leave a profile
    once it had been shown -- which is the opposite of the mistake being caught.
    """
    rows = await db.execute(
        select(Show.name, func.count(Entry.id))
        .join(Class, Entry.class_id == Class.id)
        .join(Show, Class.show_id == Show.id)
        .where(
            Entry.exhibitor_id == exhibitor_id,
            Entry.horse_id == horse_id,
            Show.end_date >= func.current_date(),
        )
        .group_by(Show.name)
        .order_by(Show.name)
    )
    entered = rows.all()
    if not entered:
        return
    total = sum(count for _, count in entered)
    show_names = ", ".join(name for name, _ in entered)
    raise HTTPException(
        409,
        {
            "code": "HORSE_HAS_ENTRIES",
            "message": (
                f"This horse is entered in {total} class"
                f"{'' if total == 1 else 'es'} at {show_names}. "
                "Withdraw those entries first, then remove the horse."
            ),
            "entry_count": total,
            "shows": [name for name, _ in entered],
        },
    )


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
    await _assert_horse_not_entered(exhibitor_id, horse_id, db)
    horse.created_by_exhibitor_id = None
    if horse.owner_exhibitor_id == exhibitor_id:
        horse.owner_exhibitor_id = None
    await db.commit()


@exhibitors_router.get("/{exhibitor_id}/my-horses", response_model=list[MyHorseOut])
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
        select(Horse).options(*_my_horse_options).where(Horse.id.in_(select(combined.c.id))).order_by(Horse.name)
    )
    return [_my_horse_out(h, exhibitor_id) for h in result.scalars().all()]


class LinkedHorseAttach(BaseModel):
    horse_id: UUID


@exhibitors_router.post("/{exhibitor_id}/linked-horses", response_model=MyHorseOut, status_code=201)
async def link_existing_horse_to_self(
    exhibitor_id: UUID,
    body: LinkedHorseAttach,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Self-service: link an existing horse to the calling exhibitor's profile.

    Only horses nobody on the platform owns can be linked outright. If the horse
    has an owner of record, linking it puts that owner's horse in someone else's
    show-registration picker, so it takes the owner's consent — the caller is
    sent to `POST /horse-access-requests` (migration 087) instead.
    """
    result = await db.execute(
        select(Exhibitor).where(Exhibitor.id == exhibitor_id, Exhibitor.user_id == safe_uuid(user_id))
    )
    if not result.scalar_one_or_none():
        raise HTTPException(403, "You can only link horses to your own profile")
    horse = await db.get(Horse, body.horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    if horse.owner_exhibitor_id is not None and horse.owner_exhibitor_id != exhibitor_id:
        owner = await db.get(Exhibitor, horse.owner_exhibitor_id)
        owner_name = owner.full_name if owner else (horse.owner_name or "the owner")
        raise HTTPException(
            409,
            {
                "code": "OWNER_APPROVAL_REQUIRED",
                "message": (
                    f"{horse.name} is owned by {owner_name}. Send them a request "
                    "and the horse is added to your profile once they approve."
                ),
                "owner_name": owner_name,
                "horse_id": str(horse.id),
                "horse_name": horse.name,
            },
        )
    link = ExhibitorHorse(exhibitor_id=exhibitor_id, horse_id=body.horse_id)
    db.add(link)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "This horse is already on your profile")
    result = await db.execute(select(Horse).options(*_my_horse_options).where(Horse.id == body.horse_id))
    return _my_horse_out(result.scalar_one(), exhibitor_id)


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
    await _assert_horse_not_entered(exhibitor_id, horse_id, db)
    await db.delete(link)
    await db.commit()


@exhibitors_router.post("/{exhibitor_id}/created-horses", response_model=CreatedHorseResult, status_code=201)
async def create_horse_for_exhibitor(
    exhibitor_id: UUID,
    body: HorseCreateWithRegistrations,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Create a horse profile via self-service, either claiming it or filing one
    the caller only rides. Optional registrations are validated and inserted in
    the same transaction so a bad number never leaves an orphaned horse behind.

    Filing a horse against somebody else does not carry an owner's authority.
    Two things follow, both matching what the caller would hit on the horse
    itself afterwards (`_check_horse_access`), so creating the record is not a
    way around either rule:

      - The trainer is the owner's to name, so trainer fields are dropped
        unless the caller is claiming the horse.
      - Putting the horse on the caller's own profile is the question
        `horse_access_requests` exists to ask. When the named owner is already
        on the platform they are asked; when they are not — a brand-new owner
        record with no account — there is nobody to ask and the caller is
        attached as before.
    """
    result = await db.execute(
        select(Exhibitor).where(Exhibitor.id == exhibitor_id, Exhibitor.user_id == safe_uuid(user_id))
    )
    caller = result.scalar_one_or_none()
    if not caller:
        raise HTTPException(403, "You can only create horses for your own profile")

    # Resolve owner from whichever mode was chosen.
    resolved_owner_id: Optional[UUID] = None

    if body.claim_ownership:
        resolved_owner_id = exhibitor_id

    elif body.owner_exhibitor_id is not None:
        owner = await db.get(Exhibitor, body.owner_exhibitor_id)
        if not owner:
            raise HTTPException(400, "Selected owner not found")
        resolved_owner_id = body.owner_exhibitor_id

    elif body.owner_first_name and body.owner_last_name and body.owner_email:
        # Find an existing user by email and use their exhibitor record,
        # or create a new standalone exhibitor record for this owner.
        email_lower = body.owner_email.lower().strip()
        user_result = await db.execute(
            select(User).where(func.lower(User.email) == email_lower)
        )
        existing_user = user_result.scalar_one_or_none()
        if existing_user:
            ex_result = await db.execute(
                select(Exhibitor).where(Exhibitor.user_id == existing_user.id)
            )
            existing_ex = ex_result.scalar_one_or_none()
            if existing_ex:
                resolved_owner_id = existing_ex.id
            else:
                full_name = _display_name(body.owner_first_name, body.owner_last_name)
                new_owner = Exhibitor(full_name=full_name, user_id=existing_user.id)
                db.add(new_owner)
                await db.flush()
                resolved_owner_id = new_owner.id
        else:
            full_name = _display_name(body.owner_first_name, body.owner_last_name)
            new_owner = Exhibitor(full_name=full_name)
            db.add(new_owner)
            await db.flush()
            resolved_owner_id = new_owner.id

    else:
        raise HTTPException(400, "Specify an owner: claim ownership, select an existing owner, or enter owner details.")

    claiming = resolved_owner_id == exhibitor_id

    # Somebody who can actually answer: an owner record with no user account
    # behind it — the standalone row the owner-details branch above just wrote —
    # could never approve anything, so asking would only strand the horse.
    approver: Optional[Exhibitor] = None
    if not claiming and resolved_owner_id is not None:
        owner = await db.get(Exhibitor, resolved_owner_id)
        if owner is not None and owner.user_id is not None:
            approver = owner

    if not claiming:
        # Naming a trainer on a horse you don't own is the same edit the horse's
        # own endpoint refuses, and it can mint a registry row: dropped here so
        # the create path can't be used to make it.
        body = body.model_copy(update={
            "trainer_id": None,
            "trainer_name": None,
            "trainer_phone": None,
            "trainer_first_name": None,
            "trainer_last_name": None,
            "trainer_email": None,
        })

    # Pre-validate every registration before inserting anything.
    await assert_registrations_available(body.registrations, db)

    horse = await build_horse_with_registrations(
        body,
        owner_exhibitor_id=resolved_owner_id,
        # Profile membership reads created_by_exhibitor_id or an
        # exhibitor_horses link, so while approval is pending this stays NULL —
        # approving writes the link. `created_by_user_id` still records who
        # filed the record.
        created_by_exhibitor_id=None if approver is not None else exhibitor_id,
        created_by_user_id=safe_uuid(user_id),
        db=db,
    )

    request = None
    if approver is not None:
        request = await build_access_request("link", horse, caller, approver, db)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            409,
            "One of the registrations conflicts with an existing record. Please verify and try again.",
        )

    # Rebuilt through CreatedHorseResult rather than returned as MyHorseOut:
    # a parent instance would be revalidated against this response model and
    # re-enter the ORM projection in MyHorseOut.compute_derived.
    horse_out = await load_my_horse(horse.id, exhibitor_id, db)
    if request is None:
        return CreatedHorseResult(**horse_out.model_dump())

    # After the commit: the request stands whether or not the mail goes out, and
    # the link comes back either way.
    await notify_request(request, db)
    return CreatedHorseResult(
        **horse_out.model_dump(),
        pending_owner_approval=True,
        approval_url=approval_url(request.token),
        approver_name=request.approver_name,
        approval_email_sent=request.email_sent,
    )


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
        association_id=reg.association_id,
        association_code=reg.association.code,
        association_name=reg.association.name,
        association_type=reg.association.association_type,
        member_number=reg.member_number,
        expires_at=reg.expires_at,
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
        .options(selectinload(ExhibitorRegistration.association))
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
        association_id=body.association_id,
        member_number=body.member_number.strip(),
        expires_at=body.expires_at,
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
        .options(selectinload(ExhibitorRegistration.association))
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
