"""A show created straight from its show bill, and what is left to check (migration 187).

The show is made as a DRAFT from the read, and every doubt about what was read
becomes a check on its setup step. Pinned here:

* **Nothing shared is written from the read alone.** One registry judge of
  exactly the bill's name is attached and still checked; anybody else is a
  check carrying what the bill printed, never a new registry row. The same for
  a venue, and for a club.
* **The payload is always creatable.** A value the create would refuse -- a
  class twice on a day, a class off the show's dates, a deadline after the
  show starts -- is left off or moved, and becomes a check saying so.
* **A check watches the value it was created with**, so changing the field
  closes it and nothing else does.

The SQL is not tested here, for the reason `tests/factories.py` gives.
"""
from datetime import date, datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from extraction.showbill import normalize_showbill
from showbill_checks import (
    BASIC,
    CLASSES,
    FEES,
    FUTURITIES,
    JUDGES,
    LODGING,
    PAPERWORK,
    SANCTIONING,
    SCORING,
    STEP_ORDER,
    _MISSING,
    check_state,
    draft_from_read,
    per_judge_count,
)
from showbill_import import apply_problems, fee_problems, prepare_draft
from tests.test_showbill_import import a_class, assoc, raw_read

APHA_TYPE = SimpleNamespace(id=uuid4(), code="APHA")
APHA = assoc("APHA", "American Paint Horse Association", kind="breed")
WSCA = assoc("WSCA", "Western Saddle Clubs Association")


def judge_row(first, last, email=None):
    return SimpleNamespace(id=uuid4(), first_name=first, last_name=last, email=email)


def bill_judge(first, last, cards=()):
    return {"first_name": first, "last_name": last, "location": None, "associations": list(cards), "check": None}


def rate(key, cents, per_judge=False, code=None, printed=None):
    return {
        "key": key,
        "label": key,
        "amount_cents": cents,
        "per_judge": per_judge,
        "association_code": code,
        "printed_text": printed,
        "check": None,
    }


def fee(label, cents, unit, **kw):
    base = {
        "label": label,
        "amount_cents": cents,
        "unit": unit,
        "notes": None,
        "early_amount_cents": None,
        "early_deadline": None,
        "min_quantity": None,
        "check": None,
    }
    base.update(kw)
    return base


def build(read, *, judges=(), venues=(), start="2027-08-21", end="2027-08-22", name="Splash of Color"):
    """Normalise a raw read, match it, and draft the show from it."""
    extracted = normalize_showbill(read)
    associations = [APHA, WSCA]
    resolved = prepare_draft(
        extracted, show_types=[APHA_TYPE], associations=associations, judges=list(judges), venues=list(venues)
    )
    return draft_from_read(
        extracted,
        resolved,
        name=name,
        show_type_id=APHA_TYPE.id,
        start_date=date.fromisoformat(start),
        end_date=date.fromisoformat(end),
        attach_showbill=True,
        registry_judges={j.id: j for j in judges},
        venues={v.id: v for v in venues},
        clubs={a.id: a for a in associations if a.association_type == "club"},
    )


def of_step(draft, step):
    return [c for c in draft.checks if c.step == step]


# ── Judges ────────────────────────────────────────────────────────────────────

def test_one_exact_registry_match_is_attached_and_still_checked():
    jane = judge_row("Jane", "Smith", "jane@example.com")
    draft = build(raw_read(judges=[bill_judge("Jane", "Smith", ["APHA"])]), judges=[jane])

    assert [j.judge_id for j in draft.payload.judges] == [jane.id]
    (check,) = of_step(draft, JUDGES)
    assert check.target == ("judge", jane.id)
    assert "on the name alone" in check.message and "jane@example.com" in check.message


def test_a_judge_the_registry_lacks_is_never_created_from_the_read():
    draft = build(raw_read(judges=[bill_judge("Bob", "Lee", ["APHA", "WSCA"])]))

    assert draft.payload.judges == []
    (check,) = of_step(draft, JUDGES)
    assert check.target is None
    assert check.action["kind"] == "add_judge"
    assert (check.action["first_name"], check.action["last_name"]) == ("Bob", "Lee")
    assert check.action["association_ids"] == [str(APHA.id), str(WSCA.id)]


