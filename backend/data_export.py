"""The show's results as data, in the columns the office picks.

The association reports (`show_reports.py`, the APHA entry file) are laid out
the way a breed body asks for them, and they stay that way: a format an
association specifies is not this app's to rearrange. This is the other thing a
show company needs -- everything the show recorded, in a file it can take
anywhere -- so the club or the company can work out its own circuit standings,
year-end awards and qualifications.

**It decides nothing.** Every club tracks its people and horses its own way, and
its eligibility rules are its own: WSCA has no member numbers at all and
qualifies a horse and rider on a placing under a WSCA judge; MNSPHC counts
points only from the day a membership starts. GaitDesk applies none of that.
The file says who placed where, under which judge, in a class of how many,
sanctioned by which clubs, and what membership and registration numbers the
show holds for the person and the horse -- and the club applies its own rules
in its own spreadsheet. A rule added here would be read as that club's, and the
next club would need another.

Two row kinds, because the two questions are different files:

* **Placings** -- one row per placing per judge's card, posted classes only,
  the same placings the Show Results report prints. A panel places the same
  horse once per card, and combining cards is a rules decision.
* **Entries** -- one row per class entry, posted or not, scratches marked: who
  entered what, for counting and for membership lists.

Built from the record `routers/show_reports.py` assembles, with the extra
columns `_load_export_extras` adds under `record["export"]`, and queries
nothing -- so a placing here is always one the Show Results report also shows.

**Membership and registration columns are per body, and only for the bodies
this show runs under or somebody here holds a number with.** One column per
body in the whole registry would be hundreds once every saddle club is in it.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable, Optional

from show_reports import OUTCOME_LABEL, _class_sort, _judge_name

PLACINGS = "placings"
ENTRIES = "entries"
BOTH = (PLACINGS, ENTRIES)

GROUPS = [
    {"key": "show", "label": "Show"},
    {"key": "class", "label": "Class"},
    {"key": "placing", "label": "Placing"},
    {"key": "entry", "label": "Entry"},
    {"key": "exhibitor", "label": "Exhibitor"},
    {"key": "memberships", "label": "Memberships"},
    {"key": "horse", "label": "Horse"},
    {"key": "registrations", "label": "Horse registrations"},
]


def _field(key: str, label: str, group: str, *, kinds=BOTH, default: bool = False) -> dict:
    return {"key": key, "label": label, "group": group, "kinds": list(kinds), "default": default}


# What any show can export. The membership and registration columns are added
# per body by `fields_for`. On by default: what a results file is unreadable
# without, plus the two ids -- the file's stated job is to be combined with
# other shows', and a name is not a key (two Sarah Johnsons, one misspelt).
BASE_FIELDS = [
    _field("show_name", "Show", "show", default=True),
    _field("show_start_date", "Show start date", "show", default=True),
    _field("show_end_date", "Show end date", "show"),
    _field("show_type", "Show type", "show"),
    _field("show_company", "Show company", "show"),
    _field("venue", "Venue", "show"),
    _field("venue_location", "Venue city and state", "show"),
    _field("show_id", "GaitDesk show ID", "show"),
    _field("class_number", "Class number", "class", default=True),
    _field("class_name", "Class name", "class", default=True),
    _field("class_date", "Class date", "class"),
    _field("class_division", "Division", "class", default=True),
    _field("class_discipline", "Discipline", "class"),
    _field("class_code", "Association class code", "class"),
    _field("sanctioned_by", "Sanctioned by", "class", default=True),
    _field("entered_count", "Entries in class", "class"),
    _field("shown_count", "Horses shown", "class", default=True),
    _field("high_point_eligible", "Counts for high point", "class"),
    _field("judge", "Judge", "placing", kinds=(PLACINGS,), default=True),
    _field("judge_associations", "Judge's associations on file", "placing", kinds=(PLACINGS,)),
    _field("place", "Place", "placing", kinds=(PLACINGS,), default=True),
    _field("tie", "Tie", "placing", kinds=(PLACINGS,)),
    _field("score", "Score", "placing", kinds=(PLACINGS,)),
    _field("outcome", "Result", "placing", kinds=(PLACINGS,)),
    _field("back_number", "Back number", "entry", default=True),
    _field("entry_status", "Entry status", "entry", kinds=(ENTRIES,), default=True),
    _field("gate_no_show", "No-show at the gate", "entry"),
    _field("entry_division", "Entered as (division)", "entry"),
    _field("relationship_to_owner", "Relationship to owner", "entry"),
    _field("exhibitor_name", "Exhibitor", "exhibitor", default=True),
    _field("exhibitor_id", "GaitDesk exhibitor ID", "exhibitor", default=True),
    _field("birth_year", "Birth year", "exhibitor"),
    _field("date_of_birth", "Date of birth", "exhibitor"),
    _field("city", "City", "exhibitor"),
    _field("state", "State", "exhibitor"),
    _field("zip", "Zip code", "exhibitor"),
    _field("email", "Email", "exhibitor"),
    _field("phone", "Phone", "exhibitor"),
    _field("competition_cards", "Competition cards", "memberships"),
    _field("horse_name", "Horse", "horse", default=True),
    _field("horse_id", "GaitDesk horse ID", "horse", default=True),
    _field("barn_name", "Barn name", "horse"),
    _field("foaling_year", "Foaling year", "horse"),
    _field("sex", "Sex", "horse"),
    _field("breed", "Breed", "horse"),
    _field("color", "Color", "horse"),
    _field("owner", "Owner", "horse"),
    _field("trainer", "Trainer", "horse"),
]


def _member_key(code: str) -> str:
    return f"member:{code}"


def _member_expires_key(code: str) -> str:
    return f"member_expires:{code}"


def _registration_key(code: str) -> str:
    return f"registration:{code}"


def _value(value) -> Any:
    """A cell a spreadsheet reads as what it is: ISO dates, plain numbers, and
    None for nothing at all (the page writes it as an empty cell)."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return value


