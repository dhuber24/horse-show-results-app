"""A show set up from its show bill: the draft the read becomes, and its notes.

The show is created as a DRAFT straight from the read, filled in as far as the
bill allows -- the show, its judges and venue (as the person on the confirm
page settled them), club sanctioning, the class schedule with its prices, the
fee catalogue, every futurity and side pot the bill runs. Nothing waits on an
Accept. What the office should look at is written down instead:

* **Office notes** (`shows.office_notes`): every doubt about the read, the
  reader's and the app's -- a price multiplied by a judge count, a fee that
  bills everybody who enters, a club the registry lacks -- grouped by the
  setup step that edits it, then what the bill told the office that no field
  holds (its officials, its procedures).
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
from datetime import date, timedelta
from typing import Any, Optional
from uuid import UUID

from billing import CLUB_SANCTION_UNITS

# Section headings in the office notes, in setup-step order.
BASICS = "Basics & Staff"
JUDGES = "Judges"
LODGING = "Lodging"
CLASSES = "Class Builder"
SANCTIONING = "Sanctioning"
FUTURITIES = "Futurities & Side Pots"
FEES = "Fees"
PAPERWORK = "Paperwork"
WHOLE_BILL = "The whole bill"

SECTION_ORDER = (BASICS, JUDGES, LODGING, CLASSES, SANCTIONING, FUTURITIES, FEES, PAPERWORK, WHOLE_BILL)

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

# Where a doubt from a read made before 2026-11-15 shows: those reads tagged
# each doubt with the show field or the setup topic it was about.
_LEGACY_FIELD_SECTIONS = {
    "requires_coggins": PAPERWORK,
    "requires_health_certificate": PAPERWORK,
    "requires_vaccination": PAPERWORK,
    "shavings_ban_outside": LODGING,
}
_LEGACY_TOPIC_SECTIONS = {"futurity": FUTURITIES, "side_pot": FUTURITIES, "high_point": "Scoring"}

# `shows.office_notes` as `ShowUpdate` takes it.
OFFICE_NOTES_MAX = 20000
PUBLIC_NOTES_MAX = 5000

# What a side pot costs when the bill prices it at nothing it printed --
# `SidePotCreate`'s own default, said so in the notes.
DEFAULT_SIDE_POT_FEE_CENTS = 1000


@dataclass
class Draft:
    """Everything `apply_import` creates, as plain dicts, and what to look at."""
    show: dict[str, Any]
    venue: Optional[dict[str, Any]]
    judges: list[dict[str, Any]]
    clubs: list[dict[str, Any]]
    classes: list[dict[str, Any]]
    fees: list[dict[str, Any]]
    futurities: list[dict[str, Any]]
    side_pots: list[dict[str, Any]]
    review: list[tuple[str, str]] = dc_field(default_factory=list)

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
        }


def _money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def _names(items: list[str], limit: int = 5) -> str:
    shown = ", ".join(items[:limit])
    return shown + (f" and {len(items) - limit} more" if len(items) > limit else "")


def _day(d: date) -> str:
    return f"{d.strftime('%a %b')} {d.day}"


def _plural(n: int, one: str, many: Optional[str] = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _cut(value: Optional[str], limit: int) -> Optional[str]:
    """Text held to the payload's limits. A bill is printed for people, and a
    sentence of notes longer than the column refuses the whole show."""
    if not value:
        return None
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def _class_label(cls: dict[str, Any]) -> str:
    """The class as the bill printed it -- its printed number is how the reader
    finds it on paper."""
    number = cls.get("number")
    return f"{cls['name']} (bill #{number})" if number else cls["name"]


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
    changed later, which is why every rate is a line in the office notes.
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
    clubs: dict[Any, Any],
) -> Draft:
    """The show a read becomes, and the lines of the office notes.

    `judge_choices` is one per judge the bill names, in order: `{"judge_id"}`
    for a registry judge, `{"new": {...}}` for one to add, `{"leave_off": True}`,
    or `{}` -- not settled yet, which the confirm page's preview allows and the
    create refuses before it gets here. `venue_choice` is `{"venue_id"}`,
    `{"new": {...}}` or None. `clubs` is id -> registry row, for the notes.
    """
    from routers.show_fees import _assert_early_rate_valid, _assert_min_quantity_valid
    from fastapi import HTTPException

    show_x = extracted.get("show") or {}
    review: list[tuple[str, str]] = []

    def note(section: str, text: str) -> None:
        review.append((section, text))

    # --- The show row ---
    entry_deadline = _as_date(show_x.get("entry_deadline"))
    if entry_deadline and entry_deadline > start_date:
        note(
            BASICS,
            f"The bill's entry deadline ({entry_deadline.isoformat()}) is after the show starts, which the app "
            "does not allow, so it was left blank. Set the last day to sign up online.",
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

    # Health papers the bill never mentions are the app's defaults, and saying
    # so is the point: "required" on a show whose bill was silent is a decision
    # the office should know it is making.
    silent = [
        f"{paper} ({default})"
        for column, paper, default in (
            ("requires_coggins", "a negative Coggins", "required, as on every show"),
            ("requires_health_certificate", "a health certificate", "not required"),
            ("requires_vaccination", "proof of vaccination", "not required"),
        )
        if show_x.get(column) is None
    ]
    if silent:
        note(PAPERWORK, f"The bill doesn't mention {_names(silent)}; set as shown, so check that is what the show asks for.")

    # --- Venue: as the confirm page settled it ---
    venue = None
    if venue_choice and venue_choice.get("venue_id"):
        venue = {"venue_id": venue_choice["venue_id"]}
    elif venue_choice and venue_choice.get("new"):
        venue = {**venue_choice["new"]}
    elif show_x.get("venue_name"):
        printed = ", ".join(p for p in (show_x.get("venue_name"), show_x.get("venue_city"), show_x.get("venue_state")) if p)
        note(BASICS, f"The bill names the venue {printed}, which was left blank. Pick or add it.")

    # --- Judges: as the confirm page settled them ---
    bill_judges = extracted.get("judges") or []
    judges_payload: list[dict[str, Any]] = []
    panel: list[dict[str, Any]] = []
    for i, j in enumerate(bill_judges):
        choice = judge_choices[i] if i < len(judge_choices) else {}
        printed = f"{j['first_name']} {j['last_name']}"
        if choice.get("leave_off"):
            note(JUDGES, f"The bill names {printed} as a judge, who was left off the show.")
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
        code = c["code"]
        if aid is None:
            marked = [
                _class_label(cls)
                for cls, r in zip(extracted_classes, resolved_classes)
                if code.upper() in {u.upper() for u in r.get("unknown_club_codes") or []}
            ]
            what = f"{code}" + (f" ({c['name']})" if c.get("name") else "")
            note(
                SANCTIONING,
                f"The bill lists {what}, which isn't a club in the registry"
                + (f", and marks {_plural(len(marked), 'class', 'classes')} for it ({_names(marked)})" if marked else "")
                + ". Request the club on the Sanctioning step, then mark its classes.",
            )
            continue
        unit = c.get("fee_unit") if c.get("fee_unit") in CLUB_SANCTION_UNITS else "per_entry"
        cents = c.get("fee_amount_cents") or 0
        clubs_payload.append({"association_id": aid, "fee_amount_cents": cents, "fee_unit": unit})
        if cents:
            row = clubs.get(aid) or clubs.get(str(aid))
            label = getattr(row, "code", None) or code
            printed = f" from “{c['fee_text']}”" if c.get("fee_text") else ""
            note(SANCTIONING, f"{label}'s club fee was read as {_money(cents)} {unit.replace('_', ' ')}{printed}.")
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

    classes_payload: list[dict[str, Any]] = []
    # Index into the bill's classes -> index into the payload, for the
    # futurities and side pots, which name their classes on the bill's.
    payload_index: dict[int, int] = {}
    seen: set[tuple[date, str]] = set()
    priced_by: dict[str, list[str]] = {}
    unpriced: list[str] = []
    moved: list[str] = []
    # Club classes the bill runs alongside a breed class of the same name --
    # "5. Amateur Performance Stallions / 5N. NSBA" -- as (club class, the
    # class it runs with).
    alongside: list[tuple[str, str]] = []
    label_by_key: dict[tuple[date, str], str] = {}
    number_by_key: dict[tuple[date, str], str] = {}
    for i, cls in enumerate(extracted_classes):
        routed = resolved_classes[i] if i < len(resolved_classes) else {}
        label = _class_label(cls)
        day = _as_date(cls.get("date"))
        day = day + shift if day else None
        if day is None or not (start_date <= day <= end_date):
            moved.append(label + (f" ({day.isoformat()})" if day else ""))
            day = start_date
        name = cls["name"]
        key = (day, " ".join(name.lower().split()))
        clubs = [c.upper() for c in cls.get("club_codes") or [] if c]
        base_key = key
        if key in seen and clubs:
            # A club's class judged concurrently with the breed class of the
            # same name: the same horses in the ring, but its own entry fee,
            # its own judges' cards and its own placings, so its own class. Named
            # for the club, since a show runs one class of a name a day.
            name = f"{cls['name']} ({clubs[0]})"
            key = (day, " ".join(name.lower().split()))
            if key not in seen:
                mine, theirs = (cls.get("number") or "").strip(), number_by_key[base_key]
                alongside.append(
                    (f"#{mine}", f"#{theirs}")
                    if mine and theirs
                    else (_class_label({**cls, "name": name}), label_by_key[base_key])
                )
        if key in seen:
            note(
                CLASSES,
                f"The bill lists {cls['name']} twice on {_day(day)}. A show runs one class of a name a day, so only "
                "the first was created; add the other under a different name if the show really runs it twice.",
            )
            continue
        seen.add(key)
        label_by_key[key] = label
        number_by_key[key] = (cls.get("number") or "").strip()
        payload_index[i] = len(classes_payload)
        rate_key = None if cls.get("is_futurity") or cls.get("is_championship") else cls.get("rate_key")
        cents = rate_totals.get(rate_key, 0) if rate_key else 0
        if rate_key:
            priced_by.setdefault(rate_key, []).append(label)
        elif not cls.get("is_futurity") and not cls.get("is_championship") and not routed.get("entered_by_qualification"):
            unpriced.append(label)
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
        if cls.get("note"):
            note(CLASSES, f"{label}: {cls['note']}")
    if alongside:
        note(
            CLASSES,
            f"{_plural(len(alongside), 'club class', 'club classes')} run alongside the class before "
            f"{'it' if len(alongside) == 1 else 'them'} on the bill, so each was created as its own class, named "
            f"for its club: {_names([f'{club} with {base}' for club, base in alongside])}. At the gate, start "
            "each with Run with, after the class it runs alongside.",
        )
    if moved:
        note(
            CLASSES,
            f"{_plural(len(moved), 'class', 'classes')} had no day on the bill, or one outside the show's dates, "
            f"and {'was' if len(moved) == 1 else 'were'} put on the first day: {_names(moved)}. Move "
            f"{'it' if len(moved) == 1 else 'them'} to the day {'it runs' if len(moved) == 1 else 'they run'}.",
        )

    # --- Class prices: one line per rate, since one rate prices many classes ---
    for key, r in rates.items():
        covered = priced_by.get(key) or []
        if not covered:
            continue
        total = rate_totals[key]
        printed = f"“{r['printed_text']}”" if r.get("printed_text") else r["label"]
        if r["per_judge"]:
            n = per_judge_count(r, panel)
            carded = r.get("association_code") if r.get("association_code") and n != len(panel) else None
            who = f"{n} {carded + ' ' if carded else ''}judge{'s' if n != 1 else ''}"
            how = f"{_money(r['amount_cents'])} × {who} = {_money(total)}"
            tail = " If the panel changes, these prices don't follow it: change them on Entry Fees."
            if not panel:
                tail = " No judges were kept, so they came to $0: price them on Entry Fees."
        else:
            how, tail = _money(total), ""
        note(FEES, f"{_plural(len(covered), 'class', 'classes')} priced at {how} from the bill's {printed}: {_names(covered)}.{tail}")
    if unpriced:
        note(
            FEES,
            f"{_plural(len(unpriced), 'class', 'classes')} had no price on the bill and "
            f"{'was' if len(unpriced) == 1 else 'were'} created free: {_names(unpriced)}. Price them on Entry Fees "
            "if they aren't.",
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
        said: list[str] = []
        if late_fee and deadline is None:
            said.append(f"its late fee ({_money(late_fee)}) was left off, since the bill gives no deadline for it to be late against")
            late_fee = 0
        tiers = f.get("fee_tiers") or []
        if not tiers:
            said.append("the bill prints no per-class prices for it: add its fee tiers")
        if not members:
            said.append("the bill marks none of its classes: add them")
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
        note(
            FUTURITIES,
            f"The {f['name']} futurity was set up from the bill with {_plural(len(members), 'class', 'classes')} "
            f"and {_plural(len(tiers), 'fee tier')}"
            + (f"; {'; '.join(said)}" if said else "")
            + ". Check its wording and fees.",
        )

    # --- Side pots: created over the classes the bill names for each ---
    side_pots_payload: list[dict[str, Any]] = []
    for p in extracted.get("side_pots") or []:
        members = [
            payload_index[i]
            for i, cls in enumerate(extracted_classes)
            if i in payload_index and p["name"].lower() in {s.lower() for s in cls.get("side_pots") or []}
        ]
        what = p["name"] + (f" ({p['description']})" if p.get("description") else "")
        if not members:
            # A side pot is a pot over classes; with none it cannot exist.
            note(
                FUTURITIES,
                f"The bill runs a side pot, {what}, but doesn't say which classes it covers, so it wasn't set up. "
                "Add it here once you know.",
            )
            continue
        fee = p.get("entry_fee_cents")
        payback = p.get("payback_percent")
        side_pots_payload.append(
            {
                "name": _cut(p["name"], 200),
                "description": _cut(p.get("description"), 1000),
                "entry_fee_cents": fee if fee is not None else DEFAULT_SIDE_POT_FEE_CENTS,
                "payback_percent": payback if payback is not None else 100,
                "class_indexes": members,
            }
        )
        unread = [
            label
            for label, missing in (
                (f"entry fee (set to {_money(DEFAULT_SIDE_POT_FEE_CENTS)})", fee is None),
                ("payback (set to 100%)", payback is None),
            )
            if missing
        ]
        note(
            FUTURITIES,
            f"The side pot {p['name']} was set up over {_plural(len(members), 'class', 'classes')}"
            + (f"; the bill doesn't print its {' or '.join(unread)}" if unread else "")
            + ". Check its fee, payback and payout.",
        )

    # --- Fees ---
    from showbill_import import fee_codes

    fees_payload: list[dict[str, Any]] = []
    fee_notes: list[tuple[int, str]] = []
    for f in extracted.get("fees") or []:
        index = len(fees_payload)
        early_cents, early_deadline = f.get("early_amount_cents"), _as_date(f.get("early_deadline"))
        minimum = f.get("min_quantity") or 0
        try:
            _assert_early_rate_valid(
                unit=f["unit"], amount_cents=f["amount_cents"],
                early_amount_cents=early_cents, early_deadline=early_deadline,
            )
        except HTTPException as exc:
            fee_notes.append((index, f"{f['label']}: the bill's early rate was left off ({exc.detail})."))
            early_cents = early_deadline = None
        try:
            _assert_min_quantity_valid(unit=f["unit"], min_quantity=minimum)
        except HTTPException as exc:
            fee_notes.append((index, f"{f['label']}: the minimum was left off ({exc.detail})."))
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
            fee_notes.append((index, f"{what} is added to every class entered, on top of the class's own price. Check it isn't a class price."))
        elif f["unit"] in _AUTOMATIC_UNITS:
            fee_notes.append((index, f"{what} is charged to every exhibitor who enters. Check it applies to everyone."))
    # The main stall / shavings / camping lines, and any other line booked at
    # sign-up, are edited on Lodging; the rest on Fees.
    codes = fee_codes((f["label"], f["unit"]) for f in fees_payload)
    for index, text in fee_notes:
        lodging = codes[index] in _LODGING_CODES or fees_payload[index]["unit"] in _RESERVABLE_UNITS
        note(LODGING if lodging else FEES, text)

    # --- What the reader itself was unsure of ---
    for w in extracted.get("warnings") or []:
        note(WHOLE_BILL, w)
    _legacy_doubts(extracted, note)

    return Draft(
        show=show,
        venue=venue,
        judges=judges_payload,
        clubs=clubs_payload,
        classes=classes_payload,
        fees=fees_payload,
        futurities=futurities_payload,
        side_pots=side_pots_payload,
        review=review,
    )


def _legacy_doubts(extracted: dict[str, Any], note: Any) -> None:
    """A read made before 2026-11-15 put its doubts on the item they were about
    and listed what it could not set up; those are notes now too."""
    for c in extracted.get("show_checks") or []:
        note(_LEGACY_FIELD_SECTIONS.get(c.get("field"), BASICS), c.get("message") or "")
    for kind, items, label in (
        (JUDGES, extracted.get("judges") or [], lambda i: f"{i['first_name']} {i['last_name']}"),
        (SANCTIONING, extracted.get("clubs") or [], lambda i: i["code"]),
        (FEES, extracted.get("class_rates") or [], lambda i: i["label"]),
        (FEES, extracted.get("fees") or [], lambda i: i["label"]),
    ):
        for item in items:
            if item.get("check"):
                note(kind, f"{label(item)}: {item['check']}")


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


def office_notes_text(draft: Draft, extracted: dict[str, Any], filename: Optional[str]) -> Optional[str]:
    """The office notes the confirm page starts from.

    The things to look at first, grouped under the setup step that edits each,
    then what the bill told the office that no field holds. Plain text, since
    it lands in a text box the office edits.
    """
    parts: list[str] = []
    by_section: dict[str, list[str]] = {}
    for section, text in draft.review:
        if text:
            by_section.setdefault(section, []).append(text)
    if by_section:
        source = f" ({filename})" if filename else ""
        parts.append(f"To check, from the show bill{source}:")
        for section in sorted(by_section, key=lambda s: SECTION_ORDER.index(s) if s in SECTION_ORDER else len(SECTION_ORDER)):
            parts.append("")
            parts.append(section)
            parts.extend(f"- {t}" for t in by_section[section])
    office = [extracted.get("notes_for_office")] if extracted.get("notes_for_office") else []
    office += [f"- {line}" for line in legacy_office_lines(extracted)]
    if office:
        if parts:
            parts.append("")
        parts.append("From the show bill:")
        parts.extend(office)
    text = "\n".join(parts).strip()
    return text or None


def public_notes_text(extracted: dict[str, Any]) -> Optional[str]:
    """The show notes the confirm page starts from: what the bill tells
    exhibitors that no field holds, as the reader wrote it."""
    return extracted.get("notes_for_exhibitors") or None
