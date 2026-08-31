"""What the show office does at the desk, on someone else's records.

Three jobs, one file, because they are gated the same way — staff with access to
*this* show, acting only on people who are on *this* show's roster:

  * **Paperwork verification** (migrations 090, 098, 099). What a show
    secretary physically inspects at the counter: the horse's age and
    registration papers, the rider's membership cards, the health documents,
    and the signed entry blank. The office signs each off, and
    a sign-off snapshots the value it was held against, so a later edit makes
    the check read back as stale instead of staying quietly green.

    Health documents are signed off on the *situation* rather than on a stored
    row, because the paper is frequently not in the app — an exhibitor hands
    over a physical Coggins at the desk and there is nothing to point at.
    Requiring an upload would break the sign-off in the exact case it exists
    for.

  * **Health flags.** Which entered horses do not have health paperwork that
    covers the show. Derived from the documents on file, not signed off and not
    stored — see below.

  * **Filling in what the exhibitor has not.** Someone shows up at the desk
    with a horse that was never added to their profile, or with no emergency
    contact on file. Staff can write both for them, but only for an exhibitor
    already on this show's roster — this is a show-office convenience, not a
    general licence to write to strangers' profiles. Both write to the
    *profile*, not to a per-show copy: an emergency contact is who to telephone
    about that person, and a second copy per show would be a second, staler
    answer to the only question that matters.

**Nothing in this file gates entry, and neither does anything else.** Coggins
standing used to be a hard stop: a horse whose record was missing, undated, or
lapsed could not be entered at all, by the exhibitor or by the secretary. That
block never made a single horse compliant — it just moved the discovery to the
worst possible moment, and pushed staff through an override that recorded a
bypass instead of a to-do. Entry is now open and the shortfall surfaces here,
early, as something the office can chase while there is still time to fix it.

Health flags are computed on read rather than stored, which is what makes them
self-clearing: the exhibitor uploads a current Coggins and the flag is simply
gone the next time anyone looks. There is no row to remember to close.

The flag and the sign-off answer different questions and can disagree in both
directions. The file says whether the date is still good; only a person at the
counter says whether the paper is genuine, present, and describes *this* horse.
A current Coggins nobody has looked at and a lapsed one the office is holding
are different situations, and the desk has to be able to tell them apart.
"""
from __future__ import annotations

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.sql import func

from database import get_db
from dependencies import require_admin_or_show_admin, safe_uuid
from models import (
    Class,
    Entry,
    Exhibitor,
    ExhibitorHorse,
    ExhibitorRegistration,
    Futurity,
    FuturityEntry,
    Horse,
    HorseRegistration,
    Show,
    ShowEntry,
    ShowVerification,
    ShowWaiver,
    ShowWaiverSignature,
    User,
)
from routers.horse_documents import (
    HEALTH_VALID,
    document_health,
    health_by_horse,
    health_snapshot,
    load_health_documents,
    paperwork_deadline,
    requirement_for,
)
from routers.people import (
    assert_registrations_available,
    build_horse_with_registrations,
    load_my_horse,
)
from routers.shows import _assert_show_access
from schemas import (
    EmergencyContactOut,
    ExhibitorEmergencyContactUpdate,
    MyHorseOut,
    ShowHealthFlagsOut,
    ShowVerificationCreate,
    ShowVerificationOut,
    StaffHorseCreate,
    VerificationChecklistOut,
)

router = APIRouter(prefix="/shows/{show_id}", tags=["Show Office"])

# Which subject columns each kind uses. Mirrors ck_show_verifications_subject.
_ASSOCIATION_KINDS = {"horse_registration", "exhibitor_membership"}


# ── Roster ─────────────────────────────────────────────────────────────────────


