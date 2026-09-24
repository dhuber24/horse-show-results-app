"""A show set up from its own show bill: what is trusted, matched and refused.

The model reads the bill; everything here is what happens either side of a
person reviewing that read. Four kinds of rule are pinned:

* **The read is cleaned, not trusted** (`normalize_showbill`). Structured outputs
  guarantee a shape, not a meaning -- a date that is not a date, a class
  pointing at a price that does not exist, an early rate with no deadline all
  have to come back as blanks the reviewer can see, never as values that look
  read off the page.
* **A match is a suggestion with a reason** (`match_judge`, `match_venue`,
  `match_association`, `prepare_draft`). A name is not an identity: one exact
  match is suggested, two people of one name are both offered and neither is
  picked.
* **Classes route the way the Class Builder routes them** (`resolve_discipline`),
  with the heading the bill printed a class under taken as the better evidence.
* **The reviewed payload is refused whole, with every problem named**
  (`apply_problems`, `fee_problems`), because the person fixing it is looking at
  a table of a hundred-odd rows.

The SQL in `apply_import` is not tested here: the repo's tests run without a
database on purpose (see `tests/factories.py`).
"""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from extraction.showbill import FEE_UNITS, SHOWBILL_SCHEMA, normalize_showbill
from schemas import ShowBillImportApply
from showbill_import import (
    READ_TIMEOUT,
    apply_problems,
    class_fee_cents,
    effective_status,
    fee_codes,
    fee_problems,
    match_association,
    match_judge,
    match_venue,
    prepare_draft,
    resolve_discipline,
)


def raw_read(**overrides):
    """A minimal model read, shaped the way the structured output returns it."""
    base = {
        "show": {
            "name": "Splash of Color",
            "start_date": "2027-08-21",
            "end_date": "2027-08-22",
            "entry_deadline": None,
            "breed_association": "APHA",
            "apha_show_number": None,
            "aqha_show_number": None,
            "apha_zone": None,
            "venue_name": "Double F Arena",
            "venue_address": None,
            "venue_city": "Hinckley",
            "venue_state": "MN",
            "shavings_ban_outside": True,
            "requires_coggins": True,
            "requires_health_certificate": None,
            "health_certificate_valid_days": None,
            "requires_vaccination": None,
            "staff": [],
        },
        "judges": [],
        "clubs": [],
        "class_rates": [],
        "classes": [],
        "fees": [],
        "not_imported": [],
        "warnings": [],
    }
    base.update(overrides)
    return base


def a_class(**overrides):
    base = {
        "date": "2027-08-21",
        "number": "1",
        "name": "Amateur Stallions All Ages",
        "discipline": "Halter",
        "bracket": "Amateur",
        "association_class_code": "AMH1",
        "rate_key": None,
        "club_codes": [],
        "is_championship": False,
        "is_futurity": False,
        "note": None,
    }
    base.update(overrides)
    return base


# ── The schema the model is held to ───────────────────────────────────────────

def _objects(schema):
    """Every object schema in the tree, however deeply nested."""
    if isinstance(schema, dict):
        if schema.get("type") == "object":
            yield schema
        for value in schema.values():
            yield from _objects(value)
    elif isinstance(schema, list):
        for value in schema:
            yield from _objects(value)


def test_every_object_in_the_schema_is_closed_and_fully_required():
    """Structured outputs refuse a schema that leaves an object open or a
    property optional. That is a 400 on every upload, found only in production,
    so it is pinned here instead."""
    objects = list(_objects(SHOWBILL_SCHEMA))
    assert len(objects) > 5
    for obj in objects:
        assert obj["additionalProperties"] is False
        assert sorted(obj["required"]) == sorted(obj["properties"])


def test_the_schema_uses_no_constraint_structured_outputs_rejects():
    text = repr(SHOWBILL_SCHEMA)
    for keyword in ("'minimum'", "'maximum'", "'minLength'", "'maxLength'", "'minItems'", "'maxItems'"):
        assert keyword not in text


def test_the_withdrawn_fee_units_are_not_offered_to_the_model():
    assert "per_class_per_horse" not in FEE_UNITS
    assert "percent_of_entry" not in FEE_UNITS


# ── Cleaning the read ─────────────────────────────────────────────────────────

def test_a_date_that_is_not_a_date_is_blanked_and_reported():
    read = normalize_showbill(raw_read(classes=[a_class(date="Saturday")]))
    assert read["classes"][0]["date"] is None
    assert any("date" in w for w in read["warnings"])


