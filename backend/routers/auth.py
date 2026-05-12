from fastapi import APIRouter, Depends, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timezone
from uuid import UUID
import bcrypt
import logging

from database import get_db
from models import User, Exhibitor, ShowSecretaryCertification, ShowType, Trainer

logger = logging.getLogger(__name__)
limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/auth", tags=["Auth"])


class UserVerify(BaseModel):
    email: EmailStr
    password: str


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    full_name: str


class SecretaryCertificationIn(BaseModel):
    show_type_id: UUID
    secretary_id_number: Optional[str] = None


class ShowSecretaryRegister(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    certifications: list[SecretaryCertificationIn] = []


class ShowManagerRegister(BaseModel):
    email: EmailStr
    password: str
    full_name: str


class TrainerRegister(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    private_phone: str
    public_email: Optional[EmailStr] = None
    public_phone: Optional[str] = None


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


@router.post("/verify")
@limiter.limit("10/minute")
async def verify_user(request: Request, body: UserVerify, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not user.hashed_password:
        logger.warning(f"Failed login attempt for email: {body.email} (user not found or no password)")
        raise HTTPException(401, "Invalid credentials")

    if not verify_password(body.password, user.hashed_password):
        logger.warning(f"Failed login attempt for email: {body.email} (invalid password)")
        raise HTTPException(401, "Invalid credentials")

    if not user.is_approved:
        raise HTTPException(403, "Account pending admin approval")

    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
    }


@router.post("/register")
async def register_user(body: UserRegister, db: AsyncSession = Depends(get_db)):
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Email already registered")

    user = User(
        email=body.email,
        full_name=body.full_name,
        role="EXHIBITOR",  # self-registration always creates EXHIBITOR accounts
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.flush()

    exhibitor = Exhibitor(full_name=body.full_name, user_id=user.id)
    db.add(exhibitor)

    await db.commit()
    await db.refresh(user)

    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
    }


@router.post("/register/show-secretary")
async def register_show_secretary(body: ShowSecretaryRegister, db: AsyncSession = Depends(get_db)):
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Email already registered")

    for cert in body.certifications:
        st = await db.get(ShowType, cert.show_type_id)
        if not st:
            raise HTTPException(400, f"Unknown show type: {cert.show_type_id}")

    user = User(
        email=body.email,
        full_name=body.full_name,
        role="SHOW_SECRETARY",
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.flush()

    for cert in body.certifications:
        db.add(ShowSecretaryCertification(
            user_id=user.id,
            show_type_id=cert.show_type_id,
            secretary_id_number=cert.secretary_id_number,
        ))

    await db.commit()
    await db.refresh(user)

    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
    }


@router.post("/register/show-manager")
async def register_show_manager(body: ShowManagerRegister, db: AsyncSession = Depends(get_db)):
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Email already registered")

    user = User(
        email=body.email,
        full_name=body.full_name,
        role="SHOW_MANAGER",
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
    }


@router.post("/register/trainer")
async def register_trainer(body: TrainerRegister, db: AsyncSession = Depends(get_db)):
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if not body.private_phone.strip():
        raise HTTPException(400, "Private phone is required")

    existing_user = await db.execute(select(User).where(User.email == body.email))
    if existing_user.scalar_one_or_none():
        raise HTTPException(409, "Email already registered")

    existing_trainer_result = await db.execute(
        select(Trainer).where(Trainer.email == body.email).limit(1)
    )
    existing_trainer = existing_trainer_result.scalar_one_or_none()
    if existing_trainer and existing_trainer.user_id is not None:
        raise HTTPException(409, "A trainer profile is already linked to that email")

    user = User(
        email=body.email,
        full_name=body.full_name,
        role="TRAINER",
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.flush()

    if existing_trainer:
        existing_trainer.user_id = user.id
        existing_trainer.name = existing_trainer.name or body.full_name
        existing_trainer.private_phone = body.private_phone.strip()
        existing_trainer.phone = existing_trainer.phone or (body.public_phone.strip() if body.public_phone else None)
        if not existing_trainer.email and body.public_email:
            existing_trainer.email = str(body.public_email)
    else:
        db.add(Trainer(
            user_id=user.id,
            name=body.full_name,
            private_phone=body.private_phone.strip(),
            phone=body.public_phone.strip() if body.public_phone else None,
            email=str(body.public_email) if body.public_email else None,
        ))

    await db.commit()
    await db.refresh(user)

    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
    }
