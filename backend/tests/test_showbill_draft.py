"""A show created straight from its show bill, and the notes it carries.

The show is made as a DRAFT from the read, filled in as far as the bill allows.
Pinned here:

* **Who a name is, a person settles.** A judge is a registry pick, a new judge
  with an email or a phone, or left off; a venue is a pick, or a new one with
  its full address. Nothing else on the confirm page is required.
* **Futurities and side pots the bill runs are set up**, over the classes the
  bill marks for each; a side pot the bill names no class for cannot exist.
* **The payload is always creatable.** A value the create would refuse -- a
  class twice on a day, a class off the show's dates, a deadline after the
  show starts, a late fee with no deadline -- is left off or moved.

The SQL is not tested here, for the reason `tests/factories.py` gives.
"""
from datetime import date, time
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from extraction.showbill import normalize_showbill
from schemas import ShowBillImportApply, ShowBillImportStart
from showbill_draft import (
    default_judge_choices,
    draft_from_read,
    office_notes_text,
    per_judge_count,
    public_notes_text,
)
from showbill_import import apply_problems, fee_codes, fee_problems, prepare_draft, start_problems
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
    )
    return draft, extracted


def payload(draft, **notes):
    return ShowBillImportApply.model_validate(
        draft.payload(attach_showbill=True, public_notes=notes.get("public"), office_notes=notes.get("office"))
    )


# ── Judges and the venue: as the confirm page settled them ────────────────────

def test_an_exact_registry_match_is_the_starting_choice_and_nobody_else_is():
    jane = judge_row("Jane", "Smith")
    twins = [judge_row("Pat", "Kerr"), judge_row("Pat", "Kerr")]
    extracted = normalize_showbill(raw_read(judges=[bill_judge("Jane", "Smith"), bill_judge("Pat", "Kerr"), bill_judge("Bob", "Lee")]))
    resolved = prepare_draft(extracted, show_types=[APHA_TYPE], associations=[], judges=[jane, *twins], venues=[])

    assert default_judge_choices(resolved, 3) == [{"judge_id": jane.id}, {}, {}]


def test_judges_are_created_as_settled_and_one_can_be_left_off():
    jane = judge_row("Jane", "Smith")
    read = raw_read(judges=[bill_judge("Jane", "Smith"), bill_judge("Bob", "Lee"), bill_judge("Ring", "Steward")])
    new_bob = {"first_name": "Bob", "last_name": "Lee", "phone": "555-0100"}
    draft, _x = build(read, judges=[jane], choices=[{"judge_id": jane.id}, {"new": new_bob}, {"leave_off": True}])

    made = payload(draft).judges
    assert [j.judge_id for j in made] == [jane.id, None]
    assert (made[1].first_name, made[1].phone) == ("Bob", "555-0100")


def test_a_venue_is_created_as_settled_or_left_blank():
    new = {"name": "Double F Arena", "address": "1 Arena Rd", "city": "Hinckley", "state": "MN", "zip": "55037"}
    draft, _x = build(raw_read(), venue={"new": new})
    assert payload(draft).venue.zip == "55037"

    draft, _x = build(raw_read(), venue=None)
    assert payload(draft).venue is None


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

def test_a_per_judge_rate_is_multiplied_by_the_carded_judges_kept():
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

    # One of them left off on the confirm page: the price follows the panel kept.
    kept = {"new": {"first_name": "x", "last_name": "y", "email": "e"}}
    draft, _x = build(read, choices=[kept, kept, {"leave_off": True}])
    assert [c["entry_fee_cents"] for c in draft.classes] == [500, 500]


def test_per_judge_count_falls_back_to_the_whole_panel():
    panel = [bill_judge("A", "One", ["APHA"]), bill_judge("B", "Two", [])]
    assert per_judge_count(rate("x", 100, True, code="NSBA"), panel) == 2
    assert per_judge_count(rate("x", 100, True), panel) == 2
    assert per_judge_count(rate("x", 100, True, code="apha"), panel) == 1


def test_unpriced_classes_are_free():
    draft, _x = build(raw_read(classes=[a_class(name="Lead Line", rate_key=None)]))
    assert draft.classes[0]["entry_fee_cents"] == 0


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