class _Roster:
    """Everyone this show's office has paperwork to check, and whose horses.

    Exhibitors come from `show_entries` (sign-up, or the shell row a secretary
    creates when adding a late entry by hand) *and* from class entries — those
    are usually the same set, but neither alone is complete.
    """

    def __init__(self) -> None:
        self.exhibitors: dict[UUID, Exhibitor] = {}
        self.back_numbers: dict[UUID, Optional[int]] = {}
        self.signed_up: dict[UUID, bool] = {}
        # Horses each exhibitor has entered, keyed so a horse entered in several
        # classes is only listed once.
        self.horses: dict[UUID, dict[UUID, Horse]] = {}
        # How many classes each horse is in, across every exhibitor riding it.
        # Sizes the problem when the office is deciding who to call first.
        self.entry_counts: dict[UUID, int] = {}

    def horse_ids(self) -> list[UUID]:
        """Every distinct horse entered in this show."""
        return list({hid for by_horse in self.horses.values() for hid in by_horse})


async def _load_roster(show_id: UUID, db: AsyncSession) -> _Roster:
    roster = _Roster()

    show_entry_result = await db.execute(
        select(ShowEntry)
        .options(
            selectinload(ShowEntry.exhibitor)
            .selectinload(Exhibitor.registrations)
            .selectinload(ExhibitorRegistration.association)
        )
        .where(ShowEntry.show_id == show_id)
    )
    for show_entry in show_entry_result.scalars().all():
        if show_entry.exhibitor is None:
            continue
        roster.exhibitors[show_entry.exhibitor_id] = show_entry.exhibitor
        roster.back_numbers[show_entry.exhibitor_id] = show_entry.back_number
        roster.signed_up[show_entry.exhibitor_id] = show_entry.registered_at is not None

    entry_result = await db.execute(
        select(Entry)
        .options(
            selectinload(Entry.exhibitor)
            .selectinload(Exhibitor.registrations)
            .selectinload(ExhibitorRegistration.association),
            selectinload(Entry.horse)
            .selectinload(Horse.registrations)
            .selectinload(HorseRegistration.association),
        )
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id)
    )
    for entry in entry_result.scalars().all():
        if entry.exhibitor is None:
            continue
        roster.exhibitors.setdefault(entry.exhibitor_id, entry.exhibitor)
        roster.back_numbers.setdefault(entry.exhibitor_id, entry.back_number)
        roster.signed_up.setdefault(entry.exhibitor_id, False)
        # Deleting a horse nulls entries.horse_id to preserve history, so an
        # entry without a horse is expected and simply has no papers to check.
        if entry.horse is not None:
            roster.horses.setdefault(entry.exhibitor_id, {})[entry.horse_id] = entry.horse
            roster.entry_counts[entry.horse_id] = roster.entry_counts.get(entry.horse_id, 0) + 1

    return roster


# ── Health paperwork ───────────────────────────────────────────────────────────


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


# ── Checklist ──────────────────────────────────────────────────────────────────


def _verification_key(
    kind: str,
    horse_id: Optional[UUID] = None,
    exhibitor_id: Optional[UUID] = None,
    association_id: Optional[UUID] = None,
    document_type: Optional[str] = None,
) -> tuple:
    """Everything that identifies one sign-off. Every subject column appears,
    including the ones a given kind leaves NULL — two kinds that agreed on the
    columns they use would otherwise collide in the lookup."""
    return (kind, horse_id, exhibitor_id, association_id, document_type)


def _inspection_status(snapshot: str, verification: Optional[ShowVerification]) -> str:
    """Whether the office's sign-off still describes what is on file."""
    if verification is None:
        return "unverified"
    return "verified" if verification.verified_value == snapshot else "stale"


def _build_inspection(snapshot: str, verification: Optional[ShowVerification]) -> dict:
    return {
        "status": _inspection_status(snapshot, verification),
        "verification_id": verification.id if verification else None,
        "verified_by_name": verification.verified_by_name if verification else None,
        "verified_at": verification.created_at if verification else None,
        # What staff read off the paper, when they recorded it. The health
        # status above may already be `valid` *because* of this — see
        # `attested_health` in routers/horse_documents.py.
        "attested_expiry": verification.attested_expiry if verification else None,
        "note": verification.note if verification else None,
    }


