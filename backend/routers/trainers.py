from datetime import date
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from uuid import UUID
import bcrypt

from database import get_db
from dependencies import require_admin, require_authenticated, safe_uuid
from models import Horse, ShowType, Trainer, TrainerDocument, TrainerRegistration
from schemas import (
    HorseOut,
    TrainerCreate,
    TrainerOut,
    TrainerProfileOut,
    TrainerProfileUpdate,
    TrainerPublicOut,
    TrainerRegistrationCreate,
    TrainerRegistrationOut,
    TrainerRegistrationUpdate,
    TrainerUpdate,
)

router = APIRouter(prefix="/trainers", tags=["Trainers"])

_horse_options = [
    selectinload(Horse.breed),
    selectinload(Horse.color),
    selectinload(Horse.owner_exhibitor),
    selectinload(Horse.trainer),
]

_trainer_full_options = [
    selectinload(Trainer.user),
    selectinload(Trainer.documents),
    selectinload(Trainer.registrations).selectinload(TrainerRegistration.show_type),
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
        business_name=trainer.business_name,
        city=trainer.city,
        state=trainer.state,
        country=trainer.country,
        website=trainer.website,
        is_public=bool(trainer.is_public),
        safesport_completed_at=trainer.safesport_completed_at,
        background_check_expires_at=trainer.background_check_expires_at,
        has_liability_insurance=bool(trainer.has_liability_insurance),
        horse_count=horse_count,
        created_at=trainer.created_at,
    )


def _safesport_current(value: date | None) -> bool:
    # SafeSport training is valid for one year from completion.
    if not value:
        return False
    today = date.today()
    return (today - value).days <= 365


def _background_current(value: date | None) -> bool:
    if not value:
        return False
    return value >= date.today()


async def _load_trainer_for_self(user_id: str, db: AsyncSession) -> Trainer:
    result = await db.execute(
        select(Trainer)
        .options(*_trainer_full_options)
        .where(Trainer.user_id == safe_uuid(user_id))
    )
    trainer = result.scalar_one_or_none()
    if not trainer:
        raise HTTPException(404, "Trainer profile not found")
    return trainer


async def _check_admin_or_self(
    trainer_id: UUID, user_id: str, role: str, db: AsyncSession
) -> Trainer:
    trainer = await db.get(Trainer, trainer_id, options=_trainer_full_options)
    if not trainer:
        raise HTTPException(404, "Trainer not found")
    if role == "ADMIN":
        return trainer
    if str(trainer.user_id) != user_id:
        raise HTTPException(403, "You can only manage your own trainer profile")
    return trainer


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
    return await _load_trainer_for_self(user_id, db)


