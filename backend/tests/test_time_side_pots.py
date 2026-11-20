"""A side pot paid on time (migration 205), from the bill to the bill it charges.

The WSCA Championship Show prints "$1,000 Added SIDEPOT 5D Barrels" as class
108, but its rules say the sidepot "times will be taken from age division run
{there will not be a seperate run}". The reader made it a class because the
prompt said a numbered jackpot is a class, and a side pot could not have held it
anyway: it could only add up placings or scores, where the higher score wins.
These tests pin each step of what replaced that:

* the reader's rule, and what a time pot reads as;
* the draft that sets it up, saying what the bill left out;
* a time pot obliges nobody and is bought into run by run;
* each run bought in is a buy-in on the bill;
* added money is in the pool and not in what the show keeps.
"""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from billing import side_pot_lines, side_pot_money
from extraction.showbill import SYSTEM_PROMPT, normalize_showbill
from schemas import SidePotCreate, default_d_percents
from side_pot_membership import (
    assert_pots_joinable,
    billed_pots,
    join_pots,
    pot_bill_index,
    pots_covering_class,
    unmet_pots,
)
from tests.test_showbill_draft import build, payload, side_pot
from tests.test_showbill_import import a_class, raw_read

BARRELS = uuid4()
SHOW_ENTRY = uuid4()


# ── The reader ───────────────────────────────────────────────────────────────

def test_the_prompt_no_longer_makes_every_numbered_jackpot_a_class():
    assert "is a class, not a side pot." in SYSTEM_PROMPT  # a jackpot with its own go still is
    assert "even when the schedule numbers it like a class" in SYSTEM_PROMPT
    assert "jackpot printed as a class of its own on the schedule is a class" not in SYSTEM_PROMPT


def barrels_read():
    read = raw_read(classes=[
        a_class(name="Int. Barrels", side_pots=["$1,000 Added SIDEPOT 5D Barrels"]),
        a_class(name="Sr. Barrels", side_pots=["$1,000 Added SIDEPOT 5D Barrels"]),
        a_class(name="Assisted Walk Trot Barrels"),
    ])
    read["side_pots"] = [side_pot(
        "$1,000 Added SIDEPOT 5D Barrels",
        description="Times taken from the age division run.",
        entry_fee_cents=4000,
        payback_percent=75,
        scoring="time",
        added_money_cents=100_000,
        d_count=5,
        d_split_ms=500,
    )]
    return read


def test_a_time_pot_is_read_with_its_ds_and_added_money():
    (pot,) = normalize_showbill(barrels_read())["side_pots"]
    assert (pot["scoring"], pot["d_count"], pot["d_split_ms"], pot["added_money_cents"]) == (
        "time", 5, 500, 100_000
    )


def test_a_placings_pot_has_no_ds_whatever_the_read_says():
    read = raw_read()
    read["side_pots"] = [side_pot("Novice Jackpot", scoring="placings", d_count=5, d_split_ms=500)]
    (pot,) = normalize_showbill(read)["side_pots"]
    assert (pot["scoring"], pot["d_count"], pot["d_split_ms"], pot["added_money_cents"]) == (
        "placings", None, None, 0
    )


def test_an_older_read_without_the_fields_is_a_placings_pot():
    read = raw_read()
    read["side_pots"] = [side_pot("Novice Jackpot")]
    (pot,) = normalize_showbill(read)["side_pots"]
    assert pot["scoring"] == "placings" and pot["added_money_cents"] == 0


# ── The draft ────────────────────────────────────────────────────────────────

def test_the_draft_sets_up_a_time_pot_over_the_classes_its_runs_come_from():
    draft, _x = build(barrels_read())
    (pot,) = payload(draft).side_pots
    assert pot.scoring_method == "fastest_time"
    assert (pot.d_count, pot.d_split_ms, pot.added_money_cents) == (5, 500, 100_000)
    assert (pot.entry_fee_cents, pot.payback_percent, pot.class_indexes) == (4000, 75, [0, 1])


