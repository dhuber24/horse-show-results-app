"""A show created straight from its show bill, and the notes it carries.

The show is made as a DRAFT from the read, filled in as far as the bill allows,
and every doubt about what was read is a line of its office notes. Pinned here:

* **Who a name is, a person settles.** A judge is a registry pick, a new judge
  with an email or a phone, or left off; a venue is a pick, or a new one with
  its full address. Nothing else on the confirm page is required.
* **Futurities and side pots the bill runs are set up**, over the classes the
  bill marks for each; a side pot the bill names no class for cannot exist,
  and says so instead.
* **The payload is always creatable.** A value the create would refuse -- a
  class twice on a day, a class off the show's dates, a deadline after the
  show starts, a late fee with no deadline -- is left off or moved, and the
  notes say so.

The SQL is not tested here, for the reason `tests/factories.py` gives.
"""
from datetime import date
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from extraction.showbill import normalize_showbill
from schemas import ShowBillImportApply, ShowBillImportStart
from showbill_draft import (
    CLASSES,
    FEES,
    FUTURITIES,
    JUDGES,
    LODGING,
    PAPERWORK,
    SANCTIONING,
    WHOLE_BILL,
    BASICS,
    default_judge_choices,
    draft_from_read,
    office_notes_text,
    per_judge_count,
    public_notes_text,
)
from showbill_import import apply_problems, fee_problems, prepare_draft, start_problems
from tests.test_showbill_import import a_class, assoc, raw_read

APHA_TYPE = SimpleNamespace(id=uuid4(), code="APHA")
APHA = assoc("APHA", "American Paint Horse Association", kind="breed")
WSCA = assoc("WSCA", "Western Saddle Clubs Association")


def judge_row(first, last, email=None):
    return SimpleNamespace(id=uuid4(), first_name=first, last_name=last, email=email)


def bill_judge(first, last, cards=()):
    return {"first_name": first, "last_name": last, "associations": list(cards)}


def rate(key, cents, per_judge=False, code=None, printed=None):
    return {"key": key, "label": key, "amount_cents": cents, "per_judge": per_judge,
            "association_code": code, "printed_text": printed}


def fee(label, cents, unit, **kw):
    base = {"label": label, "amount_cents": cents, "unit": unit, "notes": None,
            "early_amount_cents": None, "early_deadline": None, "min_quantity": None}
    base.update(kw)
    return base


def futurity(name, **kw):
    base = {"name": name, "description": "", "entry_deadline": "", "late_fee_cents": None,
            "office_fee_member_cents": None, "office_fee_nonmember_cents": None, "fee_tiers": [],
            "entry_instructions": "", "award_notice": "", "rules_notice": "", "refund_policy": ""}
    base.update(kw)
    return base


def side_pot(name, **kw):
    base = {"name": name, "description": "", "entry_fee_cents": None, "payback_percent": None}
    base.update(kw)
    return base


def build(read, *, judges=(), venues=(), start="2027-08-21", end="2027-08-22", choices=None, venue=None):
    """Normalise a raw read, match it, and draft the show from it -- with every
    judge kept as the registry match or a new judge, unless `choices` says."""
    extracted = normalize_showbill(read)
    associations = [APHA, WSCA]
    resolved = prepare_draft(
        extracted, show_types=[APHA_TYPE], associations=associations, judges=list(judges), venues=list(venues)
    )
    if choices is None:
        choices = [
            c or {"new": {"first_name": j["first_name"], "last_name": j["last_name"], "email": "j@example.com"}}
            for c, j in zip(default_judge_choices(resolved, len(extracted["judges"])), extracted["judges"])
        ]
    draft = draft_from_read(
        extracted,
        resolved,
        name="Splash of Color",
        show_type_id=APHA_TYPE.id,
        start_date=date.fromisoformat(start),
        end_date=date.fromisoformat(end),
        judge_choices=choices,
        venue_choice=venue,
        clubs={a.id: a for a in associations if a.association_type == "club"},
    )
    return draft, extracted


