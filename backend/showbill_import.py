"""A show built from its own show bill: the review, and the one press that creates it.

`extraction/showbill.py` reads the bill. This module does the two things either
side of a person looking at what it read:

* **`prepare_draft`** turns the read into a review screen. It matches what the
  bill *names* -- a judge, a venue, a club, the breed body -- against what the
  app already *holds*, and routes every class to a discipline the way the
  Class Builder would. Every match is a suggestion the reviewer can overrule,
  and every one carries the reason it was made.
* **`apply_import`** creates the show from what the reviewer submitted, in one
  transaction: the show and its staff row, venue, judges, club sanctioning,
  classes, fees, and the bill itself on file. Nothing the model read is used
  here -- only the reviewed payload -- so there is no path from the file to a
  record that does not go through a person.

Three rules worth stating, because each was a real mistake before this existed:

* **A name is not an identity.** A judge on the bill is matched to the registry
  only when first and last name agree exactly, and the screen says it matched
  on the name. It is preselected because the alternative -- a second registry
  row for somebody already in it, with no email to tell them apart -- is the
  worse outcome, and the reviewer is looking straight at it.
* **An existing judge's cards are not edited from here.** The registry is shared
  by every show that judge ever worked and editing it is admin-only
  (`routers/judges.py`); the bill's "APHA/WSCA" beside a judge is used only
  when the judge is being created.
* **One class of a name per show day**, the Class Builder's own rule
  (`routers/classes.py::_assert_name_free`). A bulk import elsewhere skips a
  duplicate rather than failing; this one refuses and names it, because the
  person who can fix it is on the review screen with the row in front of them.

The pure functions are tested without a database (`tests/test_showbill_import.py`);
the SQL around them is not, for the reason `tests/factories.py` gives.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    Association,
    ClassSanctioning,
    Judge,
    Show,
    ShowBillImport,
    ShowDocument,
    ShowFee,
    ShowJudge,
    ShowManager,
    ShowSanctioning,
    ShowSecretary,
    ShowType,
    Venue,
)
from rules.disciplines import DISCIPLINE_KEYWORDS, classify_class_name, entered_by_qualification

logger = logging.getLogger(__name__)

# A read that has not finished in this long never will: the process that owned
# it is gone (a deploy, a restart). The reader reports it as failed rather than
# leaving the review screen spinning forever, so no sweeper has to exist.
READ_TIMEOUT = timedelta(minutes=20)

STATUS_PENDING = "pending"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"

INTERRUPTED_MESSAGE = (
    "The read was interrupted before it finished. Upload the show bill again, "
    "or set the show up by hand."
)


# --- Status --------------------------------------------------------------------


def effective_status(status: str, created_at: Optional[datetime], now: datetime) -> str:
    """The status a reader should act on.

    A `pending` row older than `READ_TIMEOUT` is reported as `failed`: the task
    that would have finished it lived in a process that no longer exists.
    """
    if status == STATUS_PENDING and created_at is not None and now - created_at > READ_TIMEOUT:
        return STATUS_FAILED
    return status


# --- Matching what the bill names against what the app holds -------------------

_NON_WORD = re.compile(r"[^a-z0-9]+")


def normalize_name(value: Optional[str]) -> str:
    """Case, spacing and punctuation folded away -- "Leigh-Ann" is "leigh ann"."""
    return " ".join(_NON_WORD.sub(" ", (value or "").lower()).split())


def match_judge(first_name: str, last_name: str, registry: Iterable[Any]) -> dict[str, Any]:
    """Which registry judges this name could be, and whether one is suggested.

    `registry` rows need `id`, `first_name`, `last_name`. A single exact match
    (after `normalize_name`) is suggested; several people of one name are all
    offered and none is picked, since choosing between them is exactly the call
    a name cannot make. A registry judge with the same last name is offered as
    a candidate either way -- "Tim" on the bill and "Timothy" on file is the
    reviewer's to decide.
    """
    first, last = normalize_name(first_name), normalize_name(last_name)
    exact, same_last = [], []
    for judge in registry:
        if normalize_name(judge.last_name) != last:
            continue
        if normalize_name(judge.first_name) == first:
            exact.append(judge.id)
        else:
            same_last.append(judge.id)
    return {
        "suggested_judge_id": exact[0] if len(exact) == 1 else None,
        "candidate_judge_ids": exact + same_last,
        "matched_on": "name" if len(exact) == 1 else None,
    }


def match_venue(name: Optional[str], city: Optional[str], venues: Iterable[Any]) -> Optional[Any]:
    """The venue on file with this name, or None.

    Exact after normalising, and -- where two venues share a name, which a
    "County Fairgrounds" does -- only when the city agrees too. A venue is a
    shared row every show at it points at, so the wrong one is a show quietly
    listed at somebody else's arena.
    """
    wanted = normalize_name(name)
    if not wanted:
        return None
    same_name = [v for v in venues if normalize_name(v.name) == wanted]
    if len(same_name) == 1:
        return same_name[0].id
    wanted_city = normalize_name(city)
    in_city = [v for v in same_name if wanted_city and normalize_name(v.city) == wanted_city]
    return in_city[0].id if len(in_city) == 1 else None


def match_association(code: Optional[str], name: Optional[str], associations: Iterable[Any]) -> Optional[Any]:
    """The `associations` row a printed code or name refers to, or None.

    The code first -- it is what the bill prints beside a judge or a class --
    then the full name, both case-insensitive. Unknown is None, never a guess.
    """
    rows = list(associations)
    wanted_code = (code or "").strip().upper()
    if wanted_code:
        for row in rows:
            if row.code.upper() == wanted_code:
                return row.id
    wanted_name = normalize_name(name)
    if wanted_name:
        for row in rows:
            if normalize_name(row.name) == wanted_name:
                return row.id
    return None


def _infer_score_type(name: str) -> str:
    """Same heuristic as `routers/disciplines._infer_score_type`, which the
    Class Builder uses for a discipline name no standard row matches."""
    from routers.disciplines import _infer_score_type as infer

    return infer(name)


def _known_disciplines() -> dict[str, tuple[str, str]]:
    """The classifier's own discipline names, keyed case-insensitively."""
    known: dict[str, tuple[str, str]] = {}
    for _keyword, name, score_type in DISCIPLINE_KEYWORDS:
        known.setdefault(name.lower(), (name, score_type))
    return known


