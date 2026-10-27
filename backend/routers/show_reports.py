"""What the office sends the association after the show.

`GET /shows/{id}/reports` lists what can be produced, `.../reports/{slug}` runs
one, and `.../reports/archive` runs the set SC-110.J asks management to retain.

The whole show loads once, here, and `show_reports.py` builds every report from
that payload without querying — the same arrangement `show_financials.py` and
`financial_reports.py` use. Two things follow from it: a report cannot quote a
placing the results screen does not show, and the retention bundle cannot
disagree with the reports inside it.

Access is the show-office tier — ADMIN, or the SHOW_SECRETARY / SHOW_MANAGER
assigned to this show. A `SCRIBE` writes placings and a `GATE_STEWARD` runs the
in-gate; neither has any business reading an exhibitor's membership number off a
compliance sheet, which is the same line `show_financials.py` draws.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from backnumbers import back_numbers_for_show
from data_export import build_data_export
from database import get_db
from dependencies import require_admin_or_show_admin
from high_point import _shown
from registration_profile import ShowExhibitorView, exhibitor_views, load_copies_for_show
from judging import effective_score, is_overridden
from models import (
    Association,
    Breed,
    Class,
    ClassSanctioning,
    Discipline,
    Division,
    Entry,
    Exhibitor,
    ExhibitorCompetitionCard,
    Horse,
    HorseColor,
    HorsePattern,
    HorseRegistration,
    Judge,
    JudgeCard,
    Result,
    Show,
    ShowCompany,
    ShowEntry,
    ShowJudge,
    Trainer,
    User,
    Venue,
    judge_associations,
)
from rules.apha import DIVISION_LABELS, RELATIONSHIP_REQUIRED_DIVISIONS
from schemas import ReportDefinitionOut, ReportOut
from show_associations import show_associations
from show_companies import DATA_EXPORT, require_show_feature
from show_reports import RETENTION_SLUGS, build_report, list_reports
from routers.shows import _assert_show_access, association_id_by_code

# The role guard is on the router and the per-show check is in each endpoint —
# `require_admin_or_show_admin` says the caller is show-office tier at all, and
# `_assert_show_access` says they are that for *this* show. Same pairing the
# financials router uses.
router = APIRouter(
    prefix="/shows/{show_id}/reports",
    tags=["Show Reports"],
    dependencies=[Depends(require_admin_or_show_admin)],
)


# ── Assembling the record ──────────────────────────────────────────────────────


def _number(value) -> Optional[float]:
    return None if value is None else float(value)


def judge_name(judge: Optional[Judge]) -> Optional[str]:
    """The registry stores a judge's name in two parts; there is no `Judge.name`.

    Reading one took every report down with it — `_load_record` builds the
    judges first, so an AttributeError here 500'd the whole Show Record at any
    show with a judge assigned.
    """
    if judge is None:
        return None
    return f"{judge.first_name or ''} {judge.last_name or ''}".strip() or None


async def _load_record(show_id: UUID, db: AsyncSession) -> dict:
    """The whole show, in a fixed number of queries.

    Everything the reports need, shaped once. A per-report query would be easier
    to write and would let two reports disagree about the same class, which is
    exactly what the registry exists to prevent.
    """
    show = (await db.execute(
        select(Show).options(selectinload(Show.show_type)).where(Show.id == show_id)
    )).scalar_one_or_none()
    if not show:
        raise HTTPException(404, "Show not found")

    association_code = show.show_type.code if show.show_type else None
    # OPEN is a show type, never an affiliation — there is no `associations` row
    # for it, so a horse at an OPEN show has no registration to report.
    if association_code == "OPEN":
        association_code = None
    association_id = (
        await association_id_by_code(db, association_code) if association_code else None
    )

    judges = [
        {"id": sj.id, "name": judge_name(sj.judge), "sort_order": sj.sort_order or 0}
        for sj in (await db.execute(
            select(ShowJudge)
            .options(selectinload(ShowJudge.judge))
            .where(ShowJudge.show_id == show_id)
            .order_by(ShowJudge.sort_order, ShowJudge.created_at)
        )).scalars().all()
    ]

    class_rows = (await db.execute(
        select(Class)
        .options(selectinload(Class.associations))
        .where(Class.show_id == show_id)
        .order_by(Class.class_date, Class.sort_order.nullslast(), Class.class_number)
    )).scalars().all()

    entry_counts = dict(
        (row[0], row[1])
        for row in (await db.execute(
            select(Entry.class_id, func.count(Entry.id))
            .join(Class, Class.id == Entry.class_id)
            .where(Class.show_id == show_id, Entry.status != "WITHDRAWN")
            .group_by(Entry.class_id)
        )).all()
    )

    def class_code(cls: Class) -> Optional[str]:
        """The breed body's own identifier for this class.

        Keyed on `show_types` rather than `associations` — a class *code* is the
        catalog question, where a registration number is an affiliation.
        """
        for assoc in cls.associations:
            if assoc.show_type_id == show.show_type_id:
                return assoc.association_class_code
        return None

    classes = [
        {
            "id": c.id,
            "class_number": c.class_number,
            "class_name": c.class_name,
            "class_date": c.class_date,
            "sort_order": c.sort_order or 0,
            "score_type": c.score_type,
            "entry_fee_cents": c.entry_fee_cents or 0,
            "results_published_at": c.results_published_at,
            "pattern_posted_at": c.pattern_posted_at,
            "association_class_code": class_code(c),
            "entry_count": entry_counts.get(c.id, 0),
        }
        for c in class_rows
    ]

    entry_rows = (await db.execute(
        select(Entry)
        .join(Class, Class.id == Entry.class_id)
        .options(
            selectinload(Entry.exhibitor).selectinload(Exhibitor.registrations),
            selectinload(Entry.horse).selectinload(Horse.registrations),
            selectinload(Entry.attestations),
        )
        .where(Class.show_id == show_id)
    )).scalars().all()

    # The exhibitor's number, or the horse's where the show numbers horses
    # (migration 161).
    numbers = await back_numbers_for_show(show_id, db)

    # The membership each exhibitor gave this show, where they changed it on
    # their registration (migration 145).
    views = exhibitor_views(
        (e.exhibitor for e in entry_rows), await load_copies_for_show(show_id, db)
    )

    def member(exhibitor) -> tuple[Optional[str], Optional[object]]:
        """This show's association membership number and its expiry.

        Falls back to the pre-080 `exhibitors.apha_member_number` column, which
        is still the only place some records carry a number — the same fallback
        the APHA entry export makes, for the same reason.
        """
        if exhibitor is None:
            return None, None
        if association_id:
            for reg in exhibitor.registrations:
                if reg.association_id == association_id:
                    return reg.member_number, reg.expires_at
        if association_code == "APHA":
            return (
                getattr(exhibitor, "apha_member_number", None),
                getattr(exhibitor, "apha_member_expiry", None),
            )
        return None, None

    def registration(horse) -> Optional[str]:
        if horse is None or not association_id:
            return None
        for reg in horse.registrations:
            if reg.association_id == association_id:
                return reg.registration_number
        return None

    entries = []
    for e in entry_rows:
        member_number, member_expires = member(views.get(e.exhibitor_id) or e.exhibitor)
        entries.append({
            "id": e.id,
            "class_id": e.class_id,
            "exhibitor_id": e.exhibitor_id,
            "exhibitor_name": (e.exhibitor.full_name if e.exhibitor else None) or "(unnamed)",
            "back_number": numbers.resolve(e.exhibitor_id, e.horse_id),
            "horse_id": e.horse_id,
            "horse_name": e.horse.name if e.horse else None,
            "registration_number": registration(e.horse),
            "member_number": member_number,
            "member_expires_at": member_expires,
            "apha_division": e.apha_division,
            "apha_division_label": DIVISION_LABELS.get(e.apha_division or "", e.apha_division),
            "relationship_to_owner": e.relationship_to_owner,
            "status": e.status,
            "attestations": [
                {
                    "kind": a.kind,
                    "statement": a.statement,
                    "attested_by_name": a.attested_by_name,
                    "attested_at": a.attested_at.date() if a.attested_at else None,
                }
                for a in e.attestations
            ],
        })

    results = [
        {
            "entry_id": r.entry_id,
            "class_id": r.class_id,
            "judge_id": r.judge_id,
            "place": r.place,
            "raw_score": _number(r.raw_score),
            "is_tie": bool(r.is_tie),
            "outcome": r.outcome,
            "outcome_note": r.outcome_note,
        }
        for r in (await db.execute(
            select(Result)
            .join(Class, Class.id == Result.class_id)
            .where(Class.show_id == show_id)
        )).scalars().all()
    ]

    cards = [
        {
            "class_id": c.class_id,
            "entry_id": c.entry_id,
            "judge_id": c.judge_id,
            "system_name": c.system.name if c.system else None,
            "computed_score": _number(c.computed_score),
            "effective_score": _number(effective_score(c)),
            "is_overridden": is_overridden(c),
            "override_reason": c.override_reason,
            "maneuvers": [
                {"sequence": m.sequence, "score": _number(m.score)} for m in c.maneuvers
            ],
            "penalties": [
                {"label": p.label, "value": _number(p.value), "sequence": p.sequence}
                for p in c.penalties
            ],
        }
        for c in (await db.execute(
            select(JudgeCard)
            .join(Class, Class.id == JudgeCard.class_id)
            .where(Class.show_id == show_id)
        )).scalars().all()
    ]

    # Per exhibitor, for the compliance sheet. Built from the entries already
    # loaded rather than a second pass over the database — the two would
    # otherwise be able to disagree about who entered.
    end_date = show.end_date
    people: dict[UUID, dict] = {}
    for e in entries:
        person = people.setdefault(e["exhibitor_id"], {
            "name": e["exhibitor_name"],
            # Every number they wear -- one per horse where the show numbers
            # horses -- sorted on by the lowest.
            "back_number": numbers.first_for_exhibitor(e["exhibitor_id"]),
            "back_numbers_label": numbers.label_for_exhibitor(e["exhibitor_id"]),
            "member_number": e["member_number"],
            "member_expires_at": e["member_expires_at"],
            "entry_count": 0,
            "horse_ids": set(),
            "horses_without_registration": set(),
            "divisions": set(),
            "attestation_count": 0,
            "entries_needing_relationship": 0,
        })
        if e["status"] == "WITHDRAWN":
            continue
        person["entry_count"] += 1
        person["attestation_count"] += len(e["attestations"])
        if e["horse_id"]:
            person["horse_ids"].add(e["horse_id"])
            if not e["registration_number"]:
                person["horses_without_registration"].add(e["horse_id"])
        if e["apha_division_label"]:
            person["divisions"].add(e["apha_division_label"])
        # Only the divisions that actually require it — showing every Open entry
        # as missing a relationship would bury the ones that matter.
        if e["apha_division"] in RELATIONSHIP_REQUIRED_DIVISIONS and not e["relationship_to_owner"]:
            person["entries_needing_relationship"] += 1

    exhibitors = [
        {
            "name": p["name"],
            "back_number": p["back_number"],
            "back_numbers_label": p["back_numbers_label"],
            "member_number": p["member_number"],
            "member_expires_at": p["member_expires_at"],
            # Judged against the show's end date, never today — a card that
            # lapses on the Saturday of a three-day show is what needs chasing.
            "membership_lapsed": bool(
                p["member_expires_at"] and end_date and p["member_expires_at"] < end_date
            ),
            "entry_count": p["entry_count"],
            "horse_count": len(p["horse_ids"]),
            "horses_without_registration": len(p["horses_without_registration"]),
            "divisions": sorted(p["divisions"]),
            "attestation_count": p["attestation_count"],
            "entries_needing_relationship": p["entries_needing_relationship"],
        }
        for p in people.values()
    ]

    return {
        "show_id": show.id,
        "show_name": show.name,
        "show_type_code": show.show_type.code if show.show_type else None,
        "association_code": association_code,
        "apha_show_number": show.apha_show_number,
        "start_date": show.start_date,
        "end_date": show.end_date,
        "judges": judges,
        "judges_by_id": {j["id"]: j for j in judges},
        "classes": classes,
        "classes_by_id": {c["id"]: c for c in classes},
        "entries": entries,
        "entries_by_id": {e["id"]: e for e in entries},
        "results": results,
        "cards": cards,
        # Which (class, judge) pairs have anything filed — the class summary's
        # "cards filed" count, worked out once.
        "filed_cards": {(r["class_id"], r["judge_id"]) for r in results},
        "exhibitors": exhibitors,
    }


async def _load_export_extras(show_id: UUID, record: dict, db: AsyncSession) -> dict:
    """What the Data Export carries beyond the association reports.

    Added to an already-loaded record rather than folded into `_load_record`,
    so the reports pay nothing for columns only this file prints, and the
    placings are the very rows those reports print. Column queries throughout:
    `_load_record` has these rows in the session already, and a relationship
    read off one of them that it did not load is a `MissingGreenlet`.
    """
    associations = {
        row.id: {
            "id": row.id,
            "code": row.code,
            "name": row.name,
            "association_type": row.association_type,
        }
        for row in (await db.execute(
            select(Association.id, Association.code, Association.name, Association.association_type)
        )).all()
    }

    # `show_type` and `sanctioning` are both `lazy="selectin"`, so this read
    # carries what `show_associations` needs -- the same list the registration
    # screen, the horse picker and the desk ask from.
    show = (await db.execute(select(Show).where(Show.id == show_id))).scalar_one()
    show_association_ids = [aid for aid, _code in await show_associations(show, db)]

    place = (await db.execute(
        select(
            ShowCompany.name.label("company"),
            Venue.name.label("venue"),
            Venue.city.label("city"),
            Venue.state.label("state"),
        )
        .select_from(Show)
        .outerjoin(ShowCompany, ShowCompany.id == Show.company_id)
        .outerjoin(Venue, Venue.id == Show.venue_id)
        .where(Show.id == show_id)
    )).one()

    classes: dict = {
        row.id: {
            "division": row.division,
            "discipline": row.discipline,
            "high_point_eligible": row.high_point_eligible,
            "sanctioned_by": [],
            "shown_count": 0,
        }
        for row in (await db.execute(
            select(
                Class.id,
                Division.name.label("division"),
                Discipline.name.label("discipline"),
                Class.high_point_eligible,
            )
            .outerjoin(Division, Division.id == Class.division_id)
            .outerjoin(Discipline, Discipline.id == Class.discipline_id)
            .where(Class.show_id == show_id)
        )).all()
    }
    for class_id, code in (await db.execute(
        select(ClassSanctioning.class_id, Association.code)
        .join(Association, Association.id == ClassSanctioning.association_id)
        .join(Class, Class.id == ClassSanctioning.class_id)
        .where(Class.show_id == show_id)
    )).all():
        if class_id in classes:
            classes[class_id]["sanctioned_by"].append(code)
    # Horses shown, counted the way the high-point standings count a class:
    # neither a scratch nor a no-show at the gate went into the ring.
    for class_id, count in (await db.execute(
        select(Entry.class_id, func.count(Entry.id))
        .join(Class, Class.id == Entry.class_id)
        .where(Class.show_id == show_id, _shown(Entry.class_id))
        .group_by(Entry.class_id)
    )).all():
        if class_id in classes:
            classes[class_id]["shown_count"] = count

    entries = {
        entry_id: {"gate_no_show": no_show}
        for entry_id, no_show in (await db.execute(
            select(Entry.id, Entry.gate_no_show)
            .join(Class, Class.id == Entry.class_id)
            .where(Class.show_id == show_id)
        )).all()
    }

    # People, read through this show's copy: the details and memberships they
    # gave this show, which is what the show holds (migration 145).
    exhibitor_ids = {e["exhibitor_id"] for e in record["entries"] if e["exhibitor_id"]}
    exhibitors: dict = {}
    if exhibitor_ids:
        copies = await load_copies_for_show(show_id, db, exhibitor_ids)
        # A login's address is the authority where there is one;
        # `exhibitors.email` is what the office was given at the counter.
        login_emails = dict((await db.execute(
            select(Exhibitor.id, User.email)
            .join(User, User.id == Exhibitor.user_id)
            .where(Exhibitor.id.in_(exhibitor_ids))
        )).all())
        cards: dict = {}
        for exhibitor_id, association_id, division, year in (await db.execute(
            select(
                ExhibitorCompetitionCard.exhibitor_id,
                ExhibitorCompetitionCard.association_id,
                ExhibitorCompetitionCard.division,
                ExhibitorCompetitionCard.valid_year,
            ).where(ExhibitorCompetitionCard.exhibitor_id.in_(exhibitor_ids))
        )).all():
            code = associations.get(association_id, {}).get("code", "")
            label = DIVISION_LABELS.get(division, division)
            cards.setdefault(exhibitor_id, []).append(f"{code} {label} {year}".strip())

        apha_id = next((a for a, body in associations.items() if body["code"] == "APHA"), None)
        for row in (await db.execute(
            select(Exhibitor)
            .options(selectinload(Exhibitor.registrations))
            .where(Exhibitor.id.in_(exhibitor_ids))
        )).scalars().all():
            view = ShowExhibitorView(row, copies.get(row.id))
            memberships = {
                reg.association_id: {"number": reg.member_number, "expires_at": reg.expires_at}
                for reg in view.registrations
            }
            # The pre-080 column is still the only home of some APHA numbers --
            # the fallback the Show Results report and the APHA file both make.
            if apha_id and apha_id not in memberships and view.apha_member_number:
                memberships[apha_id] = {
                    "number": view.apha_member_number,
                    "expires_at": view.apha_member_expiry,
                }
            exhibitors[row.id] = {
                "date_of_birth": view.date_of_birth,
                "city": view.city,
                "state": view.state,
                "zip": view.zip,
                "phone": view.phone,
                "email": login_emails.get(row.id) or view.email,
                "competition_cards": cards.get(row.id, []),
                "memberships": memberships,
            }

    horse_ids = {e["horse_id"] for e in record["entries"] if e["horse_id"]}
    horses: dict = {}
    if horse_ids:
        owner = aliased(Exhibitor)
        for row in (await db.execute(
            select(
                Horse.id,
                Horse.barn_name,
                Horse.foaling_date,
                Horse.sex,
                Horse.owner_name,
                Horse.trainer_name,
                Breed.name.label("breed"),
                HorseColor.name.label("color"),
                HorsePattern.name.label("pattern"),
                owner.full_name.label("owner_exhibitor"),
                Trainer.name.label("trainer_record"),
            )
            .outerjoin(Breed, Breed.id == Horse.breed_id)
            .outerjoin(HorseColor, HorseColor.id == Horse.color_id)
            .outerjoin(HorsePattern, HorsePattern.id == Horse.pattern_id)
            .outerjoin(owner, owner.id == Horse.owner_exhibitor_id)
            .outerjoin(Trainer, Trainer.id == Horse.trainer_id)
            .where(Horse.id.in_(horse_ids))
        )).all():
            horses[row.id] = {
                "barn_name": row.barn_name,
                "foaling_year": row.foaling_date.year if row.foaling_date else None,
                "sex": row.sex,
                "breed": row.breed,
                # A Paint is a colour and a pattern -- "Bay Tobiano" (migration 116).
                "color": " ".join(p for p in (row.color, row.pattern) if p) or None,
                "owner": row.owner_exhibitor or row.owner_name,
                "trainer": row.trainer_record or row.trainer_name,
                "registrations": {},
            }
        for horse_id, association_id, number in (await db.execute(
            select(
                HorseRegistration.horse_id,
                HorseRegistration.association_id,
                HorseRegistration.registration_number,
            ).where(HorseRegistration.horse_id.in_(horse_ids))
        )).all():
            if horse_id in horses:
                horses[horse_id]["registrations"][association_id] = number

    judge_codes: dict = {}
    for show_judge_id, code in (await db.execute(
        select(ShowJudge.id, Association.code)
        .join(judge_associations, judge_associations.c.judge_id == ShowJudge.judge_id)
        .join(Association, Association.id == judge_associations.c.association_id)
        .where(ShowJudge.show_id == show_id)
    )).all():
        judge_codes.setdefault(show_judge_id, []).append(code)

    return {
        "show": {
            "company": place.company,
            "venue": place.venue,
            "venue_location": ", ".join(p for p in (place.city, place.state) if p) or None,
        },
        "associations": associations,
        "show_association_ids": show_association_ids,
        "classes": classes,
        "entries": entries,
        "exhibitors": exhibitors,
        "horses": horses,
        "judge_associations": judge_codes,
    }


# ── Endpoints ──────────────────────────────────────────────────────────────────


@router.get("", response_model=list[ReportDefinitionOut])
async def list_show_reports(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """What the reporting module can produce for this show."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    return list_reports()