def payload(draft, **notes):
    return ShowBillImportApply.model_validate(
        draft.payload(attach_showbill=True, public_notes=notes.get("public"), office_notes=notes.get("office"))
    )


def said(draft, section):
    return [text for s, text in draft.review if s == section]


# ── Judges and the venue: as the confirm page settled them ────────────────────

def test_an_exact_registry_match_is_the_starting_choice_and_nobody_else_is():
    jane = judge_row("Jane", "Smith")
    twins = [judge_row("Pat", "Kerr"), judge_row("Pat", "Kerr")]
    extracted = normalize_showbill(raw_read(judges=[bill_judge("Jane", "Smith"), bill_judge("Pat", "Kerr"), bill_judge("Bob", "Lee")]))
    resolved = prepare_draft(extracted, show_types=[APHA_TYPE], associations=[], judges=[jane, *twins], venues=[])

    assert default_judge_choices(resolved, 3) == [{"judge_id": jane.id}, {}, {}]


def test_judges_are_created_as_settled_and_one_left_off_is_said():
    jane = judge_row("Jane", "Smith")
    read = raw_read(judges=[bill_judge("Jane", "Smith"), bill_judge("Bob", "Lee"), bill_judge("Ring", "Steward")])
    new_bob = {"first_name": "Bob", "last_name": "Lee", "phone": "555-0100"}
    draft, _x = build(read, judges=[jane], choices=[{"judge_id": jane.id}, {"new": new_bob}, {"leave_off": True}])

    made = payload(draft).judges
    assert [j.judge_id for j in made] == [jane.id, None]
    assert (made[1].first_name, made[1].phone) == ("Bob", "555-0100")
    (line,) = said(draft, JUDGES)
    assert "Ring Steward" in line and "left off" in line


def test_a_venue_is_created_as_settled_and_one_left_blank_is_said():
    new = {"name": "Double F Arena", "address": "1 Arena Rd", "city": "Hinckley", "state": "MN", "zip": "55037"}
    draft, _x = build(raw_read(), venue={"new": new})
    assert payload(draft).venue.zip == "55037"
    assert said(draft, BASICS) == []

    draft, _x = build(raw_read(), venue=None)
    assert payload(draft).venue is None
    assert any("Double F Arena" in line and "left blank" in line for line in said(draft, BASICS))


def test_a_new_judge_needs_an_email_or_a_phone():
    base = {"name": "S", "show_type_id": str(uuid4()), "start_date": "2027-08-21", "end_date": "2027-08-22"}
    with pytest.raises(ValidationError, match="email or a phone"):
        ShowBillImportStart.model_validate({**base, "judges": [{"new": {"first_name": "Bob", "last_name": "Lee"}}]})
    ok = ShowBillImportStart.model_validate(
        {**base, "judges": [{"new": {"first_name": "Bob", "last_name": "Lee", "phone": " 555 "}}]}
    )
    assert ok.judges[0].new.phone == "555"


def test_a_new_venue_needs_its_full_address():
    base = {"name": "S", "show_type_id": str(uuid4()), "start_date": "2027-08-21", "end_date": "2027-08-22"}
    partial = {"name": "Arena", "address": "1 Rd", "city": "Hinckley", "state": "MN", "zip": "  "}
    with pytest.raises(ValidationError):
        ShowBillImportStart.model_validate({**base, "venue": {"new": partial}})


def test_each_judge_choice_is_exactly_one_thing():
    base = {"name": "S", "show_type_id": str(uuid4()), "start_date": "2027-08-21", "end_date": "2027-08-22"}
    for bad in ({}, {"judge_id": str(uuid4()), "leave_off": True}):
        with pytest.raises(ValidationError, match="Pick each judge"):
            ShowBillImportStart.model_validate({**base, "judges": [bad]})