_KNOWN_DISCIPLINES = _known_disciplines()


def resolve_discipline(discipline: Optional[str], class_name: str) -> tuple[str, str]:
    """(discipline name, score type) for a class, the way the importers route one.

    Two pieces of evidence, and each is right where the other is wrong:

    * **The heading** the bill printed the class under, when it names one of
      the app's disciplines (in any case -- bills print headings in capitals,
      and "HALTER" is not even a keyword the classifier knows). It is what
      rescues "Yearling Fillies", which says nothing of halter, and what keeps
      "Ranch WT Trail" in Ranch Trail and "Lead Line Trail Ages 3-8" in Lead
      Line, both of which the name alone routes to plain Trail.
    * **The class name**, through the ordered classifier the APHA and AQHA
      catalog imports use -- which wins over a known heading only when it names
      a more specific form of it: "In-Hand Trail" printed under TRAIL, or
      "Performance Halter" under HALTER.

    A heading the app has never heard of is kept as a discipline of its own,
    rather than dumped in "Unassigned", which is the one discipline nobody can
    act on. Checked against the hand transcription of the MNSPHC bill, where
    it agrees on all 172 classes.
    """
    heading = " ".join((discipline or "").split())
    by_name = classify_class_name(class_name)
    known = _KNOWN_DISCIPLINES.get(heading.lower()) if heading else None
    if known is not None:
        if by_name is not None and by_name[0] != known[0] and known[0].lower() in by_name[0].lower():
            return by_name
        return known
    if by_name is not None:
        return by_name
    if not heading:
        return "Unassigned", "placement"
    routed = classify_class_name(heading)
    if routed is not None:
        return routed
    if heading.isupper():
        heading = heading.title()
    return heading, _infer_score_type(heading)


