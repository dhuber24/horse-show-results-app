"""What the office sends the association after the show.

Before Phase 4 this was one endpoint that returned an entry list. The reports
here are the record of what actually happened: what ran, what was placed, what
was entered, the working behind the scores, and what is outstanding on paper.

Every report is built from a payload `routers/show_reports.py` assembles once
and none of them query, so these run against a plain dict — which is the point
of the registry, not a convenience for the tests.
"""
from datetime import date
from uuid import uuid4

import pytest

from show_reports import RETENTION_SLUGS, build_report, list_reports


CLASS_A, CLASS_B = uuid4(), uuid4()
JUDGE_ONE, JUDGE_TWO = uuid4(), uuid4()
ENTRY_ONE, ENTRY_TWO = uuid4(), uuid4()
EXHIBITOR_ONE, EXHIBITOR_TWO = uuid4(), uuid4()
HORSE_ONE, HORSE_TWO = uuid4(), uuid4()


def a_class(class_id, number, *, posted=True, score_type="pattern", entries=2, **over):
    return {
        "id": class_id,
        "class_number": number,
        "class_name": f"Class {number}",
        "class_date": date(2026, 6, 12),
        "sort_order": 0,
        "score_type": score_type,
        "entry_fee_cents": 3500,
        "results_published_at": "2026-06-12T18:00:00Z" if posted else None,
        "pattern_posted_at": None,
        "association_class_code": "204100",
        "entry_count": entries,
        **over,
    }


def an_entry(entry_id, exhibitor_id, horse_id, class_id, **over):
    return {
        "id": entry_id,
        "class_id": class_id,
        "exhibitor_id": exhibitor_id,
        "exhibitor_name": "Ann Reed",
        "back_number": 42,
        "horse_id": horse_id,
        "horse_name": "Dusty Gold",
        "registration_number": "APH-123",
        "member_number": "M-900",
        "member_expires_at": date(2026, 12, 31),
        "apha_division": "AMATEUR",
        "apha_division_label": "Amateur",
        "relationship_to_owner": "Self",
        "status": "ENTERED",
        "attestations": [],
        **over,
    }


def a_result(entry_id, class_id, judge_id, **over):
    return {
        "entry_id": entry_id,
        "class_id": class_id,
        "judge_id": judge_id,
        "place": 1,
        "raw_score": 71.5,
        "is_tie": False,
        "outcome": "placed",
        "outcome_note": None,
        **over,
    }


def a_record(*, classes=None, entries=None, results=None, cards=None, exhibitors=None, **over):
    classes = classes if classes is not None else [a_class(CLASS_A, "1")]
    entries = entries if entries is not None else [
        an_entry(ENTRY_ONE, EXHIBITOR_ONE, HORSE_ONE, CLASS_A)
    ]
    results = results if results is not None else [a_result(ENTRY_ONE, CLASS_A, JUDGE_ONE)]
    judges = over.pop("judges", [{"id": JUDGE_ONE, "name": "Pat Hale", "sort_order": 0}])
    record = {
        "show_id": uuid4(),
        "show_name": "Paint-O-Rama",
        "show_type_code": "APHA",
        "association_code": "APHA",
        "apha_show_number": "12345",
        "start_date": date(2026, 6, 12),
        "end_date": date(2026, 6, 14),
        "judges": judges,
        "judges_by_id": {j["id"]: j for j in judges},
        "classes": classes,
        "classes_by_id": {c["id"]: c for c in classes},
        "entries": entries,
        "entries_by_id": {e["id"]: e for e in entries},
        "results": results,
        "cards": cards or [],
        "filed_cards": {(r["class_id"], r["judge_id"]) for r in results},
        "exhibitors": exhibitors if exhibitors is not None else [],
        **over,
    }
    return record


def rows(slug, record):
    return build_report(slug, record)["rows"]


def notes(slug, record):
    return " ".join(build_report(slug, record)["notes"])


# ── The registry ──────────────────────────────────────────────────────────────

def test_every_report_runs_against_an_empty_show():
    """A show with nothing in it is the state every report is first opened in."""
    empty = a_record(classes=[], entries=[], results=[])
    for spec in list_reports():
        report = build_report(spec["slug"], empty)
        assert report["rows"] == []
        assert report["columns"], f"{spec['slug']} has no columns"


def test_an_unknown_slug_is_not_a_report():
    assert build_report("nonsense", a_record()) is None


def test_the_retention_bundle_names_real_reports():
    known = {spec["slug"] for spec in list_reports()}
    assert set(RETENTION_SLUGS) <= known


# ── Results ───────────────────────────────────────────────────────────────────

