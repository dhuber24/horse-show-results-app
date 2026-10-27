"""The show's results as data, in the columns the office picks.

`data_export.py` builds from the record `routers/show_reports.py` assembles plus
its `export` extras, and queries nothing -- so these run against a plain dict,
the same way the report registry's tests do.
"""
from datetime import date
from uuid import uuid4

from data_export import ENTRIES, PLACINGS, build_data_export

CLASS_A, CLASS_B = uuid4(), uuid4()
JUDGE_ONE, JUDGE_TWO = uuid4(), uuid4()
ENTRY_ONE, ENTRY_TWO = uuid4(), uuid4()
EXHIBITOR_ONE, EXHIBITOR_TWO = uuid4(), uuid4()
HORSE_ONE, HORSE_TWO = uuid4(), uuid4()
APHA, WSCA, MNSPHC, NSBA, AQHA = uuid4(), uuid4(), uuid4(), uuid4(), uuid4()

ASSOCIATIONS = {
    APHA: {"id": APHA, "code": "APHA", "name": "American Paint Horse Association", "association_type": "breed"},
    AQHA: {"id": AQHA, "code": "AQHA", "name": "American Quarter Horse Association", "association_type": "breed"},
    WSCA: {"id": WSCA, "code": "WSCA", "name": "Western Saddle Clubs Association", "association_type": "club"},
    MNSPHC: {"id": MNSPHC, "code": "MNSPHC", "name": "Minnesota North Star Paint Horse Club", "association_type": "club"},
    NSBA: {"id": NSBA, "code": "NSBA", "name": "National Snaffle Bit Association", "association_type": "club"},
}