def class_fee_cents(amount_cents: int, per_judge: bool, judge_count: int) -> int:
    """A class price as the app stores it: the per-judge rate multiplied out.

    What `seed_mnsphc_paint_o_rama.FEE_CENTS` did by hand -- "$9 per judge x 4
    APHA judges" is $36 on the class. Used for the review screen's first figure
    only; the screen shows the arithmetic and the reviewer submits the result.
    """
    if not per_judge:
        return amount_cents
    return amount_cents * max(judge_count, 0)


def prepare_draft(
    extracted: dict[str, Any],
    *,
    show_types: Iterable[Any],
    associations: Iterable[Any],
    judges: Iterable[Any],
    venues: Iterable[Any],
) -> dict[str, Any]:
    """The review screen's starting point: the read, plus every match it implies.

    Returns the extraction unchanged beside a `resolved` block, so the screen
    can show what the bill said next to what the app will do with it.
    """
    show = extracted.get("show") or {}
    type_rows = list(show_types)
    assoc_rows = list(associations)
    judge_rows = list(judges)
    clubs_by_id = {a.id: a for a in assoc_rows if a.association_type == "club"}

    breed = show.get("breed_association")
    show_type_id = next((t.id for t in type_rows if breed and t.code.upper() == breed.upper()), None)

    resolved_judges = []
    for judge in extracted.get("judges") or []:
        match = match_judge(judge["first_name"], judge["last_name"], judge_rows)
        match["association_ids"] = [
            aid
            for aid in (match_association(code, None, assoc_rows) for code in judge.get("associations") or [])
            if aid is not None
        ]
        resolved_judges.append(match)

    # Only clubs. A bill that lists "APHA" among its sanctioning bodies is
    # naming the breed body again, which is the show type, not an overlay.
    resolved_clubs = []
    club_id_by_code: dict[str, Any] = {}
    for club in extracted.get("clubs") or []:
        aid = match_association(club["code"], club.get("name"), assoc_rows)
        is_club = aid in clubs_by_id
        resolved_clubs.append(
            {
                "association_id": aid if is_club else None,
                "is_breed_association": aid is not None and not is_club,
            }
        )
        if is_club:
            club_id_by_code[club["code"].upper()] = aid

    resolved_classes = []
    for cls in extracted.get("classes") or []:
        discipline, score_type = resolve_discipline(cls.get("discipline"), cls["name"])
        resolved_classes.append(
            {
                "discipline": discipline,
                "score_type": score_type,
                "entered_by_qualification": bool(cls.get("is_championship"))
                or entered_by_qualification(cls["name"]),
                "club_association_ids": [
                    club_id_by_code[code.upper()]
                    for code in cls.get("club_codes") or []
                    if code.upper() in club_id_by_code
                ],
                "unknown_club_codes": [
                    code for code in cls.get("club_codes") or [] if code.upper() not in club_id_by_code
                ],
            }
        )

    return {
        "show_type_id": show_type_id,
        "venue_id": match_venue(show.get("venue_name"), show.get("venue_city"), venues),
        "judges": resolved_judges,
        "clubs": resolved_clubs,
        "classes": resolved_classes,
    }


# --- Checking the reviewed payload -----------------------------------------------