def test_one_office_fee_printed_is_everybodys_whichever_box_it_was_read_into():
    read = raw_read(classes=[a_class(name="Futurity Halter", futurity="Fut")])
    read["futurities"] = [futurity("Fut", office_fee_nonmember_cents=2500)]
    draft, _x = build(read)
    fut = draft.futurities[0]
    assert (fut["office_fee_member_cents"], fut["office_fee_nonmember_cents"]) == (2500, 2500)


def test_a_futurity_late_fee_with_no_deadline_is_left_off():
    read = raw_read(classes=[a_class(name="Futurity Halter", futurity="Fut")])
    read["futurities"] = [futurity("Fut", late_fee_cents=2500)]
    draft, _x = build(read)

    assert draft.futurities[0]["late_fee_cents"] == 0
    assert payload(draft).futurities[0].late_fee_cents == 0


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


def test_a_side_pot_with_no_classes_is_not_set_up_and_one_with_no_fee_takes_the_default():
    read = raw_read(classes=[a_class(name="Trail", side_pots=["Trail Pot"])])
    read["side_pots"] = [side_pot("Trail Pot"), side_pot("Mystery Pot", description="$100 added")]
    draft, _x = build(read)

    (pot,) = draft.side_pots
    assert (pot["name"], pot["entry_fee_cents"], pot["payback_percent"]) == ("Trail Pot", 1000, 100)


# ── Classes ───────────────────────────────────────────────────────────────────

def test_a_class_printed_twice_on_a_day_is_created_once():
    read = raw_read(classes=[a_class(name="Trail", side_pots=["Pot"]), a_class(name="trail ", side_pots=["Pot"])])
    read["side_pots"] = [side_pot("Pot")]
    draft, _x = build(read)

    assert [c["class_name"] for c in draft.classes] == ["Trail"]
    assert draft.side_pots[0]["class_indexes"] == [0]
    assert apply_problems(payload(draft)) == []


def test_a_class_with_no_readable_day_goes_on_the_first_day():
    draft, _x = build(raw_read(classes=[a_class(name="Trail", date="2026-01-01", number="12")]))

    assert draft.classes[0]["class_date"] == date(2027, 8, 21)


def test_moving_the_start_date_moves_the_schedule_day_for_day():
    draft, _x = build(raw_read(classes=[a_class(name="Trail", date="2027-08-22")]), start="2028-08-19", end="2028-08-20")
    assert draft.classes[0]["class_date"] == date(2028, 8, 20)


def test_the_reader_is_asked_for_no_warnings_or_class_notes():
    """The office checks the show against the bill on the setup steps; the
    read lists nothing for it to check."""
    from extraction.showbill import CLASSES_SCHEMA, HEADER_SCHEMA, STALLS_SCHEMA, SYSTEM_PROMPT

    assert "note" not in CLASSES_SCHEMA["properties"]["classes"]["items"]["properties"]
    assert all("warnings" not in schema["properties"] for schema in (HEADER_SCHEMA, CLASSES_SCHEMA, STALLS_SCHEMA))
    assert "warning" not in SYSTEM_PROMPT


# ── Clubs ─────────────────────────────────────────────────────────────────────

def test_a_club_the_registry_lacks_marks_no_class():
    read = raw_read(
        clubs=[{"code": "MNSPHC", "name": None, "fee_amount_cents": None, "fee_unit": None, "fee_text": None}],
        classes=[a_class(name="All Breed Trail", club_codes=["MNSPHC"])],
    )
    draft, _x = build(read)

    assert draft.clubs == [] and draft.classes[0]["club_association_ids"] == []


def test_a_club_fee_is_kept_as_read():
    read = raw_read(
        clubs=[{"code": "WSCA", "name": None, "fee_amount_cents": 300, "fee_unit": "per_entry", "fee_text": "$3 per class"}],
        classes=[a_class(name="WSCA Trail", club_codes=["WSCA"])],
    )
    draft, _x = build(read)
    assert draft.classes[0]["club_association_ids"] == [WSCA.id]
    assert draft.clubs == [{"association_id": WSCA.id, "fee_amount_cents": 300, "fee_unit": "per_entry"}]


# ── Fees ──────────────────────────────────────────────────────────────────────

