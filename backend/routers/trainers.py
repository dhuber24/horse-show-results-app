# No `from __future__ import annotations` here on purpose: slowapi's @limit
# wrapper hides string annotations from FastAPI (see gaitdesk_contact.py).
from datetime import date
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import load_only, selectinload
from uuid import UUID
import bcrypt

import stripe_gateway
from database import get_db
from dependencies import require_admin, require_authenticated, safe_uuid
from mailer import public_app_url, send_email
from payment_events import KIND_TRAINER_PRO
from models import (
    Association,
    Horse,
    Trainer,
    TrainerDocument,
    TrainerLead,
    TrainerProRequest,
    TrainerRegistration,
    User,
)
from schemas import (
    HorseOut,
    TrainerCreate,
    TrainerLeadCreate,
    TrainerLeadOut,
    TrainerOut,
    TrainerProfileOut,
    TrainerProfileUpdate,
    TrainerProRequestCreate,
    TrainerProUpdate,
    TrainerPublicOut,
    TrainerRegistrationCreate,
    TrainerRegistrationOut,
    TrainerRegistrationUpdate,
    TrainerRegistryNear,
    TrainerRegistryOut,
    TrainerUpdate,
)
from show_companies import admin_emails, email_admins
from trainer_registry import (
    MAX_PHOTOS,
    MAX_RATE_LINES,
    MAX_VIDEO_LINKS,
    PRO_INTERVALS,
    PRO_PLANS,
    PRO_PRICE_CENTS,
    RADIUS_CHOICES,
    TRAINER_DISCIPLINES,
    ListingMedia,
    clean_disciplines,
    is_listed,
    is_pro,
    lead_email,
    lead_recipient,
    listing_email,
    listing_problem,
    pro_request_email,
    public_card,
    rank_listings,
    unknown_disciplines,
    video_links_problem,
)
from zip_locations import normalize_zip, valid_coordinates, zip_location

router = APIRouter(prefix="/trainers", tags=["Trainers"])
limiter = Limiter(key_func=get_remote_address)

_horse_options = [
    selectinload(Horse.breed),
    selectinload(Horse.breeds),
    selectinload(Horse.color),
    selectinload(Horse.owner_exhibitor),
    selectinload(Horse.trainer),
]

_trainer_full_options = [
    selectinload(Trainer.user),
    # Never the image bytes: a trainer may have a headshot, a logo and a photo
    # gallery, and the profile only asks which ones exist.
    selectinload(Trainer.documents).load_only(
        TrainerDocument.id, TrainerDocument.trainer_id, TrainerDocument.document_type
    ),
    selectinload(Trainer.registrations).selectinload(TrainerRegistration.association),
    selectinload(Trainer.pro_request),
]


def _trainer_to_out(
    trainer: Trainer, horse_count: int, pro_request: Optional[TrainerProRequest] = None
) -> TrainerOut:
    # `pro_request` is passed in rather than read off the trainer: a freshly
    # created row has never loaded it, and a lazy load here would be a
    # MissingGreenlet in an async route.
    return TrainerOut(
        zip_code=trainer.zip_code,
        is_pro=is_pro(trainer),
        pro_until=trainer.pro_until,
        pro_plan=trainer.pro_plan,
        pro_request_plan=pro_request.plan if pro_request else None,
        pro_requested_at=pro_request.created_at if pro_request else None,
        id=trainer.id,
        user_id=trainer.user_id,
        first_name=trainer.first_name,
        last_name=trainer.last_name,
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


def _split_person_name(value: str) -> tuple[str, str]:
    first, _, last = value.strip().partition(" ")
    return first.strip(), last.strip()


def _resolve_name_updates(
    updates: dict,
    current_first: str,
    current_last: str,
) -> tuple[str, str]:
    first = updates.pop("first_name", None)
    last = updates.pop("last_name", None)
    legacy_name = updates.pop("name", None)
    if legacy_name is not None and first is None and last is None:
        first, last = _split_person_name(legacy_name)
    next_first = (first if first is not None else current_first).strip()
    next_last = (last if last is not None else current_last).strip()
    if not next_first or not next_last:
        raise HTTPException(400, "First name and last name are required")
    return next_first, next_last


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
        select(Trainer)
        .options(selectinload(Trainer.user), selectinload(Trainer.pro_request))
        .order_by(Trainer.name)
    )
    trainers = result.scalars().all()
    counts_res = await db.execute(
        select(Horse.trainer_id, func.count())
        .where(Horse.trainer_id.is_not(None))
        .group_by(Horse.trainer_id)
    )
    counts = {row[0]: row[1] for row in counts_res.all()}
    return [_trainer_to_out(t, counts.get(t.id, 0), t.pro_request) for t in trainers]


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