async def _futurity_enrollment_by_exhibitor(
    show_id: UUID, db: AsyncSession
) -> dict[UUID, set[UUID]]:
    """Which futurities each exhibitor at this show is enrolled in.

    One query for the whole show: the checklist walks every exhibitor, and
    asking per person would be the N+1 this module is otherwise careful about.
    """
    rows = await db.execute(
        select(ShowEntry.exhibitor_id, FuturityEntry.futurity_id)
        .join(FuturityEntry, FuturityEntry.show_entry_id == ShowEntry.id)
        .join(Futurity, Futurity.id == FuturityEntry.futurity_id)
        .where(Futurity.show_id == show_id)
        .distinct()
    )
    out: dict[UUID, set[UUID]] = {}
    for exhibitor_id, futurity_id in rows:
        out.setdefault(exhibitor_id, set()).add(futurity_id)
    return out


def _build_waiver_check(waiver: ShowWaiver, signature: Optional[ShowWaiverSignature]) -> dict:
    """A signature is either there or it is not — there is no value to hold it
    against, so nothing here can go stale the way a number can."""
    return {
        "waiver_id": waiver.id,
        "title": waiver.title,
        "is_required": waiver.is_required,
        "status": "signed" if signature else "unsigned",
        "signed_name": signature.signed_name if signature else None,
        "signed_at": signature.signed_at if signature else None,
        "on_paper": bool(signature.on_paper) if signature else False,
        "signed_by_guardian": bool(signature.signed_by_guardian) if signature else False,
        "guardian_relationship": signature.guardian_relationship if signature else None,
        "recorded_by_name": signature.recorded_by_name if signature else None,
    }


def _build_emergency_contact(exhibitor: Exhibitor) -> dict:
    """Read off the profile, never copied per show: a second copy would be a
    second, staler answer to the only question that matters here."""
    name = (exhibitor.emergency_contact_name or "").strip() or None
    phone = (exhibitor.emergency_contact_phone or "").strip() or None
    return {
        "status": "on_file" if (name and phone) else "missing",
        "name": name,
        "phone": phone,
    }


def _build_check(
    kind: str,
    current_value: Optional[str],
    verification: Optional[ShowVerification],
    association=None,
    expires_at=None,
    as_of=None,
) -> dict:
    """One line on the check-in sheet.

    `not_on_file` wins over everything: with nothing on the profile there is no
    value to hold the paper against, even if the office signed something off
    before the exhibitor cleared the field.

    `expires_at` is reported beside `status`, never folded into it. They answer
    different questions — `status` is about the *inspection* ("has anybody here
    looked at this?") and `lapsed` is about the *document* ("is it still good?")
    — and a current card nobody has checked is a different situation from a
    lapsed one the office is holding. This is the same split health paperwork
    already makes between a derived standing and an attested one.

    Judged against `as_of`, which callers pass as the show's end date. Never
    today: a membership that lapses on the Saturday of a three-day show is
    precisely what the desk needs to chase, and comparing against today calls it
    current right up until it is too late.
    """
    if current_value is None:
        status = "not_on_file"
    elif verification is None:
        status = "unverified"
    elif verification.verified_value != current_value:
        status = "stale"
    else:
        status = "verified"

    return {
        "kind": kind,
        "status": status,
        "current_value": current_value,
        "expires_at": expires_at,
        # None rather than False when there is no date: "we do not know" and
        # "it is current" must not render the same way.
        "lapsed": None if (expires_at is None or as_of is None) else expires_at < as_of,
        "association_id": association.id if association else None,
        "association_code": association.code if association else None,
        "association_name": association.name if association else None,
        "verification_id": verification.id if verification else None,
        "verified_value": verification.verified_value if verification else None,
        "verified_by_name": verification.verified_by_name if verification else None,
        "verified_at": verification.created_at if verification else None,
        "note": verification.note if verification else None,
    }