def test_an_unposted_class_is_left_out_of_the_results():
    """Posting a class is what makes its placings official. A report the office
    forwards must not be where a half-typed card first counts as a result."""
    record = a_record(
        classes=[a_class(CLASS_A, "1", posted=False)],
        results=[a_result(ENTRY_ONE, CLASS_A, JUDGE_ONE)],
    )

    assert rows("results", record) == []
    assert "have not been posted" in notes("results", record)


def test_a_posted_class_carries_the_identifiers_the_association_asks_for():
    row = rows("results", a_record())[0]

    assert row["back_number"] == "42"
    assert row["member_number"] == "M-900"
    assert row["registration_number"] == "APH-123"
    assert row["class_code"] == "204100"
    assert row["judge"] == "Pat Hale"


def test_a_panel_lists_the_same_horse_once_per_card():
    """The app does not combine cards into one official placing — that is a
    rules decision, and the report says so rather than picking a winner."""
    judges = [
        {"id": JUDGE_ONE, "name": "Pat Hale", "sort_order": 0},
        {"id": JUDGE_TWO, "name": "Lee Marsh", "sort_order": 1},
    ]
    record = a_record(
        judges=judges,
        results=[
            a_result(ENTRY_ONE, CLASS_A, JUDGE_ONE, place=1),
            a_result(ENTRY_ONE, CLASS_A, JUDGE_TWO, place=3),
        ],
    )

    result = build_report("results", record)
    assert [r["place"] for r in result["rows"]] == ["1", "3"]
    assert "once per card" in " ".join(result["notes"])


def test_a_placing_that_is_not_a_placing_says_what_happened():
    """Migration 121 — a blank in the place column reads as unjudged."""
    record = a_record(
        results=[a_result(ENTRY_ONE, CLASS_A, JUDGE_ONE, place=None, outcome="disqualified")]
    )

    assert rows("results", record)[0]["place"] == "Disqualified"


def test_a_score_is_printed_as_the_judge_called_it():
    """71.500 is what a NUMERIC(10,3) hands back; 71.5 is what was called."""
    record = a_record(results=[a_result(ENTRY_ONE, CLASS_A, JUDGE_ONE, raw_score=71.5)])

    assert rows("results", record)[0]["score"] == "71.5"


def test_an_unattributed_card_is_named_rather_than_left_blank():
    record = a_record(
        judges=[],
        results=[a_result(ENTRY_ONE, CLASS_A, None)],
    )

    assert rows("results", record)[0]["judge"] == "Unattributed"


def test_an_open_show_says_why_the_registration_columns_are_empty():
    record = a_record(association_code=None)

    assert "no breed association" in notes("results", record)


# ── Entry cards ───────────────────────────────────────────────────────────────

def test_a_withdrawn_entry_is_listed_and_marked():
    """It was taken and then pulled, which is part of the show's record — and
    dropping it would make this sheet disagree with the money."""
    record = a_record(
        entries=[
            an_entry(ENTRY_ONE, EXHIBITOR_ONE, HORSE_ONE, CLASS_A),
            an_entry(ENTRY_TWO, EXHIBITOR_TWO, HORSE_TWO, CLASS_A, status="WITHDRAWN"),
        ]
    )

    statuses = [r["status"] for r in rows("entry-cards", record)]
    assert sorted(statuses) == ["Entered", "Withdrawn"]


def test_entry_cards_do_not_depend_on_the_class_being_posted():
    """An entry is a document in its own right — it exists whether or not the
    class has been judged."""
    record = a_record(classes=[a_class(CLASS_A, "1", posted=False)])

    assert len(rows("entry-cards", record)) == 1


# ── Judges' cards ─────────────────────────────────────────────────────────────

def test_a_card_shows_its_working_and_its_total():
    record = a_record(cards=[{
        "class_id": CLASS_A,
        "entry_id": ENTRY_ONE,
        "judge_id": JUDGE_ONE,
        "system_name": "Equitation — on the flat",
        "computed_score": 71.5,
        "effective_score": 71.5,
        "is_overridden": False,
        "override_reason": None,
        "maneuvers": [{"sequence": 1, "score": 1.0}, {"sequence": 2, "score": 0.5}],
        "penalties": [{"label": "Wrong lead", "value": 5.0, "sequence": 2}],
    }])

    row = rows("judge-cards", record)[0]
    assert row["maneuvers"] == "1, 0.5"
    assert row["penalties"] == "Wrong lead (5 @ 2)"
    assert row["computed"] == "71.5"


def test_an_unmarked_maneuver_is_not_shown_as_a_zero():
    record = a_record(cards=[{
        "class_id": CLASS_A, "entry_id": ENTRY_ONE, "judge_id": JUDGE_ONE,
        "system_name": None, "computed_score": None, "effective_score": None,
        "is_overridden": False, "override_reason": None,
        "maneuvers": [{"sequence": 1, "score": 1.0}, {"sequence": 2, "score": None}],
        "penalties": [],
    }])

    assert rows("judge-cards", record)[0]["maneuvers"] == "1, ·"


