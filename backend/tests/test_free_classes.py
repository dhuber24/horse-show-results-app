"""A class the show office made free (migration 166).

Free means the entry costs nothing, and the office chose that over a $0 class
on purpose: a $0 class may simply be unpriced, and it still counts toward the
office charge. So a free class waives the class fee, a club's sanction fee on
it and every automatic charge -- and an exhibitor entered only in free classes
owes nothing. A side pot buy-in is prize money, not a fee, and stays.
"""
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import billing
from routers.classes import _apply_free
from tests.factories import (
    make_class,
    make_class_sanction,
    make_entry,
    make_fee,
    make_judges,
    make_sanctioning,
    make_show,
)


def _office_charge():
    return make_fee(code="office", label="Office fee", unit="per_exhibitor", amount_cents=1500)


def test_a_free_class_line_charges_nothing():
    leadline = make_class(class_number=1, class_name="Leadline", entry_fee_cents=0, is_free=True)

    bill = billing.build_bill(make_show(), [make_entry(cls=leadline)], [])

    line = bill["class_lines"][0]
    assert line["fee_cents"] == 0
    assert line["is_free"] is True
    assert bill["total_cents"] == 0


def test_a_free_class_line_charges_nothing_even_if_a_price_is_left_on_the_row():
    """The CHECK holds the price at 0; the bill reads the flag as well, so a row
    that somehow kept one still cannot be charged."""
    leadline = make_class(entry_fee_cents=2500, is_free=True)

    bill = billing.build_bill(make_show(), [make_entry(cls=leadline)], [])

    assert bill["class_fee_total_cents"] == 0


def test_a_free_class_carries_none_of_the_show_s_per_class_fees():
    leadline = make_class(class_number=1, entry_fee_cents=0, is_free=True)
    showmanship = make_class(class_number=2, entry_fee_cents=2000)
    per_class = make_fee(code="class", label="Class fee", unit="per_entry", amount_cents=500)
    assessment = make_fee(code="apha", label="APHA fee", unit="per_judge_per_entry", amount_cents=300)
    show = make_show(fees=[per_class, assessment], judges=make_judges(2))

    bill = billing.build_bill(show, [make_entry(cls=leadline), make_entry(cls=showmanship)], [])

    charged = {line["class_number"]: line["charge_cents"] for line in bill["class_lines"]}
    assert charged == {1: 0, 2: 500 + 600}
    assert billing.per_class_charges(show.fees, leadline, 2) == [], "the picker quotes it free too"


def test_only_free_entries_owe_no_office_or_per_horse_charge():
    """A $0 class still counts toward the office charge -- that is the
    difference between a free class and an unpriced one."""
    drug = make_fee(code="drug", label="Drug fee", unit="per_horse", amount_cents=800)
    show = make_show(fees=[_office_charge(), drug])

    free_only = billing.build_bill(show, [make_entry(cls=make_class(entry_fee_cents=0, is_free=True))], [])
    zero_priced = billing.build_bill(show, [make_entry(cls=make_class(entry_fee_cents=0))], [])

    assert free_only["charge_total_cents"] == 0
    assert free_only["total_cents"] == 0
    assert zero_priced["charge_total_cents"] == 1500 + 800


def test_a_free_entry_beside_a_paid_one_adds_nothing_to_the_office_charges():
    drug = make_fee(code="drug", label="Drug fee", unit="per_horse", amount_cents=800)
    show = make_show(fees=[_office_charge(), drug])
    entries = [
        make_entry(cls=make_class(entry_fee_cents=2000)),
        make_entry(cls=make_class(entry_fee_cents=0, is_free=True)),  # a second horse
    ]

    bill = billing.build_bill(show, entries, [])

    assert bill["charge_total_cents"] == 1500 + 800, "one office charge, one horse"


def test_a_free_class_owes_no_club_sanction_fee():
    per_class = make_sanctioning("NSBA", fee_amount_cents=300)
    per_horse = make_sanctioning("WSCA", fee_amount_cents=4500, fee_unit="per_horse")
    show = make_show(sanctioning=[per_class, per_horse])
    free = make_class(
        entry_fee_cents=0,
        is_free=True,
        sanctioning=[make_class_sanction(per_class), make_class_sanction(per_horse)],
    )

    bill = billing.build_bill(show, [make_entry(cls=free)], [])

    assert billing.class_sanction_cents(free, billing.sanction_rates(show)) == 0
    assert bill["sanction_total_cents"] == 0
    assert bill["sanction_lines"] == []


def test_a_side_pot_buy_in_is_not_waived():
    """Prize money the exhibitor puts up, not a fee the show charges."""
    pot = SimpleNamespace(id=uuid4(), name="Jackpot", status="OPEN", pot_classes=[], entry_fee_cents=5000)

    bill = billing.build_bill(
        make_show(), [make_entry(cls=make_class(entry_fee_cents=0, is_free=True))], [], side_pots=[pot]
    )

    assert bill["side_pot_total_cents"] == 5000
    assert bill["total_cents"] == 5000


# ── Setting it ───────────────────────────────────────────────────────────────


def _class(**overrides):
    defaults = dict(class_number="12", class_name="Leadline", is_free=False, is_futurity_class=False)
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_ticking_free_holds_the_price_at_zero():
    update = {"is_free": True}

    _apply_free(_class(), update)

    assert update == {"is_free": True, "entry_fee_cents": 0}


def test_a_price_on_a_free_class_is_refused_rather_than_unfreeing_it():
    with pytest.raises(HTTPException) as exc:
        _apply_free(_class(is_free=True), {"entry_fee_cents": 2500})
    assert exc.value.status_code == 422
    assert "Untick Free" in exc.value.detail


def test_a_free_class_may_be_saved_at_zero():
    update = {"entry_fee_cents": 0}

    _apply_free(_class(is_free=True), update)

    assert update["entry_fee_cents"] == 0


def test_unticking_free_and_pricing_it_in_one_save_is_allowed():
    update = {"is_free": False, "entry_fee_cents": 2500}

    _apply_free(_class(is_free=True), update)

    assert update == {"is_free": False, "entry_fee_cents": 2500}


def test_a_futurity_class_cannot_be_made_free():
    """The futurity's categories price it; a tick here could not waive them."""
    with pytest.raises(HTTPException) as exc:
        _apply_free(_class(is_futurity_class=True), {"is_free": True})
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "FUTURITY_CLASS_PRICED"


def test_an_explicit_null_changes_nothing():
    update = {"is_free": None, "entry_fee_cents": 2500}

    _apply_free(_class(), update)

    assert update == {"entry_fee_cents": 2500}