async def _listing_media(trainer_ids: list[UUID], db: AsyncSession) -> dict[UUID, ListingMedia]:
    # Ids and types only -- the bytes are served one picture at a time by the
    # media endpoint, and loading them here would pull every gallery to list it.
    if not trainer_ids:
        return {}
    result = await db.execute(
        select(TrainerDocument.id, TrainerDocument.trainer_id, TrainerDocument.document_type)
        .where(TrainerDocument.trainer_id.in_(trainer_ids))
        .order_by(TrainerDocument.created_at)
    )
    found: dict[UUID, dict] = {}
    for doc_id, trainer_id, doc_type in result.all():
        entry = found.setdefault(trainer_id, {"headshot_id": None, "logo_id": None, "photo_ids": []})
        if doc_type == "HEADSHOT":
            entry["headshot_id"] = doc_id
        elif doc_type == "LOGO":
            entry["logo_id"] = doc_id
        elif doc_type == "PHOTO":
            entry["photo_ids"].append(doc_id)
    return {
        trainer_id: ListingMedia(e["headshot_id"], e["logo_id"], tuple(e["photo_ids"]))
        for trainer_id, e in found.items()
    }


_registry_options = [
    selectinload(Trainer.user),
    selectinload(Trainer.registrations).selectinload(TrainerRegistration.association),
]


# Public: the choices and limits the registry's forms offer, so the frontend
# never keeps a second copy of the discipline list.
@router.get("/registry/options")
async def trainer_registry_options():
    return {
        "disciplines": list(TRAINER_DISCIPLINES),
        "radius_choices": [r for r in RADIUS_CHOICES if r is not None],
        "max_photos": MAX_PHOTOS,
        "max_video_links": MAX_VIDEO_LINKS,
        "max_rate_lines": MAX_RATE_LINES,
    }


# Public, no auth: the Trainer Registry page at /trainers. See trainer_registry.py.
@router.get("/registry", response_model=TrainerRegistryOut)
async def list_trainer_registry(
    zip_code: Optional[str] = Query(default=None, alias="zip", max_length=10),
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius: Optional[int] = Query(default=None, ge=1, le=3000),
    db: AsyncSession = Depends(get_db),
):
    """Every listed trainer, Pro first. Searched from a zip code, or from the
    browser's own coordinates, Pro is ranked nearest-first and `radius` (miles)
    narrows both plans; see `trainer_registry.rank_listings`."""
    result = await db.execute(
        select(Trainer)
        .options(*_registry_options)
        .where(Trainer.is_public.is_(True))
        .order_by(func.lower(Trainer.last_name), func.lower(Trainer.first_name))
    )
    trainers = [t for t in result.scalars().all() if is_listed(t)]
    media = await _listing_media([t.id for t in trainers], db)

    origin = None
    near = None
    if zip_code and zip_code.strip():
        searched = normalize_zip(zip_code)
        origin = zip_location(searched)
        near = TrainerRegistryNear(zip=searched or zip_code.strip(), located=origin is not None)
    elif lat is not None or lon is not None:
        origin = valid_coordinates(lat, lon)
        near = TrainerRegistryNear(located=origin is not None)

    entries = [
        (public_card(t, t.registrations, media.get(t.id, ListingMedia())), zip_location(t.zip_code))
        for t in trainers
    ]
    return TrainerRegistryOut(
        listings=rank_listings(entries, origin, radius if origin else None),
        near=near,
    )