def test_a_reversed_date_range_is_left_for_the_reviewer_rather_than_guessed():
    show = raw_read()["show"] | {"start_date": "2027-08-22", "end_date": "2027-08-21"}
    read = normalize_showbill(raw_read(show=show))
    assert read["show"]["start_date"] is None and read["show"]["end_date"] is None
    assert read["warnings"]


def test_a_class_pointing_at_a_rate_that_does_not_exist_comes_back_unpriced():
    read = normalize_showbill(
        raw_read(
            class_rates=[
                {"key": "open", "label": "Open", "amount_cents": 900, "per_judge": True,
                 "association_code": None, "printed_text": "$9 per judge"},
            ],
            classes=[a_class(rate_key="open"), a_class(number="2", name="Yearling Stallions", rate_key="youth")],
        )
    )
    assert read["classes"][0]["rate_key"] == "open"
    assert read["classes"][1]["rate_key"] is None
    assert any("youth" in w for w in read["warnings"])


def test_an_early_rate_without_its_deadline_is_dropped_not_half_kept():
    """The fee editors refuse half a pair; a read must not smuggle one in."""
    read = normalize_showbill(
        raw_read(
            fees=[
                {"label": "Stall", "amount_cents": 9000, "unit": "per_stall", "notes": None,
                 "early_amount_cents": 7500, "early_deadline": None, "min_quantity": None},
            ]
        )
    )
    fee = read["fees"][0]
    assert fee["early_amount_cents"] is None and fee["early_deadline"] is None


def test_a_zone_outside_apha_numbering_is_dropped():
    show = raw_read()["show"] | {"apha_zone": 22}
    assert normalize_showbill(raw_read(show=show))["show"]["apha_zone"] is None


def test_a_club_printed_twice_is_one_club():
    club = {"code": "WSCA", "name": None, "fee_amount_cents": None, "fee_unit": None, "fee_text": None}
    read = normalize_showbill(raw_read(clubs=[club, club | {"code": "wsca"}]))
    assert len(read["clubs"]) == 1


def test_whitespace_in_a_printed_name_is_folded():
    read = normalize_showbill(raw_read(classes=[a_class(name="  Amateur   Stallions\nAll Ages ")]))
    assert read["classes"][0]["name"] == "Amateur Stallions All Ages"


# ── The read's status ─────────────────────────────────────────────────────────

NOW = datetime(2027, 3, 1, 12, 0, tzinfo=timezone.utc)


def test_a_read_still_running_is_pending():
    assert effective_status("pending", NOW - timedelta(minutes=3), NOW) == "pending"


def test_a_read_nobody_finished_is_reported_as_failed_rather_than_spinning_forever():
    assert effective_status("pending", NOW - READ_TIMEOUT - timedelta(seconds=1), NOW) == "failed"


def test_a_finished_read_is_never_rewritten_by_its_age():
    assert effective_status("succeeded", NOW - timedelta(days=30), NOW) == "succeeded"


# ── Matching names against the registry ───────────────────────────────────────

def judge(first, last):
    return SimpleNamespace(id=uuid4(), first_name=first, last_name=last)


def test_one_exact_name_match_is_suggested_and_says_why():
    josh = judge("Josh", "Tjosaas")
    match = match_judge("JOSH", "Tjosaas", [josh, judge("Tim", "Crowley")])
    assert match["suggested_judge_id"] == josh.id
    assert match["matched_on"] == "name"


def test_two_people_of_one_name_are_both_offered_and_neither_picked():
    a, b = judge("Sarah", "Johnson"), judge("Sarah", "Johnson")
    match = match_judge("Sarah", "Johnson", [a, b])
    assert match["suggested_judge_id"] is None
    assert set(match["candidate_judge_ids"]) == {a.id, b.id}


def test_a_different_first_name_is_a_candidate_never_a_suggestion():
    timothy = judge("Timothy", "Crowley")
    match = match_judge("Tim", "Crowley", [timothy])
    assert match["suggested_judge_id"] is None
    assert match["candidate_judge_ids"] == [timothy.id]


def test_punctuation_and_case_do_not_hide_a_match():
    leigh = judge("Leigh Ann", "Skurupey")
    assert match_judge("Leigh-Ann", "SKURUPEY", [leigh])["suggested_judge_id"] == leigh.id


def venue(name, city=None):
    return SimpleNamespace(id=uuid4(), name=name, city=city)