def a_class(class_id, number, *, posted=True, **over):
    return {
        "id": class_id,
        "class_number": number,
        "class_name": f"Class {number}",
        "class_date": date(2026, 6, 12),
        "sort_order": 0,
        "score_type": "placement",
        "entry_fee_cents": 3500,
        "results_published_at": "2026-06-12T18:00:00Z" if posted else None,
        "pattern_posted_at": None,
        "association_class_code": "204100",
        "entry_count": 2,
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


def a_person(**over):
    return {
        "date_of_birth": date(2009, 6, 3),
        "city": "Hinckley",
        "state": "MN",
        "zip": "55037",
        "phone": "320-555-0100",
        "email": "ann@example.com",
        "competition_cards": [],
        "memberships": {APHA: {"number": "M-900", "expires_at": date(2026, 12, 31)}},
        **over,
    }


def a_horse(**over):
    return {
        "barn_name": "Dusty",
        "foaling_year": 2018,
        "sex": "Gelding",
        "breed": "Paint",
        "color": "Bay Tobiano",
        "owner": "Ann Reed",
        "trainer": None,
        "registrations": {APHA: "APH-123"},
        **over,
    }


def a_record(*, classes=None, entries=None, results=None, people=None, horses=None,
             show_association_ids=None, class_extras=None, judges=None):
    classes = classes if classes is not None else [a_class(CLASS_A, "1")]
    entries = entries if entries is not None else [an_entry(ENTRY_ONE, EXHIBITOR_ONE, HORSE_ONE, CLASS_A)]
    results = results if results is not None else [a_result(ENTRY_ONE, CLASS_A, JUDGE_ONE)]
    judges = judges if judges is not None else [{"id": JUDGE_ONE, "name": "Pat Hale", "sort_order": 0}]
    return {
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
        "cards": [],
        "filed_cards": set(),
        "exhibitors": [],
        "export": {
            "show": {"company": "MNSPHC", "venue": "Double F Arena", "venue_location": "Hinckley, MN"},
            "associations": ASSOCIATIONS,
            "show_association_ids": (
                show_association_ids if show_association_ids is not None else [APHA, WSCA, MNSPHC]
            ),
            "classes": class_extras if class_extras is not None else {
                CLASS_A: {
                    "division": "Amateur",
                    "discipline": "Western Pleasure",
                    "high_point_eligible": True,
                    "sanctioned_by": ["WSCA", "MNSPHC"],
                    "shown_count": 2,
                },
            },
            "entries": {e["id"]: {"gate_no_show": False} for e in entries},
            "exhibitors": people if people is not None else {EXHIBITOR_ONE: a_person()},
            "horses": horses if horses is not None else {HORSE_ONE: a_horse()},
            "judge_associations": {JUDGE_ONE: ["WSCA", "APHA"]},
        },
    }


def fields_by_key(export):
    return {f["key"]: f for f in export["fields"]}


# ── The columns on offer ──────────────────────────────────────────────────────

def test_every_offered_column_is_in_every_row_of_its_kind():
    export = build_data_export(a_record())
    for kind in (PLACINGS, ENTRIES):
        keys = {f["key"] for f in export["fields"] if kind in f["kinds"]}
        assert export[kind], kind
        for row in export[kind]:
            assert keys <= set(row), keys - set(row)


def test_column_keys_are_unique_and_belong_to_a_group():
    export = build_data_export(a_record())
    keys = [f["key"] for f in export["fields"]]
    assert len(keys) == len(set(keys))
    groups = {g["key"] for g in export["groups"]}
    assert {f["group"] for f in export["fields"]} <= groups


def test_a_placing_column_is_not_offered_for_entries():
    fields = fields_by_key(build_data_export(a_record()))
    assert fields["place"]["kinds"] == [PLACINGS]
    assert fields["judge"]["kinds"] == [PLACINGS]
    assert set(fields["horse_name"]["kinds"]) == {PLACINGS, ENTRIES}


def test_the_ids_are_on_by_default_because_names_do_not_join_shows():
    fields = fields_by_key(build_data_export(a_record()))
    assert fields["exhibitor_id"]["default"]
    assert fields["horse_id"]["default"]
    # Contact details are the office's to choose to send on.
    assert not fields["email"]["default"]
    assert not fields["date_of_birth"]["default"]


# ── Membership and registration columns, per body ─────────────────────────────

def test_every_body_the_show_runs_under_gets_columns():
    fields = fields_by_key(build_data_export(a_record()))
    for code in ("APHA", "WSCA", "MNSPHC"):
        assert f"member:{code}" in fields
        assert f"registration:{code}" in fields


def test_a_body_nobody_holds_and_the_show_does_not_run_under_gets_none():
    # One column per body in the registry would be hundreds once every saddle
    # club is in it.
    fields = fields_by_key(build_data_export(a_record()))
    assert "member:AQHA" not in fields
    assert "registration:AQHA" not in fields


def test_a_number_held_with_another_body_is_still_exported():
    person = a_person(memberships={
        APHA: {"number": "M-900", "expires_at": None},
        NSBA: {"number": "N-77", "expires_at": None},
    })
    export = build_data_export(a_record(people={EXHIBITOR_ONE: person}))
    assert fields_by_key(export)["member:NSBA"]["default"]
    assert export[PLACINGS][0]["member:NSBA"] == "N-77"


def test_an_empty_body_column_is_offered_but_off():
    # WSCA numbers neither riders nor horses; its column is there to tick, not
    # ticked for the office.
    fields = fields_by_key(build_data_export(a_record()))
    assert not fields["member:WSCA"]["default"]
    assert not fields["registration:WSCA"]["default"]
    assert fields["member:APHA"]["default"]
    assert fields["registration:APHA"]["default"]


def test_breed_bodies_come_before_clubs():
    fields = [f["key"] for f in build_data_export(a_record())["fields"] if f["key"].startswith("member:")]
    assert fields[0] == "member:APHA"


def test_membership_and_registration_cells_carry_the_numbers():
    row = build_data_export(a_record())[PLACINGS][0]
    assert row["member:APHA"] == "M-900"
    assert row["member_expires:APHA"] == "2026-12-31"
    assert row["registration:APHA"] == "APH-123"
    assert row["member:WSCA"] is None


# ── Rows ──────────────────────────────────────────────────────────────────────

def test_an_unposted_class_has_entries_but_no_placings():
    record = a_record(
        classes=[a_class(CLASS_A, "1", posted=False)],
    )
    export = build_data_export(record)
    assert export[PLACINGS] == []
    assert len(export[ENTRIES]) == 1
    assert "not posted yet" in " ".join(export["notes"])


def test_a_panel_gives_one_placing_row_per_card():
    judges = [
        {"id": JUDGE_ONE, "name": "Pat Hale", "sort_order": 0},
        {"id": JUDGE_TWO, "name": "Lee Moss", "sort_order": 1},
    ]
    record = a_record(
        judges=judges,
        results=[
            a_result(ENTRY_ONE, CLASS_A, JUDGE_ONE, place=1),
            a_result(ENTRY_ONE, CLASS_A, JUDGE_TWO, place=3),
        ],
    )
    rows = build_data_export(record)[PLACINGS]
    assert [(r["judge"], r["place"]) for r in rows] == [("Pat Hale", 1), ("Lee Moss", 3)]


def test_the_class_carries_its_size_and_the_clubs_that_sanction_it():
    row = build_data_export(a_record())[PLACINGS][0]
    assert row["shown_count"] == 2
    assert row["entered_count"] == 2
    assert row["sanctioned_by"] == "MNSPHC; WSCA"
    assert row["class_division"] == "Amateur"


def test_the_judges_associations_are_listed():
    row = build_data_export(a_record())[PLACINGS][0]
    assert row["judge_associations"] == "APHA; WSCA"


def test_cells_are_plain_spreadsheet_values():
    row = build_data_export(a_record())[PLACINGS][0]
    assert row["show_start_date"] == "2026-06-12"
    assert row["birth_year"] == 2009
    assert row["date_of_birth"] == "2009-06-03"
    assert row["tie"] == "No"
    assert row["high_point_eligible"] == "Yes"
    assert row["trainer"] is None


def test_a_placing_that_is_not_a_placing_says_what_happened():
    record = a_record(results=[a_result(ENTRY_ONE, CLASS_A, JUDGE_ONE, place=None, outcome="disqualified")])
    row = build_data_export(record)[PLACINGS][0]
    assert row["outcome"] == "Disqualified"
    assert row["place"] is None
    assert build_data_export(a_record())[PLACINGS][0]["outcome"] == "Placed"


def test_a_scratch_is_listed_and_marked_in_the_entries():
    record = a_record(
        entries=[
            an_entry(ENTRY_ONE, EXHIBITOR_ONE, HORSE_ONE, CLASS_A, back_number=7),
            an_entry(ENTRY_TWO, EXHIBITOR_TWO, HORSE_TWO, CLASS_A, back_number=3, status="WITHDRAWN"),
        ],
        people={EXHIBITOR_ONE: a_person(), EXHIBITOR_TWO: a_person()},
        horses={HORSE_ONE: a_horse(), HORSE_TWO: a_horse()},
    )
    rows = build_data_export(record)[ENTRIES]
    assert [(r["back_number"], r["entry_status"]) for r in rows] == [(3, "Scratched"), (7, "Entered")]


def test_an_entry_with_no_horse_still_exports():
    record = a_record(entries=[an_entry(ENTRY_ONE, EXHIBITOR_ONE, None, CLASS_A, horse_name=None)])
    row = build_data_export(record)[ENTRIES][0]
    assert row["horse_id"] is None
    assert row["registration:APHA"] is None


def test_the_file_says_it_applies_nobodys_rules():
    notes = " ".join(build_data_export(a_record())["notes"])
    assert "decide who is eligible" in notes
    assert "not checked against" in notes