def apply_problems(body: Any) -> list[str]:
    """Everything wrong with a reviewed payload that needs no database to see.

    Collected rather than raised one at a time: the reviewer fixes a 170-row
    table in one sitting, and being told about the second problem only after
    fixing the first is how a screen like this gets abandoned.
    """
    problems: list[str] = []
    show = body.show
    start, end = show.start_date, show.end_date

    outside = [c for c in body.classes if not (start <= c.class_date <= end)]
    if outside:
        names = ", ".join(f"{c.class_name} ({c.class_date.isoformat()})" for c in outside[:5])
        more = f" and {len(outside) - 5} more" if len(outside) > 5 else ""
        problems.append(
            f"{len(outside)} class{'es' if len(outside) != 1 else ''} fall outside the show's dates "
            f"({start.isoformat()} to {end.isoformat()}): {names}{more}."
        )

    seen: dict[tuple[date, str], str] = {}
    duplicates: list[str] = []
    for c in body.classes:
        key = (c.class_date, " ".join(c.class_name.lower().split()))
        if key in seen:
            duplicates.append(f"{seen[key]} on {c.class_date.isoformat()}")
        else:
            seen[key] = c.class_name
    if duplicates:
        problems.append(
            "A show runs one class of a name per day, and these appear twice: "
            + "; ".join(duplicates[:5])
            + (f" and {len(duplicates) - 5} more" if len(duplicates) > 5 else "")
            + ". Rename one or untick it."
        )

    club_ids = {club.association_id for club in body.clubs}
    if len(club_ids) != len(body.clubs):
        problems.append("A club is listed twice under sanctioning.")
    unsanctioned = sorted({c.class_name for c in body.classes if set(c.club_association_ids) - club_ids})
    if unsanctioned:
        problems.append(
            "Some classes are marked for a club the show is not sanctioned by: "
            + ", ".join(unsanctioned[:5])
            + ". Add the club under sanctioning or clear it from those classes."
        )

    for judge in body.judges:
        if judge.judge_id is None and not ((judge.first_name or "").strip() and (judge.last_name or "").strip()):
            problems.append("Every new judge needs a first and last name.")
            break
    picked = [j.judge_id for j in body.judges if j.judge_id is not None]
    if len(picked) != len(set(picked)):
        problems.append("The same registry judge is on the panel twice.")

    venue = body.venue
    if venue is not None and venue.venue_id is None and not (venue.name or "").strip():
        problems.append("A new venue needs a name.")

    return problems


def fee_problems(body: Any) -> list[str]:
    """The fee rules the fee editors enforce, applied to every row at once.

    The same two guards `routers/show_fees.py` runs on a single create -- the
    early-rate pair and the bedding-only minimum -- reused rather than restated,
    with each message put against the fee it is about.
    """
    from routers.show_fees import _assert_early_rate_valid, _assert_min_quantity_valid

    problems = []
    for fee in body.fees:
        try:
            _assert_early_rate_valid(
                unit=fee.unit,
                amount_cents=fee.amount_cents,
                early_amount_cents=fee.early_amount_cents,
                early_deadline=fee.early_deadline,
            )
            _assert_min_quantity_valid(unit=fee.unit, min_quantity=fee.min_quantity)
        except HTTPException as exc:
            problems.append(f"{fee.label}: {exc.detail}")
    return problems


# The rows setup Step 3 (Lodging & Boarding) manages, found by `code` alone --
# see `LodgingClient`'s SLOTS. A stall line imported as `horse_stall` would sit
# outside that screen, which would then offer an empty Stalls card, and filling
# it in would put a second stall charge on every bill beside the imported one.
_LODGING_SLOTS = (
    ("stall", ("per_stall",)),
    ("shavings", ("per_bag",)),
    ("camping", ("per_night", "per_day", "per_show")),
)
# `hookup` is the pre-108 name for the camping line, and the Lodging step still
# claims a row carrying it; no imported fee may be handed it.
_RESERVED_CODES = {"stall", "shavings", "camping", "hookup"}
# A stall line that is not *the* stall: the bill's tack stall, its early-arrival
# and late-departure nights. Those are real reservable lines, and they live on
# the Boarding Fees screen rather than in a Lodging step slot.
_NOT_THE_MAIN_LINE = re.compile(r"\b(tack|early|late|arrival|departure|extra|additional)\b", re.IGNORECASE)


def fee_codes(fees: Iterable[tuple[str, str]]) -> list[str]:
    """A `show_fees.code` for each (label, unit), unique within the show.

    The main stall, shavings and camping lines take the Lodging step's own codes
    -- what `seed_mnsphc_paint_o_rama.py` does by hand -- so that step opens on
    the rows the bill priced rather than beside them. Only a line that reads as
    the main one is given a slot: a bill whose only stall price is for early
    arrival has not priced a stall. Everything else gets the slug
    `ShowChargesEditor.codeFromLabel` makes, with a counter where two labels
    fold to one, and never one of the reserved slot codes.
    """
    fees = list(fees)
    codes: list[Optional[str]] = [None] * len(fees)
    for slot, units in _LODGING_SLOTS:
        main = next(
            (
                i
                for i, (label, unit) in enumerate(fees)
                if codes[i] is None and unit in units and not _NOT_THE_MAIN_LINE.search(label)
            ),
            None,
        )
        if main is not None:
            codes[main] = slot

    used = set(_RESERVED_CODES)
    for i, (label, _unit) in enumerate(fees):
        if codes[i] is not None:
            continue
        base = _NON_WORD.sub("_", label.strip().lower()).strip("_")[:60] or "charge"
        code, n = base, 2
        while code in used:
            code = f"{base}_{n}"
            n += 1
        used.add(code)
        codes[i] = code
    return codes  # type: ignore[return-value]


