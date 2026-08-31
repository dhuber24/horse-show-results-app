"""What the office sends the association after the show.

Same shape as `financial_reports.py`, and for the same reason: a report is a
slug, a title, a column list and rows of cells, and one frontend renderer draws
all of them. Adding a report is a function in `_REPORTS` — no route, no
component, no migration.

Every report is built from the payload `routers/show_reports.py` assembles once,
and none of them query. So a report cannot quote a placing the results screen
does not show, and the retention bundle cannot disagree with the reports inside
it.

Two boundaries worth stating, because both are the kind of thing that looks like
an omission:

* **Only posted classes appear in anything that reports a placing.** An unposted
  class is a draft — the publish gate is what makes a placing official, and a
  report the office forwards to an association must not be the first place a
  half-typed card is treated as a result. The count of unposted classes is
  carried as a note so nobody has to guess why a class is missing.
* **The app cannot produce a signed judge's card.** SC-110.J asks management to
  retain the *original signed* placing cards for a year. What the app holds is
  the working behind the number — maneuvers, penalties, the total — which is a
  useful record and is not the same document. The bundle says so rather than
  letting a printout imply it satisfies the rule on its own.
"""
from __future__ import annotations

from typing import Callable, Optional

# ── Column helpers ─────────────────────────────────────────────────────────────


def _col(key: str, label: str, *, money: bool = False, right: bool = False) -> dict:
    return {
        "key": key,
        "label": label,
        "align": "right" if (money or right) else "left",
        "is_money": money,
    }


def _dash(value) -> str:
    """An empty cell that reads as empty. A blank looks like a rendering fault
    in a table somebody is going to print and post."""
    if value is None or value == "":
        return "—"
    return str(value)


def _place(result: dict) -> str:
    """A placing, or what happened instead (migration 121)."""
    if result.get("place") is not None:
        return str(result["place"])
    return OUTCOME_LABEL.get(result.get("outcome") or "placed", "—")


OUTCOME_LABEL = {
    "placed": "—",
    "zero_score": "Zero score",
    "no_score": "No score",
    "disqualified": "Disqualified",
    "eliminated": "Eliminated",
}


def _score(value) -> str:
    """Trim the trailing zeros a NUMERIC(10,3) brings with it — a judge called
    71.5, not 71.500, and the sheet should say what they called."""
    if value is None:
        return "—"
    text = f"{float(value):.3f}".rstrip("0").rstrip(".")
    return text or "0"


def _class_sort(record: dict, class_id) -> tuple:
    cls = record["classes_by_id"].get(class_id, {})
    return (str(cls.get("class_date") or ""), cls.get("sort_order") or 0, cls.get("class_number") or "")


def _judge_name(record: dict, judge_id) -> str:
    if judge_id is None:
        return "Unattributed"
    return record["judges_by_id"].get(judge_id, {}).get("name") or "Unattributed"


def _unposted_note(record: dict) -> list[str]:
    unposted = [c for c in record["classes"] if not c["results_published_at"]]
    if not unposted:
        return []
    return [
        f"{len(unposted)} class(es) have not been posted and are left out: "
        + ", ".join(c["class_number"] for c in unposted[:12])
        + ("…" if len(unposted) > 12 else "")
        + ". Posting a class is what makes its placings official; until then they "
        "are a staff-only draft."
    ]


# ── Reports ────────────────────────────────────────────────────────────────────