@router.patch("/me", response_model=TrainerProfileOut)
async def update_my_trainer_profile(
    body: TrainerProfileUpdate,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    trainer = await _load_trainer_for_self(user_id, db)
    if not trainer.user:
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
        if not trainer.user.hashed_password or not bcrypt.checkpw(
            current_password.encode(), trainer.user.hashed_password.encode()
        ):
            raise HTTPException(400, "Password is incorrect")
        trainer.user.email = next_private_email

    trainer.name = next_name.strip()
    trainer.user.full_name = trainer.name
    trainer.private_phone = next_private_phone.strip()

    if "public_email" in updates:
        trainer.email = str(updates["public_email"]) if updates["public_email"] else None
    if "public_phone" in updates:
        trainer.phone = updates["public_phone"].strip() if updates["public_phone"] else None

    for key in (
        "business_name",
        "city",
        "state",
        "country",
        "website",
        "bio",
        "social_facebook",
        "social_instagram",
        "social_tiktok",
    ):
        if key in updates:
            raw = updates[key]
            setattr(trainer, key, raw.strip() if isinstance(raw, str) and raw.strip() else (raw if raw else None))

    if "is_public" in updates:
        trainer.is_public = bool(updates["is_public"])
    if "has_liability_insurance" in updates:
        trainer.has_liability_insurance = bool(updates["has_liability_insurance"])

    if updates.get("clear_safesport_completed_at"):
        trainer.safesport_completed_at = None
    elif "safesport_completed_at" in updates:
        trainer.safesport_completed_at = updates["safesport_completed_at"]

    if updates.get("clear_background_check_expires_at"):
        trainer.background_check_expires_at = None
    elif "background_check_expires_at" in updates:
        trainer.background_check_expires_at = updates["background_check_expires_at"]

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Email already in use")
    await db.refresh(trainer)
    # Re-load with full options so the response includes documents/registrations.
    return await _load_trainer_for_self(user_id, db)


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


# ── Trainer professional affiliations ──────────────────────────────────────────


async def _resolve_show_type(show_type_id: UUID, db: AsyncSession) -> ShowType:
    show_type = await db.get(ShowType, show_type_id)
    if not show_type:
        raise HTTPException(400, "Unknown association")
    if show_type.code == "OPEN":
        raise HTTPException(400, "OPEN is not a credentialing association")
    return show_type


async def _load_registration(
    trainer_id: UUID, registration_id: UUID, db: AsyncSession
) -> TrainerRegistration:
    result = await db.execute(
        select(TrainerRegistration)
        .options(selectinload(TrainerRegistration.show_type))
        .where(
            TrainerRegistration.id == registration_id,
            TrainerRegistration.trainer_id == trainer_id,
        )
    )
    registration = result.scalar_one_or_none()
    if not registration:
        raise HTTPException(404, "Affiliation not found")
    return registration


async def _list_registrations(
    trainer_id: UUID, db: AsyncSession
) -> list[TrainerRegistration]:
    result = await db.execute(
        select(TrainerRegistration)
        .options(selectinload(TrainerRegistration.show_type))
        .where(TrainerRegistration.trainer_id == trainer_id)
        .order_by(TrainerRegistration.created_at)
    )
    return list(result.scalars().all())


async def _create_registration(
    trainer_id: UUID, body: TrainerRegistrationCreate, db: AsyncSession
) -> TrainerRegistration:
    await _resolve_show_type(body.show_type_id, db)
    registration = TrainerRegistration(
        trainer_id=trainer_id,
        show_type_id=body.show_type_id,
        member_number=body.member_number.strip(),
        status=body.status,
        expires_at=body.expires_at,
    )
    db.add(registration)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "This trainer already has an affiliation with that association")
    return await _load_registration(trainer_id, registration.id, db)


async def _update_registration(
    registration: TrainerRegistration, body: TrainerRegistrationUpdate, db: AsyncSession
) -> TrainerRegistration:
    updates = body.model_dump(exclude_unset=True)
    if "member_number" in updates and updates["member_number"] is not None:
        registration.member_number = updates["member_number"].strip()
    if "status" in updates and updates["status"] is not None:
        registration.status = updates["status"]
    if updates.get("clear_expires_at"):
        registration.expires_at = None
    elif "expires_at" in updates:
        registration.expires_at = updates["expires_at"]
    await db.commit()
    await db.refresh(registration, attribute_names=["show_type"])
    return registration


