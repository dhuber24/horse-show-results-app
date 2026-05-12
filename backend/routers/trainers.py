from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from uuid import UUID

from database import get_db
from dependencies import require_admin, require_authenticated
from models import Trainer
from schemas import TrainerCreate, TrainerUpdate, TrainerOut

router = APIRouter(prefix="/trainers", tags=["Trainers"])


@router.get("/", response_model=list[TrainerOut], dependencies=[Depends(require_authenticated)])
async def list_trainers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Trainer).order_by(Trainer.name))
    return result.scalars().all()


@router.post("/", response_model=TrainerOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_trainer(body: TrainerCreate, db: AsyncSession = Depends(get_db)):
    trainer = Trainer(**body.model_dump())
    db.add(trainer)
    try:
        await db.commit()
        await db.refresh(trainer)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "A trainer with that name already exists")
    return trainer


@router.patch("/{trainer_id}", response_model=TrainerOut, dependencies=[Depends(require_admin)])
async def update_trainer(trainer_id: UUID, body: TrainerUpdate, db: AsyncSession = Depends(get_db)):
    trainer = await db.get(Trainer, trainer_id)
    if not trainer:
        raise HTTPException(404, "Trainer not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(trainer, k, v)
    try:
        await db.commit()
        await db.refresh(trainer)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "A trainer with that name already exists")
    return trainer


@router.delete("/{trainer_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_trainer(trainer_id: UUID, db: AsyncSession = Depends(get_db)):
    trainer = await db.get(Trainer, trainer_id)
    if not trainer:
        raise HTTPException(404, "Trainer not found")
    await db.delete(trainer)
    await db.commit()