def _results(record: dict) -> dict:
    """Every posted placing, by class and by judge.

    One row per card per entry, because a class judged by a panel legitimately
    places the same horse several ways and collapsing that would mean picking a
    winner between cards that disagree — which is not this app's job.
    """
    rows = []
    for result in record["results"]:
        cls = record["classes_by_id"].get(result["class_id"])
        if cls is None or not cls["results_published_at"]:
            continue
        entry = record["entries_by_id"].get(result["entry_id"])
        if entry is None:
            continue
        rows.append({
            "_sort": (
                *_class_sort(record, result["class_id"]),
                record["judges_by_id"].get(result["judge_id"], {}).get("sort_order", 0),
                result["place"] if result["place"] is not None else 9999,
            ),
            "class_number": cls["class_number"],
            "class_name": cls["class_name"],
            "class_code": _dash(cls["association_class_code"]),
            "judge": _judge_name(record, result["judge_id"]),
            "place": _place(result),
            "tie": "T" if result["is_tie"] else "",
            "score": _score(result["raw_score"]),
            "back_number": _dash(entry["back_number"]),
            "exhibitor": entry["exhibitor_name"],
            "member_number": _dash(entry["member_number"]),
            "horse": _dash(entry["horse_name"]),
            "registration_number": _dash(entry["registration_number"]),
            "division": _dash(entry["apha_division_label"]),
        })
    rows.sort(key=lambda r: r["_sort"])
    for row in rows:
        del row["_sort"]

    notes = _unposted_note(record)
    notes.append(
        "One row per judge. A class judged by a panel lists the same horse once "
        "per card — the app does not combine cards into a single official "
        "placing, because that is a rules decision rather than a display one."
    )
    if not record["association_code"]:
        notes.append(
            "This show has no breed association, so the registration and "
            "membership columns are empty by definition rather than missing."
        )
    return {
        "columns": [
            _col("class_number", "Class"),
            _col("class_name", "Class name"),
            _col("class_code", "Code"),
            _col("judge", "Judge"),
            _col("place", "Place", right=True),
            _col("tie", "Tie"),
            _col("score", "Score", right=True),
            _col("back_number", "Back #", right=True),
            _col("exhibitor", "Exhibitor"),
            _col("member_number", "Member #"),
            _col("horse", "Horse"),
            _col("registration_number", "Reg #"),
            _col("division", "Division"),
        ],
        "rows": rows,
        "totals": {},
        "notes": notes,
    }


def _entry_cards(record: dict) -> dict:
    """Every entry taken, with what the entry blank carries.

    One of the three documents SC-110.J asks management to retain. Includes
    withdrawn entries, marked as such — an entry that was taken and then pulled
    is part of the record of the show, and dropping it would make the sheet
    disagree with the money.
    """
    rows = []
    for entry in record["entries"]:
        cls = record["classes_by_id"].get(entry["class_id"], {})
        rows.append({
            "_sort": (
                entry["back_number"] if entry["back_number"] is not None else 99999,
                entry["exhibitor_name"].lower(),
                *_class_sort(record, entry["class_id"]),
            ),
            "back_number": _dash(entry["back_number"]),
            "exhibitor": entry["exhibitor_name"],
            "member_number": _dash(entry["member_number"]),
            "horse": _dash(entry["horse_name"]),
            "registration_number": _dash(entry["registration_number"]),
            "class_number": cls.get("class_number", "—"),
            "class_name": cls.get("class_name", "—"),
            "division": _dash(entry["apha_division_label"]),
            "relationship": _dash(entry["relationship_to_owner"]),
            "fee_cents": cls.get("entry_fee_cents", 0),
            "status": "Withdrawn" if entry["status"] == "WITHDRAWN" else "Entered",
        })
    rows.sort(key=lambda r: r["_sort"])
    for row in rows:
        del row["_sort"]

    return {
        "columns": [
            _col("back_number", "Back #", right=True),
            _col("exhibitor", "Exhibitor"),
            _col("member_number", "Member #"),
            _col("horse", "Horse"),
            _col("registration_number", "Reg #"),
            _col("class_number", "Class"),
            _col("class_name", "Class name"),
            _col("division", "Division"),
            _col("relationship", "Relationship to owner"),
            _col("fee_cents", "Fee", money=True),
            _col("status", "Status"),
        ],
        "rows": rows,
        "totals": {},
        "notes": [
            "Withdrawn entries are listed and marked rather than dropped — an "
            "entry that was taken and then pulled is part of the show's record.",
            "The fee shown is the class's entry fee. What an exhibitor was "
            "actually billed, including office charges and sanction fees, is in "
            "Financials.",
        ],
    }