def test_two_people_of_one_name_attach_neither_and_offer_both():
    twins = [judge_row("Pat", "Kerr"), judge_row("Pat", "Kerr")]
    draft = build(raw_read(judges=[bill_judge("Pat", "Kerr")]), judges=twins)

    assert draft.payload.judges == []
    (check,) = of_step(draft, JUDGES)
    assert sorted(check.action["candidate_ids"]) == sorted(str(j.id) for j in twins)


# ── Venue ─────────────────────────────────────────────────────────────────────

def test_a_venue_not_on_file_is_left_blank_with_what_the_bill_printed():
    draft = build(raw_read())

    assert draft.payload.venue is None
    (check,) = [c for c in of_step(draft, BASIC) if c.field == "venue_id"]
    assert check.value is None
    assert check.action == {
        "kind": "add_venue",
        "name": "Double F Arena",
        "address": None,
        "city": "Hinckley",
        "state": "MN",
    }


def test_a_venue_matched_by_name_in_another_city_is_checked():
    elsewhere = SimpleNamespace(id=uuid4(), name="Double F Arena", city="Duluth", state="MN")
    draft = build(raw_read(), venues=[elsewhere])

    assert draft.payload.venue.venue_id == elsewhere.id
    (check,) = [c for c in of_step(draft, BASIC) if c.field == "venue_id"]
    assert "cities differ" in check.message
    assert check.value == elsewhere.id


# ── Class prices ──────────────────────────────────────────────────────────────

def test_a_per_judge_rate_is_multiplied_by_the_bills_carded_judges_and_says_so():
    read = raw_read(
        judges=[
            bill_judge("A", "One", ["APHA", "WSCA"]),
            bill_judge("B", "Two", ["APHA"]),
            bill_judge("C", "Three", ["APHA", "WSCA"]),
        ],
        class_rates=[rate("wsca", 500, per_judge=True, code="WSCA", printed="$5 per WSCA judge")],
        classes=[a_class(name="WSCA Trail", rate_key="wsca"), a_class(name="WSCA Halter", rate_key="wsca")],
    )
    draft = build(read)

    assert [c.entry_fee_cents for c in draft.payload.classes] == [1000, 1000]
    (check,) = [c for c in of_step(draft, FEES) if "priced at" in c.message]
    assert "$5.00 × 2 WSCA judges named on the bill = $10.00" in check.message
    assert "2 classes" in check.message
    assert check.action["href"] == "fees/entry"


def test_per_judge_count_falls_back_to_the_whole_panel():
    panel = [bill_judge("A", "One", ["APHA"]), bill_judge("B", "Two", [])]
    assert per_judge_count(rate("x", 100, True, code="NSBA"), panel) == 2
    assert per_judge_count(rate("x", 100, True), panel) == 2
    assert per_judge_count(rate("x", 100, True, code="apha"), panel) == 1


def test_futurity_and_unpriced_classes_are_zero_and_said_so():
    read = raw_read(
        classes=[
            a_class(name="Yearling Futurity", is_futurity=True, rate_key=None),
            a_class(name="Lead Line", rate_key=None),
        ]
    )
    draft = build(read)

    assert [c.entry_fee_cents for c in draft.payload.classes] == [0, 0]
    (fut,) = of_step(draft, FUTURITIES)
    assert "Yearling Futurity" in fut.message
    assert any("no price on the bill" in c.message and "Lead Line" in c.message for c in of_step(draft, FEES))


# ── Classes ───────────────────────────────────────────────────────────────────

def test_a_class_printed_twice_on_a_day_is_created_once_and_checked():
    draft = build(raw_read(classes=[a_class(name="Trail"), a_class(name="trail ")]))

    assert [c.class_name for c in draft.payload.classes] == ["Trail"]
    assert any("twice" in c.message for c in of_step(draft, CLASSES))
    assert apply_problems(draft.payload) == []


def test_a_class_with_no_readable_day_goes_on_the_first_day_and_is_checked():
    draft = build(raw_read(classes=[a_class(name="Trail", date="2026-01-01", number="12")]))

    (made,) = draft.payload.classes
    assert made.class_date == date(2027, 8, 21)
    (check,) = of_step(draft, CLASSES)
    assert check.target == ("class", 0)
    assert check.field == "class_date" and check.value == "2027-08-21"
    assert "bill #12" in check.message


