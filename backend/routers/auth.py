from fastapi import APIRouter, Depends, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timedelta, timezone
from uuid import UUID
import bcrypt
import logging

from database import get_db
from models import User, Exhibitor, ShowSecretaryCertification, Association, Trainer

logger = logging.getLogger(__name__)
limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/auth", tags=["Auth"])


class UserVerify(BaseModel):
    email: EmailStr
    password: str


class PasswordResetWithOldPassword(BaseModel):
    email: EmailStr
    current_password: str
    new_password: str


class SecurityQuestionLookup(BaseModel):
    email: EmailStr


class PasswordResetWithSecurityAnswer(BaseModel):
    email: EmailStr
    answer: str
    new_password: str


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str


class SecretaryCertificationIn(BaseModel):
    association_id: UUID
    secretary_id_number: Optional[str] = None


class ShowSecretaryRegister(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str
    certifications: list[SecretaryCertificationIn] = []


class ShowManagerRegister(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str


class TrainerRegister(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str
    private_phone: str
    public_email: Optional[EmailStr] = None
    public_phone: Optional[str] = None


def normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


# How many consecutive wrong answers before the reset route stops listening, and
# for how long. One user-written question is the whole account on this route, so
# the throttle is what stands between a guessable question ("first horse's name",
# which is printed on the entry form) and an intruder with a list. Per-IP rate
# limiting is not enough on its own — it resets when the attacker changes address,
# and the counter is a property of the account, not of where the guess came from.
MAX_SECURITY_ANSWER_ATTEMPTS = 5
SECURITY_ANSWER_LOCKOUT = timedelta(minutes=15)

# Deliberately identical for "no such account" and "no question on file". The
# reset page is unauthenticated, so a message that distinguished them would answer
# "does this person have an account here" for anyone who asked.
NO_QUESTION_DETAIL = "No security question is on file for that email."


def normalize_security_answer(answer: str) -> str:
    """Answers are typed months apart, on a phone, at a horse show. Matching the
    raw string would fail on 'Dusty ' vs 'dusty' — a difference the user cannot
    see and would have no way to debug. Case and surrounding/among-word spacing
    are dropped; nothing else is, because everything else is signal."""
    return " ".join(answer.strip().lower().split())


def hash_security_answer(answer: str) -> str:
    return bcrypt.hashpw(normalize_security_answer(answer).encode(), bcrypt.gensalt()).decode()


def verify_security_answer(answer: str, hashed: str) -> bool:
    return bcrypt.checkpw(normalize_security_answer(answer).encode(), hashed.encode())


def security_answer_lockout_remaining(user: User) -> Optional[timedelta]:
    """None when the reset route is open for this user, else how long is left."""
    locked_until = user.security_answer_locked_until
    if not locked_until:
        return None
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)
    remaining = locked_until - datetime.now(timezone.utc)
    return remaining if remaining.total_seconds() > 0 else None


def clear_security_answer_throttle(user: User) -> None:
    user.security_answer_failed_attempts = 0
    user.security_answer_locked_until = None


def _lockout_detail(remaining: timedelta) -> str:
    # Rounded up, so "1 minute" never means "try again and be refused" — but a
    # whole 15 minutes must read as 15, not 16.
    minutes = max(1, -(-int(remaining.total_seconds()) // 60))
    return (
        f"Too many incorrect answers. Try again in {minutes} minute{'s' if minutes != 1 else ''}, "
        "or ask an administrator to reset your password."
    )


def display_name(first_name: str, last_name: str) -> str:
    return f"{first_name.strip()} {last_name.strip()}".strip()


def validate_name_parts(first_name: str, last_name: str) -> None:
    if not first_name.strip() or not last_name.strip():
        raise HTTPException(400, "First name and last name are required")


@router.post("/verify")
@limiter.limit("10/minute")
async def verify_user(request: Request, body: UserVerify, db: AsyncSession = Depends(get_db)):
    email = normalize_email(body.email)
    result = await db.execute(select(User).where(func.lower(User.email) == email))
    user = result.scalar_one_or_none()

    if not user or not user.hashed_password:
        logger.warning(f"Failed login attempt for email: {email} (user not found or no password)")
        raise HTTPException(401, "Invalid credentials")

    if not verify_password(body.password, user.hashed_password):
        logger.warning(f"Failed login attempt for email: {email} (invalid password)")
        raise HTTPException(401, "Invalid credentials")

    if not user.is_approved:
        raise HTTPException(403, "Account pending admin approval")

    user.last_login_at = datetime.now(timezone.utc)
    # Signing in proves control of the account, so a stranger's failed guesses at
    # the security question must not leave the owner's reset route locked.
    clear_security_answer_throttle(user)
    await db.commit()

    return {
        "id": str(user.id),
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": user.full_name,
        "role": user.role,
    }


@router.post("/reset-password")
@limiter.limit("5/minute")
async def reset_password_with_old_password(
    request: Request, body: PasswordResetWithOldPassword, db: AsyncSession = Depends(get_db)
):
    """Unauthenticated "forgot password" flow: proves identity with the
    current password rather than a mailed token, since email delivery
    isn't wired up yet. Same eventual guarantee as /users/me/password —
    only someone who already knows the current password can change it."""
    if len(body.new_password) < 8:
        raise HTTPException(400, "New password must be at least 8 characters")
    email = normalize_email(body.email)
    result = await db.execute(select(User).where(func.lower(User.email) == email))
    user = result.scalar_one_or_none()

    if not user or not user.hashed_password:
        raise HTTPException(401, "Invalid email or current password")
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(401, "Invalid email or current password")

    user.hashed_password = hash_password(body.new_password)
    clear_security_answer_throttle(user)
    await db.commit()
    return {"detail": "Password updated"}


@router.post("/password-reset/question")
@limiter.limit("10/minute")
async def get_security_question(
    request: Request, body: SecurityQuestionLookup, db: AsyncSession = Depends(get_db)
):
    """Step one of the real forgot-password flow: hand back the question this
    account chose, so the user can answer it. Public by necessity — the whole
    point is that the caller cannot sign in."""
    email = normalize_email(body.email)
    result = await db.execute(select(User).where(func.lower(User.email) == email))
    user = result.scalar_one_or_none()

    if not user or not user.hashed_password or not user.security_question:
        raise HTTPException(404, NO_QUESTION_DETAIL)

    remaining = security_answer_lockout_remaining(user)
    if remaining:
        # Refused before the question is even shown. Handing it out during a
        # lockout would let an attacker who has run out of guesses keep reading
        # the prompt, which is the half of the pair that hints at the answer.
        raise HTTPException(429, _lockout_detail(remaining))

    return {"question": user.security_question}


@router.post("/password-reset/answer")
@limiter.limit("5/minute")
async def reset_password_with_security_answer(
    request: Request, body: PasswordResetWithSecurityAnswer, db: AsyncSession = Depends(get_db)
):
    """Step two: the answer sets the password directly, in one request.

    No intermediate token, because a token is only worth its complexity when the
    two steps happen in different places — a mailed link, a different device. Here
    both halves are typed on the same screen a second apart, so a token table
    would add a thing to expire and clean up and secure, and buy nothing.

    Every failure path commits: the attempt counter is the defence, and a counter
    that only persisted on the happy path would not be one."""
    if len(body.new_password) < 8:
        raise HTTPException(400, "New password must be at least 8 characters")

    email = normalize_email(body.email)
    result = await db.execute(select(User).where(func.lower(User.email) == email))
    user = result.scalar_one_or_none()

    if not user or not user.hashed_password or not user.security_answer_hash:
        raise HTTPException(404, NO_QUESTION_DETAIL)

    remaining = security_answer_lockout_remaining(user)
    if remaining:
        raise HTTPException(429, _lockout_detail(remaining))

    if not verify_security_answer(body.answer, user.security_answer_hash):
        user.security_answer_failed_attempts = (user.security_answer_failed_attempts or 0) + 1
        locked = user.security_answer_failed_attempts >= MAX_SECURITY_ANSWER_ATTEMPTS
        if locked:
            user.security_answer_locked_until = datetime.now(timezone.utc) + SECURITY_ANSWER_LOCKOUT
        await db.commit()
        logger.warning(
            f"Failed security answer for email: {email} "
            f"(attempt {user.security_answer_failed_attempts}{', now locked' if locked else ''})"
        )
        if locked:
            raise HTTPException(429, _lockout_detail(SECURITY_ANSWER_LOCKOUT))
        left = MAX_SECURITY_ANSWER_ATTEMPTS - user.security_answer_failed_attempts
        raise HTTPException(401, f"That answer doesn't match. {left} attempt{'s' if left != 1 else ''} left.")

    user.hashed_password = hash_password(body.new_password)
    clear_security_answer_throttle(user)
    await db.commit()
    logger.info(f"Password reset via security question for email: {email}")
    return {"detail": "Password updated"}


@router.post("/register")
async def register_user(body: UserRegister, db: AsyncSession = Depends(get_db)):
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    validate_name_parts(body.first_name, body.last_name)
    email = normalize_email(body.email)

    existing = await db.execute(select(User).where(func.lower(User.email) == email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Email already registered")

    full_name = display_name(body.first_name, body.last_name)
    user = User(
        email=email,
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
        role="EXHIBITOR",  # self-registration always creates EXHIBITOR accounts
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.flush()

    exhibitor = Exhibitor(full_name=full_name, user_id=user.id)
    db.add(exhibitor)

    await db.commit()
    await db.refresh(user)

    return {
        "id": str(user.id),
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": user.full_name,
        "role": user.role,
    }


@router.post("/register/show-secretary")
async def register_show_secretary(body: ShowSecretaryRegister, db: AsyncSession = Depends(get_db)):
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    validate_name_parts(body.first_name, body.last_name)
    email = normalize_email(body.email)

    existing = await db.execute(select(User).where(func.lower(User.email) == email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Email already registered")

    for cert in body.certifications:
        assoc = await db.get(Association, cert.association_id)
        if not assoc:
            raise HTTPException(400, f"Unknown association: {cert.association_id}")

    user = User(
        email=email,
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
        role="SHOW_SECRETARY",
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.flush()

    for cert in body.certifications:
        db.add(ShowSecretaryCertification(
            user_id=user.id,
            association_id=cert.association_id,
            secretary_id_number=cert.secretary_id_number,
        ))

    await db.commit()
    await db.refresh(user)

    return {
        "id": str(user.id),
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": user.full_name,
        "role": user.role,
    }


@router.post("/register/show-manager")
async def register_show_manager(body: ShowManagerRegister, db: AsyncSession = Depends(get_db)):
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    validate_name_parts(body.first_name, body.last_name)
    email = normalize_email(body.email)

    existing = await db.execute(select(User).where(func.lower(User.email) == email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Email already registered")

    user = User(
        email=email,
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
        role="SHOW_MANAGER",
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return {
        "id": str(user.id),
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": user.full_name,
        "role": user.role,
    }


@router.post("/register/trainer")
async def register_trainer(body: TrainerRegister, db: AsyncSession = Depends(get_db)):
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if not body.private_phone.strip():
        raise HTTPException(400, "Private phone is required")
    validate_name_parts(body.first_name, body.last_name)
    email = normalize_email(body.email)
    public_email = normalize_email(body.public_email) if body.public_email else None

    existing_user = await db.execute(select(User).where(func.lower(User.email) == email))
    if existing_user.scalar_one_or_none():
        raise HTTPException(409, "Email already registered")

    trainer_email_candidates = [email]
    if public_email:
        trainer_email_candidates.append(public_email)
    existing_trainer_result = await db.execute(
        select(Trainer)
        .where(func.lower(Trainer.email).in_(trainer_email_candidates))
        .limit(1)
    )
    existing_trainer = existing_trainer_result.scalar_one_or_none()
    if existing_trainer and existing_trainer.user_id is not None:
        raise HTTPException(409, "A trainer profile is already linked to that email")

    # If no email-only match, fall back to first + last + public email against
    # unclaimed registry rows. This lets a registry row that an exhibitor
    # created from the horse form get merged into the trainer's account.
    if not existing_trainer and public_email:
        existing_by_name_email = await db.execute(
            select(Trainer).where(
                func.lower(Trainer.first_name) == body.first_name.strip().lower(),
                func.lower(Trainer.last_name) == body.last_name.strip().lower(),
                func.lower(Trainer.email) == public_email,
                Trainer.user_id.is_(None),
            )
        )
        existing_trainer = existing_by_name_email.scalar_one_or_none()

    user = User(
        email=email,
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
        role="TRAINER",
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.flush()

    if existing_trainer:
        existing_trainer.user_id = user.id
        existing_trainer.first_name = existing_trainer.first_name or body.first_name.strip()
        existing_trainer.last_name = existing_trainer.last_name or body.last_name.strip()
        existing_trainer.private_phone = body.private_phone.strip()
        existing_trainer.phone = existing_trainer.phone or (body.public_phone.strip() if body.public_phone else None)
        if not existing_trainer.email and public_email:
            existing_trainer.email = public_email
    else:
        db.add(Trainer(
            user_id=user.id,
            first_name=body.first_name.strip(),
            last_name=body.last_name.strip(),
            private_phone=body.private_phone.strip(),
            phone=body.public_phone.strip() if body.public_phone else None,
            email=public_email,
        ))

    await db.commit()
    await db.refresh(user)

    return {
        "id": str(user.id),
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": user.full_name,
        "role": user.role,
    }