async def build_verification_checklist(show_id: UUID, db: AsyncSession) -> dict:
    """The paperwork sweep for this show, by exhibitor.

    Split out from the route so the desk screen can fold the same checks into
    its per-exhibitor panel without a second implementation of what "verified",
    "stale", and "nothing on file" mean. Access is the caller's to assert.
    """
    show = await _get_show_or_404(show_id, db)
    roster = await _load_roster(show_id, db)
    health = await health_by_horse(roster.horse_ids(), show, db)

    verification_result = await db.execute(
        select(ShowVerification).where(ShowVerification.show_id == show_id)
    )
    by_key: dict[tuple, ShowVerification] = {
        _verification_key(
            v.kind, v.horse_id, v.exhibitor_id, v.association_id, v.document_type
        ): v
        for v in verification_result.scalars().all()
    }

    waiver_result = await db.execute(
        select(ShowWaiver).where(ShowWaiver.show_id == show_id).order_by(ShowWaiver.sort_order)
    )
    waivers = list(waiver_result.scalars().all())
    # A futurity release is asked of that futurity's entrants and nobody else
    # (migration 109). Without this the desk would show every exhibitor an
    # unsigned release for a programme they never entered, and the show's
    # outstanding count would never reach zero.
    enrolled_futurities = (
        await _futurity_enrollment_by_exhibitor(show_id, db)
        if any(w.futurity_id is not None for w in waivers)
        else {}
    )
    signature_result = await db.execute(
        select(ShowWaiverSignature).join(
            ShowWaiver, ShowWaiverSignature.waiver_id == ShowWaiver.id
        ).where(ShowWaiver.show_id == show_id)
    )
    signatures: dict[tuple, ShowWaiverSignature] = {
        (sig.waiver_id, sig.exhibitor_id): sig for sig in signature_result.scalars().all()
    }

    # A horse entered by two exhibitors is listed under both, but its checks are
    # one and the same — totals count distinct checks so the sweep is not
    # reported as bigger than it is.
    distinct_status: dict[tuple, str] = {}

    def record(key: tuple, check: dict) -> dict:
        distinct_status[key] = check["status"]
        return check

    exhibitors_out = []
    for exhibitor_id, exhibitor in roster.exhibitors.items():
        memberships = []
        for reg in sorted(
            exhibitor.registrations or [],
            key=lambda r: (r.association.code if r.association else ""),
        ):
            key = _verification_key(
                "exhibitor_membership",
                exhibitor_id=exhibitor_id,
                association_id=reg.association_id,
            )
            memberships.append(record(key, _build_check(
                "exhibitor_membership", reg.member_number, by_key.get(key), reg.association,
                expires_at=reg.expires_at,
                as_of=show.end_date,
            )))

        horses_out = []
        for horse in sorted(
            roster.horses.get(exhibitor_id, {}).values(), key=lambda h: h.name or ""
        ):
            age_key = _verification_key("horse_age", horse.id)
            age_check = record(age_key, _build_check(
                "horse_age",
                horse.foaling_date.isoformat() if horse.foaling_date else None,
                by_key.get(age_key),
            ))

            horse_regs = []
            for reg in sorted(
                horse.registrations or [],
                key=lambda r: (r.association.code if r.association else ""),
            ):
                key = _verification_key(
                    "horse_registration", horse.id, association_id=reg.association_id
                )
                horse_regs.append(record(key, _build_check(
                    "horse_registration", reg.registration_number, by_key.get(key), reg.association,
                )))

            # Each health line carries both facts: what the documents on file
            # say, and whether anyone has looked at the paper. They are computed
            # apart because they can disagree in both directions.
            health_out = []
            for check in health.get(horse.id, []):
                key = _verification_key(
                    "horse_health_document", horse.id, document_type=check["code"]
                )
                verification = by_key.get(key)
                inspection = _build_inspection(health_snapshot(check), verification)
                distinct_status[key] = inspection["status"]
                health_out.append({**check, "inspection": inspection})

            horses_out.append({
                "horse_id": horse.id,
                "horse_name": horse.name,
                "barn_name": horse.barn_name,
                "age_check": age_check,
                "registrations": horse_regs,
                "health": health_out,
            })

        waiver_checks = [
            _build_waiver_check(w, signatures.get((w.id, exhibitor_id)))
            for w in waivers
            if w.futurity_id is None
            or w.futurity_id in enrolled_futurities.get(exhibitor_id, set())
        ]
        emergency_contact = _build_emergency_contact(exhibitor)

        # Outstanding is what is left at *this person's* desk visit, so a shared
        # horse counts for each exhibitor who has to present it.
        all_checks = memberships + [h["age_check"] for h in horses_out]
        for h in horses_out:
            all_checks.extend(h["registrations"])

        outstanding = sum(1 for c in all_checks if c["status"] != "verified")
        # The health *status* is not counted — a lapsed Coggins is the
        # exhibitor's job, not a sign-off the desk owes. The inspection is.
        outstanding += sum(
            1 for h in horses_out for c in h["health"] if c["inspection"]["status"] != "verified"
        )
        outstanding += sum(1 for w in waiver_checks if w["is_required"] and w["status"] != "signed")
        if emergency_contact["status"] == "missing":
            outstanding += 1

        exhibitors_out.append({
            "exhibitor_id": exhibitor_id,
            "exhibitor_name": exhibitor.full_name,
            "back_number": roster.back_numbers.get(exhibitor_id),
            "signed_up": roster.signed_up.get(exhibitor_id, False),
            "memberships": memberships,
            "horses": horses_out,
            "waivers": waiver_checks,
            "emergency_contact": emergency_contact,
            "outstanding": outstanding,
        })

    exhibitors_out.sort(key=lambda e: (e["exhibitor_name"] or "").lower())

    totals = {
        "checks": len(distinct_status),
        "verified": 0,
        "stale": 0,
        "unverified": 0,
        "not_on_file": 0,
        # Counted apart from the sign-offs: chasing a signature is a different
        # job with a different fix than chasing a document.
        "waivers_outstanding": sum(
            1 for e in exhibitors_out for w in e["waivers"]
            if w["is_required"] and w["status"] != "signed"
        ),
        "contacts_missing": sum(
            1 for e in exhibitors_out if e["emergency_contact"]["status"] == "missing"
        ),
    }
    for status in distinct_status.values():
        totals[status] += 1

    return {"show_id": show_id, "exhibitors": exhibitors_out, "totals": totals}