def _start(**kw):
    base = {"name": "S", "show_type_id": str(uuid4()), "start_date": "2027-08-21", "end_date": "2027-08-22"}
    return ShowBillImportStart.model_validate({**base, **kw})


def test_create_needs_every_judge_settled_and_a_venue_from_whoever_may_add_one():
    extracted = normalize_showbill(raw_read(judges=[bill_judge("Bob", "Lee")]))

    problems = start_problems(_start(), extracted, "SHOW_MANAGER")
    assert any("1 judge" in p for p in problems)
    assert any("Double F Arena" in p for p in problems)

    settled = _start(judges=[{"leave_off": True}], venue={"venue_id": str(uuid4())})
    assert start_problems(settled, extracted, "SHOW_MANAGER") == []


def test_a_secretary_may_leave_the_venue_blank_but_not_add_one():
    extracted = normalize_showbill(raw_read())
    assert start_problems(_start(), extracted, "SHOW_SECRETARY") == []
    new = {"name": "A", "address": "1 Rd", "city": "C", "state": "MN", "zip": "1"}
    assert any("Only a show manager" in p for p in start_problems(_start(venue={"new": new}), extracted, "SHOW_SECRETARY"))


# ── Class prices ──────────────────────────────────────────────────────────────

def test_a_per_judge_rate_is_multiplied_by_the_carded_judges_kept_and_says_so():
    read = raw_read(
        judges=[
            bill_judge("A", "One", ["APHA", "WSCA"]),
            bill_judge("B", "Two", ["APHA"]),
            bill_judge("C", "Three", ["APHA", "WSCA"]),
        ],
        class_rates=[rate("wsca", 500, per_judge=True, code="WSCA", printed="$5 per WSCA judge")],
        classes=[a_class(name="WSCA Trail", rate_key="wsca"), a_class(name="WSCA Halter", rate_key="wsca")],
    )
    draft, _x = build(read)
    assert [c["entry_fee_cents"] for c in draft.classes] == [1000, 1000]
    (line,) = [t for t in said(draft, FEES) if "priced at" in t]
    assert "$5.00 × 2 WSCA judges = $10.00" in line and "2 classes" in line

    # One of them left off on the confirm page: the price follows the panel kept.
    kept = {"new": {"first_name": "x", "last_name": "y", "email": "e"}}
    draft, _x = build(read, choices=[kept, kept, {"leave_off": True}])
    assert [c["entry_fee_cents"] for c in draft.classes] == [500, 500]


def test_per_judge_count_falls_back_to_the_whole_panel():
    panel = [bill_judge("A", "One", ["APHA"]), bill_judge("B", "Two", [])]
    assert per_judge_count(rate("x", 100, True, code="NSBA"), panel) == 2
    assert per_judge_count(rate("x", 100, True), panel) == 2
    assert per_judge_count(rate("x", 100, True, code="apha"), panel) == 1


def test_unpriced_classes_are_free_and_said_so():
    draft, _x = build(raw_read(classes=[a_class(name="Lead Line", rate_key=None)]))
    assert draft.classes[0]["entry_fee_cents"] == 0
    assert any("Lead Line" in t and "no price on the bill" in t for t in said(draft, FEES))


# ── Futurities and side pots ──────────────────────────────────────────────────

