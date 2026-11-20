"""A show set up from its show bill: the draft the read becomes, and its notes.

The show is created as a DRAFT straight from the read, filled in as far as the
bill allows -- the show, its judges and venue (as the person on the confirm
page settled them), club sanctioning, the class schedule with its prices, the
fee catalogue, every futurity and side pot the bill runs. Nothing waits on an
Accept, and nothing is listed for the office to check: the office walks the
setup steps and fixes what is wrong there. The read also drafts two notes:

* **Office notes** (`shows.office_notes`): what the bill told the office that
  no field holds (its officials, its procedures).
* **Show notes** (`shows.public_notes`): what the bill tells exhibitors that no
  field holds -- awards, sponsors, the refund policy, grounds rules.

Both are drafted here and shown on the confirm page, where the person edits,
downloads or clears them; what they leave is what the show gets.

**What still needs a person** is the one thing a read cannot settle: who a
name on the bill *is*. Judges and venues are shared by every show, so the
confirm page attaches only an exact registry match on its own, and for
anything else the person searches the directory, or adds the judge (with an
email or a phone, which is what tells two people of one name apart) or the
venue (with its full address). See `ShowBillImportStart`.

`draft_from_read` is pure, and is what the tests exercise.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from datetime import date, time, timedelta
from typing import Any, Optional
from uuid import UUID

from billing import CLUB_SANCTION_UNITS

# The setup topic an older read's `not_imported` line was about, as the office
# notes name it.
_LEGACY_TOPIC_SECTIONS = {"futurity": "Futurities & Side Pots", "side_pot": "Futurities & Side Pots", "high_point": "Scoring"}

# `shows.office_notes` as `ShowUpdate` takes it.
OFFICE_NOTES_MAX = 20000
PUBLIC_NOTES_MAX = 5000

# What a side pot costs when the bill prices it at nothing it printed --
# `SidePotCreate`'s own default.
DEFAULT_SIDE_POT_FEE_CENTS = 1000
# A time pot's D lines when the bill names its Ds but not how far apart they
# are: half a second, the common barrel split.
DEFAULT_D_SPLIT_MS = 500


@dataclass
class Draft:
    """Everything `apply_import` creates, as plain dicts."""
    show: dict[str, Any]
    venue: Optional[dict[str, Any]]
    judges: list[dict[str, Any]]
    clubs: list[dict[str, Any]]
    classes: list[dict[str, Any]]
    fees: list[dict[str, Any]]
    futurities: list[dict[str, Any]]
    side_pots: list[dict[str, Any]]
    # The stall periods the bill sells stalls for, with their prices.
    stall_periods: list[dict[str, Any]] = dc_field(default_factory=list)

    def payload(self, *, attach_showbill: bool, public_notes: Optional[str], office_notes: Optional[str]) -> dict:
        return {
            "show": {**self.show, "public_notes": public_notes, "office_notes": office_notes},
            "venue": self.venue,
            "judges": self.judges,
            "clubs": self.clubs,
            "classes": self.classes,
            "fees": self.fees,
            "futurities": self.futurities,
            "side_pots": self.side_pots,
            "attach_showbill": attach_showbill,
            "stall_periods": self.stall_periods,
        }


def _cut(value: Optional[str], limit: int) -> Optional[str]:
    """Text held to the payload's limits. A bill is printed for people, and a
    sentence of notes longer than the column refuses the whole show."""
    if not value:
        return None
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


# The Lodging step's own default for a period's move-in: the day before the
# show, at noon (`defaultMoveIn`, `lib/default-time.ts`).
_NOON = time(12, 0)
# A stalls-open day further from the show than this is a misread, not a plan.
_MOVE_IN_REACH = timedelta(days=14)


def _as_time(value: Any) -> Optional[time]:
    if isinstance(value, str) and value:
        try:
            return time.fromisoformat(value)
        except ValueError:
            return None
    return None


def _fit_period(
    move_in: Optional[date],
    in_time: Optional[time],
    move_out: Optional[date],
    out_time: Optional[time],
    start_date: date,
    end_date: date,
) -> tuple[date, Optional[time], date, Optional[time]]:
    """A period's move-in and move-out, the Lodging step's own default where the
    bill gives none or one too far from the show to be right."""
    if move_in is None or not (start_date - _MOVE_IN_REACH <= move_in <= end_date):
        move_in, in_time = start_date - timedelta(days=1), _NOON
    if move_out is None or not (max(move_in, start_date) <= move_out <= end_date + timedelta(days=2)):
        move_out, out_time = end_date, None
    return move_in, in_time, move_out, out_time


def _shifted(value: Any, shift: timedelta) -> Optional[date]:
    day = _as_date(value)
    return day + shift if day else None


def _stall_periods(
    extracted: dict[str, Any], start_date: date, end_date: date, shift: timedelta
) -> list[dict[str, Any]]:
    """The show's stall periods as the bill sells them, each with its box, tie
    and tack prices and its own Early Move-In Pass -- what the Lodging step's
    *Stalls & move-in* card sets, so the step opens on them rather than on one
    period with the rest under *Other charges per stall*.

    The rules every period shares (`show.stall_notes`) open the first period's
    move-in notes: Show Details prints every period's notes together, so one
    copy is read by everybody, where a copy on each would print three times.
    Moves with the schedule when the first day is moved."""
    show_x = extracted.get("show") or {}
    read = extracted.get("stall_periods")
    if read is None:
        # A read made before 2026-11-18, which gave one move-in for the show.
        read = []
        if show_x.get("stall_notes") or show_x.get("stalls_move_in_date"):
            read = [
                {
                    "name": "Full show",
                    "move_in_date": show_x.get("stalls_move_in_date"),
                    "move_in_time": show_x.get("stalls_move_in_time"),
                    "move_out_date": show_x.get("stalls_move_out_date"),
                    "move_out_time": show_x.get("stalls_move_out_time"),
                    "stalls": [],
                }
            ]
    shared = show_x.get("stall_notes")
    if not read and shared:
        read = [{"name": "Full show", "stalls": []}]

    periods: list[dict[str, Any]] = []
    for index, p in enumerate(read):
        name = p["name"]
        move_in, in_time, move_out, out_time = _fit_period(
            _shifted(p.get("move_in_date"), shift),
            _as_time(p.get("move_in_time")),
            _shifted(p.get("move_out_date"), shift),
            _as_time(p.get("move_out_time")),
            start_date,
            end_date,
        )
        notes = "\n\n".join(n for n in ((shared if index == 0 else None), p.get("move_in_notes")) if n) or None

        reserve_by = _as_date(p.get("reserve_by"))
        stalls = [
            {
                "kind": st["kind"],
                "amount_cents": st["amount_cents"],
                "early_amount_cents": st.get("early_amount_cents") if reserve_by else None,
                "early_deadline": reserve_by if st.get("early_amount_cents") else None,
                "horses_per_tack_stall": st.get("horses_per_tack_stall"),
                "notes": _cut(st.get("notes"), 500),
            }
            for st in p.get("stalls") or []
        ]

        early_pass = None
        ps = p.get("early_move_in_pass")
        if ps:
            pass_in = _shifted(ps.get("move_in_date"), shift)
            pass_time = _as_time(ps.get("move_in_time")) if pass_in else None
            # Not before the period's own move-in: left for the office to set.
            if pass_in and not (move_in - _MOVE_IN_REACH <= pass_in <= move_in):
                pass_in = pass_time = None
            pass_end = _shifted(ps.get("move_in_end_date"), shift) if pass_in else None
            end_time = _as_time(ps.get("move_in_end_time")) if pass_end else None
            if pass_end and (
                pass_end < pass_in
                or pass_end > move_out
                or (pass_end == pass_in and pass_time and end_time and end_time <= pass_time)
            ):
                pass_end = end_time = None
            early_pass = {
                "label": _cut(ps.get("label"), 200),
                "amount_cents": ps["amount_cents"],
                "move_in_date": pass_in,
                "move_in_time": pass_time,
                "move_in_end_date": pass_end,
                "move_in_end_time": end_time,
                "one_per_exhibitor": bool(ps.get("per_exhibitor")),
                "notes": _cut(ps.get("notes"), 500),
            }

        periods.append(
            {
                "name": name,
                "move_in_date": move_in,
                "move_in_time": in_time,
                "move_out_date": move_out,
                "move_out_time": out_time,
                "move_out_note": _cut(p.get("move_out_note"), 200),
                "move_in_notes": _cut(notes, 2000),
                "stalls": stalls,
                "early_move_in_pass": early_pass,
            }
        )
    return periods


def _as_date(value: Any) -> Optional[date]:
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def _first_set(*values: Optional[int]) -> int:
    return next((v for v in values if v is not None), 0)


def per_judge_count(rate: dict[str, Any], bill_judges: list[dict[str, Any]]) -> int:
    """How many of the panel a per-judge rate is multiplied by.

    The rule billing uses for a per-judge fee (`billing.carded_judge_count`),
    on the cards the bill prints beside each judge: the judges carded with the
    rate's association, or the whole panel when none is, or when the rate names
    no association. The panel is the bill's judges the confirm page kept --
    worked out before the show exists, so a price does not follow a panel
    changed later.
    """
    code = (rate.get("association_code") or "").upper()
    if code:
        carded = [j for j in bill_judges if code in {c.upper() for c in j.get("associations") or []}]
        if carded:
            return len(carded)
    return len(bill_judges)


def default_judge_choices(resolved: dict[str, Any], count: int) -> list[dict[str, Any]]:
    """The confirm page's starting choice for each judge the bill names: the
    registry judge of exactly that name where there is one, nothing otherwise."""
    rows = resolved.get("judges") or []
    out = []
    for i in range(count):
        suggested = (rows[i] if i < len(rows) else {}).get("suggested_judge_id")
        out.append({"judge_id": suggested} if suggested else {})
    return out


def draft_from_read(
    extracted: dict[str, Any],
    resolved: dict[str, Any],
    *,
    name: str,
    show_type_id: Optional[UUID],
    start_date: date,
    end_date: date,
    judge_choices: list[dict[str, Any]],
    venue_choice: Optional[dict[str, Any]],
) -> Draft:
    """The show a read becomes.

    `judge_choices` is one per judge the bill names, in order: `{"judge_id"}`
    for a registry judge, `{"new": {...}}` for one to add, `{"leave_off": True}`,
    or `{}` -- not settled yet, which the confirm page's preview allows and the
    create refuses before it gets here. `venue_choice` is `{"venue_id"}`,
    `{"new": {...}}` or None.
    """
    from routers.show_fees import _assert_early_rate_valid, _assert_min_quantity_valid
    from fastapi import HTTPException

    show_x = extracted.get("show") or {}

    # --- The show row ---
    entry_deadline = _as_date(show_x.get("entry_deadline"))
    # After the show starts is not allowed: left blank for the office to set.
    if entry_deadline and entry_deadline > start_date:
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
        "vaccination_notes": _cut(show_x.get("vaccination_notes"), 2000),
    }

    # --- Venue: as the confirm page settled it ---
    venue = None
    if venue_choice and venue_choice.get("venue_id"):
        venue = {"venue_id": venue_choice["venue_id"]}
    elif venue_choice and venue_choice.get("new"):
        venue = {**venue_choice["new"]}

    # --- Judges: as the confirm page settled them ---
    bill_judges = extracted.get("judges") or []
    judges_payload: list[dict[str, Any]] = []
    panel: list[dict[str, Any]] = []
    for i, j in enumerate(bill_judges):
        choice = judge_choices[i] if i < len(judge_choices) else {}
        if choice.get("leave_off"):
            continue
        panel.append(j)
        if choice.get("judge_id"):
            judges_payload.append({"judge_id": choice["judge_id"]})
        elif choice.get("new"):
            judges_payload.append({**choice["new"]})
        # `{}`: unsettled, which only the preview builds.

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
        # A club the registry lacks is left for the office to request.
        if aid is None:
            continue
        unit = c.get("fee_unit") if c.get("fee_unit") in CLUB_SANCTION_UNITS else "per_entry"
        cents = c.get("fee_amount_cents") or 0
        clubs_payload.append({"association_id": aid, "fee_amount_cents": cents, "fee_unit": unit})
    sanctioned = {c["association_id"] for c in clubs_payload}

    # --- Classes, priced from the bill's rates over the panel kept ---
    rates = {r["key"]: r for r in extracted.get("class_rates") or []}
    rate_totals: dict[str, int] = {}
    for key, r in rates.items():
        n = per_judge_count(r, panel)
        rate_totals[key] = r["amount_cents"] * n if r["per_judge"] else r["amount_cents"]

    # A start date moved on the confirm page (the year the reader guessed, say)
    # moves the schedule with it, day for day, rather than stranding every class.
    bill_start = _as_date(show_x.get("start_date"))
    shift = (start_date - bill_start) if bill_start and bill_start != start_date else timedelta(0)

    stall_periods = _stall_periods(extracted, start_date, end_date, shift)

    classes_payload: list[dict[str, Any]] = []
    # Index into the bill's classes -> index into the payload, for the
    # futurities and side pots, which name their classes on the bill's.
    payload_index: dict[int, int] = {}
    seen: set[tuple[date, str]] = set()
    for i, cls in enumerate(extracted_classes):
        routed = resolved_classes[i] if i < len(resolved_classes) else {}
        day = _as_date(cls.get("date"))
        day = day + shift if day else None
        # No day, or one outside the show's dates: the first day.
        if day is None or not (start_date <= day <= end_date):
            day = start_date
        name = cls["name"]
        key = (day, " ".join(name.lower().split()))
        clubs = [c.upper() for c in cls.get("club_codes") or [] if c]
        if key in seen and clubs:
            # A club's class judged concurrently with the breed class of the
            # same name: the same horses in the ring, but its own entry fee,
            # its own judges' cards and its own placings, so its own class. Named
            # for the club, since a show runs one class of a name a day.
            name = f"{cls['name']} ({clubs[0]})"
            key = (day, " ".join(name.lower().split()))
        # A show runs one class of a name a day: only the first is created.
        if key in seen:
            continue
        seen.add(key)
        payload_index[i] = len(classes_payload)
        rate_key = None if cls.get("is_futurity") or cls.get("is_championship") else cls.get("rate_key")
        cents = rate_totals.get(rate_key, 0) if rate_key else 0
        # Kept as printed (migration 191); blank where the bill printed none.
        # Longer than a number can be is a misread, not a number.
        printed_number = (cls.get("number") or "").strip()
        if len(printed_number) > 20:
            printed_number = ""
        classes_payload.append(
            {
                "class_date": day,
                "class_number": printed_number,
                "class_name": _cut(name, 200),
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

    # --- Futurities, each with the classes the bill marked for it ---
    futurities_payload: list[dict[str, Any]] = []
    for f in extracted.get("futurities") or []:
        members = [
            payload_index[i]
            for i, cls in enumerate(extracted_classes)
            if i in payload_index and (cls.get("futurity") or "").lower() == f["name"].lower()
        ]
        late_fee = f.get("late_fee_cents") or 0
        deadline = _as_date(f.get("entry_deadline"))
        # A late fee with no deadline to be late against is left off.
        if late_fee and deadline is None:
            late_fee = 0
        tiers = f.get("fee_tiers") or []
        futurities_payload.append(
            {
                "name": _cut(f["name"], 200),
                "description": _cut(f.get("description"), 2000),
                "entry_deadline": deadline,
                "late_fee_cents": late_fee,
                # A bill that prints one office fee prints it for everybody,
                # whichever of the two the reader put it in.
                "office_fee_member_cents": _first_set(f.get("office_fee_member_cents"), f.get("office_fee_nonmember_cents")),
                "office_fee_nonmember_cents": _first_set(f.get("office_fee_nonmember_cents"), f.get("office_fee_member_cents")),
                "entry_instructions": _cut(f.get("entry_instructions"), 8000),
                "award_notice": _cut(f.get("award_notice"), 8000),
                "rules_notice": _cut(f.get("rules_notice"), 8000),
                "refund_policy": _cut(f.get("refund_policy"), 8000),
                "fee_tiers": [
                    {"name": _cut(t["name"], 120), "amount_cents": t["amount_cents"], "sort_order": n}
                    for n, t in enumerate(tiers)
                ],
                "class_indexes": members,
            }
        )

    # --- Side pots: created over the classes the bill names for each ---
    side_pots_payload: list[dict[str, Any]] = []
    for p in extracted.get("side_pots") or []:
        members = [
            payload_index[i]
            for i, cls in enumerate(extracted_classes)
            if i in payload_index and p["name"].lower() in {s.lower() for s in cls.get("side_pots") or []}
        ]
        if not members:
            # A side pot is a pot over classes; with none it cannot exist.
            continue
        fee = p.get("entry_fee_cents")
        payback = p.get("payback_percent")
        timed = p.get("scoring") == "time"
        d_count = (p.get("d_count") or 1) if timed else 1
        d_split = p.get("d_split_ms") if timed else None
        side_pots_payload.append(
            {
                "name": _cut(p["name"], 200),
                "description": _cut(p.get("description"), 1000),
                "entry_fee_cents": fee if fee is not None else DEFAULT_SIDE_POT_FEE_CENTS,
                "payback_percent": payback if payback is not None else 100,
                "scoring_method": "fastest_time" if timed else "sum_placings",
                "added_money_cents": p.get("added_money_cents") or 0,
                "d_count": d_count,
                "d_split_ms": d_split or DEFAULT_D_SPLIT_MS,
                "class_indexes": members,
            }
        )

    # --- Fees: an early rate or a minimum the app refuses is left off ---
    fees_payload: list[dict[str, Any]] = []
    for f in extracted.get("fees") or []:
        early_cents, early_deadline = f.get("early_amount_cents"), _as_date(f.get("early_deadline"))
        minimum = f.get("min_quantity") or 0
        try:
            _assert_early_rate_valid(
                unit=f["unit"], amount_cents=f["amount_cents"],
                early_amount_cents=early_cents, early_deadline=early_deadline,
            )
        except HTTPException:
            early_cents = early_deadline = None
        try:
            _assert_min_quantity_valid(unit=f["unit"], min_quantity=minimum)
        except HTTPException:
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

    return Draft(
        show=show,
        venue=venue,
        judges=judges_payload,
        clubs=clubs_payload,
        classes=classes_payload,
        fees=fees_payload,
        futurities=futurities_payload,
        side_pots=side_pots_payload,
        stall_periods=stall_periods,
    )


def legacy_office_lines(extracted: dict[str, Any]) -> list[str]:
    """What an older read listed for the office with no field to hold it --
    the show officials it named, and its `not_imported` lines."""
    lines = []
    staff = (extracted.get("show") or {}).get("staff") or []
    for s in staff:
        lines.append(f"{s['name']} ({s['role']})" if s.get("role") else s["name"])
    for line in extracted.get("not_imported") or []:
        text = line if isinstance(line, str) else line.get("text")
        topic = None if isinstance(line, str) else _LEGACY_TOPIC_SECTIONS.get(line.get("topic"))
        if text:
            lines.append(f"{topic}: {text}" if topic else text)
    return lines


def office_notes_text(extracted: dict[str, Any]) -> Optional[str]:
    """The office notes the confirm page starts from: what the bill tells the
    show office that no field holds -- its officials and their contacts, how
    the office runs. Information about the show, never a list of things to
    check."""
    office = [extracted.get("notes_for_office")] if extracted.get("notes_for_office") else []
    office += [f"- {line}" for line in legacy_office_lines(extracted)]
    text = "\n".join(office).strip()
    return text or None


def public_notes_text(extracted: dict[str, Any]) -> Optional[str]:
    """The show notes the confirm page starts from: what the bill tells
    exhibitors that no field holds, as the reader wrote it."""
    return extracted.get("notes_for_exhibitors") or None