def _joined(values: Iterable[str]) -> Optional[str]:
    """Several values in one cell, in a stable order."""
    items = sorted({v for v in values if v})
    return "; ".join(items) or None


def export_bodies(record: dict) -> list[dict]:
    """The bodies that get membership and registration columns, breed first.

    Every body this show runs under, so its columns are there even when nobody
    has filled them in, plus every body anybody in the file holds a number
    with -- an NSBA number on an exhibitor at a show NSBA has nothing to do
    with is still a fact a club might want.
    """
    extras = record["export"]
    associations = extras["associations"]
    wanted = set(extras["show_association_ids"])
    for person in extras["exhibitors"].values():
        wanted.update(person["memberships"].keys())
    for horse in extras["horses"].values():
        wanted.update(horse["registrations"].keys())
    bodies = [associations[a] for a in wanted if a in associations]
    return sorted(bodies, key=lambda b: (b["association_type"] != "breed", b["code"]))


def fields_for(record: dict) -> list[dict]:
    """Every column this show can export, grouped and in order.

    A per-body column is on by default only where somebody here has a value in
    it. An empty WSCA registration column is not a gap in the file -- WSCA
    numbers no horses -- and should not be in it unless somebody asks.
    """
    extras = record["export"]
    member_held: set = set()
    expiry_held: set = set()
    for person in extras["exhibitors"].values():
        for association_id, membership in person["memberships"].items():
            if membership.get("number"):
                member_held.add(association_id)
            if membership.get("expires_at"):
                expiry_held.add(association_id)
    registered: set = {
        association_id
        for horse in extras["horses"].values()
        for association_id, number in horse["registrations"].items()
        if number
    }

    member_fields = []
    registration_fields = []
    for body in export_bodies(record):
        code = body["code"]
        member_fields.append(
            _field(_member_key(code), f"{code} member number", "memberships", default=body["id"] in member_held)
        )
        member_fields.append(
            _field(
                _member_expires_key(code),
                f"{code} membership expires",
                "memberships",
                default=body["id"] in expiry_held,
            )
        )
        registration_fields.append(
            _field(
                _registration_key(code),
                f"{code} registration number",
                "registrations",
                default=body["id"] in registered,
            )
        )

    out: list[dict] = []
    for group in GROUPS:
        out.extend(f for f in BASE_FIELDS if f["group"] == group["key"])
        if group["key"] == "memberships":
            out.extend(member_fields)
        if group["key"] == "registrations":
            out.extend(registration_fields)
    return out


