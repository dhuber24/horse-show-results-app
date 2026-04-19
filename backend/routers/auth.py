from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel, EmailStr
from jose import JWTError
from uuid import UUID

from database import get_db
from models import User, Exhibitor
from auth_utils import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    ACCESS_TOKEN_EXPIRE_MINUTES,
)

router = APIRouter(prefix="/auth", tags=["Auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str


class RefreshRequest(BaseModel):
    refresh_token: str


def _token_response(user: User) -> dict:
    return {
        "access_token": create_access_token(user.id, user.email, user.role, user.full_name),
        "refresh_token": create_refresh_token(user.id),
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


@router.post("/login")
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not user.hashed_password:
        raise HTTPException(401, "Invalid credentials")
    if not verify_password(body.password, user.hashed_password):
        raise HTTPException(401, "Invalid credentials")

    return _token_response(user)


@router.post("/refresh")
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        user_id_str = decode_refresh_token(body.refresh_token)
    except JWTError:
        raise HTTPException(401, "Invalid or expired refresh token")

    user = await db.get(User, UUID(user_id_str))
    if not user:
        raise HTTPException(401, "User not found")

    return _token_response(user)


@router.post("/register", status_code=201)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Email already registered")

    user = User(
        email=body.email,
        full_name=body.full_name,
        role="EXHIBITOR",
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.flush()

    # Link to an existing unmatched exhibitor record, or create a new one
    exhibitor_result = await db.execute(
        select(Exhibitor).where(
            func.lower(Exhibitor.full_name) == body.full_name.lower(),
            Exhibitor.user_id == None,
        )
    )
    exhibitor = exhibitor_result.scalar_one_or_none()
    if exhibitor:
        exhibitor.user_id = user.id
    else:
        db.add(Exhibitor(full_name=body.full_name, user_id=user.id))

    await db.commit()
    await db.refresh(user)

    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
    }