@router.get("/archive")
async def get_retention_archive(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The show's record to keep on file, in one read: the class summary, the
    results, the entry cards and the judges' cards.

    Associations and clubs commonly ask a show's management to keep the signed
    judge's cards, the results and the entry cards for a period after the show
    (APHA's SC-110.J is one such rule). The app holds all of those in some form
    and had no way to get them out together. This is that — one bundle,
    generated from the show's own data the way the show bill is, rather than an
    upload that would go stale the moment a placing is corrected.

    **The wording is generic on purpose.** It is offered at every show, whatever
    body sanctions it, so it names no association's rule; how long to keep the
    record, and whether a processed copy comes back, is the sanctioning body's
    to say.

    **It does not replace the paper**, and says so in `caveats` rather than
    letting a printout imply otherwise: the *signed* judge's cards are paper the
    judge hands to the office, and nothing the app can generate is that document.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    record = await _load_record(show_id, db)

    unposted = [c for c in record["classes"] if not c["results_published_at"]]
    caveats = [
        "The original signed judge's placing cards are paper the judge hands to "
        "the office. Nothing here is that document — Judges' Cards is what the "
        "scribe recorded off them. Keep the paper as well.",
        # A bundle that listed only its own output would look complete while
        # missing the one document the app cannot hold: the results as the
        # sanctioning body sends them back after processing them.
        "If your association or club sends the results back once it has "
        "processed them, keep its copy with this bundle — that is its document, "
        "not this one.",
        "How long to keep the record, and how late a correction may be asked "
        "for, are set by the association or club that sanctions the show. "
        "Check its rules; many ask for at least a year.",
        "Generated from the show's own data, so re-running it after a correction "
        "produces the corrected record. Print or export a copy at the point you "
        "need to retain one.",
    ]
    if unposted:
        caveats.append(
            f"{len(unposted)} class(es) have not been posted. Their placings are "
            "still a staff-only draft and are left out of the results."
        )
    if not record["judges"]:
        caveats.append(
            "No judges are assigned to this show, so every placing is filed "
            "against a single unattributed card."
        )

    return {
        "show_id": record["show_id"],
        "show_name": record["show_name"],
        "show_type_code": record["show_type_code"],
        "apha_show_number": record["apha_show_number"],
        "start_date": record["start_date"],
        "end_date": record["end_date"],
        "generated_at": datetime.now(timezone.utc),
        "caveats": caveats,
        "reports": [build_report(slug, record) for slug in RETENTION_SLUGS],
    }


@router.get("/data-export", dependencies=[Depends(require_show_feature(DATA_EXPORT))])
async def get_data_export(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Every column the show can export and every row, for the office to pick
    from -- see `data_export.py`.

    Declared before `/{slug}` so it is not read as a report slug. Not in the
    registry either: a registry report is a fixed column list, and this one's
    columns are the reader's choice. GaitDesk Pro, on the show's plan; the
    association reports beside it are not.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    record = await _load_record(show_id, db)
    record["export"] = await _load_export_extras(show_id, record, db)
    return {
        "show_id": record["show_id"],
        "show_name": record["show_name"],
        "generated_at": datetime.now(timezone.utc),
        **build_data_export(record),
    }


@router.get("/{slug}", response_model=ReportOut)
async def get_show_report(
    show_id: UUID,
    slug: str,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Run one report."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    record = await _load_record(show_id, db)

    report = build_report(slug, record)
    if report is None:
        raise HTTPException(404, "Report not found")

    return {
        **report,
        "show_id": record["show_id"],
        "show_name": record["show_name"],
        "generated_at": datetime.now(timezone.utc),
    }