def test_moving_the_start_date_moves_the_schedule_day_for_day():
    read = raw_read(classes=[a_class(name="Trail", date="2027-08-22")])
    draft = build(read, start="2028-08-19", end="2028-08-20")

    assert draft.payload.classes[0].class_date == date(2028, 8, 20)
    assert of_step(draft, CLASSES) == []


def test_a_class_note_is_a_check_on_that_class():
    draft = build(raw_read(classes=[a_class(name="Trail"), a_class(name="Halter", note="Price smudged.")]))

    (check,) = of_step(draft, CLASSES)
    assert check.target == ("class", 1) and check.source == "bill"
    assert check.message.endswith("Price smudged.")


# ── Clubs ─────────────────────────────────────────────────────────────────────

def test_a_club_the_registry_lacks_is_a_check_and_marks_no_class():
    read = raw_read(
        clubs=[{"code": "MNSPHC", "name": None, "fee_amount_cents": None, "fee_unit": None, "fee_text": None}],
        classes=[a_class(name="All Breed Trail", club_codes=["MNSPHC"])],
    )
    draft = build(read)

    assert draft.payload.clubs == []
    assert draft.payload.classes[0].club_association_ids == []
    (check,) = of_step(draft, SANCTIONING)
    assert "MNSPHC" in check.message and "All Breed Trail" in check.message


def test_a_club_fee_is_watched_by_its_amount():
    read = raw_read(
        clubs=[{"code": "WSCA", "name": None, "fee_amount_cents": 300, "fee_unit": "per_entry", "fee_text": "$3 per class"}],
        classes=[a_class(name="WSCA Trail", club_codes=["WSCA"])],
    )
    draft = build(read)

    assert draft.payload.classes[0].club_association_ids == [WSCA.id]
    (check,) = of_step(draft, SANCTIONING)
    assert check.target == ("sanctioning", WSCA.id)
    assert (check.field, check.value) == ("fee_amount_cents", 300)


# ── Fees ──────────────────────────────────────────────────────────────────────

def test_fees_that_bill_everybody_are_checked_on_their_unit_and_lodging_lines_on_lodging():
    read = raw_read(
        fees=[
            fee("Stall", 9000, "per_stall"),
            fee("Tack stall", 5000, "per_stall"),
            fee("Office fee", 1500, "per_exhibitor"),
            fee("Arena fee", 300, "per_entry"),
        ]
    )
    draft = build(read)

    assert len(draft.payload.fees) == 4
    by_message = {c.message.split(" (")[0]: c for c in draft.checks if c.target and c.target[0] == "fee"}
    assert by_message["Office fee"].step == FEES and by_message["Office fee"].field == "unit"
    assert "on top of the class's own price" in by_message["Arena fee"].message
    # The plain stall bills nobody it shouldn't, so it carries no check at all.
    assert "Stall" not in by_message


def test_a_bad_early_rate_is_left_off_rather_than_refusing_the_show():
    read = raw_read(fees=[fee("Stall", 9000, "per_stall", early_amount_cents=12000, early_deadline="2027-08-01")])
    draft = build(read)

    assert fee_problems(draft.payload) == []
    assert draft.payload.fees[0].early_amount_cents is None
    (check,) = [c for c in draft.checks if c.target == ("fee", 0)]
    assert check.step == LODGING and "early rate was left off" in check.message


# ── The show row ──────────────────────────────────────────────────────────────

def test_an_entry_deadline_after_the_show_starts_is_blank_and_checked():
    read = raw_read()
    read["show"]["entry_deadline"] = "2027-08-25"
    draft = build(read)

    assert draft.payload.show.entry_deadline is None
    (check,) = [c for c in of_step(draft, BASIC) if c.field == "entry_deadline"]
    assert check.value is None


def test_paperwork_the_bill_never_mentions_is_the_default_and_checked():
    draft = build(raw_read())

    fields = {c.field: c.value for c in of_step(draft, PAPERWORK)}
    # The fixture's bill states a Coggins, and is silent on the other two.
    assert fields == {"requires_health_certificate": False, "requires_vaccination": False}