def _judge_cards(record: dict) -> dict:
    """The working behind each score: maneuvers, penalties, and the total.

    **Not the signed card.** SC-110.J asks for the original signed placing cards,
    which are paper the judge hands to the office. This is what the scribe
    recorded off them, which is a useful record and a different document.
    """
    rows = []
    for card in record["cards"]:
        cls = record["classes_by_id"].get(card["class_id"])
        entry = record["entries_by_id"].get(card["entry_id"])
        if cls is None or entry is None:
            continue
        maneuvers = ", ".join(
            _score(m["score"]) if m["score"] is not None else "·" for m in card["maneuvers"]
        )
        penalties = "; ".join(
            f"{p['label']} ({_score(p['value'])}"
            + (f" @ {p['sequence']}" if p["sequence"] else "")
            + ")"
            for p in card["penalties"]
        )
        rows.append({
            "_sort": (
                *_class_sort(record, card["class_id"]),
                record["judges_by_id"].get(card["judge_id"], {}).get("sort_order", 0),
                entry["back_number"] if entry["back_number"] is not None else 99999,
            ),
            "class_number": cls["class_number"],
            "judge": _judge_name(record, card["judge_id"]),
            "back_number": _dash(entry["back_number"]),
            "exhibitor": entry["exhibitor_name"],
            "horse": _dash(entry["horse_name"]),
            "system": _dash(card["system_name"]),
            "maneuvers": maneuvers or "—",
            "penalties": penalties or "—",
            "computed": _score(card["computed_score"]),
            "score": _score(card["effective_score"]),
            "override": card["override_reason"] or ("Yes" if card["is_overridden"] else ""),
        })
    rows.sort(key=lambda r: r["_sort"])
    for row in rows:
        del row["_sort"]

    notes = [
        "This is what the scribe recorded off the judge's card — the maneuver "
        "scores, the penalties called, and the total. It is not the original "
        "signed card, which is paper the judge hands to the office and which "
        "SC-110.J asks management to retain separately.",
        "Where Score differs from Computed, somebody overruled the arithmetic. "
        "The reason they gave is in the last column and the change is in the "
        "class's audit history.",
    ]
    if not rows:
        notes = [
            "No judge's cards have been recorded. Classes score the way they "
            "always have — the scribe enters a total — until a card is assigned "
            "to them under Classes → Judging Cards."
        ]
    return {
        "columns": [
            _col("class_number", "Class"),
            _col("judge", "Judge"),
            _col("back_number", "Back #", right=True),
            _col("exhibitor", "Exhibitor"),
            _col("horse", "Horse"),
            _col("system", "Card"),
            _col("maneuvers", "Maneuvers"),
            _col("penalties", "Penalties"),
            _col("computed", "Computed", right=True),
            _col("score", "Score", right=True),
            _col("override", "Overridden"),
        ],
        "rows": rows,
        "totals": {},
        "notes": notes,
    }


def _class_summary(record: dict) -> dict:
    """One row per class: what ran, who judged it, and whether it is posted."""
    rows = []
    for cls in record["classes"]:
        cards = [
            j for j in record["judges"]
            if (cls["id"], j["id"]) in record["filed_cards"]
        ]
        rows.append({
            "class_number": cls["class_number"],
            "class_name": cls["class_name"],
            "class_date": str(cls["class_date"]),
            "class_code": _dash(cls["association_class_code"]),
            "score_type": cls["score_type"],
            "entries": cls["entry_count"],
            "judges_filed": f"{len(cards)} of {len(record['judges']) or 1}",
            "pattern_posted": "—" if cls["score_type"] != "pattern" else (
                "Yes" if cls["pattern_posted_at"] else "Not recorded"
            ),
            "posted": "Posted" if cls["results_published_at"] else "Draft",
        })
    return {
        "columns": [
            _col("class_number", "Class"),
            _col("class_name", "Class name"),
            _col("class_date", "Date"),
            _col("class_code", "Code"),
            _col("score_type", "Scored as"),
            _col("entries", "Entries", right=True),
            _col("judges_filed", "Cards filed", right=True),
            _col("pattern_posted", "Pattern posted"),
            _col("posted", "Results"),
        ],
        "rows": rows,
        "totals": {"class_number": "Total", "entries": sum(c["entry_count"] for c in record["classes"])},
        "notes": [
            "Cards filed counts the judges who have entered at least one placing, "
            "against the panel assigned to the show. A show with no judges "
            "assigned files one unattributed card.",
            "Pattern posted is recorded from the gate screen and applies to "
            "pattern classes only. The app records whether and when, never "
            "whether it met the one-hour deadline — a class carries a date and "
            "no start time, so there is nothing to measure back from.",
        ],
    }