def test_a_time_pot_with_no_ds_printed_is_one_field():
    read = barrels_read()
    read["side_pots"][0].update(d_count=0, d_split_ms=0)
    draft, _x = build(read)
    (pot,) = payload(draft).side_pots
    assert (pot.d_count, pot.d_split_ms) == (1, 500)


# ── The pot itself ──────────────────────────────────────────────────────────

def test_a_new_time_pot_takes_the_default_shares_for_its_ds():
    pot = SidePotCreate(name="5D", scoring_method="fastest_time", d_count=5, class_ids=[uuid4()])
    assert pot.d_percents == [30, 25, 20, 15, 10]
    assert default_d_percents(7) == [16, 14, 14, 14, 14, 14, 14]


def test_shares_that_do_not_fit_the_ds_are_refused():
    with pytest.raises(ValidationError):
        SidePotCreate(name="5D", scoring_method="fastest_time", d_count=5, d_percents=[50, 50], class_ids=[uuid4()])
    with pytest.raises(ValidationError):
        SidePotCreate(name="4D", d_count=4, d_percents=[40, 30, 20, 20], class_ids=[uuid4()])


# ── Membership: a time pot obliges nobody ────────────────────────────────────

def make_pot(*, scoring_method="fastest_time", rows=(), fee=4000, name="5D Barrels"):
    return SimpleNamespace(
        id=uuid4(),
        name=name,
        status="open",
        entry_fee_cents=fee,
        scoring_method=scoring_method,
        pot_classes=[SimpleNamespace(class_id=BARRELS)],
        pot_entries=[SimpleNamespace(show_entry_id=se, entry_id=run) for se, run in rows],
    )


def test_a_time_pot_is_no_condition_of_entering_its_classes():
    pots = [make_pot()]
    assert pots_covering_class(pots, BARRELS) == []
    assert unmet_pots(pots, BARRELS, SHOW_ENTRY) == []


def test_a_time_pot_cannot_be_bought_into_from_an_entry_form():
    pot = make_pot()
    with pytest.raises(ValueError, match="run by run"):
        assert_pots_joinable([pot], {pot.id}, {BARRELS})


def test_joining_with_an_entry_never_buys_a_person_into_a_time_pot():
    pot = make_pot()
    assert join_pots(SHOW_ENTRY, [pot], db=SimpleNamespace(add=lambda row: None)) == []
    assert pot.pot_entries == []


# ── Billing: each run bought in is a buy-in ──────────────────────────────────

def test_two_runs_bought_in_are_two_buy_ins_on_one_line():
    pot = make_pot(rows=[(SHOW_ENTRY, uuid4()), (SHOW_ENTRY, uuid4()), (uuid4(), uuid4())])
    billed = billed_pots([pot], SHOW_ENTRY)
    assert billed == [pot, pot]
    (line,), total = side_pot_lines(billed)
    assert (line["quantity"], line["line_total_cents"], total) == (2, 8000, 8000)
    assert line["name"] == "5D Barrels × 2 runs"
    assert pot_bill_index([pot])[SHOW_ENTRY] == [pot, pot]


def test_a_per_exhibitor_pot_is_still_one_buy_in():
    pot = make_pot(scoring_method="sum_placings", rows=[(SHOW_ENTRY, None)], name="Ranch Jackpot")
    (line,), total = side_pot_lines(billed_pots([pot], SHOW_ENTRY))
    assert (line["quantity"], line["name"], total) == (1, "Ranch Jackpot", 4000)


def test_added_money_is_in_the_pool_and_not_in_what_the_show_keeps():
    pot = SimpleNamespace(entry_fee_cents=4000, payback_percent=75, added_money_cents=100_000)
    money = side_pot_money(pot, paid_entry_count=40, payouts=[])
    assert money["buy_ins_cents"] == 160_000
    assert money["payout_pool_cents"] == 120_000 + 100_000
    assert money["retained_cents"] == 40_000