# --- Creating the show ------------------------------------------------------------


def _reject(problems: list[str]) -> None:
    if problems:
        raise HTTPException(
            422,
            {
                "msg": (
                    problems[0]
                    if len(problems) == 1
                    else f"{len(problems)} things need fixing before the show can be created."
                ),
                "problems": problems,
            },
        )


async def apply_import(
    import_id: UUID,
    body: Any,
    *,
    user_id: UUID,
    user_role: str,
    db: AsyncSession,
) -> UUID:
    """Create the reviewed show in one transaction and return its id.

    The import row is locked first, so a double press creates one show and the
    second press is told which show the first one made.
    """
    imp = (
        await db.execute(
            select(
                ShowBillImport.id,
                ShowBillImport.created_by_user_id,
                ShowBillImport.status,
                ShowBillImport.show_id,
                ShowBillImport.original_filename,
                ShowBillImport.mime_type,
                ShowBillImport.file_size,
            )
            .where(ShowBillImport.id == import_id)
            .with_for_update()
        )
    ).one_or_none()
    if imp is None or (user_role != "ADMIN" and imp.created_by_user_id != user_id):
        raise HTTPException(404, "Show bill import not found")
    if imp.show_id is not None:
        raise HTTPException(
            409,
            {"msg": "A show has already been created from this show bill.", "show_id": str(imp.show_id)},
        )
    if imp.status != STATUS_SUCCEEDED:
        raise HTTPException(409, "This show bill has not been read successfully, so there is nothing to create.")

    _reject(apply_problems(body) + fee_problems(body))

    show_type = await db.get(ShowType, body.show.show_type_id)
    if show_type is None:
        _reject(["Pick the show's breed association (or Open)."])

    problems: list[str] = []

    club_ids = [club.association_id for club in body.clubs]
    if club_ids:
        found = (
            await db.execute(
                select(Association.id).where(
                    Association.id.in_(club_ids),
                    Association.association_type == "club",
                    Association.is_active.is_(True),
                )
            )
        ).scalars().all()
        if len(set(found)) != len(set(club_ids)):
            problems.append("A sanctioning club is not an active club in the registry.")

    venue_id = None
    if body.venue is not None:
        if body.venue.venue_id is not None:
            if await db.get(Venue, body.venue.venue_id) is None:
                problems.append("The venue picked is no longer on file.")
            venue_id = body.venue.venue_id
        elif user_role not in ("ADMIN", "SHOW_MANAGER"):
            # The rule `POST /venues` already enforces, for the same reason: a
            # venue is shared by every show held there.
            problems.append(
                "Only a show manager or an admin can add a venue. Pick one from the list, "
                "or leave the venue blank and add it later."
            )

    registry_ids = [j.judge_id for j in body.judges if j.judge_id is not None]
    if registry_ids:
        found = (await db.execute(select(Judge.id).where(Judge.id.in_(registry_ids)))).scalars().all()
        if len(set(found)) != len(set(registry_ids)):
            problems.append("A judge picked from the registry is no longer on file.")

    # Same identity rule as `POST /judges` (migration 085): name + email. The
    # screen offered the registry match; a clash here means it was declined
    # without an email to tell the two people apart.
    for pick in body.judges:
        if pick.judge_id is not None:
            continue
        first, last = pick.first_name.strip(), pick.last_name.strip()
        email = (pick.email or "").strip()
        clash = (
            await db.execute(
                select(Judge.id).where(
                    func.lower(Judge.first_name) == first.lower(),
                    func.lower(Judge.last_name) == last.lower(),
                    func.lower(func.coalesce(Judge.email, "")) == email.lower(),
                )
            )
        ).first()
        if clash is not None:
            problems.append(
                f"{first} {last} is already in the judge registry. Pick them from the list, "
                "or add an email to show this is somebody else."
            )

    new_judge_assoc_ids = {aid for j in body.judges if j.judge_id is None for aid in j.association_ids}
    assoc_by_id: dict[Any, Association] = {}
    if new_judge_assoc_ids:
        assoc_rows = (
            await db.execute(select(Association).where(Association.id.in_(new_judge_assoc_ids)))
        ).scalars().all()
        assoc_by_id = {a.id: a for a in assoc_rows}
        if len(assoc_by_id) != len(new_judge_assoc_ids):
            problems.append("A judge's association is not in the registry.")
    _reject(problems)

    # --- Venue ---
    if body.venue is not None and body.venue.venue_id is None:
        venue = Venue(
            name=body.venue.name.strip(),
            address=(body.venue.address or "").strip() or None,
            city=(body.venue.city or "").strip() or None,
            state=(body.venue.state or "").strip() or None,
            created_by_user_id=user_id,
        )
        db.add(venue)
        await db.flush()
        venue_id = venue.id

    # --- The show, and the caller's staff row (as `POST /shows` does) ---
    s = body.show
    show = Show(
        name=s.name.strip(),
        venue_id=venue_id,
        show_type_id=s.show_type_id,
        start_date=s.start_date,
        end_date=s.end_date,
        entry_deadline=s.entry_deadline,
        status="DRAFT",
        apha_show_number=(s.apha_show_number or "").strip() or None,
        aqha_show_number=(s.aqha_show_number or "").strip() or None,
        apha_zone=s.apha_zone,
        shavings_ban_outside=s.shavings_ban_outside,
        requires_coggins=s.requires_coggins,
        requires_health_certificate=s.requires_health_certificate,
        health_certificate_valid_days=s.health_certificate_valid_days,
        requires_vaccination=s.requires_vaccination,
        created_by_user_id=user_id,
    )
    db.add(show)
    await db.flush()
    if user_role == "SHOW_SECRETARY":
        db.add(ShowSecretary(show_id=show.id, user_id=user_id))
    elif user_role == "SHOW_MANAGER":
        db.add(ShowManager(show_id=show.id, user_id=user_id))

    # --- Judges: registry picks as they are, new ones created with their cards ---
    for order, pick in enumerate(body.judges, start=1):
        judge_id = pick.judge_id
        if judge_id is None:
            judge = Judge(
                first_name=pick.first_name.strip(),
                last_name=pick.last_name.strip(),
                email=(pick.email or "").strip() or None,
            )
            judge.associations = [assoc_by_id[aid] for aid in dict.fromkeys(pick.association_ids)]
            db.add(judge)
            await db.flush()
            judge_id = judge.id
        db.add(ShowJudge(show_id=show.id, judge_id=judge_id, sort_order=order))

    # --- Club sanctioning ---
    for club in body.clubs:
        db.add(
            ShowSanctioning(
                show_id=show.id,
                association_id=club.association_id,
                fee_amount_cents=club.fee_amount_cents,
                fee_unit=club.fee_unit,
            )
        )
    await db.flush()

    # --- Classes: the Class Builder's own importer, a day at a time ---
    from routers.classes import _create_classes_auto_routed

    # A class code is the breed body's catalog identifier (`class_associations`
    # keys it on the show type). An Open show has no breed body to hold one
    # against, so a code printed on an Open bill is left off rather than filed
    # under OPEN, where nothing would ever read it.
    keeps_codes = show_type.code != "OPEN"
    by_day: dict[date, list[Any]] = {}
    for cls in body.classes:
        by_day.setdefault(cls.class_date, []).append(cls)
    for day in sorted(by_day):
        reviewed = by_day[day]
        items = []
        for cls in reviewed:
            discipline, score_type = resolve_discipline(cls.discipline, cls.class_name)
            items.append(
                {
                    "name": cls.class_name.strip(),
                    "bracket": (cls.bracket or "").strip() or None,
                    "association_code": (
                        (cls.association_class_code or "").strip() or None if keeps_codes else None
                    ),
                    "explicit_discipline": discipline,
                    "explicit_score_type": score_type,
                }
            )
        # Created in date order, program order within a day, so the running
        # sort order the importer assigns is already the schedule's numbering.
        created = await _create_classes_auto_routed(
            show_id=show.id,
            items=items,
            show_type_id=show.show_type_id,
            class_date=day,
            db=db,
        )
        for cls, made in zip(reviewed, created):
            made.entry_fee_cents = cls.entry_fee_cents
            made.entered_by_qualification = cls.entered_by_qualification
            for aid in dict.fromkeys(cls.club_association_ids):
                db.add(ClassSanctioning(class_id=made.id, association_id=aid))

    # --- Fees ---
    for order, (fee, code) in enumerate(zip(body.fees, fee_codes((f.label, f.unit) for f in body.fees)), start=1):
        db.add(
            ShowFee(
                show_id=show.id,
                code=code,
                label=fee.label.strip(),
                amount_cents=fee.amount_cents,
                unit=fee.unit,
                notes=(fee.notes or "").strip() or None,
                sort_order=order,
                early_amount_cents=fee.early_amount_cents,
                early_deadline=fee.early_deadline,
                min_quantity=fee.min_quantity,
            )
        )

    # --- The bill itself, on file. `showbill_source` stays 'generated':
    # switching the Show Bill button to the upload is its own deliberate press
    # in setup Step 9, exactly as it is for a bill uploaded there. ---
    if body.attach_showbill:
        file_data = (
            await db.execute(select(ShowBillImport.file_data).where(ShowBillImport.id == import_id))
        ).scalar_one()
        db.add(
            ShowDocument(
                show_id=show.id,
                document_type="SHOWBILL",
                original_filename=imp.original_filename,
                file_data=file_data,
                mime_type=imp.mime_type,
                file_size=imp.file_size,
                uploaded_by_user_id=user_id,
            )
        )

    await db.execute(
        update(ShowBillImport)
        .where(ShowBillImport.id == import_id)
        .values(
            show_id=show.id,
            accepted=body.model_dump(mode="json"),
            applied_at=datetime.now(timezone.utc),
        )
    )
    await db.commit()
    return show.id