def test_a_venue_is_matched_by_name():
    arena = venue("Double F Arena", "Hinckley")
    assert match_venue("double f arena", None, [arena, venue("Other")]) == arena.id


def test_two_venues_of_one_name_need_the_city_to_agree():
    here, there = venue("County Fairgrounds", "Hinckley"), venue("County Fairgrounds", "Pine City")
    assert match_venue("County Fairgrounds", None, [here, there]) is None
    assert match_venue("County Fairgrounds", "Pine City", [here, there]) == there.id


def assoc(code, name, kind="club"):
    return SimpleNamespace(id=uuid4(), code=code, name=name, association_type=kind)


def test_an_association_is_found_by_code_then_by_name():
    wsca = assoc("WSCA", "Western Saddle Clubs Association")
    rows = [wsca, assoc("NSBA", "National Snaffle Bit Association")]
    assert match_association("wsca", None, rows) == wsca.id
    assert match_association(None, "Western Saddle Clubs Association", rows) == wsca.id
    assert match_association("XYZ", "Nobody", rows) is None


# ── Routing classes ───────────────────────────────────────────────────────────

def test_a_capitalised_heading_rescues_a_class_name_that_says_nothing():
    """"Yearling Fillies" says nothing of halter until it is read under HALTER --
    and HALTER is not a keyword the classifier knows, so the heading is matched
    against the app's discipline names in any case."""
    assert resolve_discipline("HALTER", "Yearling Fillies") == ("Halter", "placement")


def test_the_class_name_wins_only_where_it_names_a_more_specific_form_of_the_heading():
    assert resolve_discipline("TRAIL", "Amateur In-Hand Trail")[0] == "In-Hand Trail"
    assert resolve_discipline("HALTER", "Performance Halter Mares")[0] == "Performance Halter"


def test_a_known_heading_wins_where_the_class_name_misleads():
    """Both from the MNSPHC bill: the name alone routes each to plain Trail."""
    assert resolve_discipline("RANCH TRAIL", "All Breed Ranch WT Trail All Ages")[0] == "Ranch Trail"
    assert resolve_discipline("LEAD LINE", "All Breed Youth Lead Line Trail Ages 3-8")[0] == "Lead Line"


def test_the_class_name_is_used_when_there_is_no_heading():
    assert resolve_discipline(None, "Amateur Western Pleasure") == ("Western Pleasure", "placement")


def test_an_unknown_heading_is_kept_rather_than_dumped_in_unassigned():
    discipline, score_type = resolve_discipline("COSTUME CLASS", "Walk-Trot 11-18")
    assert discipline == "Costume Class"
    assert score_type == "placement"


def test_nothing_to_go_on_is_unassigned():
    assert resolve_discipline(None, "Class Seventeen") == ("Unassigned", "placement")


def test_a_per_judge_rate_is_multiplied_out_and_a_flat_one_is_not():
    assert class_fee_cents(900, True, 4) == 3600
    assert class_fee_cents(1000, False, 4) == 1000


def test_prepare_draft_matches_the_breed_body_clubs_and_championships():
    apha_type = SimpleNamespace(id=uuid4(), code="APHA")
    apha = assoc("APHA", "American Paint Horse Association", kind="breed")
    wsca = assoc("WSCA", "Western Saddle Clubs Association")
    read = normalize_showbill(
        raw_read(
            clubs=[
                {"code": "WSCA", "name": None, "fee_amount_cents": None, "fee_unit": None, "fee_text": None},
                {"code": "APHA", "name": None, "fee_amount_cents": None, "fee_unit": None, "fee_text": None},
            ],
            classes=[
                a_class(club_codes=["WSCA", "NSBA"]),
                a_class(number="2-3", name="Grand & Reserve Amateur Stallions", is_championship=True),
            ],
        )
    )
    resolved = prepare_draft(read, show_types=[apha_type], associations=[apha, wsca], judges=[], venues=[])

    assert resolved["show_type_id"] == apha_type.id
    # APHA listed among the clubs is the breed body named again, not an overlay.
    assert resolved["clubs"][0]["association_id"] == wsca.id
    assert resolved["clubs"][1] == {"association_id": None, "is_breed_association": True}
    first, championship = resolved["classes"]
    assert first["club_association_ids"] == [wsca.id]
    assert first["unknown_club_codes"] == ["NSBA"]
    assert championship["entered_by_qualification"] is True


# ── Refusing a reviewed payload ───────────────────────────────────────────────

