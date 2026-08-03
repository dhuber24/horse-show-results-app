"""Exhibitor self-registration for a published show.

Exhibitors browse PUBLISHED shows, pick a horse per class they want to enter,
and submit one request that:

- ensures a `show_entries` row exists for the exhibitor (back number left blank
  for the secretary to assign);
- creates one `entries` row per (class, horse) pair;
- runs the same association/Coggins validation as the secretary entry path.

The exhibitor is derived from the authenticated user — never trusted from the
request body — so a logged-in EXHIBITOR can only register themselves.

Once a show flips out of PUBLISHED (ACTIVE / COMPLETED / DRAFT), this endpoint
returns 403 and the secretary must add late entries through the admin flow.
"""
from datetime import date
from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, union
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from dependencies import INTERNAL_API_KEY, require_authenticated, safe_uuid
from models import (
    AqhaStandardClass,
    Class,
    ClassAssociation,
    Entry,
    Exhibitor,
    ExhibitorHorse,
    Horse,
    HorseDocument,
    Result,
    Show,
    ShowEntry,
)
from routers.shows import get_aqha_association_id
from rules import get_rules
from schemas import EntryOut

router = APIRouter(prefix="/shows/{show_id}/register", tags=["Show Registration"])


# ── Request / response schemas ────────────────────────────────────────────────

class ShowRegistrationItem(BaseModel):
    class_id: UUID
    horse_id: UUID
    apha_division: Optional[str] = Field(default=None, max_length=40)
    relationship_to_owner: Optional[str] = Field(default=None, max_length=200)


class ShowRegistrationCreate(BaseModel):
    entries: list[ShowRegistrationItem] = Field(min_length=1)


class FeeBreakdownItem(BaseModel):
    class_id: UUID
    class_number: str
    class_name: str
    fee_cents: int
    nsba_sanction_cents: int = 0


class ShowRegistrationResult(BaseModel):
    show_entry_id: UUID
    created_entries: list[EntryOut]
    fee_breakdown: list[FeeBreakdownItem]
    subtotal_fee_cents: int
    nsba_sanction_total_cents: int = 0
    office_charge_total_cents: int = 0
    total_fee_cents: int


# NSBA Sanction Fees rule: 6% of entry fee, minimum $3, charged on every
# NSBA-approved entry (paid even if the exhibitor scratches).
# Source: https://www.nsba.com/images/documents/Show-Approval-Documents/Sanction-Fees.pdf
NSBA_SANCTION_MIN_CENTS = 300
NSBA_SANCTION_RATE = 0.06


def _class_is_nsba(show: Show, class_: Class) -> bool:
    """NSBA approval comes from club sanctioning, not from the show type.

    Migration 080 split clubs out of show_types: NSBA is a club association a
    show opts into via show_sanctioning, so an "NSBA show" is now (for example)
    an OPEN or AQHA show carrying NSBA sanctioning."""
    return any(
        s.association is not None and s.association.code == "NSBA"
        for s in (show.sanctioning or [])
    )


def _nsba_sanction_cents(entry_fee_cents: int) -> int:
    pct = int(round(entry_fee_cents * NSBA_SANCTION_RATE))
    return max(NSBA_SANCTION_MIN_CENTS, pct)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _load_exhibitor_for_user(user_id: UUID, db: AsyncSession) -> Exhibitor:
    result = await db.execute(
        select(Exhibitor)
        .options(selectinload(Exhibitor.registrations))
        .where(Exhibitor.user_id == user_id)
    )
    exhibitor = result.scalar_one_or_none()
    if not exhibitor:
        raise HTTPException(403, "Only exhibitors can self-register for a show")
    return exhibitor


async def _load_published_show_or_403(show_id: UUID, db: AsyncSession) -> Show:
    result = await db.execute(
        select(Show)
        .options(
            selectinload(Show.show_type),
            # Needed by _class_is_nsba: club sanctioning drives NSBA fees.
            selectinload(Show.sanctioning),
        )
        .where(Show.id == show_id)
    )
    show = result.scalar_one_or_none()
    if not show:
        raise HTTPException(404, "Show not found")
    if show.status != "PUBLISHED":
        raise HTTPException(
            403,
            "Self-registration is only available while the show is open for "
            f"registration (current status: {show.status}). "
            "Contact the show secretary to be added.",
        )
    return show