@router.get("/me/registrations", response_model=list[TrainerRegistrationOut])
async def list_my_registrations(
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    trainer = await _load_trainer_for_self(user_id, db)
    return await _list_registrations(trainer.id, db)


@router.post(
    "/me/registrations",
    response_model=TrainerRegistrationOut,
    status_code=201,
)
async def create_my_registration(
    body: TrainerRegistrationCreate,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    trainer = await _load_trainer_for_self(user_id, db)
    return await _create_registration(trainer.id, body, db)


@router.patch(
    "/me/registrations/{registration_id}",
    response_model=TrainerRegistrationOut,
)
async def update_my_registration(
    registration_id: UUID,
    body: TrainerRegistrationUpdate,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    trainer = await _load_trainer_for_self(user_id, db)
    registration = await _load_registration(trainer.id, registration_id, db)
    return await _update_registration(registration, body, db)


@router.delete("/me/registrations/{registration_id}", status_code=204)
async def delete_my_registration(
    registration_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    trainer = await _load_trainer_for_self(user_id, db)
    registration = await _load_registration(trainer.id, registration_id, db)
    await db.delete(registration)
    await db.commit()


@router.get(
    "/{trainer_id}/registrations",
    response_model=list[TrainerRegistrationOut],
    dependencies=[Depends(require_authenticated)],
)
async def list_trainer_registrations(
    trainer_id: UUID,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _check_admin_or_self(trainer_id, user_id, x_user_role, db)
    return await _list_registrations(trainer_id, db)


@router.post(
    "/{trainer_id}/registrations",
    response_model=TrainerRegistrationOut,
    status_code=201,
    dependencies=[Depends(require_admin)],
)
async def create_trainer_registration(
    trainer_id: UUID,
    body: TrainerRegistrationCreate,
    db: AsyncSession = Depends(get_db),
):
    trainer = await db.get(Trainer, trainer_id)
    if not trainer:
        raise HTTPException(404, "Trainer not found")
    return await _create_registration(trainer_id, body, db)


@router.patch(
    "/{trainer_id}/registrations/{registration_id}",
    response_model=TrainerRegistrationOut,
    dependencies=[Depends(require_admin)],
)
async def admin_update_trainer_registration(
    trainer_id: UUID,
    registration_id: UUID,
    body: TrainerRegistrationUpdate,
    db: AsyncSession = Depends(get_db),
):
    registration = await _load_registration(trainer_id, registration_id, db)
    return await _update_registration(registration, body, db)


@router.delete(
    "/{trainer_id}/registrations/{registration_id}",
    status_code=204,
    dependencies=[Depends(require_admin)],
)
async def admin_delete_trainer_registration(
    trainer_id: UUID,
    registration_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    registration = await _load_registration(trainer_id, registration_id, db)
    await db.delete(registration)
    await db.commit()


# ── Admin-facing trainer update / delete ───────────────────────────────────────


@router.patch("/{trainer_id}", response_model=TrainerOut, dependencies=[Depends(require_admin)])
async def update_trainer(trainer_id: UUID, body: TrainerUpdate, db: AsyncSession = Depends(get_db)):
    trainer = await db.get(Trainer, trainer_id, options=[selectinload(Trainer.user)])
    if not trainer:
        raise HTTPException(404, "Trainer not found")
    updates = body.model_dump(exclude_unset=True)
    for k, v in updates.items():
        setattr(trainer, k, v)
    if "name" in updates and trainer.user:
        trainer.user.full_name = trainer.name
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


# ── Public ad-facing endpoint (used later by ad/listing surfaces) ──────────────


@router.get("/{trainer_id}/public", response_model=TrainerPublicOut)
async def get_public_trainer(trainer_id: UUID, db: AsyncSession = Depends(get_db)):
    trainer = await db.get(Trainer, trainer_id, options=_trainer_full_options)
    if not trainer or not trainer.is_public:
        raise HTTPException(404, "Trainer not found")
    affiliations = await _list_registrations(trainer.id, db)
    return TrainerPublicOut(
        id=trainer.id,
        name=trainer.name,
        business_name=trainer.business_name,
        city=trainer.city,
        state=trainer.state,
        country=trainer.country,
        website=trainer.website,
        bio=trainer.bio,
        public_email=trainer.email,
        public_phone=trainer.phone,
        social_facebook=trainer.social_facebook,
        social_instagram=trainer.social_instagram,
        social_tiktok=trainer.social_tiktok,
        has_headshot=any(d.document_type == "HEADSHOT" for d in trainer.documents),
        safesport_current=_safesport_current(trainer.safesport_completed_at),
        background_check_current=_background_current(trainer.background_check_expires_at),
        has_liability_insurance=bool(trainer.has_liability_insurance),
        affiliations=[TrainerRegistrationOut.model_validate(a) for a in affiliations],
    )