@router.get("/me", response_model=TrainerProfileOut)
async def get_my_trainer_profile(
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    return await _load_trainer_for_self(user_id, db)


@router.patch("/me", response_model=TrainerProfileOut)
async def update_my_trainer_profile(
    body: TrainerProfileUpdate,
    background: BackgroundTasks,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    trainer = await _load_trainer_for_self(user_id, db)
    if not trainer.user:
        raise HTTPException(404, "Trainer profile not found")
    was_public = bool(trainer.is_public)

    updates = body.model_dump(exclude_unset=True)
    next_first_name, next_last_name = _resolve_name_updates(
        updates, trainer.first_name, trainer.last_name
    )
    next_private_phone = updates.get("private_phone", trainer.private_phone)
    next_private_email = str(updates.get("private_email", trainer.user.email))

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

    trainer.first_name = next_first_name
    trainer.last_name = next_last_name
    trainer.user.first_name = next_first_name
    trainer.user.last_name = next_last_name
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

    # ── Trainer Registry listing (migration 165) ──
    problem = None
    if "zip_code" in updates:
        raw_zip = (updates["zip_code"] or "").strip()
        trainer.zip_code = normalize_zip(raw_zip) if raw_zip else None
        if raw_zip and not trainer.zip_code:
            problem = "Enter a 5-digit zip code."
    if "disciplines" in updates and updates["disciplines"] is not None:
        unknown = unknown_disciplines(updates["disciplines"])
        if unknown:
            problem = f"Not a discipline on the list: {', '.join(unknown)}"
        trainer.disciplines = clean_disciplines(updates["disciplines"])
    if "video_urls" in updates and updates["video_urls"] is not None:
        urls = [u.strip() for u in updates["video_urls"] if u and u.strip()]
        problem = problem or video_links_problem(urls)
        trainer.video_urls = urls
    if "rate_sheet" in updates and updates["rate_sheet"] is not None:
        if len(updates["rate_sheet"]) > MAX_RATE_LINES:
            problem = problem or f"A rate sheet holds up to {MAX_RATE_LINES} lines."
        trainer.rate_sheet = updates["rate_sheet"]

    # The profile form disables Save on the same rule; this is the backstop.
    if not problem and trainer.is_public:
        problem = listing_problem(trainer.city, trainer.state, trainer.zip_code, trainer.disciplines)
    if problem:
        await db.rollback()
        raise HTTPException(400, problem)

    # Only the moment it goes on, not every save of a listed profile.
    newly_listed = trainer.is_public and not was_public
    recipients = await admin_emails(db) if newly_listed else []

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Email already in use")
    if recipients:
        subject, mail_body = listing_email(trainer, trainer.user.email, at_signup=False)
        background.add_task(email_admins, recipients, subject, mail_body, trainer.user.email)
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


@router.get(
    "/{trainer_id}/horses",
    response_model=list[HorseOut],
    dependencies=[Depends(require_authenticated)],
)
async def list_trainer_horses(
    trainer_id: UUID,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _check_admin_or_self(trainer_id, user_id, x_user_role, db)
    horses_result = await db.execute(
        select(Horse)
        .options(*_horse_options)
        .where(Horse.trainer_id == trainer_id)
        .order_by(Horse.name)
    )
    return horses_result.scalars().all()


@router.delete("/me/horses/{horse_id}", status_code=204)
async def unlink_horse_from_my_trainer_profile(
    horse_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    # Lets a trainer remove a horse that an exhibitor wrongly linked to them.
    # Only succeeds when the horse is currently linked to this trainer.
    result = await db.execute(select(Trainer).where(Trainer.user_id == safe_uuid(user_id)))
    trainer = result.scalar_one_or_none()
    if not trainer:
        raise HTTPException(404, "Trainer profile not found")

    horse = await db.get(Horse, horse_id)
    if not horse or horse.trainer_id != trainer.id:
        raise HTTPException(404, "Horse is not linked to your trainer profile")

    horse.trainer_id = None
    # Also clear the free-text fallback so the horse doesn't keep claiming this
    # trainer by name after the registry link is removed.
    horse.trainer_name = None
    await db.commit()


# ── Trainer Registry: the trainer's own leads and Pro request ─────────────────


@router.get("/me/leads", response_model=list[TrainerLeadOut])
async def list_my_leads(
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    # Every lead they were ever sent, even after Pro lapses: they are the
    # trainer's messages, and the email may never have arrived.
    trainer = await _load_trainer_for_self(user_id, db)
    result = await db.execute(
        select(TrainerLead)
        .where(TrainerLead.trainer_id == trainer.id)
        .order_by(TrainerLead.created_at.desc())
        .limit(500)
    )
    return result.scalars().all()


@router.post("/me/pro-request", response_model=TrainerProfileOut)
async def request_pro(
    body: TrainerProRequestCreate,
    background: BackgroundTasks,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Ask GaitDesk for Pro. One request per trainer: asking again changes the
    plan on it, and the admins are emailed only for a new one or a new plan."""
    trainer = await _load_trainer_for_self(user_id, db)
    existing = trainer.pro_request
    if existing and existing.plan == body.plan:
        return trainer
    if existing:
        existing.plan = body.plan
    else:
        db.add(TrainerProRequest(
            trainer_id=trainer.id, plan=body.plan, requested_by_user_id=safe_uuid(user_id)
        ))
    recipients = await admin_emails(db)
    await db.commit()
    if recipients:
        login_email = trainer.user.email if trainer.user else None
        subject, mail_body = pro_request_email(trainer, body.plan, login_email)
        background.add_task(email_admins, recipients, subject, mail_body, login_email)
    return await _reload_for_self(user_id, db)


@router.delete("/me/pro-request", response_model=TrainerProfileOut)
async def withdraw_pro_request(
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    trainer = await _load_trainer_for_self(user_id, db)
    await db.execute(delete(TrainerProRequest).where(TrainerProRequest.trainer_id == trainer.id))
    await db.commit()
    return await _reload_for_self(user_id, db)


@router.post("/me/pro-checkout")
async def start_pro_checkout(
    body: TrainerProRequestCreate,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Subscribe to Pro by card (migration 172): returns the Stripe Checkout
    page to send the trainer to. Card only, and GaitDesk pays the processing
    fee. Pro switches on when Stripe reports the first invoice paid, and each
    renewal moves `pro_until` on (`payment_events.apply_trainer_renewal`).

    The Stripe customer is made here, before Checkout, and kept on the trainer
    -- so a paid invoice can always be matched to them, whichever of Stripe's
    events arrives first.
    """
    stripe_gateway.require_configured()
    trainer = await _load_trainer_for_self(user_id, db)
    if trainer.stripe_subscription_id:
        raise HTTPException(
            409, "You already have a Pro subscription. Use Manage subscription to change or cancel it."
        )
    try:
        if not trainer.stripe_customer_id:
            trainer.stripe_customer_id = await stripe_gateway.run(
                stripe_gateway.create_customer,
                trainer.user.email if trainer.user else trainer.email,
                trainer.name,
                {"trainer_id": str(trainer.id)},
            )
            await db.commit()
        url = await stripe_gateway.run(
            stripe_gateway.create_subscription_checkout,
            customer_id=trainer.stripe_customer_id,
            amount_cents=PRO_PRICE_CENTS[body.plan],
            interval=PRO_INTERVALS[body.plan],
            product_name=f"GaitDesk Trainer Registry {PRO_PLANS[body.plan]}",
            success_url=f"{public_app_url()}/profile/registry?pro=thanks",
            cancel_url=f"{public_app_url()}/profile/registry",
            metadata={"kind": KIND_TRAINER_PRO, "trainer_id": str(trainer.id), "plan": body.plan},
        )
    except stripe_gateway.PaymentError as exc:
        raise HTTPException(502, exc.message)
    return {"url": url}


@router.post("/me/billing-portal")
async def open_billing_portal(
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Stripe's own page for the trainer to change their card, switch between
    monthly and annual, or cancel. Cancelling leaves Pro on through the date
    already paid for."""
    stripe_gateway.require_configured()
    trainer = await _load_trainer_for_self(user_id, db)
    if not trainer.stripe_customer_id:
        raise HTTPException(409, "There is no Pro subscription on file to manage.")
    try:
        url = await stripe_gateway.run(
            stripe_gateway.create_billing_portal,
            trainer.stripe_customer_id,
            f"{public_app_url()}/profile/registry",
        )
    except stripe_gateway.PaymentError as exc:
        raise HTTPException(502, exc.message)
    return {"url": url}


async def _reload_for_self(user_id: str, db: AsyncSession) -> Trainer:
    # After a write that changed `pro_request`, the row is already in the
    # session, so a plain re-select would hand back the stale relationship.
    result = await db.execute(
        select(Trainer)
        .options(*_trainer_full_options)
        .where(Trainer.user_id == safe_uuid(user_id))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


# ── Trainer professional affiliations ──────────────────────────────────────────


async def _resolve_association(association_id: UUID, db: AsyncSession) -> Association:
    association = await db.get(Association, association_id)
    if not association:
        raise HTTPException(400, "Unknown association")
    if not association.is_active:
        raise HTTPException(400, "That association is no longer active")
    return association


async def _load_registration(
    trainer_id: UUID, registration_id: UUID, db: AsyncSession
) -> TrainerRegistration:
    result = await db.execute(
        select(TrainerRegistration)
        .options(selectinload(TrainerRegistration.association))
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
        .options(selectinload(TrainerRegistration.association))
        .where(TrainerRegistration.trainer_id == trainer_id)
        .order_by(TrainerRegistration.created_at)
    )
    return list(result.scalars().all())


async def _create_registration(
    trainer_id: UUID, body: TrainerRegistrationCreate, db: AsyncSession
) -> TrainerRegistration:
    await _resolve_association(body.association_id, db)
    registration = TrainerRegistration(
        trainer_id=trainer_id,
        association_id=body.association_id,
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
    await db.refresh(registration, attribute_names=["association"])
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
    trainer = await db.get(
        Trainer, trainer_id, options=[selectinload(Trainer.user), selectinload(Trainer.pro_request)]
    )
    if not trainer:
        raise HTTPException(404, "Trainer not found")
    updates = body.model_dump(exclude_unset=True)
    if "first_name" in updates or "last_name" in updates or "name" in updates:
        trainer.first_name, trainer.last_name = _resolve_name_updates(
            updates, trainer.first_name, trainer.last_name
        )
        if trainer.user:
            trainer.user.first_name = trainer.first_name
            trainer.user.last_name = trainer.last_name
    for k, v in updates.items():
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
    return _trainer_to_out(trainer, count_res.scalar_one() or 0, trainer.pro_request)


@router.delete("/{trainer_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_trainer(trainer_id: UUID, db: AsyncSession = Depends(get_db)):
    trainer = await db.get(Trainer, trainer_id)
    if not trainer:
        raise HTTPException(404, "Trainer not found")
    linked_user = await db.get(User, trainer.user_id) if trainer.user_id else None
    await db.delete(trainer)
    if linked_user:
        await db.delete(linked_user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            409,
            "Cannot delete trainer: linked user is still referenced by other records. "
            "Remove the dependent records first.",
        )


# ── Public: one trainer's Trainer Registry listing (/trainers/{id}) ────────────


@router.get("/{trainer_id}/public", response_model=TrainerPublicOut)
async def get_public_trainer(trainer_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Trainer).options(*_registry_options).where(Trainer.id == trainer_id)
    )
    trainer = result.scalar_one_or_none()
    if not trainer or not is_listed(trainer):
        raise HTTPException(404, "Trainer not found")
    media = await _listing_media([trainer.id], db)
    return public_card(trainer, trainer.registrations, media.get(trainer.id, ListingMedia()))


# ── Public: the Contact Trainer button on a Pro listing ────────────────────────


@router.post("/{trainer_id}/leads", status_code=201)
@limiter.limit("5/minute")
async def send_trainer_lead(
    request: Request,
    trainer_id: UUID,
    body: TrainerLeadCreate,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Stored, then emailed to the trainer -- `mailer.py` does nothing without
    SMTP, and a lead that was only an email could be lost. Only a listed Pro
    trainer takes leads; anybody else is a 404, the same as no listing."""
    result = await db.execute(
        select(Trainer).options(selectinload(Trainer.user)).where(Trainer.id == trainer_id)
    )
    trainer = result.scalar_one_or_none()
    if not trainer or not is_listed(trainer) or not is_pro(trainer):
        raise HTTPException(404, "Trainer not found")

    # A bot filled in the hidden field. Told it worked, and nothing is kept:
    # telling it otherwise only teaches it to try again.
    if (body.website or "").strip():
        return {"ok": True}

    lead = TrainerLead(
        trainer_id=trainer.id,
        sender_name=body.sender_name,
        sender_email=str(body.sender_email).strip().lower(),
        sender_phone=(body.sender_phone or "").strip() or None,
        message=body.message,
    )
    db.add(lead)
    await db.commit()

    recipient = lead_recipient(trainer)
    if recipient:
        subject, mail_body = lead_email(trainer, lead)
        background.add_task(send_email, recipient, subject, mail_body, lead.sender_email)
    return {"ok": True}


# ── Admin: recording Pro ───────────────────────────────────────────────────────


@router.put("/{trainer_id}/pro", response_model=TrainerOut, dependencies=[Depends(require_admin)])
async def set_trainer_pro(trainer_id: UUID, body: TrainerProUpdate, db: AsyncSession = Depends(get_db)):
    """Record what a trainer has paid for: Pro through `pro_until`, or no Pro
    at all when it is null. Recording a date that has not passed answers their
    request, as switching a company's feature on answers its request."""
    trainer = await db.get(
        Trainer, trainer_id, options=[selectinload(Trainer.user), selectinload(Trainer.pro_request)]
    )
    if not trainer:
        raise HTTPException(404, "Trainer not found")
    trainer.pro_until = body.pro_until
    trainer.pro_plan = body.pro_plan if body.pro_until else None
    answered = body.pro_until is not None and body.pro_until >= date.today()
    if answered and trainer.pro_request:
        await db.delete(trainer.pro_request)
    await db.commit()

    reloaded = await db.execute(
        select(Trainer)
        .options(selectinload(Trainer.user), selectinload(Trainer.pro_request))
        .where(Trainer.id == trainer_id)
        .execution_options(populate_existing=True)
    )
    trainer = reloaded.scalar_one()
    count_res = await db.execute(
        select(func.count()).select_from(Horse).where(Horse.trainer_id == trainer.id)
    )
    return _trainer_to_out(trainer, count_res.scalar_one() or 0, trainer.pro_request)


@router.delete("/{trainer_id}/pro-request", status_code=204, dependencies=[Depends(require_admin)])
async def dismiss_pro_request(trainer_id: UUID, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(TrainerProRequest).where(TrainerProRequest.trainer_id == trainer_id))
    await db.commit()