def test_a_readers_show_check_watches_the_value_the_show_was_created_with():
    read = raw_read(warnings=["[start_date] Year inferred."])
    draft = build(read)

    (check,) = [c for c in of_step(draft, BASIC) if c.field == "start_date"]
    assert check.source == "bill" and check.value == date(2027, 8, 21)


def test_lines_not_imported_go_to_the_step_that_sets_them_up():
    read = raw_read(
        not_imported=["[side_pot] Novice jackpot", "[high_point] Year-end hi-point", "Refunds by request only"]
    )
    draft = build(read)

    steps = {c.message.split(": ", 1)[1]: c.step for c in draft.checks if c.message.startswith("On the bill")}
    assert steps == {"Novice jackpot": FUTURITIES, "Year-end hi-point": SCORING, "Refunds by request only": BASIC}


def test_the_whole_draft_is_creatable_and_its_checks_are_in_step_order():
    read = raw_read(
        judges=[bill_judge("Bob", "Lee")],
        class_rates=[rate("open", 900, per_judge=True)],
        classes=[a_class(name="Trail", rate_key="open", note="Check"), a_class(name="Trail")],
        fees=[fee("Office fee", 1500, "per_exhibitor")],
        warnings=["Page 4 is cut off."],
    )
    draft = build(read)

    assert apply_problems(draft.payload) == [] and fee_problems(draft.payload) == []
    order = [STEP_ORDER.index(c.step) for c in draft.checks]
    assert order == sorted(order)


# ── Whether a check is open ───────────────────────────────────────────────────

def test_a_check_is_open_until_accepted_changed_or_removed():
    now = datetime.now(timezone.utc)
    assert check_state(None, "start_date", "2027-08-21", date(2027, 8, 21)) == "open"
    assert check_state(None, "start_date", "2027-08-21", date(2027, 8, 22)) == "changed"
    assert check_state(now, "start_date", "2027-08-21", date(2027, 8, 22)) == "accepted"
    assert check_state(None, "unit", "per_entry", _MISSING) == "removed"
    # A check that watches no column closes only when somebody accepts it.
    assert check_state(None, None, None, object()) == "open"


def test_a_tagged_warning_lands_on_the_item_or_field_it_names():
    # Tags rather than schema fields: the header schema is at the API's grammar
    # limit, and a tag costs it nothing (see `route_warnings`).
    read = normalize_showbill(
        raw_read(
            judges=[bill_judge("Jane", "Smith"), bill_judge("Bob", "Lee")],
            fees=[fee("Stall", 9000, "per_stall")],
            warnings=[
                "[judge: jane smith] Surname smudged.",
                "[judge: Lee] Cards not stated.",
                "[fee: Stall] Unit unclear.",
                "[end_date] Two end dates printed.",
                "[fee: Tack stall] Not on the fee list.",
                "[not_a_field] Kept as it is.",
                "Page 4 is cut off.",
            ],
        )
    )
    assert [j["check"] for j in read["judges"]] == ["Surname smudged.", "Cards not stated."]
    assert read["fees"][0]["check"] == "Unit unclear."
    assert read["show_checks"] == [{"field": "end_date", "message": "Two end dates printed."}]
    # Nothing is lost: an item that cannot be found keeps its name, and an
    # unknown tag or no tag is about the bill as a whole.
    assert read["warnings"] == [
        "Tack stall: Not on the fee list.",
        "[not_a_field] Kept as it is.",
        "Page 4 is cut off.",
    ]


def test_doubts_cost_the_header_schema_nothing():
    # The header pass is at the API's grammar limit: on 2026-11-13 even one
    # `check` string on each of four item types was refused as "The compiled
    # grammar is too large". Doubts travel as tagged `warnings` instead. A field
    # added here must be tried against the API first (docs/showbill-import.md).
    from extraction.showbill import HEADER_SCHEMA

    props = HEADER_SCHEMA["properties"]
    assert set(props) == {"show", "judges", "clubs", "class_rates", "fees", "not_imported", "warnings"}
    for key in ("judges", "clubs", "class_rates", "fees"):
        assert "check" not in props[key]["items"]["properties"]
    assert props["not_imported"]["items"] == {"type": "string"}
