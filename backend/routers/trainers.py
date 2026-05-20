from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from uuid import UUID
import bcrypt

from database import get_db
from dependencies import require_admin, require_authenticated, safe_uuid
from models import Horse, Trainer
from schemas import HorseOut, TrainerCreate, TrainerProfileOut, TrainerProfileUpdate, TrainerUpdate, TrainerOut

router = APIRouter(prefix="/trainers", tags=["Trainers"])

_horse_options = [
    selectinload(Horse.breed),
    selectinload(Horse.color),
    selectinload(Horse.owner_exhibitor),
    selectinload(Horse.trainer),
]


def _trainer_to_out(trainer: Trainer, horse_count: int) -> TrainerOut:
    return TrainerOut(
        id=trainer.id,
        user_id=trainer.user_id,
        name=trainer.name,
        private_phone=trainer.private_phone,
        phone=trainer.phone,
        email=trainer.email,
        user_email=trainer.user.email if trainer.user else None,
        horse_count=horse_count,
        created_at=trainer.created_at,
    )


@router.get("/", response_model=list[TrainerOut], dependencies=[Depends(require_authenticated)])
async def list_trainers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Trainer).options(selectinload(Trainer.user)).order_by(Trainer.name)
    )
    trainers = result.scalars().all()
    counts_res = await db.execute(
        select(Horse.trainer_id, func.count())
        .where(Horse.trainer_id.is_not(None))
        .group_by(Horse.trainer_id)
    )
    counts = {row[0]: row[1] for row in counts_res.all()}
    return [_trainer_to_out(t, counts.get(t.id, 0)) for t in trainers]


@router.post("/", response_model=TrainerOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_trainer(body: TrainerCreate, db: AsyncSession = Depends(get_db)):
    trainer = Trainer(**body.model_dump())
    db.add(trainer)
    try:
        await db.commit()
        await db.refresh(trainer, attribute_names=["user"])
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "A trainer with that name already exists")
    return _trainer_to_out(trainer, 0)


@router.get("/me", response_model=TrainerProfileOut)
async def get_my_trainer_profile(
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Trainer)
        .options(selectinload(Trainer.user))
        .where(Trainer.user_id == safe_uuid(user_id))
    )
    trainer = result.scalar_one_or_none()
    if not trainer:
        raise HTTPException(404, "Trainer profile not found")
    return trainer


@router.patch("/me", response_model=TrainerProfileOut)
async def update_my_trainer_profile(
    body: TrainerProfileUpdate,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Trainer)
        .options(selectinload(Trainer.user))
        .where(Trainer.user_id == safe_uuid(user_id))
    )
    trainer = result.scalar_one_or_none()
    if not trainer or not trainer.user:
        raise HTTPException(404, "Trainer profile not found")

    updates = body.model_dump(exclude_unset=True)
    next_name = updates.get("name", trainer.name)
    next_private_phone = updates.get("private_phone", trainer.private_phone)
    next_private_email = str(updates.get("private_email", trainer.user.email))

    if not next_name or not next_name.strip():
        raise HTTPException(400, "Name is required")
    if not next_private_phone or not next_private_phone.strip():
        raise HTTPException(400, "Private phone is required")
    if not next_private_email or not next_private_email.strip():
        raise HTTPException(400, "Private email is required")

    if "private_email" in updates and next_private_email != trainer.user.email:
        current_password = updates.get("current_password")
        if not current_password:
            raise HTTPException(400, "Confirm your password to change private email")
        if not trainer.user.hashed_password or not bcrypt.checkpw(current_password.encode(), trainer.user.hashed_password.encode()):
            raise HTTPException(400, "Password is incorrect")
        trainer.user.email = next_private_email

    trainer.name = next_name.strip()
    trainer.user.full_name = trainer.name
    trainer.private_phone = next_private_phone.strip()
    if "public_email" in updates:
        trainer.email = str(updates["public_email"]) if updates["public_email"] else None
    if "public_phone" in updates:
        trainer.phone = updates["public_phone"].strip() if updates["public_phone"] else None

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Email already in use")
    await db.refresh(trainer)
    return trainer


@router.get("/me/horses", response_model=list[HorseOut])
async def list_my_trainer_horses(
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Trainer).where(Trainer.user_id == safe_uuid(user_id)))
    trainer = result.scalar_one_or_none()
    if not trainer:
        raise HTTPException(404, "Trainer profile not found")

    horses_result = await db.execute(
        select(Horse)
        .options(*_horse_options)
        .where(Horse.trainer_id == trainer.id)
        .order_by(Horse.name)
    )
    return horses_result.scalars().all()


@router.patch("/{trainer_id}", response_model=TrainerOut, dependencies=[Depends(require_admin)])
async def update_trainer(trainer_id: UUID, body: TrainerUpdate, db: AsyncSession = Depends(get_db)):
    trainer = await db.get(Trainer, trainer_id, options=[selectinload(Trainer.user)])
    if not trainer:
        raise HTTPException(404, "Trainer not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(trainer, k, v)
    try:
        await db.commit()
        await db.refresh(trainer, attribute_names=["user"])
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "A trainer with that name already exists")
    count_res = await db.execute(
        select(func.count()).select_from(Horse).where(Horse.trainer_id == trainer.id)
    )
    return _trainer_to_out(trainer, count_res.scalar_one() or 0)


@router.delete("/{trainer_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_trainer(trainer_id: UUID, db: AsyncSession = Depends(get_db)):
    trainer = await db.get(Trainer, trainer_id)
    if not trainer:
        raise HTTPException(404, "Trainer not found")
    await db.delete(trainer)
    await db.commit()