def test_a_futurity_is_set_up_with_its_classes_free_and_its_tiers():
    read = raw_read(
        classes=[
            a_class(name="Yearling Futurity", futurity="Color Futurity", rate_key="open"),
            a_class(name="Trail", rate_key="open"),
        ],
        class_rates=[rate("open", 3600)],
    )
    read["futurities"] = [futurity(
        "Color Futurity",
        entry_deadline="2027-06-01",
        late_fee_cents=2500,
        office_fee_member_cents=5000,
        fee_tiers=[{"name": "Open", "amount_cents": 7500}],
        rules_notice="Yearlings nominated by June 1.",
    )]
    draft, _x = build(read)

    assert [c["entry_fee_cents"] for c in draft.classes] == [0, 3600]
    (fut,) = draft.futurities
    assert fut["class_indexes"] == [0]
    assert fut["entry_deadline"] == date(2027, 6, 1) and fut["late_fee_cents"] == 2500
    # One office fee printed is everybody's.
    assert (fut["office_fee_member_cents"], fut["office_fee_nonmember_cents"]) == (5000, 5000)
    assert fut["fee_tiers"] == [{"name": "Open", "amount_cents": 7500, "sort_order": 0}]
    assert fut["rules_notice"] == "Yearlings nominated by June 1."
    (line,) = said(draft, FUTURITIES)
    assert "Color Futurity" in line and "1 class" in line


def test_one_office_fee_printed_is_everybodys_whichever_box_it_was_read_into():
    read = raw_read(classes=[a_class(name="Futurity Halter", futurity="Fut")])
    read["futurities"] = [futurity("Fut", office_fee_nonmember_cents=2500)]
    draft, _x = build(read)
    fut = draft.futurities[0]
    assert (fut["office_fee_member_cents"], fut["office_fee_nonmember_cents"]) == (2500, 2500)


def test_a_warning_both_passes_give_is_said_once():
    read = normalize_showbill(raw_read(warnings=["Year inferred.", "Page 4 is cut off.", "Year inferred."]))
    assert read["warnings"] == ["Year inferred.", "Page 4 is cut off."]


def test_a_futurity_late_fee_with_no_deadline_is_left_off_and_said():
    read = raw_read(classes=[a_class(name="Futurity Halter", futurity="Fut")])
    read["futurities"] = [futurity("Fut", late_fee_cents=2500)]
    draft, _x = build(read)

    assert draft.futurities[0]["late_fee_cents"] == 0
    assert payload(draft).futurities[0].late_fee_cents == 0
    (line,) = said(draft, FUTURITIES)
    assert "late fee" in line and "fee tiers" in line


def test_a_side_pot_is_set_up_over_the_classes_the_bill_names_for_it():
    read = raw_read(classes=[
        a_class(name="Novice Trail", side_pots=["Novice Jackpot"]),
        a_class(name="Novice Horsemanship", side_pots=["novice jackpot"]),
        a_class(name="Open Trail"),
    ])
    read["side_pots"] = [side_pot("Novice Jackpot", entry_fee_cents=2500, payback_percent=80)]
    draft, _x = build(read)

    (pot,) = payload(draft).side_pots
    assert (pot.class_indexes, pot.entry_fee_cents, pot.payback_percent) == ([0, 1], 2500, 80)
    (line,) = said(draft, FUTURITIES)
    assert "Novice Jackpot" in line and "doesn't print" not in line


def test_a_side_pot_with_no_classes_is_not_set_up_and_one_with_no_fee_says_its_default():
    read = raw_read(classes=[a_class(name="Trail", side_pots=["Trail Pot"])])
    read["side_pots"] = [side_pot("Trail Pot"), side_pot("Mystery Pot", description="$100 added")]
    draft, _x = build(read)

    (pot,) = draft.side_pots
    assert (pot["name"], pot["entry_fee_cents"], pot["payback_percent"]) == ("Trail Pot", 1000, 100)
    lines = said(draft, FUTURITIES)
    assert any("Trail Pot" in t and "$10.00" in t and "100%" in t for t in lines)
    assert any("Mystery Pot ($100 added)" in t and "wasn't set up" in t for t in lines)


# ── Classes ───────────────────────────────────────────────────────────────────