@router.get(
    "/verifications/checklist",
    response_model=VerificationChecklistOut,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def get_verification_checklist(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The paperwork sweep for this show, by exhibitor."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    return await build_verification_checklist(show_id, db)


@router.get(
    "/health-flags",
    response_model=ShowHealthFlagsOut,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def get_health_flags(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Entered horses whose health paperwork will not carry them through the show.

    The office's chase list. Entry does not wait on any of this, so this is how
    staff find out early enough to do something — a phone call, or a Coggins
    pulled on the way. Horses that are fine are left out entirely: the useful
    length of this list is the number of problems, not the number of horses.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)
    roster = await _load_roster(show_id, db)

    horse_ids = roster.horse_ids()
    health = await health_by_horse(horse_ids, show, db)

    # Who to call about each horse. A horse ridden by two exhibitors is one flag
    # carrying both names rather than two flags about one piece of paper.
    riders: dict[UUID, list[dict]] = {}
    horses_by_id: dict[UUID, Horse] = {}
    for exhibitor_id, by_horse in roster.horses.items():
        for horse_id, horse in by_horse.items():
            horses_by_id[horse_id] = horse
            exhibitor = roster.exhibitors.get(exhibitor_id)
            riders.setdefault(horse_id, []).append({
                "exhibitor_id": exhibitor_id,
                "exhibitor_name": exhibitor.full_name if exhibitor else "(unknown)",
                "back_number": roster.back_numbers.get(exhibitor_id),
            })

    totals = {
        "horses": len(horse_ids),
        "flagged": 0,
        "missing": 0,
        "undated": 0,
        "expired": 0,
    }
    flagged = []
    for horse_id in horse_ids:
        for check in health.get(horse_id, []):
            if check["status"] == HEALTH_VALID:
                continue
            totals["flagged"] += 1
            totals[check["status"]] += 1
            horse = horses_by_id[horse_id]
            flagged.append({
                "horse_id": horse_id,
                "horse_name": horse.name,
                "barn_name": horse.barn_name,
                "check": check,
                "entry_count": roster.entry_counts.get(horse_id, 0),
                "exhibitors": sorted(
                    riders.get(horse_id, []),
                    key=lambda r: (r["exhibitor_name"] or "").lower(),
                ),
            })

    # Nothing on file first, then no date, then lapsed — roughly the order of how
    # much work each one is for the exhibitor to put right.
    severity = {"missing": 0, "undated": 1, "expired": 2}
    flagged.sort(key=lambda f: (severity.get(f["check"]["status"], 9), (f["horse_name"] or "").lower()))

    return {
        "show_id": show_id,
        "as_of": paperwork_deadline(show),
        "flagged": flagged,
        "totals": totals,
    }


# ── Signing off ────────────────────────────────────────────────────────────────


async def _assert_horse_is_entered(show_id: UUID, horse_id: UUID, db: AsyncSession) -> Horse:
    horse = await db.get(Horse, horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    entered = await db.execute(
        select(Entry.id)
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id, Entry.horse_id == horse_id)
        .limit(1)
    )
    if not entered.scalar_one_or_none():
        raise HTTPException(403, "That horse is not entered in this show")
    return horse


async def _assert_exhibitor_on_roster(
    show_id: UUID, exhibitor_id: UUID, db: AsyncSession
) -> Exhibitor:
    """On the roster means signed up *or* entered by staff — either way the
    person is competing at this show and the office deals with their paperwork."""
    exhibitor = await db.get(Exhibitor, exhibitor_id)
    if not exhibitor:
        raise HTTPException(404, "Exhibitor not found")

    show_entry = await db.execute(
        select(ShowEntry.id)
        .where(ShowEntry.show_id == show_id, ShowEntry.exhibitor_id == exhibitor_id)
        .limit(1)
    )
    if show_entry.scalar_one_or_none():
        return exhibitor

    entry = await db.execute(
        select(Entry.id)
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id, Entry.exhibitor_id == exhibitor_id)
        .limit(1)
    )
    if entry.scalar_one_or_none():
        return exhibitor

    raise HTTPException(403, "That exhibitor is not registered for this show")


def _assert_subject_shape(body: ShowVerificationCreate) -> None:
    """Reject subject columns that do not belong to the kind being signed off.

    Mirrors ck_show_verifications_subject. The database would refuse the row
    anyway, but a 422 naming the field beats a 500 naming a constraint.
    """
    if body.kind in _ASSOCIATION_KINDS and body.association_id is None:
        raise HTTPException(422, "association_id is required for this verification")
    if body.kind not in _ASSOCIATION_KINDS and body.association_id is not None:
        raise HTTPException(422, "association_id does not apply to this verification")

    if body.kind == "horse_health_document" and body.document_type is None:
        raise HTTPException(422, "document_type is required for this verification")
    if body.kind != "horse_health_document" and body.document_type is not None:
        raise HTTPException(422, "document_type does not apply to this verification")
    # Mirrors ck_show_verifications_attested_expiry. Only a health document has
    # an expiry to read off it.
    if body.kind != "horse_health_document" and body.attested_expiry is not None:
        raise HTTPException(422, "attested_expiry does not apply to this verification")


async def _current_value_for(
    show: Show, body: ShowVerificationCreate, db: AsyncSession
) -> str:
    """Read what is on file for the subject being signed off.

    Derived here rather than taken from the request: a caller able to name the
    value it "verified" could attest to a number nobody has on file.
    """
    _assert_subject_shape(body)
    show_id = show.id

    if body.kind in {"horse_age", "horse_registration", "horse_health_document"}:
        if body.horse_id is None:
            raise HTTPException(422, "horse_id is required for this verification")
        if body.exhibitor_id is not None:
            raise HTTPException(422, "exhibitor_id does not apply to this verification")
        horse = await _assert_horse_is_entered(show_id, body.horse_id, db)

        if body.kind == "horse_age":
            if horse.foaling_date is None:
                raise HTTPException(
                    422,
                    "No foaling date on file for this horse. Record the date from the "
                    "registration papers first, then verify it.",
                )
            return horse.foaling_date.isoformat()

        if body.kind == "horse_health_document":
            # Signed off against the standing, not against an uploaded row: the
            # office is frequently holding a paper the app has never been shown,
            # and refusing to record that would break the sign-off in the one
            # case it exists for. "missing:none" is a perfectly good thing to
            # have attested to — and it goes stale the moment a document
            # arrives, which is correct.
            requirement = requirement_for(show, body.document_type)
            documents = await load_health_documents([horse.id], [body.document_type], db)
            check = document_health(
                requirement,
                documents.get(horse.id, {}).get(body.document_type, []),
                paperwork_deadline(show),
            )
            return health_snapshot(check)

        result = await db.execute(
            select(HorseRegistration).where(
                HorseRegistration.horse_id == body.horse_id,
                HorseRegistration.association_id == body.association_id,
            )
        )
        registration = result.scalar_one_or_none()
        if registration is None:
            raise HTTPException(422, "No registration number on file for that association")
        return registration.registration_number

    # exhibitor_membership
    if body.exhibitor_id is None:
        raise HTTPException(422, "exhibitor_id is required for this verification")
    if body.horse_id is not None:
        raise HTTPException(422, "horse_id does not apply to this verification")
    await _assert_exhibitor_on_roster(show_id, body.exhibitor_id, db)

    result = await db.execute(
        select(ExhibitorRegistration).where(
            ExhibitorRegistration.exhibitor_id == body.exhibitor_id,
            ExhibitorRegistration.association_id == body.association_id,
        )
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(422, "No membership number on file for that association")
    return membership.member_number


@router.post(
    "/verifications",
    response_model=ShowVerificationOut,
    status_code=201,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def record_verification(
    show_id: UUID,
    body: ShowVerificationCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Sign off that this show's office physically inspected the document.

    Re-signing an existing check replaces it rather than stacking a second row —
    that is how a stale check is cleared once staff have seen the new paper.

    For a health document the caller may also send `attested_expiry`: the date
    printed on the paper in the secretary's hand. Given, and covering the show,
    it clears the horse's health flag — an office that has just inspected a
    valid Coggins should not still be told to go and find one. Omitted, the
    inspection is still recorded and the horse stays flagged, which is the right
    outcome for a document that was illegible or genuinely lapsed.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)
    current_value = await _current_value_for(show, body, db)

    actor = await db.get(User, safe_uuid(x_user_id))
    # The unused subject columns are NULL for this kind, and `== None` is what
    # SQLAlchemy renders as IS NULL — matching on them is what makes this find
    # the row the partial unique index would collide with.
    existing_result = await db.execute(
        select(ShowVerification).where(
            ShowVerification.show_id == show_id,
            ShowVerification.kind == body.kind,
            ShowVerification.horse_id == body.horse_id,
            ShowVerification.exhibitor_id == body.exhibitor_id,
            ShowVerification.association_id == body.association_id,
            ShowVerification.document_type == body.document_type,
        )
    )
    verification = existing_result.scalar_one_or_none()

    if verification is None:
        verification = ShowVerification(
            show_id=show_id,
            kind=body.kind,
            horse_id=body.horse_id,
            exhibitor_id=body.exhibitor_id,
            association_id=body.association_id,
            document_type=body.document_type,
        )
        db.add(verification)

    # Taken from the request, unlike `verified_value` beside it. There is
    # nothing to derive it from: the document is frequently paper the app has
    # never been shown, which is the whole reason this sign-off exists.
    verification.attested_expiry = body.attested_expiry
    verification.verified_value = current_value
    verification.note = body.note
    verification.verified_by = actor.id if actor else None
    verification.verified_by_name = actor.full_name if actor else None
    verification.created_at = func.now()

    try:
        await db.commit()
    except IntegrityError:
        # The partial unique indexes are the backstop for two staff members
        # signing off the same check at once; the other one's row stands.
        await db.rollback()
        raise HTTPException(409, "That check was just signed off by someone else. Reload to see it.")
    await db.refresh(verification)
    return verification


@router.delete(
    "/verifications/{verification_id}",
    status_code=204,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def delete_verification(
    show_id: UUID,
    verification_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Undo a sign-off recorded against the wrong row."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    verification = await db.get(ShowVerification, verification_id)
    if not verification or verification.show_id != show_id:
        raise HTTPException(404, "Verification not found")
    await db.delete(verification)
    await db.commit()


# ── Emergency contact ──────────────────────────────────────────────────────────


@router.patch(
    "/exhibitors/{exhibitor_id}/emergency-contact",
    response_model=EmergencyContactOut,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def set_emergency_contact(
    show_id: UUID,
    exhibitor_id: UUID,
    body: ExhibitorEmergencyContactUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Take an emergency contact over the counter and put it on the profile.

    The desk checks that the show has somebody to telephone, and until now could
    only report that it did not — leaving staff to ask the exhibitor to go and
    edit their own account, at a counter, with a queue behind them. `PATCH
    /exhibitors/{id}` is ADMIN-or-self, so a secretary could not do it for them.

    Written to the exhibitor's profile rather than to a per-show copy, on
    purpose. Who to call if something happens to this person is not a fact about
    one weekend, and a per-show duplicate would be a second answer that goes
    stale the moment they change their phone number.

    Scoped to this show's roster, the same rule as staff creating a horse: the
    reach exists because the person is standing in front of them at *their*
    show, not because of staff rank.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    exhibitor = await _assert_exhibitor_on_roster(show_id, exhibitor_id, db)

    name = (body.name or "").strip() or None
    phone = (body.phone or "").strip() or None
    if bool(name) != bool(phone):
        raise HTTPException(
            422,
            "An emergency contact needs both a name and a phone number — "
            "one without the other still reads as missing.",
        )

    exhibitor.emergency_contact_name = name
    exhibitor.emergency_contact_phone = phone
    await db.commit()
    await db.refresh(exhibitor)
    return _build_emergency_contact(exhibitor)


# ── Creating a horse for an exhibitor ──────────────────────────────────────────


@router.post(
    "/exhibitors/{exhibitor_id}/horses",
    response_model=MyHorseOut,
    status_code=201,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def create_horse_for_show_exhibitor(
    show_id: UUID,
    exhibitor_id: UUID,
    body: StaffHorseCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Create a horse on an exhibitor's profile, on their behalf, at the desk.

    Limited to exhibitors on this show's roster: show staff get this reach
    because the person is standing in front of them at *their* show, not because
    staff may edit any profile in the system.

    The exhibitor owns the horse and it is linked to their profile, so it turns
    up in their own horse list and in the Add Entry picker straight away.
    `created_by_exhibitor_id` stays NULL — they did not add it — and
    `created_by_user_id` records the staff member who did.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _assert_exhibitor_on_roster(show_id, exhibitor_id, db)

    await assert_registrations_available(body.registrations, db)
    horse = await build_horse_with_registrations(
        body,
        owner_exhibitor_id=exhibitor_id,
        created_by_exhibitor_id=None,
        created_by_user_id=safe_uuid(x_user_id),
        db=db,
    )
    # Ownership alone does not put a horse on the profile's horse list — that
    # reads created_by_exhibitor_id or an exhibitor_horses link.
    db.add(ExhibitorHorse(exhibitor_id=exhibitor_id, horse_id=horse.id))

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            409,
            "One of the registrations conflicts with an existing record. Please verify and try again.",
        )

    return await load_my_horse(horse.id, exhibitor_id, db)
