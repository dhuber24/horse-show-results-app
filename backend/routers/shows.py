import csv
import io
from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from sqlalchemy.orm import aliased, selectinload
from uuid import UUID
from datetime import date
from typing import Optional

from database import get_db
from dependencies import require_admin, require_admin_or_show_admin, INTERNAL_API_KEY, safe_uuid
from models import (
    Association,
    ClassAssociation,
    Show,
    ShowAffiliation,
    ShowSecretary,
    ShowScribe,
    ShowGateSteward,
    ShowManager,
    Entry,
    Class,
    Horse,
    Exhibitor,
    Judge,
    Result,
    ShowEntry,
    ShowJudge,
    HorseRegistration,
    ShowType,
    User,
)
from schemas import (
    APHAValidationOut,
    AssociationValidationOut,
    ShowCreate,
    ShowUpdate,
    ShowOut,
    ShowAffiliationUpdate,
)
from apha_context import apha_entry_context
from rules import get_rules
from rules.apha import application_window, category_requirements, show_minimums
import standard_classes

router = APIRouter(prefix="/shows", tags=["Shows"])


def _serialize(show: Show) -> dict:
    return {
        "id": show.id,
        "name": show.name,
        "venue": show.venue_rel.name if show.venue_rel else None,
        "venue_id": show.venue_id,
        "show_type_id": show.show_type_id,
        "show_type_code": show.show_type.code if show.show_type else None,
        "show_type_name": show.show_type.name if show.show_type else None,
        "start_date": show.start_date,
        "end_date": show.end_date,
        # The day entries close (migration 123). Records only -- it gates nothing
        # and bills nothing; APHA SC-090.C counts the approval deadline back from
        # it, or from start_date when it is unset.
        "entry_deadline": show.entry_deadline,
        "status": show.status,
        "apha_show_number": show.apha_show_number,
        # Serialized here because this function builds the payload by hand and
        # ShowOut would otherwise fill the gap with its own default. Left out, it
        # meant every show reported `apha_zone: null` whatever was stored -- and
        # the edit form, loading that null and posting it back, wiped the zone on
        # the next save. The migration-097 note below warned about this exact
        # shape; the zone arrived in migration 119, after it.
        "apha_zone": show.apha_zone,
        # Which kind of show, and whether a clinic runs alongside (migration 124).
        # `Show.show_category` is lazy="selectin" so this costs one extra SELECT
        # for the whole list rather than one per show.
        "show_category_id": show.show_category_id,
        "show_category": (
            {
                "id": str(show.show_category.id),
                "show_type_id": (
                    str(show.show_category.show_type_id)
                    if show.show_category.show_type_id else None
                ),
                "code": show.show_category.code,
                "name": show.show_category.name,
                "min_judges": show.show_category.min_judges,
                "max_judges": show.show_category.max_judges,
                "judge_limit_basis": show.show_category.judge_limit_basis,
                "min_days": show.show_category.min_days,
                "rule_reference": show.show_category.rule_reference,
            }
            if show.show_category else None
        ),
        "offers_clinic": show.offers_clinic,
        "aqha_show_number": show.aqha_show_number,
        "aqha_approval_status": show.aqha_approval_status,
        "aqha_approval_submitted_at": show.aqha_approval_submitted_at,
        "aqha_approval_notes": show.aqha_approval_notes,
        "office_charge_cents": show.office_charge_cents,
        "office_charge_basis": show.office_charge_basis,
        "shavings_ban_outside": show.shavings_ban_outside,
        # Which health papers this show requires (migration 097). Serialized
        # here rather than left to ShowOut's defaults: this function builds the
        # payload by hand, so a column missing from it reads back as the schema
        # default and a show that requires a CVI would report that it does not.
        "requires_coggins": show.requires_coggins,
        "requires_health_certificate": show.requires_health_certificate,
        "health_certificate_valid_days": show.health_certificate_valid_days,
        "requires_vaccination": show.requires_vaccination,
        "vaccination_valid_days": show.vaccination_valid_days,
        "vaccination_notes": show.vaccination_notes,
        "affiliations": [
            {
                "show_type_id": str(a.show_type_id),
                "show_type_code": a.show_type.code,
                "show_type_name": a.show_type.name,
            }
            for a in (show.affiliations or [])
        ],
        # Club sanctioning (NSBA, WSCA, ...). Program information — it is on the
        # front of every show bill, and an exhibitor deciding whether to enter
        # needs it to know which of their memberships earn points here. Distinct
        # from `affiliations`, which is breed show types; see the note in
        # Claude.md on why clubs are not `show_types`. Both relationships are
        # lazy="selectin" on the model, so this adds no options to any caller.
        "sanctioning": [
            {
                "association_id": str(s.association_id),
                "code": s.association.code if s.association else "",
                "name": s.association.name if s.association else "",
                "per_class_fee_cents": s.per_class_fee_cents,
            }
            for s in (show.sanctioning or [])
        ],
        "created_at": show.created_at,
    }