def test_a_class_printed_twice_on_a_day_is_created_once_and_said():
    read = raw_read(classes=[a_class(name="Trail", side_pots=["Pot"]), a_class(name="trail ", side_pots=["Pot"])])
    read["side_pots"] = [side_pot("Pot")]
    draft, _x = build(read)

    assert [c["class_name"] for c in draft.classes] == ["Trail"]
    assert draft.side_pots[0]["class_indexes"] == [0]
    assert any("twice" in t for t in said(draft, CLASSES))
    assert apply_problems(payload(draft)) == []


def test_a_class_with_no_readable_day_goes_on_the_first_day_and_is_said():
    draft, _x = build(raw_read(classes=[a_class(name="Trail", date="2026-01-01", number="12")]))

    assert draft.classes[0]["class_date"] == date(2027, 8, 21)
    (line,) = said(draft, CLASSES)
    assert "bill #12" in line and "first day" in line


def test_moving_the_start_date_moves_the_schedule_day_for_day():
    draft, _x = build(raw_read(classes=[a_class(name="Trail", date="2027-08-22")]), start="2028-08-19", end="2028-08-20")
    assert draft.classes[0]["class_date"] == date(2028, 8, 20)
    assert said(draft, CLASSES) == []


def test_a_class_note_is_a_line_naming_the_class():
    draft, _x = build(raw_read(classes=[a_class(name="Halter", number="4", note="Price smudged.")]))
    assert said(draft, CLASSES) == ["Halter (bill #4): Price smudged."]


# ── Clubs ─────────────────────────────────────────────────────────────────────

def test_a_club_the_registry_lacks_is_said_and_marks_no_class():
    read = raw_read(
        clubs=[{"code": "MNSPHC", "name": None, "fee_amount_cents": None, "fee_unit": None, "fee_text": None}],
        classes=[a_class(name="All Breed Trail", club_codes=["MNSPHC"])],
    )
    draft, _x = build(read)

    assert draft.clubs == [] and draft.classes[0]["club_association_ids"] == []
    (line,) = said(draft, SANCTIONING)
    assert "MNSPHC" in line and "All Breed Trail" in line


def test_a_club_fee_is_said_as_read():
    read = raw_read(
        clubs=[{"code": "WSCA", "name": None, "fee_amount_cents": 300, "fee_unit": "per_entry", "fee_text": "$3 per class"}],
        classes=[a_class(name="WSCA Trail", club_codes=["WSCA"])],
    )
    draft, _x = build(read)
    assert draft.classes[0]["club_association_ids"] == [WSCA.id]
    assert said(draft, SANCTIONING) == ["WSCA's club fee was read as $3.00 per entry from “$3 per class”."]


# ── Fees ──────────────────────────────────────────────────────────────────────

def test_fees_that_bill_everybody_are_said_and_lodging_lines_go_under_lodging():
    read = raw_read(fees=[
        fee("Stall", 9000, "per_stall"),
        fee("Office fee", 1500, "per_exhibitor"),
        fee("Arena fee", 300, "per_entry"),
        fee("Shavings", 1000, "per_bag", early_amount_cents=1200, early_deadline="2027-08-01"),
    ])
    draft, _x = build(read)

    assert len(draft.fees) == 4 and fee_problems(payload(draft)) == []
    fees = said(draft, FEES)
    assert any(t.startswith("Office fee") and "every exhibitor" in t for t in fees)
    assert any(t.startswith("Arena fee") and "on top of the class's own price" in t for t in fees)
    assert not any("Stall" in t for t in fees + said(draft, LODGING))
    assert any("Shavings" in t and "early rate was left off" in t for t in said(draft, LODGING))


# ── The show row ──────────────────────────────────────────────────────────────

def test_an_entry_deadline_after_the_show_starts_is_blank_and_said():
    read = raw_read()
    read["show"]["entry_deadline"] = "2027-08-25"
    draft, _x = build(read)
    assert draft.show["entry_deadline"] is None
    assert any("entry deadline" in t for t in said(draft, BASICS))