def payload(**overrides):
    base = {
        "show": {
            "name": "Splash of Color",
            "show_type_id": str(uuid4()),
            "start_date": "2027-08-21",
            "end_date": "2027-08-22",
        },
        "classes": [],
        "fees": [],
    }
    base.update(overrides)
    return ShowBillImportApply.model_validate(base)


def cls(name, day="2027-08-21", clubs=()):
    return {"class_date": day, "class_name": name, "club_association_ids": [str(c) for c in clubs]}


def test_a_clean_payload_has_no_problems():
    body = payload(classes=[cls("Yearling Stallions"), cls("Yearling Stallions", day="2027-08-22")])
    assert apply_problems(body) == []


def test_the_same_class_twice_on_one_day_is_refused_and_named():
    body = payload(classes=[cls("Yearling Stallions"), cls("yearling  stallions")])
    problems = apply_problems(body)
    assert len(problems) == 1 and "Yearling" in problems[0]


def test_a_class_outside_the_show_dates_is_refused():
    problems = apply_problems(payload(classes=[cls("Trail", day="2027-08-25")]))
    assert "outside the show's dates" in problems[0]


def test_a_class_marked_for_a_club_the_show_is_not_sanctioned_by_is_refused():
    wsca = uuid4()
    assert apply_problems(payload(classes=[cls("WSCA Barrels", clubs=[wsca])]))
    sanctioned = payload(
        clubs=[{"association_id": str(wsca)}],
        classes=[cls("WSCA Barrels", clubs=[wsca])],
    )
    assert apply_problems(sanctioned) == []


def test_a_new_judge_needs_both_names():
    body = payload(judges=[{"first_name": "Josh"}])
    assert any("first and last name" in p for p in apply_problems(body))


def test_a_new_venue_needs_a_name():
    assert any("venue" in p for p in apply_problems(payload(venue={"city": "Hinckley"})))


def test_all_problems_are_reported_together():
    body = payload(
        judges=[{"last_name": "Crowley"}],
        classes=[cls("Trail"), cls("Trail"), cls("Reining", day="2027-09-01")],
    )
    assert len(apply_problems(body)) == 3


def test_a_reversed_show_date_range_never_reaches_the_checks():
    with pytest.raises(ValidationError):
        payload(show={"name": "x", "show_type_id": str(uuid4()),
                      "start_date": "2027-08-22", "end_date": "2027-08-21"})


def test_the_fee_editors_rules_apply_to_every_row_by_name():
    body = payload(
        fees=[
            {"label": "Stall", "amount_cents": 9000, "unit": "per_stall", "early_amount_cents": 7500},
            {"label": "Tack stall", "amount_cents": 5000, "unit": "per_stall", "min_quantity": 2},
            {"label": "Shavings", "amount_cents": 1000, "unit": "per_bag", "min_quantity": 2},
        ]
    )
    problems = fee_problems(body)
    assert len(problems) == 2
    assert problems[0].startswith("Stall:") and problems[1].startswith("Tack stall:")


def test_fee_codes_are_unique_within_the_show():
    fees = [("Office", "per_horse"), ("office", "per_horse"), ("Office!", "flat"), ("RV / hook-up", "flat")]
    assert fee_codes(fees) == ["office", "office_2", "office_3", "rv_hook_up"]


def test_the_main_lodging_lines_take_the_lodging_steps_own_codes():
    """The MNSPHC bill's order: the horse stall is the Stalls slot, the tack
    stall and the early-arrival nights are extra lines beside it."""
    fees = [
        ("Early arrival — stall", "per_stall"),
        ("Horse stall", "per_stall"),
        ("Tack stall", "per_stall"),
        ("Shavings", "per_bag"),
        ("Electrical hook-up (whole show)", "per_show"),
        ("Late departure — hook-up", "per_show"),
    ]
    assert fee_codes(fees) == [
        "early_arrival_stall",
        "stall",
        "tack_stall",
        "shavings",
        "camping",
        "late_departure_hook_up",
    ]


def test_a_bill_with_no_main_stall_line_does_not_fill_the_stalls_slot():
    assert fee_codes([("Early arrival stall", "per_stall")]) == ["early_arrival_stall"]


def test_no_other_fee_is_handed_a_lodging_slot_code():
    """A flat "Camping" note would otherwise be claimed by the Lodging step's
    camping card and edited as though it were the booked line."""
    assert fee_codes([("Camping", "flat"), ("Stall", "flat")]) == ["camping_2", "stall_2"]