async def _exhibitor_horse_ids(exhibitor_id: UUID, db: AsyncSession) -> set[UUID]:
    """Horses on this exhibitor's profile — matches the /my-horses endpoint (created or linked).

    Intentionally excludes horses that only have owner_exhibitor_id set: those are
    invisible to the exhibitor in their profile UI and cannot be managed there, so they
    should not appear in the self-registration picker either. Use ExhibitorHorse to
    explicitly grant an exhibitor access to a horse they didn't create.
    """
    from_created = select(Horse.id).where(Horse.created_by_exhibitor_id == exhibitor_id)
    from_link = (
        select(Horse.id)
        .join(ExhibitorHorse, ExhibitorHorse.horse_id == Horse.id)
        .where(ExhibitorHorse.exhibitor_id == exhibitor_id)
    )
    combined = union(from_created, from_link).subquery()
    result = await db.execute(select(combined.c.id))
    return {row[0] for row in result.all()}


def _aqha_class_code(show: Show, class_: Class) -> str | None:
    for assoc in class_.associations or []:
        if assoc.show_type_id == show.show_type_id or (
            assoc.show_type and assoc.show_type.code == "AQHA"
        ):
            return assoc.association_class_code
    return None


async def _association_validation_context(show: Show, class_: Class, db: AsyncSession):
    context: dict = {}
    if show.show_type and show.show_type.code == "AQHA":
        aqha_code = _aqha_class_code(show, class_)
        context["aqha_show_type_id"] = show.show_type_id
        context["aqha_association_id"] = await get_aqha_association_id(db)
        context["aqha_class_code"] = aqha_code
        context["aqha_class"] = (
            await db.get(AqhaStandardClass, aqha_code) if aqha_code else None
        )
    return context


async def _assert_coggins(horse_id: UUID, db: AsyncSession) -> None:
    result = await db.execute(
        select(HorseDocument).where(
            HorseDocument.horse_id == horse_id,
            HorseDocument.document_type == "COGGINS",
        )
    )
    docs = result.scalars().all()
    today = date.today()
    has_valid = any(doc.expiry_date is None or doc.expiry_date >= today for doc in docs)
    if not has_valid:
        msg = (
            "No valid Coggins on file for this horse"
            if not docs
            else "Coggins on file has expired"
        )
        raise HTTPException(422, {"code": "COGGINS_EXPIRED", "message": msg})