async def _get_show_with_type(db: AsyncSession, show_id: UUID) -> Show | None:
    result = await db.execute(
        select(Show).options(selectinload(Show.show_type), selectinload(Show.venue_rel)).where(Show.id == show_id)
    )
    return result.scalar_one_or_none()


@router.get("/")
async def list_shows(
    x_api_key: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    x_user_role: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    is_authenticated = x_api_key and x_api_key == INTERNAL_API_KEY

    if is_authenticated and x_user_role == "ADMIN":
        # Admins see all shows including DRAFTs
        query = select(Show).options(selectinload(Show.show_type), selectinload(Show.venue_rel)).order_by(Show.start_date)
    elif is_authenticated and x_user_role == "SHOW_SECRETARY" and x_user_id:
        # Secretaries see their own assigned shows (including DRAFTs)
        query = (
            select(Show)
            .options(selectinload(Show.show_type), selectinload(Show.venue_rel))
            .join(ShowSecretary, ShowSecretary.show_id == Show.id)
            .where(ShowSecretary.user_id == safe_uuid(x_user_id))
            .order_by(Show.start_date)
        )
    elif is_authenticated and x_user_role == "SHOW_MANAGER" and x_user_id:
        # Show Managers see shows they are assigned to manage (including DRAFTs)
        query = (
            select(Show)
            .options(selectinload(Show.show_type), selectinload(Show.venue_rel))
            .join(ShowManager, ShowManager.show_id == Show.id)
            .where(ShowManager.user_id == safe_uuid(x_user_id))
            .order_by(Show.start_date)
        )
    elif is_authenticated and x_user_role == "SCRIBE" and x_user_id:
        # Scribes see their assigned shows, but not DRAFTs
        query = (
            select(Show)
            .options(selectinload(Show.show_type), selectinload(Show.venue_rel))
            .join(ShowScribe, ShowScribe.show_id == Show.id)
            .where(ShowScribe.user_id == safe_uuid(x_user_id), Show.status != "DRAFT")
            .order_by(Show.start_date)
        )
    elif is_authenticated and x_user_role == "GATE_STEWARD" and x_user_id:
        # Gate stewards see their assigned shows, but not DRAFTs
        query = (
            select(Show)
            .options(selectinload(Show.show_type), selectinload(Show.venue_rel))
            .join(ShowGateSteward, ShowGateSteward.show_id == Show.id)
            .where(ShowGateSteward.user_id == safe_uuid(x_user_id), Show.status != "DRAFT")
            .order_by(Show.start_date)
        )
    else:
        # Public / exhibitors — no DRAFTs
        query = (
            select(Show)
            .options(selectinload(Show.show_type), selectinload(Show.venue_rel))
            .where(Show.status != "DRAFT")
            .order_by(Show.start_date)
        )

    result = await db.execute(query)
    return [_serialize(s) for s in result.scalars().all()]


@router.post("/", response_model=ShowOut, status_code=201)
async def create_show(
    body: ShowCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    if x_user_role not in ("ADMIN", "SHOW_SECRETARY", "SHOW_MANAGER"):
        raise HTTPException(403, "Admin, Show Secretary, or Show Manager access required")

    show = Show(**body.model_dump(), created_by_user_id=safe_uuid(x_user_id))
    db.add(show)
    await db.commit()

    if x_user_role == "SHOW_SECRETARY":
        db.add(ShowSecretary(show_id=show.id, user_id=safe_uuid(x_user_id)))
        await db.commit()
    elif x_user_role == "SHOW_MANAGER":
        db.add(ShowManager(show_id=show.id, user_id=safe_uuid(x_user_id)))
        await db.commit()

    show = await _get_show_with_type(db, show.id)
    return _serialize(show)


@router.get("/{show_id}", response_model=ShowOut)
async def get_show(show_id: UUID, db: AsyncSession = Depends(get_db)):
    show = await _get_show_with_type(db, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return _serialize(show)


@router.get("/{show_id}/results-index")
async def get_results_index(show_id: UUID, db: AsyncSession = Depends(get_db)):
    """Lightweight per-class participant index that powers the public Results
    search. For every placed result in a non-DRAFT, **posted** class, returns
    the placing plus the exhibitor/horse names and back number, grouped by
    class id, so the Results page can filter classes by horse, exhibitor, back
    number, place, or class number/name without one round trip per class.

    Public, mirroring the other read endpoints backing the Results page — which
    is why it filters on `results_published_at`: a class the scribe is still
    entering is a draft, and this endpoint has no authenticated caller to make
    an exception for.
    """
    if not await db.get(Show, show_id):
        raise HTTPException(404, "Show not found")

    # One row per placing per judge (migration 095). A class judged by a panel
    # legitimately lists the same horse once per card, so each row carries the
    # judge's name — collapsing to one row would have to pick a winner between
    # cards that disagree, which is not this app's job.
    rows = await db.execute(
        select(
            Class.id,
            Result.place,
            Result.is_tie,
            Result.outcome,
            Result.outcome_note,
            Entry.back_number,
            ShowEntry.back_number,
            Exhibitor.full_name,
            Horse.name,
            Judge.first_name,
            Judge.last_name,
        )
        .join(Result, Result.class_id == Class.id)
        .join(Entry, Entry.id == Result.entry_id)
        .join(Exhibitor, Exhibitor.id == Entry.exhibitor_id)
        .outerjoin(Horse, Horse.id == Entry.horse_id)
        .outerjoin(ShowJudge, ShowJudge.id == Result.judge_id)
        .outerjoin(Judge, Judge.id == ShowJudge.judge_id)
        .outerjoin(
            ShowEntry,
            (ShowEntry.show_id == show_id)
            & (ShowEntry.exhibitor_id == Entry.exhibitor_id),
        )
        .where(
            Class.show_id == show_id,
            Class.status != "DRAFT",
            Class.results_published_at.isnot(None),
        )
        # Result.place sorts NULLs last by default, which is where an entry that
        # was not placed belongs — behind everyone who was.
        .order_by(ShowJudge.sort_order.nulls_first(), Result.place)
    )

    by_class: dict[str, list[dict]] = {}
    for (
        class_id,
        place,
        is_tie,
        outcome,
        outcome_note,
        entry_bn,
        show_bn,
        exhibitor_name,
        horse_name,
        judge_first,
        judge_last,
    ) in rows:
        by_class.setdefault(str(class_id), []).append(
            {
                "place": place,
                "is_tie": bool(is_tie),
                # Migration 121. A row with no place is not an empty row — it is a
                # disqualification, an elimination, or a no score, and the sheet
                # has to say which.
                "outcome": outcome or "placed",
                "outcome_note": outcome_note,
                "back_number": show_bn if show_bn is not None else entry_bn,
                "exhibitor_name": exhibitor_name,
                "horse_name": horse_name,
                "judge_name": f"{judge_first} {judge_last}" if judge_first else None,
            }
        )
    return by_class


@router.get("/{show_id}/program-index")
async def get_program_index(show_id: UUID, db: AsyncSession = Depends(get_db)):
    """Per-class program listing for the whole show, grouped by class id — the
    columns a printed show program carries (back number, horse, owner, sire,
    dam, exhibitor).

    This backs both halves of the public schedule: expanding a class, and
    searching the show by horse, exhibitor, owner, or pedigree. Fetching it once
    beats one round trip per class, matching the results-index that powers the
    Results page.

    Owner display follows the horse record's own precedence — a linked owner
    exhibitor wins over the free-text owner_name fallback. Withdrawn entries and
    DRAFT classes are excluded. Public, like the other read endpoints behind the
    spectator pages.
    """
    if not await db.get(Show, show_id):
        raise HTTPException(404, "Show not found")

    owner = aliased(Exhibitor)
    rows = await db.execute(
        select(
            Class.id,
            Entry.id,
            Entry.back_number,
            ShowEntry.back_number,
            Entry.is_disqualified,
            Entry.gate_order,
            Exhibitor.full_name,
            Horse.name,
            Horse.owner_name,
            Horse.sire_name,
            Horse.dam_name,
            owner.full_name,
        )
        .join(Entry, Entry.class_id == Class.id)
        .join(Exhibitor, Exhibitor.id == Entry.exhibitor_id)
        .outerjoin(Horse, Horse.id == Entry.horse_id)
        .outerjoin(owner, owner.id == Horse.owner_exhibitor_id)
        .outerjoin(
            ShowEntry,
            (ShowEntry.show_id == show_id)
            & (ShowEntry.exhibitor_id == Entry.exhibitor_id),
        )
        .where(
            Class.show_id == show_id,
            Class.status != "DRAFT",
            Entry.status != "WITHDRAWN",
        )
        .order_by(Entry.gate_order.nullslast(), Entry.back_number.nullslast())
    )

    by_class: dict[str, list[dict]] = {}
    for (
        class_id,
        entry_id,
        entry_bn,
        show_bn,
        is_disqualified,
        gate_order,
        exhibitor_name,
        horse_name,
        horse_owner_name,
        sire_name,
        dam_name,
        owner_full_name,
    ) in rows:
        by_class.setdefault(str(class_id), []).append(
            {
                "id": str(entry_id),
                "back_number": show_bn if show_bn is not None else entry_bn,
                "exhibitor_name": exhibitor_name,
                "horse_name": horse_name,
                "owner_name": owner_full_name or horse_owner_name,
                "sire_name": sire_name,
                "dam_name": dam_name,
                "is_disqualified": bool(is_disqualified),
                "gate_order": gate_order,
            }
        )
    return by_class


async def _assert_show_access(show_id: UUID, x_api_key: str, x_user_id: str, x_user_role: str, db: AsyncSession):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    if x_user_role == "ADMIN":
        return
    if x_user_role == "SHOW_SECRETARY":
        row = await db.execute(
            select(ShowSecretary).where(ShowSecretary.show_id == show_id, ShowSecretary.user_id == safe_uuid(x_user_id))
        )
        if row.scalar_one_or_none():
            return
    if x_user_role == "SHOW_MANAGER":
        row = await db.execute(
            select(ShowManager).where(ShowManager.show_id == show_id, ShowManager.user_id == safe_uuid(x_user_id))
        )
        if row.scalar_one_or_none():
            return
    raise HTTPException(403, "Not authorized for this show")


async def association_id_by_code(db: AsyncSession, code: str) -> Optional[UUID]:
    """A body's row in the `associations` registry, by code.

    Horse and exhibitor registration numbers key on `associations`, not on
    `show_types` (migration 080). Anything reading a registration or membership
    number needs this id, and reaching for `show.show_type_id` instead is the
    mistake that left the APHA export raising AttributeError on every show whose
    entered horses held a registration row.
    """
    result = await db.execute(select(Association.id).where(Association.code == code))
    return result.scalar_one_or_none()


async def get_aqha_association_id(db: AsyncSession) -> Optional[UUID]:
    """AQHA's row in the `associations` registry. Shared by every caller that
    builds an AQHA validation context."""
    return await association_id_by_code(db, "AQHA")


async def _count_show_classes(db: AsyncSession, show_id: UUID) -> int:
    result = await db.execute(
        select(func.count()).select_from(Class).where(Class.show_id == show_id)
    )
    return result.scalar_one()


@router.patch("/{show_id}", response_model=ShowOut)
async def update_show(
    show_id: UUID,
    body: ShowUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")

    updates = body.model_dump(exclude_unset=True)
    new_status = updates.get("status")

    # Publishing gates (data integrity)
    if new_status == "PUBLISHED":
        effective_venue_id = updates.get("venue_id", show.venue_id)
        if not effective_venue_id:
            raise HTTPException(400, "Cannot publish: a venue must be selected before publishing.")
        class_count = await _count_show_classes(db, show_id)
        if class_count == 0:
            raise HTTPException(400, "Cannot publish: the show must have at least one class before publishing.")

    # In Progress gate: current date must fall within the show's date range
    if new_status == "ACTIVE":
        today = date.today()
        effective_start = updates.get("start_date", show.start_date)
        effective_end = updates.get("end_date", show.end_date)
        if not (effective_start <= today <= effective_end):
            raise HTTPException(
                400,
                "Cannot set status to In Progress: the current date is outside the show's date range.",
            )

    for k, v in updates.items():
        setattr(show, k, v)
    await db.commit()
    show = await _get_show_with_type(db, show_id)
    return _serialize(show)


@router.delete("/{show_id}", status_code=204)
async def delete_show(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    result = await db.execute(
        select(Show)
        .options(
            selectinload(Show.classes),
            selectinload(Show.rings),
            selectinload(Show.divisions),
            selectinload(Show.show_secretaries),
            selectinload(Show.show_scribes),
            selectinload(Show.show_entries),
        )
        .where(Show.id == show_id)
    )
    show = result.scalar_one_or_none()
    if not show:
        raise HTTPException(404, "Show not found")
    if show.status != "DRAFT":
        raise HTTPException(
            400,
            "Only shows in DRAFT status can be deleted. Transition the show back to DRAFT first.",
        )
    await db.delete(show)
    await db.commit()


@router.put("/{show_id}/affiliations", status_code=200, dependencies=[Depends(require_admin_or_show_admin)])
async def set_show_affiliations(
    show_id: UUID,
    body: ShowAffiliationUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    await db.execute(delete(ShowAffiliation).where(ShowAffiliation.show_id == show_id))
    for show_type_id in body.show_type_ids:
        db.add(ShowAffiliation(show_id=show_id, show_type_id=show_type_id))
    await db.commit()
    return {"ok": True}


def _class_association_code(class_: Class, show_type_id: UUID) -> str | None:
    for assoc in class_.associations or []:
        if assoc.show_type_id == show_type_id or (assoc.show_type and assoc.show_type.code == "AQHA"):
            return assoc.association_class_code
    return None


def _aqha_workshop_cutoff(show_date: date) -> date:
    try:
        return show_date.replace(year=show_date.year - 3)
    except ValueError:
        # Feb. 29 shows use Feb. 28 as the 3-year lookback boundary.
        return show_date.replace(year=show_date.year - 3, day=28)


async def _qualified_aqha_management_workshop_staff(db: AsyncSession, show: Show) -> list[User]:
    cutoff = _aqha_workshop_cutoff(show.start_date)
    secretary_result = await db.execute(
        select(User)
        .join(ShowSecretary, ShowSecretary.user_id == User.id)
        .where(
            ShowSecretary.show_id == show.id,
            User.aqha_management_workshop_completed_at.is_not(None),
            User.aqha_management_workshop_completed_at >= cutoff,
        )
    )
    manager_result = await db.execute(
        select(User)
        .join(ShowManager, ShowManager.user_id == User.id)
        .where(
            ShowManager.show_id == show.id,
            User.aqha_management_workshop_completed_at.is_not(None),
            User.aqha_management_workshop_completed_at >= cutoff,
        )
    )
    users_by_id = {user.id: user for user in secretary_result.scalars().all()}
    users_by_id.update({user.id: user for user in manager_result.scalars().all()})
    return list(users_by_id.values())


@router.get("/{show_id}/aqha-validation", response_model=AssociationValidationOut)
async def aqha_validation(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_with_type(db, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    if not show.show_type or show.show_type.code != "AQHA":
        raise HTTPException(400, "This show is not an AQHA sanctioned show")

    classes_result = await db.execute(
        select(Class)
        .options(selectinload(Class.associations).selectinload(ClassAssociation.show_type))
        .where(Class.show_id == show_id)
        .order_by(Class.class_date, Class.sort_order.nullslast(), Class.class_number)
    )
    classes = classes_result.scalars().all()
    codes = sorted(
        {
            code
            for cls in classes
            for code in [_class_association_code(cls, show.show_type_id)]
            if code
        }
    )
    standard_by_code = await standard_classes.lookup_many(db, "AQHA", list(codes))

    aqha_association_id = await get_aqha_association_id(db)

    rules = get_rules("AQHA")
    issues = rules.validate_show_schedule(
        show,
        classes,
        {
            "aqha_show_type_id": show.show_type_id,
            "aqha_association_id": aqha_association_id,
            "standard_classes_by_code": standard_by_code,
            "qualified_management_workshop_staff": await _qualified_aqha_management_workshop_staff(db, show),
        },
    )

    entries_result = await db.execute(
        select(Entry)
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id)
        .options(
            selectinload(Entry.class_).selectinload(Class.associations).selectinload(ClassAssociation.show_type),
            selectinload(Entry.horse).selectinload(Horse.registrations),
            selectinload(Entry.exhibitor).selectinload(Exhibitor.registrations),
        )
        .order_by(Class.sort_order.nullslast(), Class.class_number, Entry.back_number)
    )
    for entry in entries_result.scalars().all():
        class_ = entry.class_
        aqha_code = _class_association_code(class_, show.show_type_id)
        entry_issues = rules.validate_entry(
            entry,
            show,
            class_,
            {
                "aqha_show_type_id": show.show_type_id,
                "aqha_association_id": aqha_association_id,
                "aqha_class_code": aqha_code,
                "aqha_class": standard_by_code.get(aqha_code),
            },
        )
        for issue in entry_issues:
            issue.setdefault("entry_id", str(entry.id))
        issues.extend(entry_issues)

    return {
        "show_id": show_id,
        "association": "AQHA",
        "error_count": sum(1 for issue in issues if issue.get("severity") == "error"),
        "warning_count": sum(1 for issue in issues if issue.get("severity") == "warning"),
        "issues": issues,
    }


@router.get("/{show_id}/apha-validation", response_model=APHAValidationOut)
async def apha_validation(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """SC-090 approval readiness plus the per-entry APHA rules, in one read.

    The entry rules already run at both entry doors and block there, so the
    schedule half is most of what comes back. They are re-run anyway because an
    entry that passed can stop passing without anybody touching it: a horse
    flagged Solid Paint-Bred after it was entered, a division corrected at the
    desk, a fifth horse added under SC-185.F.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)

    result = await db.execute(
        select(Show)
        .options(
            selectinload(Show.show_type),
            selectinload(Show.venue_rel),
            # SC-090.B reads each assigned judge's carding. `Judge.associations`
            # is lazy="selectin" on the model, so loading the judge brings it.
            selectinload(Show.judges).selectinload(ShowJudge.judge),
        )
        .where(Show.id == show_id)
    )
    show = result.scalar_one_or_none()
    if not show:
        raise HTTPException(404, "Show not found")
    if not show.show_type or show.show_type.code != "APHA":
        raise HTTPException(400, "This show is not an APHA approved show")

    classes_result = await db.execute(
        select(Class)
        # SC-095.A reads the discipline the classifier assigned and the bracket,
        # because "Open halter, 2 and under" is not a column and has to be read
        # off both. The rules module is pure and never touches a session, so an
        # unloaded relationship here is a MissingGreenlet inside the check.
        .options(selectinload(Class.discipline), selectinload(Class.division))
        .where(Class.show_id == show_id)
        .order_by(Class.class_date, Class.sort_order.nullslast(), Class.class_number)
    )
    classes = classes_result.scalars().all()

    rules = get_rules("APHA")
    today = date.today()
    # Computed once and passed in, so the checklist on the payload and the
    # findings in the list cannot disagree about the same schedule.
    minimums = show_minimums(show, classes)
    issues = rules.validate_show_schedule(
        show, classes, {"as_of": today, "minimums": minimums}
    )

    # The same context both entry doors build. One pair of queries for the whole
    # show, rather than one per entry per rule.
    entry_context = await apha_entry_context(show_id, db)
    entries_result = await db.execute(
        select(Entry)
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id)
        .options(selectinload(Entry.class_), selectinload(Entry.horse))
        .order_by(Class.sort_order.nullslast(), Class.class_number)
    )
    for entry in entries_result.scalars().all():
        entry_issues = rules.validate_entry(entry, show, entry.class_, entry_context)
        for issue in entry_issues:
            issue.setdefault("entry_id", str(entry.id))
        issues.extend(entry_issues)

    # Withheld once the show has a number, for the reason `validate_show_schedule`
    # gives: APHA assigns it on approval, so the ladder no longer applies.
    window = None
    if not (show.apha_show_number or "").strip():
        window = application_window(show, today)

    return {
        "show_id": show_id,
        "association": "APHA",
        "error_count": sum(1 for issue in issues if issue.get("severity") == "error"),
        "warning_count": sum(1 for issue in issues if issue.get("severity") == "warning"),
        "issues": issues,
        "application_window": window,
        "minimums": minimums,
        "category_requirements": category_requirements(show),
    }


@router.get("/{show_id}/apha-export")
async def apha_export(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_with_type(db, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    if not show.show_type or show.show_type.code != "APHA":
        raise HTTPException(400, "This show is not an APHA sanctioned show")
    if not show.apha_show_number:
        raise HTTPException(400, "Set the APHA Show Number on the show before exporting")

    # Two different APHA ids, doing two different jobs. A class *code* is the
    # breed body's catalog identifier and keys on `show_types`; a registration or
    # membership *number* is an affiliation and keys on `associations` (migration
    # 080). Reading `show_type_id` off a registration row is what broke this
    # endpoint — the column has not existed since 080.
    apha_type_result = await db.execute(
        select(ShowType).where(ShowType.code == "APHA")
    )
    apha_show_type = apha_type_result.scalar_one_or_none()
    apha_association_id = await association_id_by_code(db, "APHA")

    # Fetch all entries for this show with related data
    entries_result = await db.execute(
        select(Entry)
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id)
        .options(
            selectinload(Entry.class_),
            selectinload(Entry.exhibitor).selectinload(Exhibitor.registrations),
            selectinload(Entry.horse).selectinload(Horse.registrations),
        )
        .order_by(Entry.exhibitor_id, Class.class_number)
    )
    entries = entries_result.scalars().all()

    # Look up the APHA class code per class via the class_associations table.
    apha_code_by_class: dict = {}
    if apha_show_type:
        for entry in entries:
            cls = entry.class_
            if cls.id in apha_code_by_class:
                continue
            code = ""
            for assoc in cls.associations:
                if assoc.show_type_id == apha_show_type.id:
                    code = assoc.association_class_code or ""
                    break
            apha_code_by_class[cls.id] = code

    # Build exhibitor → back number map from show_entries
    show_entries_result = await db.execute(
        select(ShowEntry).where(ShowEntry.show_id == show_id)
    )
    back_number_map: dict = {
        se.exhibitor_id: se.back_number for se in show_entries_result.scalars().all()
    }

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "SHOW NBR", "SHOW YR", "BACK#", "REG NUMBER",
        "HORSE'S NAME", "CLASS CODE", "CLASS DESCRIPTION",
        "EXHIBITOR ID", "EXHIBITOR'S NAME",
    ])

    show_yr = show.start_date.year if show.start_date else ""

    def apha_registration_number(horse) -> str:
        """The horse's APHA number, off the `associations`-keyed registry."""
        if horse is None or not apha_association_id:
            return ""
        for reg in horse.registrations:
            if reg.association_id == apha_association_id:
                return reg.registration_number or ""
        return ""

    def apha_member_number(exhibitor) -> str:
        """The exhibitor's APHA membership number.

        `exhibitor_registrations` is the registry every other affiliation reads
        from, so it wins. `exhibitors.apha_member_number` is the pre-080 column
        and is still the only place some records carry a number, so it stays as a
        fallback rather than silently exporting a blank.
        """
        if exhibitor is None:
            return ""
        if apha_association_id:
            for reg in exhibitor.registrations:
                if reg.association_id == apha_association_id:
                    return reg.member_number or ""
        return exhibitor.apha_member_number or ""

    for entry in entries:
        writer.writerow([
            show.apha_show_number,
            show_yr,
            back_number_map.get(entry.exhibitor_id, ""),
            apha_registration_number(entry.horse),
            entry.horse.name if entry.horse else "",
            apha_code_by_class.get(entry.class_.id, ""),
            entry.class_.class_name,
            apha_member_number(entry.exhibitor),
            entry.exhibitor.full_name,
        ])

    csv_content = output.getvalue()
    # Named for what it holds. This export carries entries, not placings — there
    # is no place, judge or score column in it — and a file called "results" that
    # contains none is how an office submits the wrong thing to APHA.
    filename = f"apha_entries_{show_id}.csv"

    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