def _compliance(record: dict) -> dict:
    """What is on file for each exhibitor, and what is not.

    **This never changes a placing, and that is the point.** AM-300.E.4 says an
    exhibitor who fails the ownership requirement "will lose any APHA points
    earned but will maintain placings", and everyone else's placings are
    explicitly unchanged. So this is a sheet the office forwards to the
    association, never an input that recomputes a class.

    Nothing here is verified by the app. A membership number is what somebody
    typed; an attestation is what somebody declared. The one column that records
    an act of checking is the desk's physical inspection, which lives on the
    registration desk rather than here.
    """
    rows = []
    for person in record["exhibitors"]:
        missing = []
        if record["association_code"] and not person["member_number"]:
            missing.append(f"{record['association_code']} membership number")
        if person["membership_lapsed"]:
            missing.append("membership lapses before the show ends")
        if person["horses_without_registration"]:
            missing.append(
                f"{person['horses_without_registration']} horse(s) with no registration number"
            )
        if person["entries_needing_relationship"]:
            missing.append(
                f"{person['entries_needing_relationship']} entry(s) with no relationship to owner"
            )
        rows.append({
            "_sort": (
                0 if missing else 1,
                person["back_number"] if person["back_number"] is not None else 99999,
                person["name"].lower(),
            ),
            "back_number": _dash(person["back_number"]),
            "exhibitor": person["name"],
            "member_number": _dash(person["member_number"]),
            "member_expires": _dash(person["member_expires_at"]),
            "entries": person["entry_count"],
            "horses": person["horse_count"],
            "divisions": ", ".join(person["divisions"]) or "—",
            "attestations": str(person["attestation_count"]) if person["attestation_count"] else "—",
            "missing": "; ".join(missing) or "Nothing outstanding",
        })
    rows.sort(key=lambda r: r["_sort"])
    for row in rows:
        del row["_sort"]

    notes = [
        "Nothing on this sheet changes a placing. AM-300.E.4 is explicit that an "
        "exhibitor who fails the ownership requirement loses their points but "
        "keeps their placings, and everyone else's placings are unaffected — so "
        "this is a report the office forwards, never an input that recomputes a "
        "class.",
        "None of it is verified by the app. A membership number is what somebody "
        "typed and an attestation is what somebody declared. What the office "
        "physically inspected is recorded separately, at the registration desk.",
        "Membership expiry is judged against the show's end date, not today: a "
        "card that lapses on the Saturday of a three-day show is exactly what "
        "the office needs to chase.",
    ]
    if not record["association_code"]:
        notes.insert(
            0,
            "This show has no breed association, so there is no membership or "
            "registration requirement to report against.",
        )
    return {
        "columns": [
            _col("back_number", "Back #", right=True),
            _col("exhibitor", "Exhibitor"),
            _col("member_number", "Member #"),
            _col("member_expires", "Expires"),
            _col("entries", "Entries", right=True),
            _col("horses", "Horses", right=True),
            _col("divisions", "Divisions"),
            _col("attestations", "Declarations"),
            _col("missing", "Outstanding"),
        ],
        "rows": rows,
        "totals": {},
        "notes": notes,
    }


