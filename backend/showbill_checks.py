"""A show set up from its show bill, and what is left for a person to check.

Migration 187. The show is created as a DRAFT straight from the read and the
office walks the ordinary setup steps. Every doubt about what was read -- the
reader's own, or one of the app's (a judge matched on the name alone, a club
the registry does not hold, a fee that bills everybody who enters) -- is a
`show_bill_checks` row, shown on its step and against the field it is about.

Three rules keep "the model suggests, a person decides" true now that the show
exists before anybody has looked at it:

* **A shared record is never written from the read alone.** Judges and venues
  are shared by every show that uses them, so only a confident match is
  attached (one registry judge of exactly that name, one venue of exactly that
  name), and that match is itself a check. A judge or venue the registry lacks
  is a check carrying what the bill printed, for somebody to add with the
  step's own form. A club the registry lacks is a check, never a new club.
* **A show cannot leave DRAFT while a check is open** (`routers/shows.py`), so
  nothing read off a bill reaches an exhibitor until a person has looked.
* **A check closes when it is accepted, or when its field is changed or its
  row deleted** -- decided on read here, never stored, so editing the value is
  as good as pressing Accept and an undo puts the check back.

`draft_from_read` is pure, and is what the tests exercise; the SQL is below it.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Optional
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from billing import CLUB_SANCTION_UNITS
from models import Class, ShowBillCheck, ShowFee, ShowJudge, ShowSanctioning, Show
from schemas import ShowBillImportApply

# Wizard step keys (`frontend/app/admin/shows/_wizard/steps.ts`).
BASIC = "basic"
JUDGES = "judges"
LODGING = "lodging"
CLASSES = "classes"
SANCTIONING = "sanctioning"
FUTURITIES = "futurities"
FEES = "fees"
SCORING = "judgecards"
PAPERWORK = "paperwork"

STEP_ORDER = (BASIC, JUDGES, LODGING, CLASSES, SANCTIONING, FUTURITIES, FEES, SCORING, PAPERWORK)

# The Lodging step's own rows (`showbill_import.fee_codes`).
_LODGING_CODES = {"stall", "shavings", "camping", "hookup"}

_AUTOMATIC_UNITS = {
    "per_exhibitor",
    "per_horse",
    "per_judge_per_horse",
    "per_judge_per_exhibitor",
    "per_judge_per_entry",
    "per_entry",
}
_RESERVABLE_UNITS = {"per_stall", "per_bag", "per_night", "per_day", "per_show"}

# Which show column a reader's show-level check is about, and the step that
# asks it. "breed_association" is the show type; "venue" is the venue picked.
_SHOW_CHECK_TARGETS: dict[str, tuple[str, str]] = {
    "name": ("name", BASIC),
    "start_date": ("start_date", BASIC),
    "end_date": ("end_date", BASIC),
    "entry_deadline": ("entry_deadline", BASIC),
    "breed_association": ("show_type_id", BASIC),
    "apha_show_number": ("apha_show_number", BASIC),
    "aqha_show_number": ("aqha_show_number", BASIC),
    "apha_zone": ("apha_zone", BASIC),
    "venue": ("venue_id", BASIC),
    "requires_coggins": ("requires_coggins", PAPERWORK),
    "requires_health_certificate": ("requires_health_certificate", PAPERWORK),
    "requires_vaccination": ("requires_vaccination", PAPERWORK),
    "shavings_ban_outside": ("shavings_ban_outside", LODGING),
}

_NOT_IMPORTED_STEPS = {"futurity": FUTURITIES, "side_pot": FUTURITIES, "high_point": SCORING}

# The columns a check may watch, per target. Anything else is accepted-only:
# a check with no field closes when somebody presses Accept (or the row goes).
WATCHED_FIELDS: dict[str, set[str]] = {
    "show": {
        "name", "start_date", "end_date", "entry_deadline", "show_type_id", "venue_id",
        "apha_show_number", "aqha_show_number", "apha_zone", "requires_coggins",
        "requires_health_certificate", "health_certificate_valid_days", "requires_vaccination",
        "shavings_ban_outside",
    },
    "class": {"class_name", "class_date", "entry_fee_cents"},
    "fee": {"label", "amount_cents", "unit"},
    "sanctioning": {"fee_amount_cents", "fee_unit"},
    "judge": set(),
}


@dataclass
class CheckSpec:
    """A check before the show exists.

    `target` is how to find the record once it does: `("show",)`, a payload
    index for a class or fee (`("class", 12)`), or an id already known for a
    registry judge or a club (`("judge", <uuid>)`). None is about the step.
    """
    step: str
    message: str
    source: str  # 'bill' (the reader said so) or 'app' (the app's own check)
    target: Optional[tuple] = None
    field: Optional[str] = None
    value: Any = None
    action: Optional[dict] = None


@dataclass
class Draft:
    payload: ShowBillImportApply
    checks: list[CheckSpec] = dc_field(default_factory=list)


def _jsonable(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    return value


def _money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def _names(items: list[str], limit: int = 5) -> str:
    shown = ", ".join(items[:limit])
    return shown + (f" and {len(items) - limit} more" if len(items) > limit else "")


def _day(d: date) -> str:
    return f"{d.strftime('%a %b')} {d.day}"


def _cut(value: Optional[str], limit: int) -> Optional[str]:
    """Text held to the payload's limits. A bill is printed for people, and a
    sentence of notes longer than the column refuses the whole show."""
    if not value:
        return None
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def _class_label(cls: dict[str, Any]) -> str:
    """The class as the bill printed it -- its printed number, which the app
    does not keep (it numbers 1..N), is how the reviewer finds it on paper."""
    number = cls.get("number")
    return f"{cls['name']} (bill #{number})" if number else cls["name"]


def per_judge_count(rate: dict[str, Any], bill_judges: list[dict[str, Any]]) -> int:
    """How many of the bill's judges a per-judge rate is multiplied by.

    The rule billing uses for a per-judge fee (`billing.carded_judge_count`),
    on the cards the bill prints beside each judge: the judges carded with the
    rate's association, or the whole panel when none is, or when the rate names
    no association. The panel is the bill's rather than the registry's because
    the class prices are worked out before anybody has picked a judge -- which
    is why every rate is a check that says what it was multiplied by.
    """
    code = (rate.get("association_code") or "").upper()
    if code:
        carded = [j for j in bill_judges if code in {c.upper() for c in j.get("associations") or []}]
        if carded:
            return len(carded)
    return len(bill_judges)


def draft_from_read(
    extracted: dict[str, Any],
    resolved: dict[str, Any],
    *,
    name: str,
    show_type_id: UUID,
    start_date: date,
    end_date: date,
    attach_showbill: bool,
    registry_judges: dict[Any, Any],
    venues: dict[Any, Any],
    clubs: dict[Any, Any],
) -> Draft:
    """The payload `apply_import` creates the show from, and its checks.

    The four values a show row cannot exist without -- name, type, dates -- are
    the person's, from the page before; everything else is the read, made safe
    to create (a value that would be refused is left off and becomes a check)
    with every doubt written down.

    `registry_judges`, `venues` and `clubs` are id -> row, for the messages:
    a check that says "matched to Jane Smith (jane@example.com)" is one somebody
    can answer without opening the registry.
    """
    from routers.show_fees import _assert_early_rate_valid, _assert_min_quantity_valid
    from fastapi import HTTPException
    from showbill_import import fee_codes

    show_x = extracted.get("show") or {}
    checks: list[CheckSpec] = []

    def check(step: str, message: str, source: str = "app", **kw: Any) -> None:
        checks.append(CheckSpec(step=step, message=message, source=source, **kw))

    # --- The show row ---
    entry_deadline = _as_date(show_x.get("entry_deadline"))
    if entry_deadline and entry_deadline > start_date:
        check(
            BASIC,
            f"The bill's entry deadline ({entry_deadline.isoformat()}) is after the show starts, which "
            "the app does not allow, so it was left blank. Set the last day to sign up online.",
            target=("show",),
            field="entry_deadline",
        )
        entry_deadline = None
    cvi_days = show_x.get("health_certificate_valid_days") or 30
    show = {
        "name": _cut(name.strip(), 200),
        "show_type_id": show_type_id,
        "start_date": start_date,
        "end_date": end_date,
        "entry_deadline": entry_deadline,
        "apha_show_number": _cut(show_x.get("apha_show_number"), 50),
        "aqha_show_number": _cut(show_x.get("aqha_show_number"), 50),
        "apha_zone": show_x.get("apha_zone"),
        "shavings_ban_outside": bool(show_x.get("shavings_ban_outside")),
        # A bill that says nothing about a Coggins is not saying "no": the
        # column's own default, and every show's, is that one is required.
        "requires_coggins": show_x.get("requires_coggins") is not False,
        "requires_health_certificate": bool(show_x.get("requires_health_certificate")),
        "health_certificate_valid_days": cvi_days if 1 <= cvi_days <= 365 else 30,
        "requires_vaccination": bool(show_x.get("requires_vaccination")),
    }

    for c in extracted.get("show_checks") or []:
        column, step = _SHOW_CHECK_TARGETS[c["field"]]
        check(step, c["message"], "bill", target=("show",), field=column)

    # Health papers the bill never mentions are the app's defaults, and saying
    # so is the point: "required" on a show whose bill was silent is a decision
    # the office should know it is making.
    paper_defaults = (
        ("requires_coggins", "a negative Coggins", "it is required, as on every show"),
        ("requires_health_certificate", "a health certificate", "it is not required"),
        ("requires_vaccination", "proof of vaccination", "it is not required"),
    )
    for column, paper, default in paper_defaults:
        if show_x.get(column) is None:
            check(
                PAPERWORK,
                f"The bill doesn't mention {paper}, so {default}. Check that is what the show asks for.",
                target=("show",),
                field=column,
            )

    # --- Venue: attached only on an exact match, never created ---
    venue = None
    printed_venue = ", ".join(
        p for p in (show_x.get("venue_name"), show_x.get("venue_city"), show_x.get("venue_state")) if p
    )
    venue_id = resolved.get("venue_id")
    if venue_id:
        venue = {"venue_id": venue_id}
        row = venues.get(venue_id) or venues.get(str(venue_id))
        on_file = ", ".join(p for p in (getattr(row, "name", None), getattr(row, "city", None), getattr(row, "state", None)) if p)
        bill_city = (show_x.get("venue_city") or "").strip().lower()
        file_city = (getattr(row, "city", None) or "").strip().lower()
        if bill_city and bill_city != file_city:
            check(
                BASIC,
                f"The bill's venue, {printed_venue}, was matched to {on_file or 'a venue on file'} by its "
                "name. The cities differ: check it is the same place.",
                target=("show",),
                field="venue_id",
            )
    elif show_x.get("venue_name"):
        check(
            BASIC,
            f"The bill names the venue {printed_venue}, which isn't on file. Pick it from the list, "
            "or add it as a new venue.",
            target=("show",),
            field="venue_id",
            action={
                "kind": "add_venue",
                "name": show_x.get("venue_name"),
                "address": show_x.get("venue_address"),
                "city": show_x.get("venue_city"),
                "state": show_x.get("venue_state"),
            },
        )

    staff = show_x.get("staff") or []
    if staff:
        check(
            BASIC,
            "The bill names these show officials: "
            + _names([f"{s['name']} ({s['role']})" if s.get("role") else s["name"] for s in staff], 8)
            + ". Add the ones who work the show under Show Staff. The app doesn't create logins "
            "from a show bill.",
        )

    # --- Judges: a single exact match is attached, and still checked ---
    bill_judges = extracted.get("judges") or []
    judges_payload: list[dict[str, Any]] = []
    resolved_judges = resolved.get("judges") or []
    for i, j in enumerate(bill_judges):
        match = resolved_judges[i] if i < len(resolved_judges) else {}
        printed = " · ".join(
            p for p in (f"{j['first_name']} {j['last_name']}", j.get("location"), "/".join(j.get("associations") or [])) if p
        )
        suffix = f" The bill: {j['check']}" if j.get("check") else ""
        suggested = match.get("suggested_judge_id")
        if suggested:
            judges_payload.append({"judge_id": suggested})
            row = registry_judges.get(suggested) or registry_judges.get(str(suggested))
            on_file = (
                f"{row.first_name} {row.last_name}" + (f" ({row.email})" if getattr(row, "email", None) else "")
                if row is not None
                else "a judge on file"
            )
            check(
                JUDGES,
                f"{printed} was matched to {on_file} on the name alone. Check it is the same person; "
                f"if not, remove them and add the right judge.{suffix}",
                "bill" if suffix else "app",
                target=("judge", suggested),
            )
            continue
        candidates = match.get("candidate_judge_ids") or []
        if candidates:
            lead = (
                f"The bill names {printed}. {len(candidates)} judge{'s' if len(candidates) != 1 else ''} "
                "with that last name are on file and the app can't tell which, if any, it is. Pick them "
                "below, or add a new judge."
            )
        else:
            lead = f"The bill names {printed}, who isn't in the judge registry. Add them below."
        check(
            JUDGES,
            lead + suffix,
            "bill" if suffix else "app",
            action={
                "kind": "add_judge",
                "first_name": j["first_name"],
                "last_name": j["last_name"],
                "association_ids": [str(a) for a in match.get("association_ids") or []],
                "candidate_ids": [str(c) for c in candidates],
            },
        )

    # --- Clubs: registry clubs only ---
    clubs_payload: list[dict[str, Any]] = []
    extracted_classes = extracted.get("classes") or []
    resolved_classes = resolved.get("classes") or []
    resolved_clubs = resolved.get("clubs") or []
    for i, c in enumerate(extracted.get("clubs") or []):
        match = resolved_clubs[i] if i < len(resolved_clubs) else {}
        if match.get("is_breed_association"):
            continue
        aid = match.get("association_id")
        code = c["code"]
        if aid is None:
            marked = [
                _class_label(cls)
                for cls, r in zip(extracted_classes, resolved_classes)
                if code.upper() in {u.upper() for u in r.get("unknown_club_codes") or []}
            ]
            what = f"{code}" + (f" ({c['name']})" if c.get("name") else "")
            check(
                SANCTIONING,
                f"The bill lists {what}, which isn't a club in the registry"
                + (f", and marks {len(marked)} classes for it ({_names(marked)})" if marked else "")
                + ". Ask a GaitDesk admin to add the club, or request it below, then mark its classes here.",
                "app",
            )
            continue
        unit = c.get("fee_unit") if c.get("fee_unit") in CLUB_SANCTION_UNITS else "per_entry"
        cents = c.get("fee_amount_cents") or 0
        clubs_payload.append({"association_id": aid, "fee_amount_cents": cents, "fee_unit": unit})
        row = clubs.get(aid) or clubs.get(str(aid))
        label = getattr(row, "code", None) or code
        if cents:
            printed = f" from “{c['fee_text']}”" if c.get("fee_text") else ""
            check(
                SANCTIONING,
                f"{label}'s club fee was read as {_money(cents)}, {unit.replace('_', ' ')}{printed}. "
                "Check the amount and how it is charged.",
                target=("sanctioning", aid),
                field="fee_amount_cents",
                value=cents,
            )
        if c.get("check"):
            check(SANCTIONING, f"{label}: {c['check']}", "bill", target=("sanctioning", aid))
    sanctioned = {c["association_id"] for c in clubs_payload}

    # --- Classes, priced from the bill's rates over the bill's judges ---
    rates = {r["key"]: r for r in extracted.get("class_rates") or []}
    rate_totals: dict[str, int] = {}
    for key, r in rates.items():
        n = per_judge_count(r, bill_judges)
        rate_totals[key] = r["amount_cents"] * n if r["per_judge"] else r["amount_cents"]

    # A start date moved on the page before (the year the reader guessed, say)
    # moves the schedule with it, day for day, rather than stranding every class.
    bill_start = _as_date(show_x.get("start_date"))
    shift = (start_date - bill_start) if bill_start and bill_start != start_date else timedelta(0)

    classes_payload: list[dict[str, Any]] = []
    class_checks: list[tuple[int, CheckSpec]] = []
    seen: dict[tuple[date, str], str] = {}
    priced_by: dict[str, list[str]] = {}
    unpriced: list[str] = []
    futurity: list[str] = []
    for i, cls in enumerate(extracted_classes):
        routed = resolved_classes[i] if i < len(resolved_classes) else {}
        label = _class_label(cls)
        day = _as_date(cls.get("date"))
        day = day + shift if day else None
        moved = None
        if day is None:
            moved = "Its day couldn't be read off the bill"
        elif not (start_date <= day <= end_date):
            moved = f"The bill puts it on {day.isoformat()}, outside the show's dates"
        if moved:
            day = start_date
        key = (day, " ".join(cls["name"].lower().split()))
        if key in seen:
            check(
                CLASSES,
                f"The bill lists {cls['name']} twice on {_day(day)}. A show runs one class of a name a day, "
                "so only the first was created. Add the other under a different name if the show really "
                "runs it twice.",
                "app",
            )
            continue
        seen[key] = cls["name"]
        index = len(classes_payload)
        rate_key = None if cls.get("is_futurity") or cls.get("is_championship") else cls.get("rate_key")
        cents = rate_totals.get(rate_key, 0) if rate_key else 0
        if cls.get("is_futurity"):
            futurity.append(label)
        elif rate_key:
            priced_by.setdefault(rate_key, []).append(label)
        elif not cls.get("is_championship") and not (routed.get("entered_by_qualification")):
            unpriced.append(label)
        classes_payload.append(
            {
                "class_date": day,
                "class_name": _cut(cls["name"], 200),
                "discipline": _cut(routed.get("discipline") or cls.get("discipline"), 100),
                "bracket": _cut(cls.get("bracket"), 100),
                "association_class_code": _cut(cls.get("association_class_code"), 50),
                "entry_fee_cents": cents,
                "club_association_ids": [a for a in routed.get("club_association_ids") or [] if a in sanctioned],
                "entered_by_qualification": bool(
                    routed.get("entered_by_qualification", cls.get("is_championship"))
                ),
            }
        )
        if moved:
            class_checks.append(
                (
                    index,
                    CheckSpec(
                        step=CLASSES,
                        message=f"{label}: {moved}, so it was put on the first day. Move it to the day it runs.",
                        source="app",
                        target=("class", index),
                        field="class_date",
                        value=day.isoformat(),
                    ),
                )
            )
        if cls.get("note"):
            class_checks.append(
                (
                    index,
                    CheckSpec(
                        step=CLASSES,
                        message=f"{label}: {cls['note']}",
                        source="bill",
                        target=("class", index),
                    ),
                )
            )
    checks.extend(spec for _i, spec in class_checks)

    # --- Class prices: one check per rate, since one rate prices many classes ---
    entry_fees = {"kind": "link", "label": "Open Entry Fees", "href": "fees/entry"}
    for key, r in rates.items():
        covered = priced_by.get(key) or []
        if not covered:
            continue
        total = rate_totals[key]
        printed = f"“{r['printed_text']}”" if r.get("printed_text") else r["label"]
        if r["per_judge"]:
            n = per_judge_count(r, bill_judges)
            carded = r.get("association_code") if r.get("association_code") and n != len(bill_judges) else None
            who = f"{n} {carded + ' ' if carded else ''}judge{'s' if n != 1 else ''}"
            how = f"{_money(r['amount_cents'])} × {who} named on the bill = {_money(total)}"
            tail = " If the panel changes, these prices don't follow it: change them on Entry Fees."
            if not bill_judges:
                tail = " The bill names no judges, so they came to $0: price them on Entry Fees."
        else:
            how = _money(total)
            tail = ""
        message = (
            f"{len(covered)} class{'es' if len(covered) != 1 else ''} priced at {how} from the bill's {printed}: "
            f"{_names(covered)}.{tail}"
        )
        if r.get("check"):
            message += f" The bill: {r['check']}"
        check(FEES, message, "bill" if r.get("check") else "app", action=entry_fees)
    if unpriced:
        check(
            FEES,
            f"{len(unpriced)} class{'es have' if len(unpriced) != 1 else ' has'} no price on the bill and "
            f"{'were' if len(unpriced) != 1 else 'was'} created at $0: {_names(unpriced)}. Price "
            f"{'them' if len(unpriced) != 1 else 'it'} on Entry Fees, or leave the class free.",
            action=entry_fees,
        )
    if futurity:
        check(
            FUTURITIES,
            f"The bill marks {len(futurity)} class{'es' if len(futurity) != 1 else ''} as part of a futurity "
            f"({_names(futurity)}). They were created at $0, since the futurity prices them. Set the futurity "
            "up here and add those classes to it.",
        )

    # --- Fees ---
    fees_payload: list[dict[str, Any]] = []
    fee_checks: list[tuple[int, str, CheckSpec]] = []
    for f in extracted.get("fees") or []:
        index = len(fees_payload)
        early_cents, early_deadline = f.get("early_amount_cents"), _as_date(f.get("early_deadline"))
        minimum = f.get("min_quantity") or 0
        notes: list[str] = []
        try:
            _assert_early_rate_valid(
                unit=f["unit"], amount_cents=f["amount_cents"],
                early_amount_cents=early_cents, early_deadline=early_deadline,
            )
        except HTTPException as exc:
            notes.append(f"The bill's early rate was left off ({exc.detail})")
            early_cents = early_deadline = None
        try:
            _assert_min_quantity_valid(unit=f["unit"], min_quantity=minimum)
        except HTTPException as exc:
            notes.append(f"The minimum was left off ({exc.detail})")
            minimum = 0
        fees_payload.append(
            {
                "label": _cut(f["label"], 200),
                "amount_cents": f["amount_cents"],
                "unit": f["unit"],
                "notes": _cut(f.get("notes"), 500),
                "early_amount_cents": early_cents,
                "early_deadline": early_deadline,
                "min_quantity": minimum,
            }
        )
        what = f"{f['label']} ({_money(f['amount_cents'])} {f['unit'].replace('_', ' ')})"
        if f["unit"] == "per_entry":
            fee_checks.append((index, "unit", CheckSpec(
                step=FEES,
                message=f"{what} is added to every class entered, on top of the class's own price. Check it "
                "isn't a class price: a class price belongs on the class.",
                source="app", target=("fee", index), field="unit", value=f["unit"],
            )))
        elif f["unit"] in _AUTOMATIC_UNITS:
            fee_checks.append((index, "unit", CheckSpec(
                step=FEES,
                message=f"{what} is charged to every exhibitor who enters a class. Check it applies to "
                "everyone; a fee only some people pay is printed (flat) or booked at sign-up.",
                source="app", target=("fee", index), field="unit", value=f["unit"],
            )))
        for note in notes:
            fee_checks.append((index, "", CheckSpec(
                step=FEES, message=f"{f['label']}: {note}.", source="app", target=("fee", index),
            )))
        if f.get("check"):
            fee_checks.append((index, "", CheckSpec(
                step=FEES, message=f"{f['label']}: {f['check']}", source="bill", target=("fee", index),
            )))

    # The main stall / shavings / camping lines are the Lodging step's rows, so
    # their checks are shown there; another booked line is edited on Boarding
    # Fees, which the check links to.
    codes = fee_codes((f["label"], f["unit"]) for f in fees_payload)
    for index, _field, spec in fee_checks:
        if codes[index] in _LODGING_CODES:
            spec.step = LODGING
        elif fees_payload[index]["unit"] in _RESERVABLE_UNITS:
            spec.step = LODGING
            spec.action = {"kind": "link", "label": "Open Boarding Fees", "href": "fees/boarding"}
        checks.append(spec)

    # --- What the bill says that has no place in setup yet ---
    for line in extracted.get("not_imported") or []:
        if isinstance(line, str):
            line = {"topic": "other", "text": line}
        check(
            _NOT_IMPORTED_STEPS.get(line.get("topic"), BASIC),
            f"On the bill but not set up from it: {line['text']}",
            "bill",
        )
    for w in extracted.get("warnings") or []:
        check(BASIC, f"About the whole bill: {w}", "bill")

    # A check on a show column watches the value the show is created with, so
    # it closes the moment somebody changes it -- and only then.
    created = {**show, "venue_id": venue["venue_id"] if venue else None}
    for spec in checks:
        if spec.target == ("show",) and spec.field:
            spec.value = created.get(spec.field)

    payload = ShowBillImportApply.model_validate(
        {
            "show": show,
            "venue": venue,
            "judges": judges_payload,
            "clubs": clubs_payload,
            "classes": classes_payload,
            "fees": fees_payload,
            "attach_showbill": attach_showbill,
        }
    )
    checks.sort(key=lambda c: STEP_ORDER.index(c.step) if c.step in STEP_ORDER else len(STEP_ORDER))
    return Draft(payload=payload, checks=checks)


def _as_date(value: Any) -> Optional[date]:
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


# --- Whether a check is still open -------------------------------------------

_MISSING = object()


def check_state(accepted_at: Optional[datetime], field: Optional[str], value: Any, current: Any) -> str:
    """`accepted`, `removed`, `changed` or `open`.

    `current` is the watched column as it is now, or `_MISSING` when the row
    has gone. A check that watches no column closes only on Accept, or with its
    row. Pure, so it is what the tests pin.
    """
    if accepted_at is not None:
        return "accepted"
    if current is _MISSING:
        return "removed"
    if field is not None and _jsonable(current) != value:
        return "changed"
    return "open"


async def _current_values(db: AsyncSession, show_id: UUID, rows: list[Any]) -> dict[Any, Any]:
    """check id -> the watched column as it is now, `_MISSING` when its row is
    gone, or None for a check about no record.

    Columns by name, never whole rows: `Show` and `Class` load relationships
    eagerly, and this runs on every setup page of a show set up from its bill.
    """
    wanted: dict[str, set[Any]] = {}
    fields: dict[str, set[str]] = {}
    for r in rows:
        if r.target_type:
            wanted.setdefault(r.target_type, set()).add(r.target_id)
            if r.field and r.field in WATCHED_FIELDS.get(r.target_type, set()):
                fields.setdefault(r.target_type, set()).add(r.field)

    found: dict[tuple[str, Any], dict[str, Any]] = {}

    async def read(kind: str, model: Any, key: Any, *where: Any) -> None:
        cols = sorted(fields.get(kind, set()))
        stmt = select(key, *(getattr(model, c) for c in cols)).where(*where)
        for row in (await db.execute(stmt)).all():
            found[(kind, row[0])] = dict(zip(cols, row[1:]))

    if "show" in wanted:
        await read("show", Show, Show.id, Show.id == show_id)
    if "class" in wanted:
        await read("class", Class, Class.id, Class.show_id == show_id, Class.id.in_(wanted["class"]))
    if "fee" in wanted:
        await read("fee", ShowFee, ShowFee.id, ShowFee.show_id == show_id, ShowFee.id.in_(wanted["fee"]))
    if "judge" in wanted:
        await read(
            "judge", ShowJudge, ShowJudge.judge_id,
            ShowJudge.show_id == show_id, ShowJudge.judge_id.in_(wanted["judge"]),
        )
    if "sanctioning" in wanted:
        await read(
            "sanctioning", ShowSanctioning, ShowSanctioning.association_id,
            ShowSanctioning.show_id == show_id, ShowSanctioning.association_id.in_(wanted["sanctioning"]),
        )

    out: dict[Any, Any] = {}
    for r in rows:
        if not r.target_type:
            out[r.id] = None
            continue
        record = found.get((r.target_type, r.target_id), _MISSING)
        if record is _MISSING:
            out[r.id] = _MISSING
        elif r.field is None or r.field not in WATCHED_FIELDS.get(r.target_type, set()):
            # A field nothing watches closes only on Accept, like no field.
            out[r.id] = record
        else:
            out[r.id] = record[r.field]
    return out


async def load_checks(db: AsyncSession, show_id: UUID) -> list[dict[str, Any]]:
    """Every check on the show, in step order, with its state."""
    rows = (
        await db.execute(
            select(ShowBillCheck).where(ShowBillCheck.show_id == show_id).order_by(ShowBillCheck.sort_order)
        )
    ).scalars().all()
    if not rows:
        return []
    current = await _current_values(db, show_id, rows)
    return [
        {
            "id": r.id,
            "step": r.step,
            "target_type": r.target_type,
            "target_id": r.target_id,
            "field": r.field,
            "message": r.message,
            "source": r.source,
            "action": r.action,
            "state": check_state(
                r.accepted_at,
                r.field if r.field in WATCHED_FIELDS.get(r.target_type or "", set()) else None,
                r.value,
                current[r.id],
            ),
            "accepted_at": r.accepted_at,
        }
        for r in rows
    ]


async def open_check_count(db: AsyncSession, show_id: UUID) -> int:
    return sum(1 for c in await load_checks(db, show_id) if c["state"] == "open")


async def set_accepted(db: AsyncSession, show_id: UUID, check_id: UUID, user_id: Optional[UUID], accepted: bool) -> bool:
    result = await db.execute(
        update(ShowBillCheck)
        .where(ShowBillCheck.id == check_id, ShowBillCheck.show_id == show_id)
        .values(
            accepted_at=datetime.now(timezone.utc) if accepted else None,
            accepted_by_user_id=user_id if accepted else None,
        )
    )
    await db.commit()
    return result.rowcount > 0


def check_rows(
    specs: Iterable[CheckSpec],
    *,
    show_id: UUID,
    import_id: UUID,
    class_ids: list[UUID],
    fee_ids: list[UUID],
) -> list[ShowBillCheck]:
    """The specs as rows, each target found among what was just created."""
    out = []
    for order, spec in enumerate(specs):
        target_type = target_id = None
        if spec.target:
            target_type = spec.target[0]
            if target_type == "show":
                target_id = show_id
            elif target_type == "class":
                target_id = class_ids[spec.target[1]]
            elif target_type == "fee":
                target_id = fee_ids[spec.target[1]]
            else:
                target_id = spec.target[1]
        out.append(
            ShowBillCheck(
                show_id=show_id,
                import_id=import_id,
                step=spec.step,
                target_type=target_type,
                target_id=target_id,
                field=spec.field,
                value=_jsonable(spec.value),
                message=spec.message,
                source=spec.source,
                action=spec.action,
                sort_order=order,
            )
        )
    return out