def test_fees_are_kept_and_an_early_rate_the_app_refuses_is_left_off():
    read = raw_read(fees=[
        fee("Stall", 9000, "per_stall"),
        fee("Office fee", 1500, "per_exhibitor"),
        fee("Arena fee", 300, "per_entry"),
        fee("Shavings", 1000, "per_bag", early_amount_cents=1200, early_deadline="2027-08-01"),
    ])
    draft, _x = build(read)

    assert len(draft.fees) == 4 and fee_problems(payload(draft)) == []
    # An early rate higher than the price is no early rate: everybody pays the price.
    shavings = draft.fees[3]
    assert (shavings["early_amount_cents"], shavings["early_deadline"]) == (None, None)


# ── The show row ──────────────────────────────────────────────────────────────

def test_an_entry_deadline_after_the_show_starts_is_blank():
    read = raw_read()
    read["show"]["entry_deadline"] = "2027-08-25"
    draft, _x = build(read)
    assert draft.show["entry_deadline"] is None


# ── The notes ─────────────────────────────────────────────────────────────────

def test_the_office_notes_are_only_what_the_bill_tells_the_office():
    """Officials, contacts, how the office runs -- never a list of things to
    check."""
    read = raw_read(
        judges=[bill_judge("Bob", "Lee")],
        class_rates=[rate("open", 900, per_judge=True)],
        classes=[a_class(name="Trail", rate_key="open")],
        fees=[fee("Office fee", 1500, "per_exhibitor")],
        notes_for_office="Show secretary: Kim Ray, 555-0101",
    )
    draft, extracted = build(read)

    assert office_notes_text(extracted) == "Show secretary: Kim Ray, 555-0101"
    assert office_notes_text(normalize_showbill(raw_read())) is None


def test_an_older_read_keeps_its_officials_as_notes_and_drops_its_doubts():
    extracted = normalize_showbill(raw_read())
    extracted["show"]["staff"] = [{"role": "Show Secretary", "name": "Kim Ray"}]
    extracted["show_checks"] = [{"field": "start_date", "message": "Year inferred."}]
    extracted["judges"] = [{**bill_judge("Bob", "Lee"), "check": "Surname smudged."}]
    extracted["not_imported"] = [{"topic": "side_pot", "text": "Novice jackpot"}, "Refunds by request only"]
    resolved = prepare_draft(extracted, show_types=[APHA_TYPE], associations=[], judges=[], venues=[])
    draft = draft_from_read(
        extracted, resolved, name="S", show_type_id=None, start_date=date(2027, 8, 21), end_date=date(2027, 8, 22),
        judge_choices=[{"leave_off": True}], venue_choice=None,
    )
    text = office_notes_text(extracted)

    assert "- Kim Ray (Show Secretary)" in text
    assert "- Futurities & Side Pots: Novice jackpot" in text
    assert "- Refunds by request only" in text
    assert "Year inferred" not in text and "Surname smudged" not in text
    # An older read's doubts are dropped, not an error: the draft still builds.
    assert draft.judges == []


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
    )
    read["futurities"] = [futurity("Fut", late_fee_cents=500)]
    read["side_pots"] = [side_pot("Pot")]
    draft, extracted = build(read)
    made = payload(draft, public="Bring your own chairs.", office=office_notes_text(extracted))

    assert apply_problems(made) == [] and fee_problems(made) == []
    assert made.show.public_notes == "Bring your own chairs."
    assert made.show.office_notes is None


# ── Stall periods (2026-11-18) ────────────────────────────────────────────────

def _show(**fields):
    read = raw_read()
    read["show"].update(fields)
    return read


def _period(name, move_in="", move_out="", stalls=(), **kw):
    """A stall period as the reader returns it."""
    return {
        "name": name,
        "move_in": move_in,
        "move_out": move_out,
        "move_out_note": kw.get("move_out_note", ""),
        "move_in_notes": kw.get("move_in_notes", ""),
        "reserve_by": kw.get("reserve_by", ""),
        "stalls": [
            {"kind": k, "amount_cents": c, "early_amount_cents": e, "horses_per_tack_stall": h, "notes": n}
            for k, c, e, h, n in (tuple(st) + (0, 0, "")[len(st) - 2:] for st in stalls)
        ],
        "early_move_in_pass": kw.get("passes", []),
    }


def _stalls(*periods, **show):
    read = _show(**show)
    read["stall_periods"] = list(periods)
    return read


