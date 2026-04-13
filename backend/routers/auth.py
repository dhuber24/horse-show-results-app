from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import bcrypt

from database import get_db
from models import User

router = APIRouter(prefix="/auth", tags=["Auth"])


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


@router.post("/verify")
async def verify_user(body: dict, db: AsyncSession = Depends(get_db)):
    email = body.get("email")
    password = body.get("password")
    if not email or not password:
        raise HTTPException(400, "Email and password required")

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if not user or not user.hashed_password:
        raise HTTPException(401, "Invalid credentials")

    if not verify_password(password, user.hashed_password):
        raise HTTPException(401, "Invalid credentials")

    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
    }


@router.post("/register")
async def register_user(body: dict, db: AsyncSession = Depends(get_db)):
    email = body.get("email")
    password = body.get("password")
    full_name = body.get("full_name")
    role = body.get("role", "RIDER")

    if not email or not password or not full_name:
        raise HTTPException(400, "Email, password, and full name required")

    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Email already registered")

    user = User(
        email=email,
        full_name=full_name,
        role=role,
        hashed_password=hash_password(password),
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