def _entry_cells(record: dict, entry: dict, bodies: list[dict]) -> dict:
    """Everything about one class entry: the show, the class, the person, the
    horse. Shared by both row kinds so a placing and its entry cannot describe
    the same person two ways."""
    extras = record["export"]
    show = extras["show"]
    cls = record["classes_by_id"].get(entry["class_id"], {})
    class_extra = extras["classes"].get(entry["class_id"], {})
    person = extras["exhibitors"].get(entry["exhibitor_id"], {})
    horse = extras["horses"].get(entry["horse_id"], {}) if entry["horse_id"] else {}
    entry_extra = extras["entries"].get(entry["id"], {})
    dob = person.get("date_of_birth")

    cells = {
        "show_id": str(record["show_id"]),
        "show_name": record["show_name"],
        "show_start_date": record["start_date"],
        "show_end_date": record["end_date"],
        "show_type": record["show_type_code"],
        "show_company": show.get("company"),
        "venue": show.get("venue"),
        "venue_location": show.get("venue_location"),
        "class_number": cls.get("class_number"),
        "class_name": cls.get("class_name"),
        "class_date": cls.get("class_date"),
        "class_division": class_extra.get("division"),
        "class_discipline": class_extra.get("discipline"),
        "class_code": cls.get("association_class_code"),
        "sanctioned_by": _joined(class_extra.get("sanctioned_by", ())),
        "entered_count": cls.get("entry_count"),
        "shown_count": class_extra.get("shown_count", 0),
        "high_point_eligible": class_extra.get("high_point_eligible"),
        "back_number": entry["back_number"],
        "entry_status": "Scratched" if entry["status"] == "WITHDRAWN" else "Entered",
        "gate_no_show": entry_extra.get("gate_no_show"),
        "entry_division": entry["apha_division_label"],
        "relationship_to_owner": entry["relationship_to_owner"],
        "exhibitor_name": entry["exhibitor_name"],
        "exhibitor_id": str(entry["exhibitor_id"]) if entry["exhibitor_id"] else None,
        "birth_year": dob.year if dob else None,
        "date_of_birth": dob,
        "city": person.get("city"),
        "state": person.get("state"),
        "zip": person.get("zip"),
        "email": person.get("email"),
        "phone": person.get("phone"),
        "competition_cards": _joined(person.get("competition_cards", ())),
        "horse_name": entry["horse_name"],
        "horse_id": str(entry["horse_id"]) if entry["horse_id"] else None,
        "barn_name": horse.get("barn_name"),
        "foaling_year": horse.get("foaling_year"),
        "sex": horse.get("sex"),
        "breed": horse.get("breed"),
        "color": horse.get("color"),
        "owner": horse.get("owner"),
        "trainer": horse.get("trainer"),
    }
    memberships = person.get("memberships", {})
    registrations = horse.get("registrations", {})
    for body in bodies:
        membership = memberships.get(body["id"], {})
        cells[_member_key(body["code"])] = membership.get("number")
        cells[_member_expires_key(body["code"])] = membership.get("expires_at")
        cells[_registration_key(body["code"])] = registrations.get(body["id"])
    return cells


def _placing_rows(record: dict, bodies: list[dict]) -> list[dict]:
    """Every posted placing, per judge's card -- the rows Show Results prints."""
    judge_associations = record["export"]["judge_associations"]
    rows = []
    for result in record["results"]:
        cls = record["classes_by_id"].get(result["class_id"])
        if cls is None or not cls["results_published_at"]:
            continue
        entry = record["entries_by_id"].get(result["entry_id"])
        if entry is None:
            continue
        cells = _entry_cells(record, entry, bodies)
        cells.update({
            "judge": _judge_name(record, result["judge_id"]),
            "judge_associations": _joined(judge_associations.get(result["judge_id"], ())),
            "place": result["place"],
            "tie": bool(result["is_tie"]),
            "score": result["raw_score"],
            "outcome": (
                "Placed"
                if (result.get("outcome") or "placed") == "placed"
                else OUTCOME_LABEL.get(result["outcome"], result["outcome"])
            ),
        })
        sort = (
            *_class_sort(record, result["class_id"]),
            record["judges_by_id"].get(result["judge_id"], {}).get("sort_order", 0),
            result["place"] if result["place"] is not None else 9999,
        )
        rows.append((sort, cells))
    rows.sort(key=lambda pair: pair[0])
    return [{k: _value(v) for k, v in cells.items()} for _sort, cells in rows]


def _entry_rows(record: dict, bodies: list[dict]) -> list[dict]:
    """Every class entry, posted or not, scratches included and marked."""
    rows = []
    for entry in record["entries"]:
        cells = _entry_cells(record, entry, bodies)
        number = entry["back_number"]
        sort = (*_class_sort(record, entry["class_id"]), number if number is not None else 10**9)
        rows.append((sort, cells))
    rows.sort(key=lambda pair: pair[0])
    return [{k: _value(v) for k, v in cells.items()} for _sort, cells in rows]


def build_data_export(record: dict) -> dict:
    """Every exportable column and both row kinds, for the page to pick from.

    Rows carry every column; the page keeps the ones ticked. So the preview and
    the file are the same snapshot, and changing the selection costs nothing.
    """
    bodies = export_bodies(record)
    unposted = [c for c in record["classes"] if not c["results_published_at"]]
    notes = [
        "Placings come from posted classes only, one row per judge's card — the "
        "same placings as the Show Results report. GaitDesk does not combine "
        "judges' cards or decide who is eligible for anything: apply your "
        "club's or association's own rules to this file.",
        "Membership and registration numbers are what each exhibitor gave this "
        "show. They are not checked against any association's records.",
    ]
    if unposted:
        notes.append(
            f"{len(unposted)} class(es) are not posted yet. Their placings are a "
            "staff-only draft and are not in the placings rows; their entries are "
            "in the entries rows."
        )
    return {
        "groups": GROUPS,
        "fields": fields_for(record),
        PLACINGS: _placing_rows(record, bodies),
        ENTRIES: _entry_rows(record, bodies),
        "notes": notes,
    }