def _coggins_requirement(expiry_dates: list[date | None]) -> dict:
    today = date.today()
    has_valid = any(expiry_date is None or expiry_date >= today for expiry_date in expiry_dates)
    if has_valid:
        return {
            "code": "COGGINS",
            "label": "Coggins Test (EIA)",
            "status": "valid",
            "message": "Valid Coggins on file",
        }

    return {
        "code": "COGGINS",
        "label": "Coggins Test (EIA)",
        "status": "expired" if expiry_dates else "missing",
        "message": (
            "Coggins on file has expired"
            if expiry_dates
            else "No valid Coggins on file for this horse"
        ),
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/preview")
async def preview_registration(
    show_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Return the published-show classes the caller can register for, along
    with the horses on their exhibitor profile and existing entries.

    The frontend uses this to render the registration form: a horse picker per
    class, with already-entered (class, horse) combinations preselected.
    """
    show = await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(safe_uuid(user_id), db)

    classes_result = await db.execute(
        select(Class)
        .options(
            selectinload(Class.associations).selectinload(ClassAssociation.show_type)
        )
        .where(Class.show_id == show_id, Class.status != "CLOSED")
        .order_by(Class.class_date, Class.sort_order.nullslast(), Class.class_number)
    )
    classes = classes_result.scalars().all()

    horse_ids = await _exhibitor_horse_ids(exhibitor.id, db)
    horses: list[Horse] = []
    coggins_expiries_by_horse: dict[UUID, list[date | None]] = {}
    if horse_ids:
        horses_result = await db.execute(
            select(Horse).where(Horse.id.in_(horse_ids)).order_by(Horse.name)
        )
        horses = horses_result.scalars().all()
        coggins_expiries_by_horse = {h.id: [] for h in horses}
        coggins_result = await db.execute(
            select(HorseDocument.horse_id, HorseDocument.expiry_date).where(
                HorseDocument.horse_id.in_(horse_ids),
                HorseDocument.document_type == "COGGINS",
            )
        )
        for horse_id, expiry_date in coggins_result.all():
            coggins_expiries_by_horse.setdefault(horse_id, []).append(expiry_date)

    existing_result = await db.execute(
        select(Entry)
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id, Entry.exhibitor_id == exhibitor.id)
    )
    existing = existing_result.scalars().all()

    return {
        "show": {
            "id": str(show.id),
            "name": show.name,
            "status": show.status,
            "start_date": show.start_date,
            "end_date": show.end_date,
            "show_type_code": show.show_type.code if show.show_type else None,
            "office_charge_cents": show.office_charge_cents,
        },
        "exhibitor": {
            "id": str(exhibitor.id),
            "full_name": exhibitor.full_name,
        },
        "classes": [
            {
                "id": str(c.id),
                "class_number": c.class_number,
                "class_name": c.class_name,
                "class_date": c.class_date,
                "entry_fee_cents": c.entry_fee_cents,
                "is_nsba_approved": _class_is_nsba(show, c),
                "nsba_sanction_cents": (
                    _nsba_sanction_cents(c.entry_fee_cents)
                    if _class_is_nsba(show, c)
                    else 0
                ),
            }
            for c in classes
        ],
        "horses": [
            {
                "id": str(h.id),
                "name": h.name,
                "can_register": (
                    _coggins_requirement(coggins_expiries_by_horse.get(h.id, []))["status"]
                    == "valid"
                ),
                "registration_requirements": [
                    _coggins_requirement(coggins_expiries_by_horse.get(h.id, []))
                ],
            }
            for h in horses
        ],
        "existing_entries": [
            {
                "id": str(e.id),
                "class_id": str(e.class_id),
                "horse_id": str(e.horse_id) if e.horse_id else None,
            }
            for e in existing
        ],
    }


@router.post("/", response_model=ShowRegistrationResult, status_code=201)
async def register_for_show(
    show_id: UUID,
    body: ShowRegistrationCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")

    user_uuid = safe_uuid(x_user_id)
    show = await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(user_uuid, db)

    # Verify each horse belongs to this exhibitor before we touch the DB.
    requested_horse_ids = {item.horse_id for item in body.entries}
    allowed_horse_ids = await _exhibitor_horse_ids(exhibitor.id, db)
    not_yours = requested_horse_ids - allowed_horse_ids
    if not_yours:
        raise HTTPException(
            403,
            "One or more horses are not on your profile. Add them to your "
            "profile first before registering.",
        )

    # Resolve classes once, with association data for validation rules.
    requested_class_ids = {item.class_id for item in body.entries}
    classes_result = await db.execute(
        select(Class)
        .options(
            selectinload(Class.associations).selectinload(ClassAssociation.show_type)
        )
        .where(Class.id.in_(requested_class_ids))
    )
    classes_by_id = {c.id: c for c in classes_result.scalars().all()}
    for class_id in requested_class_ids:
        cls = classes_by_id.get(class_id)
        if not cls or cls.show_id != show_id:
            raise HTTPException(400, "One or more classes do not belong to this show")
        if cls.status == "CLOSED":
            raise HTTPException(
                400,
                f"Class {cls.class_number} ({cls.class_name}) is closed and not "
                "accepting entries.",
            )

    # Ensure a show_entries row exists for this exhibitor. Back number stays
    # NULL — assignment is the secretary's job.
    show_entry_result = await db.execute(
        select(ShowEntry).where(
            ShowEntry.show_id == show_id,
            ShowEntry.exhibitor_id == exhibitor.id,
        )
    )
    show_entry = show_entry_result.scalar_one_or_none()
    if not show_entry:
        show_entry = ShowEntry(show_id=show_id, exhibitor_id=exhibitor.id)
        db.add(show_entry)
        await db.flush()  # populate show_entry.id without committing

    # Eager-load horse registration data once per requested horse so the rules
    # engine can read it without lazy loads.
    horses_result = await db.execute(
        select(Horse)
        .options(selectinload(Horse.registrations))
        .where(Horse.id.in_(requested_horse_ids))
    )
    horses_by_id = {h.id: h for h in horses_result.scalars().all()}

    rules = get_rules(show.show_type.code if show.show_type else None)

    # Pull all of this exhibitor's existing entries for the requested classes
    # so we can pre-check "exhibitor already in this non-pattern class" rules
    # and reject duplicates inside the submitted batch too.
    existing_entries_result = await db.execute(
        select(Entry.class_id).where(
            Entry.exhibitor_id == exhibitor.id,
            Entry.class_id.in_(requested_class_ids),
        )
    )
    existing_non_pattern_classes: set[UUID] = {
        cid for (cid,) in existing_entries_result.all()
        if classes_by_id[cid].score_type != "pattern"
    }
    batch_non_pattern_classes: set[UUID] = set()

    created: list[Entry] = []
    fee_breakdown: list[FeeBreakdownItem] = []
    subtotal = 0
    sanction_total = 0
    horses_charged: set[UUID] = set()

    for item in body.entries:
        cls = classes_by_id[item.class_id]
        horse = horses_by_id.get(item.horse_id)
        if not horse:
            raise HTTPException(404, "Horse not found")

        if cls.score_type != "pattern":
            if cls.id in existing_non_pattern_classes or cls.id in batch_non_pattern_classes:
                raise HTTPException(
                    409,
                    f"You can only enter class {cls.class_number} "
                    f"({cls.class_name}) once.",
                )
            batch_non_pattern_classes.add(cls.id)

        await _assert_coggins(item.horse_id, db)

        entry = Entry(
            class_id=item.class_id,
            exhibitor_id=exhibitor.id,
            horse_id=item.horse_id,
            # Explicit, not left to the column default: that default is applied
            # at flush, and validate_entry runs before this is ever flushed. An
            # unset status reads as None and short-circuits every association
            # rule, silently skipping validation.
            status="ENTERED",
            apha_division=item.apha_division,
            relationship_to_owner=item.relationship_to_owner,
        )
        # Wire relationships so validate_entry can read them without lazy loads.
        entry.class_ = cls
        entry.horse = horse
        entry.exhibitor = exhibitor

        issues = rules.validate_entry(
            entry,
            show,
            cls,
            await _association_validation_context(show, cls, db),
        )
        errors = [i for i in issues if i.get("severity") == "error"]
        if errors:
            raise HTTPException(
                422,
                {
                    "code": "ASSOCIATION_VALIDATION_FAILED",
                    "message": (
                        f"Entry for class {cls.class_number} ({cls.class_name}) "
                        "fails validation"
                    ),
                    "issues": issues,
                },
            )

        db.add(entry)
        created.append(entry)
        sanction_cents = (
            _nsba_sanction_cents(cls.entry_fee_cents)
            if _class_is_nsba(show, cls)
            else 0
        )
        fee_breakdown.append(
            FeeBreakdownItem(
                class_id=cls.id,
                class_number=cls.class_number,
                class_name=cls.class_name,
                fee_cents=cls.entry_fee_cents,
                nsba_sanction_cents=sanction_cents,
            )
        )
        subtotal += cls.entry_fee_cents
        sanction_total += sanction_cents
        horses_charged.add(item.horse_id)

    office_charge_total = show.office_charge_cents * len(horses_charged)
    total_fee = subtotal + sanction_total + office_charge_total

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        msg = str(exc.orig) if exc.orig is not None else ""
        if "entries_class_horse_uniq" in msg:
            raise HTTPException(
                409,
                "One of the selected horses is already entered in that class.",
            )
        raise HTTPException(
            409,
            "One or more selections conflict with an existing entry.",
        )

    for entry in created:
        await db.refresh(entry)

    return ShowRegistrationResult(
        show_entry_id=show_entry.id,
        created_entries=[EntryOut.model_validate(e) for e in created],
        fee_breakdown=fee_breakdown,
        subtotal_fee_cents=subtotal,
        nsba_sanction_total_cents=sanction_total,
        office_charge_total_cents=office_charge_total,
        total_fee_cents=total_fee,
    )


@router.delete("/entries/{entry_id}", status_code=204)
async def withdraw_entry(
    show_id: UUID,
    entry_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Exhibitor-self withdraw of a single entry.

    Allowed while the show is PUBLISHED and the calling user owns the entry's
    exhibitor profile. Blocked once a result has been recorded — at that point
    the secretary handles edits through the admin flow.
    """
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")

    await _load_published_show_or_403(show_id, db)  # asserts PUBLISHED status
    exhibitor = await _load_exhibitor_for_user(safe_uuid(x_user_id), db)

    entry_result = await db.execute(
        select(Entry)
        .options(selectinload(Entry.class_))
        .where(Entry.id == entry_id)
    )
    entry = entry_result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Entry not found")
    if entry.exhibitor_id != exhibitor.id:
        raise HTTPException(403, "You can only withdraw your own entries")
    if not entry.class_ or entry.class_.show_id != show_id:
        raise HTTPException(404, "Entry not found in this show")

    # Defensive: results shouldn't exist during PUBLISHED, but if a class was
    # scored before being reverted, refuse to silently wipe historical results.
    result_exists = await db.execute(
        select(Result.id).where(Result.entry_id == entry_id).limit(1)
    )
    if result_exists.scalar_one_or_none():
        raise HTTPException(
            409,
            "This entry already has a result recorded and cannot be withdrawn. "
            "Contact the show secretary.",
        )

    await db.delete(entry)
    await db.commit()