def test_a_bill_selling_stalls_by_window_makes_a_stall_period_for_each():
    """WSCA's Championship Show (2026-11-18): the full show, the pleasure days
    and the games days, each with its own box and tack price, tie stalls for
    the full show only, prices doubling after the entry deadline, and a
    priority move-in pass for the pleasure stalls."""
    read = _stalls(
        _period(
            "Full show", "2027-08-20 16:00", "2027-08-22",
            stalls=[("box", 26000, 13000, 0, "Horse Barn or Cattle Barn"), ("tie", 2500), ("tack", 26000, 13000, 3, "Group form")],
            reserve_by="2027-07-25",
        ),
        _period(
            "Pleasure", "2027-08-20 16:00", "2027-08-21",
            stalls=[("box", 11000, 5500), ("tack", 11000, 5500)],
            move_out_note="One hour after your last class",
            reserve_by="2027-07-25",
            passes=[{"label": "Priority Move-In Pass", "amount_cents": 7500, "move_in": "2027-08-20 14:00",
                     "move_in_until": "2027-08-20 16:00", "per_exhibitor": True, "notes": "One trailer per pass."}],
        ),
        _period(
            "Games", "2027-08-21 21:00", "2027-08-22",
            stalls=[("box", 11200, 5600), ("tack", 11200, 5600, 4)],
            move_in_notes="See a traffic attendant for your stall.",
            reserve_by="2027-07-25",
        ),
        stall_notes="No switching stalls.",
    )
    draft, _x = build(read)

    full, pleasure, games = draft.stall_periods
    assert [p["name"] for p in draft.stall_periods] == ["Full show", "Pleasure", "Games"]
    assert (full["move_in_date"], full["move_in_time"]) == (date(2027, 8, 20), time(16, 0))
    assert (games["move_in_date"], games["move_in_time"]) == (date(2027, 8, 21), time(21, 0))
    assert pleasure["move_out_note"] == "One hour after your last class"
    # The rules every period shares are said once, on the first period.
    assert full["move_in_notes"] == "No switching stalls."
    assert pleasure["move_in_notes"] is None
    assert games["move_in_notes"] == "See a traffic attendant for your stall."

    assert [(s["kind"], s["amount_cents"], s["early_amount_cents"]) for s in full["stalls"]] == [
        ("box", 26000, 13000), ("tie", 2500, None), ("tack", 26000, 13000),
    ]
    assert full["stalls"][0]["early_deadline"] == date(2027, 7, 25)
    assert full["stalls"][1]["early_deadline"] is None
    assert full["stalls"][2]["horses_per_tack_stall"] == 3
    assert games["stalls"][1]["horses_per_tack_stall"] == 4
    assert pleasure["early_move_in_pass"] == {
        "label": "Priority Move-In Pass",
        "amount_cents": 7500,
        "move_in_date": date(2027, 8, 20),
        "move_in_time": time(14, 0),
        "move_in_end_date": date(2027, 8, 20),
        "move_in_end_time": time(16, 0),
        "one_per_exhibitor": True,
        "notes": "One trailer per pass.",
    }
    assert full["early_move_in_pass"] is None

    made = payload(draft)
    assert [len(p.stalls) for p in made.stall_periods] == [3, 2, 2]
    assert made.fees == []


def test_the_bills_stall_lines_are_written_as_the_lodging_step_writes_them():
    """Each price in its period's cell on Lodging: a per_stall line with its
    kind and period, named for both, and the pass as the period's add-on --
    not a list of whole-show lines under Other charges per stall."""
    from uuid import UUID as _UUID

    from showbill_import import _stall_lines

    read = _stalls(
        _period("Full show", "2027-08-20 16:00", "2027-08-22", stalls=[("box", 13000), ("tack", 13000, 0, 3)]),
        _period(
            "Games", "2027-08-21 21:00", "2027-08-22", stalls=[("box", 5600)],
            passes=[{"label": "", "amount_cents": 3500, "move_in": "", "move_in_until": "", "per_exhibitor": False, "notes": ""}],
        ),
    )
    made = payload(build(read)[0])
    ids = [_UUID(int=1), _UUID("abcdef12" + "0" * 24)]
    rows = _stall_lines(uuid4(), made.stall_periods, ids, taken={"office"})

    assert [(r.code, r.label, r.stall_kind, r.stall_period_id) for r in rows] == [
        ("stall", "Box stall — Full show", "box", ids[0]),
        ("stall_tack_00000000", "Tack stall — Full show", "tack", ids[0]),
        ("stall_box_abcdef12", "Box stall — Games", "box", ids[1]),
        ("early_move_in_abcdef12", "Early Move-In Pass — Games", "add_on", ids[1]),
    ]
    assert all(r.unit == "per_stall" for r in rows)
    assert rows[1].horses_per_tack_stall == 3
    assert [r.sort_order for r in rows] == [1, 2, 3, 4]


