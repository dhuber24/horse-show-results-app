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

from backnumbers import ShowBackNumbers, back_numbers_for_show
from cancellations import is_on_roster
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
    requires_physical_check,
)
from routers.people import (
    assert_registrations_available,
    build_horse_with_registrations,
    load_my_horse,
)
from routers.shows import _assert_show_access
from schemas import (
    EmergencyContactOut,
    ExhibitorContactOut,
    ExhibitorContactUpdate,
    ExhibitorEmergencyContactUpdate,
    MyHorseOut,
    ShowHealthFlagsOut,
    ShowVerificationCreate,
    ShowVerificationOut,
    StaffHorseCreate,
    VerificationChecklistOut,
)
from registration_profile import (
    ShowExhibitorView,
    add_horse,
    get_or_create_copy,
    load_copies_for_show,
    load_copy,
    membership_for,
    take_details,
)
from show_associations import asked_of, show_associations

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
        # The show's back numbers, of whichever kind it issues (migration 161).
        self.numbers = ShowBackNumbers()
        self.signed_up: dict[UUID, bool] = {}
        # Horses each exhibitor has entered, keyed so a horse entered in several
        # classes is only listed once.
        self.horses: dict[UUID, dict[UUID, Horse]] = {}
        # How many classes each horse is in, across every exhibitor riding it.
        # Sizes the problem when the office is deciding who to call first.
        self.entry_counts: dict[UUID, int] = {}
        # Each exhibitor's copy of their profile at this show, where they have
        # changed something on their registration (migration 145). What the
        # desk reads their details and memberships through -- see `view`.
        self.copies: dict = {}

    def view(self, exhibitor_id: UUID) -> ShowExhibitorView:
        """The exhibitor as this show holds them: their registration's own
        details and memberships where they changed any, the profile otherwise."""
        return ShowExhibitorView(
            self.exhibitors[exhibitor_id], self.copies.get(exhibitor_id)
        )

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
            .selectinload(ExhibitorRegistration.association),
            # For the contact block: where the row is linked to an account,
            # that account's address is the authority. An unloaded relationship
            # here is lazy IO in an async request, so it is asked for by name.
            selectinload(ShowEntry.exhibitor).selectinload(Exhibitor.user),
        )
        .where(ShowEntry.show_id == show_id)
    )
    for show_entry in show_entry_result.scalars().all():
        if show_entry.exhibitor is None:
            continue
        roster.exhibitors[show_entry.exhibitor_id] = show_entry.exhibitor
        roster.signed_up[show_entry.exhibitor_id] = is_on_roster(show_entry)

    entry_result = await db.execute(
        select(Entry)
        .options(
            selectinload(Entry.exhibitor)
            .selectinload(Exhibitor.registrations)
            .selectinload(ExhibitorRegistration.association),
            selectinload(Entry.exhibitor).selectinload(Exhibitor.user),
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
        roster.signed_up.setdefault(entry.exhibitor_id, False)
        # Deleting a horse nulls entries.horse_id to preserve history, so an
        # entry without a horse is expected and simply has no papers to check.
        if entry.horse is not None:
            roster.horses.setdefault(entry.exhibitor_id, {})[entry.horse_id] = entry.horse
            roster.entry_counts[entry.horse_id] = roster.entry_counts.get(entry.horse_id, 0) + 1

    roster.copies = await load_copies_for_show(show_id, db, roster.exhibitors.keys())
    roster.numbers = await back_numbers_for_show(show_id, db)
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
        # What staff read off the paper, when they recorded one. The health
        # status above may already be `valid` *because* of this inspection —
        # see `attested_health` in routers/horse_documents.py.
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
        "futurity_id": waiver.futurity_id,
        "status": "signed" if signature else "unsigned",
        "signed_name": signature.signed_name if signature else None,
        "signed_at": signature.signed_at if signature else None,
        "on_paper": bool(signature.on_paper) if signature else False,
        "signed_by_guardian": bool(signature.signed_by_guardian) if signature else False,
        "guardian_relationship": signature.guardian_relationship if signature else None,
        "recorded_by_name": signature.recorded_by_name if signature else None,
    }


def _build_emergency_contact(exhibitor) -> dict:
    """Read off what the exhibitor gave this show -- a `ShowExhibitorView`, so
    the registration's own answer where they changed it there and the profile's
    otherwise (migration 145)."""
    name = (exhibitor.emergency_contact_name or "").strip() or None
    phone = (exhibitor.emergency_contact_phone or "").strip() or None
    return {
        "status": "on_file" if (name and phone) else "missing",
        "name": name,
        "phone": phone,
    }


def _build_contact(exhibitor) -> dict:
    """How the office reaches this person away from the counter.

    Read off a `ShowExhibitorView`, like the emergency contact beside it: the
    telephone and address the exhibitor gave this show's registration where they
    changed them there, the profile's otherwise (migration 145). The email is
    the account's or the office's, which no registration edits. Nothing here is
    a check and none of it counts toward
    `outstanding`: an exhibitor with no email on file is not paperwork anybody
    owes, they are simply somebody the office has to telephone instead.

    **The account's address wins where there is an account.** `exhibitors.email`
    (migration 140) is what somebody wrote on a paper entry blank, which is the
    only address there is for an office record with no login; once that record
    is linked to an account, the address they actually sign in with is the one
    that reaches them. Same precedence as the exhibitor registry. Where the two
    differ the office one is reported as well rather than dropped, because a
    mismatch is usually either the better address or a typo worth seeing, and
    silently preferring one of them hides both cases.
    """
    account_email = (exhibitor.user.email or "").strip() or None if exhibitor.user else None
    office_email = (exhibitor.email or "").strip() or None
    # Only a *second* address is worth printing. The same one written down twice
    # is not two facts.
    differs = bool(
        account_email and office_email and account_email.lower() != office_email.lower()
    )

    contact = {
        "email": account_email or office_email,
        "email_source": "account" if account_email else ("office" if office_email else None),
        "office_email": office_email if differs else None,
        "phone": (exhibitor.phone or "").strip() or None,
        "address": (exhibitor.address or "").strip() or None,
        "city": (exhibitor.city or "").strip() or None,
        "state": (exhibitor.state or "").strip() or None,
        "zip": (exhibitor.zip or "").strip() or None,
        # A youth exhibitor is reached through their guardian, so the number is
        # contact detail rather than the emergency contact it sits near — the
        # person you ring first, not the person you ring if something happens.
        "guardian_name": (exhibitor.parent_guardian_name or "").strip() or None,
        "guardian_phone": (exhibitor.parent_guardian_phone or "").strip() or None,
    }
    # One definition of "there is nothing here", so the screen's empty state and
    # any future count cannot disagree about it.
    contact["has_any"] = any(
        contact[key] for key in ("email", "phone", "address", "city", "guardian_phone")
    )
    return contact


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


def desk_inspections(show) -> dict:
    """Which of the card and papers sign-offs this show's office does (migration 160).

    True for a show row that predates the columns, which is exactly what every
    one of them already did. The health originals are the fourth desk
    inspection and are asked separately (`requires_physical_check`), because
    switching that one off keeps its rows.
    """
    return {
        "membership_cards": bool(getattr(show, "requires_membership_card_check", True)),
        "horse_age": bool(getattr(show, "requires_horse_age_check", True)),
        "registration_papers": bool(getattr(show, "requires_registration_papers_check", True)),
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

    # Does this show want the paper produced at the counter (migration 138)?
    # The health rows are built either way -- the office may still record a
    # document it was handed at a show that did not ask for one -- but a show
    # that accepts the upload as sufficient owes no sign-off, so the inspection
    # is neither counted as outstanding nor added to the sweep totals. The same
    # reasoning as `asked_association_ids` below: a check nobody working that
    # show can meaningfully clear is one they learn to scroll past, and it
    # spends the credibility of the checks that matter.
    physical_check = requires_physical_check(show)

    # Which of the other sign-offs this show's office does at all (migration
    # 160). Plenty of shows never look at registration papers, and a red row per
    # horse per association that nobody there will clear teaches staff to scroll
    # past the panel. Unlike the health rows above these are not built when off:
    # a health inspection clears the horse's flag whether or not the show asked
    # for one, but a sign-off on a card or a foaling date only records, so a row
    # nobody is asked to do is clutter. Sign-offs already recorded stay in
    # `show_verifications` and reappear if the check is turned back on.
    inspections = desk_inspections(show)

    # Which memberships and which registration papers this show may ask for.
    # An exhibitor's profile carries every card they hold and a horse carries
    # every body it is papered with; only the ones this show runs under are the
    # office's business. Before this the desk listed all of them, so an Open
    # show with no club sanctioning asked staff to inspect APHA, WSCA and
    # MNSPHC cards and counted each one as outstanding -- a check nobody at
    # that show could ever clear, sitting beside the ones that matter. The same
    # list the registration screen prompts from and the horse picker flags
    # against, so the exhibitor's card and the horse's papers cannot drift.
    # Empty at an Open show with no clubs, which drops both sections entirely.
    asked_association_ids = {
        association_id for association_id, _code in await show_associations(show, db)
    }

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
        # What the exhibitor gave *this show* -- a phone number or a membership
        # corrected on their registration here is not on their profile, and the
        # desk has to read the one they gave the show (migration 145).
        view = roster.view(exhibitor_id)
        memberships = []
        for reg in sorted(
            asked_of(view.registrations or [], asked_association_ids)
            if inspections["membership_cards"] else [],
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
            age_check = None
            if inspections["horse_age"]:
                age_key = _verification_key("horse_age", horse.id)
                age_check = record(age_key, _build_check(
                    "horse_age",
                    horse.foaling_date.isoformat() if horse.foaling_date else None,
                    by_key.get(age_key),
                ))

            horse_regs = []
            for reg in sorted(
                asked_of(horse.registrations or [], asked_association_ids)
                if inspections["registration_papers"] else [],
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
                if physical_check:
                    distinct_status[key] = inspection["status"]
                health_out.append({**check, "inspection": inspection})

            horses_out.append({
                "horse_id": horse.id,
                "horse_name": horse.name,
                "barn_name": horse.barn_name,
                # The horse's own number, at a show that numbers horses
                # (migration 161); None at one that numbers exhibitors.
                "back_number": (
                    roster.numbers.by_horse.get(horse.id) if roster.numbers.per_horse else None
                ),
                "preferred_back_number": (
                    roster.numbers.preferred_by_horse.get(horse.id)
                    if roster.numbers.per_horse
                    else None
                ),
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
        emergency_contact = _build_emergency_contact(view)

        # Outstanding is what is left at *this person's* desk visit, so a shared
        # horse counts for each exhibitor who has to present it.
        all_checks = memberships + [
            h["age_check"] for h in horses_out if h["age_check"] is not None
        ]
        for h in horses_out:
            all_checks.extend(h["registrations"])

        outstanding = sum(1 for c in all_checks if c["status"] != "verified")
        # The health *status* is not counted — a lapsed Coggins is the
        # exhibitor's job, not a sign-off the desk owes. The inspection is.
        # Only where this show asks for the paper at the counter, though.
        if physical_check:
            outstanding += sum(
                1 for h in horses_out for c in h["health"]
                if c["inspection"]["status"] != "verified"
            )
        outstanding += sum(1 for w in waiver_checks if w["is_required"] and w["status"] != "signed")
        if emergency_contact["status"] == "missing":
            outstanding += 1

        exhibitors_out.append({
            "exhibitor_id": exhibitor_id,
            "exhibitor_name": exhibitor.full_name,
            "back_number": roster.numbers.first_for_exhibitor(exhibitor_id),
            "back_numbers": roster.numbers.for_exhibitor(exhibitor_id),
            "signed_up": roster.signed_up.get(exhibitor_id, False),
            "memberships": memberships,
            "horses": horses_out,
            "waivers": waiver_checks,
            "emergency_contact": emergency_contact,
            # Reference, not a check — deliberately assembled after
            # `outstanding` is counted so it cannot creep into the tally.
            "contact": _build_contact(view),
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

    return {
        "show_id": show_id,
        "exhibitors": exhibitors_out,
        "totals": totals,
        # Reported so the desk can say why a health row it is still showing is
        # not being counted, rather than leaving staff to wonder.
        "requires_physical_document_check": physical_check,
        # Which sign-offs were built at all (migration 160), so the desk can
        # tell "this show does not check papers" from "nothing here to check".
        "requires_membership_card_check": inspections["membership_cards"],
        "requires_horse_age_check": inspections["horse_age"],
        "requires_registration_papers_check": inspections["registration_papers"],
        # The day every health check above was judged against. Reported for the
        # same reason: a sign-off whose attested date stops before this one does
        # not clear the flag, and the form asking for that date should be able
        # to say so while it is being typed rather than leave staff to work it
        # out from a row that did not change.
        "paperwork_deadline": paperwork_deadline(show),
    }


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
                # The number worn on this horse: the exhibitor's, or the
                # horse's where the show numbers horses.
                "back_number": roster.numbers.resolve(exhibitor_id, horse_id),
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

    # The membership the exhibitor gave this show, which is the profile's until
    # they changed their memberships on the registration (migration 145) -- the
    # same rows the checklist was built from, so a sign-off cannot snapshot a
    # number the desk was not shown.
    # A select rather than `db.get(..., options=...)`: the roster check above
    # has just put this row in the identity map, where `get` drops the options.
    exhibitor_result = await db.execute(
        select(Exhibitor)
        .options(
            selectinload(Exhibitor.registrations).selectinload(
                ExhibitorRegistration.association
            )
        )
        .where(Exhibitor.id == body.exhibitor_id)
        .execution_options(populate_existing=True)
    )
    exhibitor = exhibitor_result.scalar_one()
    view = ShowExhibitorView(exhibitor, await load_copy(show.id, body.exhibitor_id, db))
    membership = membership_for(view, body.association_id)
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

    For a health document the sign-off is the office's word that the paper
    describes this horse and covers the show, and it clears the horse's health
    flag for this show (`attested_health`) — an office that has just inspected a
    good Coggins should not still be told to go and find one. The caller may
    also send `attested_expiry`, the date printed on the paper, which is kept
    for the record; it is no longer what decides whether the flag clears.
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
    """Take an emergency contact over the counter, for this show.

    The desk checks that the show has somebody to telephone, and until now could
    only report that it did not — leaving staff to ask the exhibitor to go and
    edit their own account, at a counter, with a queue behind them.

    Written to this show's copy of the exhibitor's details, never to the
    profile (migration 145): show data does not write back to the profile, from
    the exhibitor's registration or from the desk. The first write copies the
    rest of the profile's details across with it, so the show goes on holding
    the telephone and address it already had.

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

    copy = await get_or_create_copy(show_id, exhibitor_id, db)
    take_details(copy, exhibitor)
    copy.emergency_contact_name = name
    copy.emergency_contact_phone = phone
    await db.commit()
    return _build_emergency_contact(ShowExhibitorView(exhibitor, copy))


# ── Contact details ────────────────────────────────────────────────────────────

#: Contact fields the office writes to the show's copy, by the name the desk
#: payload uses. The guardian is `parent_guardian_*` on the copy.
_CONTACT_COPY_FIELDS = {
    "phone": "phone",
    "address": "address",
    "city": "city",
    "state": "state",
    "zip": "zip",
    "guardian_name": "parent_guardian_name",
    "guardian_phone": "parent_guardian_phone",
}


@router.patch(
    "/exhibitors/{exhibitor_id}/contact",
    response_model=ExhibitorContactOut,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def set_contact(
    show_id: UUID,
    exhibitor_id: UUID,
    body: ExhibitorContactUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Take an exhibitor's contact details over the counter. Nothing is required.

    The desk could show how to reach somebody but not record it, so a walk-up
    typed in with only a name stayed unreachable however many times they read
    their number out. None of it is a check -- an exhibitor with no telephone is
    somebody the office reaches another way -- so every field is optional and a
    blank clears it.

    Telephone, postal address and a youth exhibitor's guardian go to this
    show's copy of the exhibitor's details, never to the profile (migration
    145), exactly as the emergency contact beside them does. The email is the
    one field the copy does not hold: it is `exhibitors.email`, the address the
    office takes at the counter (migration 140) and which only the office
    writes. The address an account signs in with is untouched, because a login
    is not the office's to change.

    Scoped to this show's roster, like every other write the desk makes on
    somebody's behalf.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _assert_exhibitor_on_roster(show_id, exhibitor_id, db)
    # Re-read with the account: the reply names the address they sign in with,
    # and `user` is a lazy relationship -- reading it off the `db.get` row above
    # is a lazy load in an async request.
    exhibitor = (
        await db.execute(
            select(Exhibitor)
            .options(selectinload(Exhibitor.user))
            .where(Exhibitor.id == exhibitor_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()

    sent = body.model_dump(exclude_unset=True)
    values = {key: (value or "").strip() or None for key, value in sent.items()}

    if "email" in values:
        email = values["email"]
        if email and ("@" not in email or " " in email):
            raise HTTPException(422, f"{email} does not look like an email address.")
        exhibitor.email = email

    copy_values = {
        column: values[key] for key, column in _CONTACT_COPY_FIELDS.items() if key in values
    }
    copy = await load_copy(show_id, exhibitor_id, db)
    if copy_values:
        copy = await get_or_create_copy(show_id, exhibitor_id, db)
        # The first write copies the rest of the profile's details across, so
        # the show goes on holding the date of birth and emergency contact it
        # already had.
        take_details(copy, exhibitor)
        for column, value in copy_values.items():
            setattr(copy, column, value)

    await db.commit()
    return _build_contact(ShowExhibitorView(exhibitor, copy))


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
    # And on this show's registration, where the exhibitor has changed their
    # horse list there and it no longer follows the profile (migration 145) --
    # a horse the office just created for them at this show is one they are
    # bringing to it. A no-op while the list follows the profile.
    await add_horse(show_id, exhibitor_id, horse.id, None, db)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            409,
            "One of the registrations conflicts with an existing record. Please verify and try again.",
        )

    return await load_my_horse(horse.id, exhibitor_id, db)