def test_paperwork_the_bill_never_mentions_is_one_line():
    draft, _x = build(raw_read())
    (line,) = said(draft, PAPERWORK)
    # The fixture's bill states a Coggins, and is silent on the other two.
    assert "health certificate" in line and "vaccination" in line and "Coggins" not in line


# ── The notes ─────────────────────────────────────────────────────────────────

def test_the_office_notes_list_what_to_check_by_step_then_what_the_bill_told_the_office():
    read = raw_read(
        judges=[bill_judge("Bob", "Lee")],
        class_rates=[rate("open", 900, per_judge=True)],
        classes=[a_class(name="Trail", rate_key="open", note="Check the price")],
        fees=[fee("Office fee", 1500, "per_exhibitor")],
        notes_for_office="Show secretary: Kim Ray, 555-0101",
        warnings=["Page 4 is cut off."],
    )
    draft, extracted = build(read)
    text = office_notes_text(draft, extracted, "bill.pdf")

    assert text.startswith("To check, from the show bill (bill.pdf):")
    order = [text.index(h) for h in ("\nClass Builder\n", "\nFees\n", "\nPaperwork\n", f"\n{WHOLE_BILL}\n")]
    assert order == sorted(order)
    assert "- Page 4 is cut off." in text
    assert text.endswith("From the show bill:\nShow secretary: Kim Ray, 555-0101")


def test_an_older_read_keeps_its_officials_doubts_and_lines_not_imported_as_notes():
    extracted = normalize_showbill(raw_read())
    extracted["show"]["staff"] = [{"role": "Show Secretary", "name": "Kim Ray"}]
    extracted["show_checks"] = [{"field": "start_date", "message": "Year inferred."}]
    extracted["judges"] = [{**bill_judge("Bob", "Lee"), "check": "Surname smudged."}]
    extracted["not_imported"] = [{"topic": "side_pot", "text": "Novice jackpot"}, "Refunds by request only"]
    resolved = prepare_draft(extracted, show_types=[APHA_TYPE], associations=[], judges=[], venues=[])
    draft = draft_from_read(
        extracted, resolved, name="S", show_type_id=None, start_date=date(2027, 8, 21), end_date=date(2027, 8, 22),
        judge_choices=[{"leave_off": True}], venue_choice=None, clubs={},
    )
    text = office_notes_text(draft, extracted, None)

    assert "- Year inferred." in text
    assert "- Bob Lee: Surname smudged." in text
    assert "- Kim Ray (Show Secretary)" in text
    assert "- Futurities & Side Pots: Novice jackpot" in text
    assert "- Refunds by request only" in text


def test_the_show_notes_are_what_the_bill_tells_exhibitors():
    extracted = normalize_showbill(raw_read(notes_for_exhibitors="Hi-point saddle to the all-around.\n\nNo dogs."))
    assert public_notes_text(extracted) == "Hi-point saddle to the all-around.\n\nNo dogs."
    assert public_notes_text(normalize_showbill(raw_read())) is None


def test_the_whole_draft_is_creatable():
    read = raw_read(
        judges=[bill_judge("Bob", "Lee")],
        class_rates=[rate("open", 900, per_judge=True)],
        classes=[
            a_class(name="Trail", rate_key="open", side_pots=["Pot"]),
            a_class(name="Trail"),
            a_class(name="Futurity Halter", futurity="Fut"),
        ],
        fees=[fee("Office fee", 1500, "per_exhibitor")],
        warnings=["Page 4 is cut off."],
    )
    read["futurities"] = [futurity("Fut", late_fee_cents=500)]
    read["side_pots"] = [side_pot("Pot")]
    draft, extracted = build(read)
    made = payload(draft, public="Bring your own chairs.", office=office_notes_text(draft, extracted, "b.pdf"))

    assert apply_problems(made) == [] and fee_problems(made) == []
    assert made.show.public_notes == "Bring your own chairs."
    assert made.show.office_notes.startswith("To check")