def test_a_stall_priced_in_a_period_never_hands_the_stall_code_to_a_fee():
    assert fee_codes([("Stall deposit", "per_stall")]) == ["stall"]
    assert fee_codes([("Stall deposit", "per_stall")], stalls_priced=True) == ["stall_deposit"]
    assert fee_codes([("Early arrival stall", "per_stall")], stalls_priced=True) == ["early_arrival_stall_2"]


def test_a_lower_price_with_no_day_it_ends_is_dropped():
    read = _stalls(_period("Full show", "2027-08-20", "2027-08-22", stalls=[("box", 26000, 13000)]))
    [p] = build(read)[0].stall_periods
    assert p["stalls"][0]["early_amount_cents"] is None and p["stalls"][0]["early_deadline"] is None


def test_a_period_move_in_the_bill_doesnt_print_is_the_lodging_steps_default():
    draft, _x = build(_stalls(_period("Full show"), stall_notes="No unloading in the parking lot."))

    [p] = draft.stall_periods
    assert (p["move_in_date"], p["move_in_time"]) == (date(2027, 8, 20), time(12, 0))
    assert (p["move_out_date"], p["move_out_time"]) == (date(2027, 8, 22), None)
    assert p["move_in_notes"] == "No unloading in the parking lot."


def test_a_period_move_in_far_from_the_show_is_a_misread():
    draft, _x = build(_stalls(_period("Full show", "2026-08-20 16:00", "2027-08-22 18:00")))
    [p] = draft.stall_periods
    assert p["move_in_date"] == date(2027, 8, 20)
    assert p["move_out_time"] == time(18, 0)


def test_the_stall_periods_move_with_the_schedule():
    read = _stalls(_period("Full show", "2027-08-19 09:00", "2027-08-22"))
    draft, _x = build(read, start="2027-08-28", end="2027-08-29")
    assert draft.stall_periods[0]["move_in_date"] == date(2027, 8, 26)


def test_stall_rules_with_no_period_read_make_a_full_show_period():
    draft, _x = build(_show(stall_notes="Unload between the barns."))
    [p] = draft.stall_periods
    assert p["name"] == "Full show" and p["move_in_notes"] == "Unload between the barns."


def test_a_read_from_before_stall_periods_still_makes_its_one_period():
    extracted = normalize_showbill(raw_read())
    extracted.pop("stall_periods")
    extracted["show"].update(stall_notes="Unload between the barns.", stalls_move_in_date="2027-08-20", stalls_move_in_time="16:00")
    from showbill_draft import _stall_periods

    [p] = _stall_periods(extracted, date(2027, 8, 21), date(2027, 8, 22), __import__("datetime").timedelta(0))
    assert (p["name"], p["move_in_date"], p["move_in_time"]) == ("Full show", date(2027, 8, 20), time(16, 0))
    assert p["move_in_notes"] == "Unload between the barns." and p["stalls"] == []


def test_a_bill_saying_nothing_about_stalls_makes_no_period():
    draft, _x = build(raw_read())
    assert draft.stall_periods == [] and payload(draft).stall_periods == []


def test_which_vaccinations_go_to_the_paperwork_steps_notes():
    draft, _x = build(_show(requires_vaccination=True, vaccination_notes="Flu/Rhino and EHV within 6 months."))
    assert draft.show["vaccination_notes"] == "Flu/Rhino and EHV within 6 months."
    assert payload(draft).show.vaccination_notes == "Flu/Rhino and EHV within 6 months."


@pytest.mark.parametrize(
    "printed, day, hour",
    [
        ("2027-08-20 18:00", "2027-08-20", "18:00"),
        ("2027-08-20T6:30", "2027-08-20", "06:30"),
        ("2027-08-20", "2027-08-20", None),
        ("2027-08-20 25:00", "2027-08-20", None),
        ("Thursday evening", None, None),
        ("", None, None),
    ],
)
def test_a_move_in_reads_as_a_day_and_an_hour_or_is_left_out(printed, day, hour):
    read = normalize_showbill(_stalls(_period("Full show", printed)))
    [p] = read["stall_periods"]
    assert (p["move_in_date"], p["move_in_time"]) == (day, hour)