def test_the_cards_report_says_it_is_not_the_signed_card():
    """SC-110.J asks for the original signed placing cards, which are paper."""
    record = a_record(cards=[{
        "class_id": CLASS_A, "entry_id": ENTRY_ONE, "judge_id": JUDGE_ONE,
        "system_name": None, "computed_score": 70.0, "effective_score": 70.0,
        "is_overridden": False, "override_reason": None,
        "maneuvers": [], "penalties": [],
    }])

    assert "not the original" in notes("judge-cards", record)


def test_no_cards_explains_itself_rather_than_showing_an_empty_table():
    assert "always have" in notes("judge-cards", a_record())


# ── Class summary ─────────────────────────────────────────────────────────────

def test_the_class_summary_counts_the_judges_who_filed_against_the_panel():
    judges = [
        {"id": JUDGE_ONE, "name": "Pat Hale", "sort_order": 0},
        {"id": JUDGE_TWO, "name": "Lee Marsh", "sort_order": 1},
    ]
    record = a_record(judges=judges, results=[a_result(ENTRY_ONE, CLASS_A, JUDGE_ONE)])

    assert rows("class-summary", record)[0]["judges_filed"] == "1 of 2"


def test_a_draft_class_is_marked_as_one():
    record = a_record(classes=[a_class(CLASS_A, "1", posted=False)])

    assert rows("class-summary", record)[0]["posted"] == "Draft"


def test_pattern_posting_is_only_asked_of_pattern_classes():
    record = a_record(
        classes=[
            a_class(CLASS_A, "1", score_type="pattern"),
            a_class(CLASS_B, "2", score_type="placement"),
        ]
    )

    by_number = {r["class_number"]: r for r in rows("class-summary", record)}
    assert by_number["1"]["pattern_posted"] == "Not recorded"
    assert by_number["2"]["pattern_posted"] == "—"


# ── Compliance ────────────────────────────────────────────────────────────────

def a_person(**over):
    return {
        "name": "Ann Reed",
        "back_number": 42,
        "member_number": "M-900",
        "member_expires_at": date(2026, 12, 31),
        "membership_lapsed": False,
        "entry_count": 3,
        "horse_count": 1,
        "horses_without_registration": 0,
        "divisions": ["Amateur"],
        "attestation_count": 0,
        "entries_needing_relationship": 0,
        **over,
    }


def test_a_complete_exhibitor_has_nothing_outstanding():
    record = a_record(exhibitors=[a_person()])

    assert rows("compliance", record)[0]["missing"] == "Nothing outstanding"


def test_a_missing_membership_number_is_named():
    record = a_record(exhibitors=[a_person(member_number=None)])

    assert "APHA membership number" in rows("compliance", record)[0]["missing"]


def test_a_membership_lapsing_during_the_show_is_reported():
    record = a_record(exhibitors=[a_person(membership_lapsed=True)])

    assert "lapses before the show ends" in rows("compliance", record)[0]["missing"]


def test_exhibitors_with_something_outstanding_come_first():
    record = a_record(exhibitors=[
        a_person(name="Complete", back_number=1),
        a_person(name="Incomplete", back_number=99, member_number=None),
    ])

    assert [r["exhibitor"] for r in rows("compliance", record)] == ["Incomplete", "Complete"]


def test_the_compliance_sheet_says_it_never_changes_a_placing():
    """AM-300.E.4 — an exhibitor who fails the ownership requirement loses their
    points and keeps their placings, and everyone else's are unaffected."""
    text = notes("compliance", a_record(exhibitors=[a_person()]))

    assert "never an input that recomputes" in text
    assert "None of it is verified by the app" in text


def test_an_open_show_has_no_membership_to_report_against():
    record = a_record(association_code=None, exhibitors=[a_person(member_number=None)])

    assert "no membership or registration requirement" in notes("compliance", record)
    assert rows("compliance", record)[0]["missing"] == "Nothing outstanding"


# ── Attestations ──────────────────────────────────────────────────────────────

def test_a_declaration_is_quoted_in_full():
    """The stored copy, not a lookup — APHA revises its Novice limits, and
    quoting the current rule would misstate what somebody agreed to."""
    statement = "I declare that I have not exceeded the Novice Amateur limits."
    record = a_record(entries=[
        an_entry(
            ENTRY_ONE, EXHIBITOR_ONE, HORSE_ONE, CLASS_A,
            attestations=[{
                "kind": "novice_eligibility",
                "statement": statement,
                "attested_by_name": "Ann Reed",
                "attested_at": date(2026, 5, 1),
            }],
        )
    ])

    row = rows("attestations", record)[0]
    assert row["statement"] == statement
    assert row["declared_by"] == "Ann Reed"


def test_no_declarations_explains_when_they_are_asked_for():
    assert "Novice" in notes("attestations", a_record())
