"""Office changes to what an exhibitor owes (migration 197).

GaitDesk does not run the stall chart; the office does, and the bill follows it
through the bookings the office sets and through adjustments: a signed amount
and a reason, positive a charge and negative a credit, in `build_bill`'s total
like every other line. Not a payment -- a refund is a negative payment.
"""
from datetime import date, datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

import billing
from schemas import AccountAdjustmentCreate
from tests.factories import make_class, make_entry, make_show


def adjustment(amount_cents, reason="Box stalls full — given a tie stall"):
    return SimpleNamespace(
        id=uuid4(), amount_cents=amount_cents, reason=reason,
        recorded_by_name="Office", created_at=datetime(2027, 9, 23, tzinfo=timezone.utc),
    )


def a_bill(adjustments=()):
    show = make_show()
    entry = make_entry(cls=make_class(entry_fee_cents=2500))
    return billing.build_bill(show, [entry], [], (), (), adjustments)


def test_a_bill_with_no_adjustments_is_unchanged():
    bill = a_bill()
    assert bill["adjustment_lines"] == []
    assert bill["adjustment_total_cents"] == 0
    assert bill["total_cents"] == 2500


def test_a_credit_lowers_the_bill_and_a_charge_raises_it():
    credit = adjustment(-10500)
    charge = adjustment(5000, "Stall not checked out — cleaning fee")
    bill = a_bill([credit, charge])
    assert [line["amount_cents"] for line in bill["adjustment_lines"]] == [-10500, 5000]
    assert bill["adjustment_lines"][1]["reason"] == "Stall not checked out — cleaning fee"
    assert bill["adjustment_total_cents"] == -5500
    assert bill["total_cents"] == 2500 - 5500


def test_an_adjustment_changes_the_balance_not_what_was_paid():
    show = make_show()
    entry = make_entry(cls=make_class(entry_fee_cents=2500))
    paid = SimpleNamespace(amount_cents=2500, received_on=date(2027, 9, 1), created_at=None)
    account = billing.build_account(show, [entry], [], [paid], (), (), [adjustment(-1000)])
    assert account["net_paid_cents"] == 2500
    assert account["balance_cents"] == -1000  # a credit the office owes back


def test_the_show_totals_carry_the_adjustments():
    show = make_show()
    entry = make_entry(cls=make_class(entry_fee_cents=2500))
    accounts = [
        billing.build_account(show, [entry], [], [], (), (), [adjustment(-500)]),
        billing.build_account(show, [entry], [], [], (), (), [adjustment(5000)]),
    ]
    totals = billing.summarize_accounts(accounts)
    assert totals["adjustment_total_cents"] == 4500
    assert totals["billed_cents"] == 2500 * 2 + 4500


def test_an_adjustment_needs_an_amount_and_a_reason():
    with pytest.raises(ValidationError):
        AccountAdjustmentCreate(exhibitor_id=uuid4(), amount_cents=0, reason="Comped stall")
    with pytest.raises(ValidationError):
        AccountAdjustmentCreate(exhibitor_id=uuid4(), amount_cents=-500, reason="   ")
    body = AccountAdjustmentCreate(exhibitor_id=uuid4(), amount_cents=-500, reason="  Comped stall ")
    assert body.reason == "Comped stall"