def _attestations(record: dict) -> dict:
    """Every eligibility declaration made at entry, with its exact wording.

    The statement is quoted in full rather than referenced. APHA revises its
    Novice limits, and a report that named the rule instead of the words would
    silently restate what somebody agreed to two seasons ago — the same reason
    the row stores its own copy (migration 118).
    """
    rows = []
    for entry in record["entries"]:
        cls = record["classes_by_id"].get(entry["class_id"], {})
        for attestation in entry["attestations"]:
            rows.append({
                "back_number": _dash(entry["back_number"]),
                "exhibitor": entry["exhibitor_name"],
                "horse": _dash(entry["horse_name"]),
                "class_number": cls.get("class_number", "—"),
                "division": _dash(entry["apha_division_label"]),
                "declared_by": _dash(attestation["attested_by_name"]),
                "declared_at": _dash(attestation["attested_at"]),
                "statement": attestation["statement"],
            })
    notes = [
        "The wording is the copy stored with each declaration, not a lookup. "
        "APHA revises its Novice limits, and quoting the current rule would "
        "misstate what somebody agreed to in an earlier season.",
        "These are declarations, not checks. The rule book puts eligibility on "
        "the exhibitor and the burden of proof on whoever protests; the app "
        "holds no points or earnings database and never will.",
    ]
    if not rows:
        notes = [
            "No eligibility declarations were made. They are asked for on Novice "
            "Amateur and Novice Youth entries (AM-205, YP-255.A.1)."
        ]
    return {
        "columns": [
            _col("back_number", "Back #", right=True),
            _col("exhibitor", "Exhibitor"),
            _col("horse", "Horse"),
            _col("class_number", "Class"),
            _col("division", "Division"),
            _col("declared_by", "Declared by"),
            _col("declared_at", "When"),
            _col("statement", "Statement"),
        ],
        "rows": rows,
        "totals": {},
        "notes": notes,
    }


_REPORTS: dict[str, dict] = {
    "results": {
        "title": "Show Results",
        "description": "Every posted placing, by class and by judge, with back numbers, registration and membership numbers.",
        "build": _results,
    },
    "class-summary": {
        "title": "Class Summary",
        "description": "One row per class — entries, cards filed, pattern posting, and whether the results are posted.",
        "build": _class_summary,
    },
    "entry-cards": {
        "title": "Entry Cards",
        "description": "Every entry taken, with the horse, the membership and registration numbers, the division and the fee.",
        "build": _entry_cards,
    },
    "judge-cards": {
        "title": "Judges' Cards",
        "description": "The maneuvers, penalties and totals recorded off each judge's card, and any override.",
        "build": _judge_cards,
    },
    "compliance": {
        "title": "Compliance Sheet",
        "description": "What is on file per exhibitor and what is outstanding. Never changes a placing.",
        "build": _compliance,
    },
    "attestations": {
        "title": "Eligibility Declarations",
        "description": "Every Novice eligibility declaration made at entry, quoted in the words the entrant agreed to.",
        "build": _attestations,
    },
}

# The reports SC-110.J asks management to retain for a year, in the order they
# make sense to read: what ran, what was placed, what was entered, and the
# working behind the scores.
RETENTION_SLUGS = ("class-summary", "results", "entry-cards", "judge-cards")


def list_reports() -> list[dict]:
    """Every report the module can produce, in the order they are offered."""
    return [
        {"slug": slug, "title": spec["title"], "description": spec["description"]}
        for slug, spec in _REPORTS.items()
    ]


def get_report_spec(slug: str) -> Optional[dict]:
    return _REPORTS.get(slug)


def build_report(slug: str, record: dict) -> Optional[dict]:
    """Run one report against an already-assembled show record."""
    spec = _REPORTS.get(slug)
    if spec is None:
        return None
    built: Callable[[dict], dict] = spec["build"]
    return {
        "slug": slug,
        "title": spec["title"],
        "description": spec["description"],
        **built(record),
    }