# --- The background read -------------------------------------------------------

# Strong references to running reads. `asyncio.create_task` holds only a weak
# one, and a read garbage-collected mid-flight would leave its row pending
# until the timeout called it failed.
_running: set[asyncio.Task] = set()


def start_read(import_id: UUID) -> None:
    """Read the bill after the request that uploaded it has returned."""
    task = asyncio.create_task(_read(import_id))
    _running.add(task)
    task.add_done_callback(_running.discard)


async def _read(import_id: UUID) -> None:
    from database import AsyncSessionLocal
    from extraction.showbill import extract_showbill

    values: dict[str, Any]
    try:
        async with AsyncSessionLocal() as db:
            file = (
                await db.execute(
                    select(
                        ShowBillImport.file_data,
                        ShowBillImport.mime_type,
                        ShowBillImport.original_filename,
                    ).where(ShowBillImport.id == import_id)
                )
            ).one()
        result = await extract_showbill(file.file_data, file.mime_type, file.original_filename)
        values = {
            "status": result.status,
            "error_message": result.error_message,
            "extracted": result.fields or None,
            "model": result.model,
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
        }
    except Exception:  # noqa: BLE001 - the row must never be left pending
        logger.exception("showbill import %s: read failed", import_id)
        values = {
            "status": STATUS_FAILED,
            "error_message": "Could not read the show bill. Try again, or set the show up by hand.",
        }

    try:
        async with AsyncSessionLocal() as db:
            await db.execute(
                update(ShowBillImport)
                .where(ShowBillImport.id == import_id)
                .values(completed_at=datetime.now(timezone.utc), **values)
            )
            await db.commit()
    except Exception:  # noqa: BLE001 - nothing left to report it to
        logger.exception("showbill import %s: could not record the read", import_id)
