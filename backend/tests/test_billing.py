"""What an exhibitor owes, pinned down.

Every case here encodes an invariant `billing.py`'s own docstrings already
state. That is deliberate: the module is careful and well-reasoned, and the
risk is not that it is wrong today but that a later edit quietly trades one of
those reasons away. Three screens quote these numbers and a show office
collects on them, so a silent regression here charges a real person the wrong
amount.
"""
from datetime import date

import pytest

import billing
from tests.factories import (
    make_class,
    make_entry,
    make_fee,
    make_payment,
    make_payout,
    make_reservation,
    make_sanctioning,
    make_show,
    make_side_pot,
)

# ── The early rate is a pair ──────────────────────────────────────────────────


def test_early_rate_needs_both_halves():
    """An amount without a deadline, or a deadline without an amount, is a
    half-finished edit in the fee editor — not a price."""
    assert billing.has_early_rate(make_fee(early_amount_cents=4000, early_deadline=date(2026, 5, 1)))
    assert not billing.has_early_rate(make_fee(early_amount_cents=4000, early_deadline=None))
    assert not billing.has_early_rate(make_fee(early_amount_cents=None, early_deadline=date(2026, 5, 1)))
    assert not billing.has_early_rate(make_fee())


def test_early_rate_is_open_through_the_deadline_itself():
    fee = make_fee(early_amount_cents=4000, early_deadline=date(2026, 5, 1))
    assert billing.early_rate_is_open(fee, date(2026, 4, 30))
    assert billing.early_rate_is_open(fee, date(2026, 5, 1)), "the deadline day still counts"
    assert not billing.early_rate_is_open(fee, date(2026, 5, 2))


def test_early_rate_is_closed_when_the_fee_offers_none():
    assert not billing.early_rate_is_open(make_fee(), date(2020, 1, 1))


# ── A booking is priced off the day it was booked, never off today ────────────


def test_fee_rate_is_pinned_to_the_booking_date():
    """The one promise an early rate makes. Pricing off "now" would silently
    reprice an April reservation the moment the deadline passed in May."""
    fee = make_fee(amount_cents=5000, early_amount_cents=4000, early_deadline=date(2026, 5, 1))

    # Booked in April: keeps the early rate, however long after we ask.
    assert billing.fee_rate_cents(fee, date(2026, 4, 10)) == 4000
    # Booked in June: standard rate, and asking again later does not change it.
    assert billing.fee_rate_cents(fee, date(2026, 6, 10)) == 5000


def test_fee_rate_without_an_early_rate_is_always_the_standard_amount():
    fee = make_fee(amount_cents=5000)
    assert billing.fee_rate_cents(fee, date(2020, 1, 1)) == 5000
    assert billing.fee_rate_cents(fee, date(2030, 1, 1)) == 5000


# ── NSBA sanctioning ──────────────────────────────────────────────────────────


def test_nsba_sanction_is_six_percent_with_a_three_dollar_floor():
    assert billing.nsba_sanction_cents(10000) == 600           # 6% of $100
    assert billing.nsba_sanction_cents(2500) == 300            # 6% is $1.50 → floored to $3
    assert billing.nsba_sanction_cents(0) == 300               # owed even on a free class
    assert billing.nsba_sanction_cents(5000) == 300            # 6% is exactly $3


def test_show_is_nsba_sanctioned_only_via_a_club_row():
    assert not billing.show_is_nsba_sanctioned(make_show())
    assert not billing.show_is_nsba_sanctioned(make_show(sanctioning=[make_sanctioning("WSCA")]))
    assert billing.show_is_nsba_sanctioned(
        make_show(sanctioning=[make_sanctioning("WSCA"), make_sanctioning("NSBA")])
    )


def test_show_sanctioning_tolerates_a_row_with_no_association():
    """A sanctioning row whose association did not load must not raise — the
    bill is not the place to discover a dangling reference."""
    show = make_show(sanctioning=[make_sanctioning(None), make_sanctioning("NSBA")])
    assert billing.show_is_nsba_sanctioned(show) is True


def test_show_sanctioning_handles_a_null_collection():
    assert not billing.show_is_nsba_sanctioned(make_show(sanctioning=None))


# ── The office charge honours the show's stated basis ─────────────────────────


def test_office_charge_per_back_number_is_charged_once():
    """One back number, one charge, however many horses they brought."""
    show = make_show(office_charge_cents=1500, office_charge_basis="per_back_number")
    assert billing.office_charge_total_cents(show, distinct_horse_count=4, has_entries=True) == 1500


def test_office_charge_per_horse_multiplies():
    show = make_show(office_charge_cents=1500, office_charge_basis="per_horse")
    assert billing.office_charge_total_cents(show, distinct_horse_count=3, has_entries=True) == 4500


def test_office_charge_is_zero_without_entries():
    """Signing up for a show you never entered a class at does not owe the
    office charge."""
    show = make_show(office_charge_cents=1500, office_charge_basis="per_back_number")
    assert billing.office_charge_total_cents(show, distinct_horse_count=0, has_entries=False) == 0


def test_office_charge_is_zero_when_the_show_sets_none():
    show = make_show(office_charge_cents=0, office_charge_basis="per_horse")
    assert billing.office_charge_total_cents(show, distinct_horse_count=3, has_entries=True) == 0


# ── build_bill ────────────────────────────────────────────────────────────────


def test_bill_totals_its_four_components():
    show = make_show(office_charge_cents=1000, office_charge_basis="per_back_number")
    entries = [
        make_entry(cls=make_class(entry_fee_cents=2500)),
        make_entry(cls=make_class(entry_fee_cents=3000)),
    ]
    reservations = [make_reservation(fee=make_fee(amount_cents=5000), quantity=2)]

    bill = billing.build_bill(show, entries, reservations)

    assert bill["class_fee_total_cents"] == 5500
    assert bill["nsba_sanction_total_cents"] == 0
    assert bill["office_charge_total_cents"] == 1000
    assert bill["reservation_total_cents"] == 10000
    assert bill["total_cents"] == 16500
    assert bill["total_cents"] == (
        bill["class_fee_total_cents"]
        + bill["nsba_sanction_total_cents"]
        + bill["office_charge_total_cents"]
        + bill["reservation_total_cents"]
    )


def test_bill_counts_distinct_horses_for_a_per_horse_office_charge():
    """Two classes on the same horse is one horse. Counting entries instead
    would overcharge every exhibitor who enters more than one class."""
    show = make_show(office_charge_cents=1000, office_charge_basis="per_horse")
    shared_horse = object()
    entries = [
        make_entry(horse_id=shared_horse),
        make_entry(horse_id=shared_horse),
        make_entry(),
    ]

    bill = billing.build_bill(show, entries, [])

    assert bill["office_charge_total_cents"] == 2000, "two distinct horses, not three entries"


def test_bill_charges_nsba_sanction_per_entry():
    """Money is per entry, not per class — an exhibitor showing two horses in
    the same pattern class owes two sanction fees."""
    show = make_show(sanctioning=[make_sanctioning("NSBA")])
    entries = [make_entry(cls=make_class(entry_fee_cents=10000)) for _ in range(2)]

    bill = billing.build_bill(show, entries, [])

    assert bill["nsba_sanction_total_cents"] == 1200
    assert all(line["nsba_sanction_cents"] == 600 for line in bill["class_lines"])


def test_bill_skips_an_entry_whose_class_is_gone():
    """A class deleted out from under an entry must not take the whole bill
    down with it."""
    show = make_show()
    entries = [make_entry(cls=make_class(entry_fee_cents=2500)), make_entry(cls=None)]

    bill = billing.build_bill(show, entries, [])

    assert len(bill["class_lines"]) == 1
    assert bill["class_fee_total_cents"] == 2500


def test_bill_skips_reservations_with_no_quantity():
    show = make_show()
    reservations = [
        make_reservation(fee=make_fee(amount_cents=5000), quantity=0),
        make_reservation(fee=make_fee(amount_cents=5000), quantity=-1),
        make_reservation(fee=make_fee(amount_cents=5000), quantity=1),
    ]

    bill = billing.build_bill(show, [], reservations)

    assert len(bill["reservation_lines"]) == 1
    assert bill["reservation_total_cents"] == 5000


def test_bill_reservation_line_reports_the_early_rate_and_what_it_saved():
    fee = make_fee(amount_cents=5000, early_amount_cents=4000, early_deadline=date(2026, 5, 1))
    show = make_show()

    early = billing.build_bill(
        show, [], [make_reservation(fee=fee, quantity=2, reserved_at=date(2026, 4, 1))]
    )["reservation_lines"][0]
    assert early["amount_cents"] == 4000
    assert early["standard_amount_cents"] == 5000
    assert early["is_early_rate"] is True
    assert early["line_total_cents"] == 8000

    late = billing.build_bill(
        show, [], [make_reservation(fee=fee, quantity=2, reserved_at=date(2026, 6, 1))]
    )["reservation_lines"][0]
    assert late["amount_cents"] == 5000
    assert late["is_early_rate"] is False
    assert late["line_total_cents"] == 10000


def test_an_empty_bill_is_zero_rather_than_an_error():
    bill = billing.build_bill(make_show(office_charge_cents=1000), [], [])
    assert bill["total_cents"] == 0
    assert bill["class_lines"] == []
    assert bill["reservation_lines"] == []


# ── Payments: a refund is a negative row ──────────────────────────────────────


def test_payment_totals_keep_money_in_and_money_back_apart():
    """A day that took $600 and refunded $100 is not the same day as one that
    took $500, and the drawer has to be able to say so."""
    totals = billing.payment_totals_cents([make_payment(60000), make_payment(-10000)])

    assert totals["collected_cents"] == 60000
    assert totals["refunded_cents"] == 10000
    assert totals["net_paid_cents"] == 50000


def test_payment_totals_of_nothing_are_zero():
    assert billing.payment_totals_cents([]) == {
        "collected_cents": 0,
        "refunded_cents": 0,
        "net_paid_cents": 0,
    }


# ── One exhibitor's account ───────────────────────────────────────────────────


def test_account_balance_is_billed_minus_paid():
    show = make_show()
    entries = [make_entry(cls=make_class(entry_fee_cents=2500))]

    account = billing.build_account(show, entries, [], [make_payment(1000)])

    assert account["bill"]["total_cents"] == 2500
    assert account["net_paid_cents"] == 1000
    assert account["balance_cents"] == 1500


def test_overpaying_leaves_a_negative_balance():
    show = make_show()
    entries = [make_entry(cls=make_class(entry_fee_cents=2500))]

    account = billing.build_account(show, entries, [], [make_payment(4000)])

    assert account["balance_cents"] == -1500


def _account(billed: int, paid: int) -> dict:
    """An account billed exactly `billed` and paid exactly `paid`."""
    show = make_show()
    entries = [make_entry(cls=make_class(entry_fee_cents=billed))] if billed else []
    payments = [make_payment(paid)] if paid else []
    return billing.build_account(show, entries, [], payments)


# ── The show-wide rollup ──────────────────────────────────────────────────────


def test_outstanding_and_credit_are_never_netted():
    """The one to get right. One exhibitor paying twice must not reduce what
    the show is owed by everybody else — the office needs "still to collect",
    not a figure quietly offset by an overpayment.
    """
    accounts = [_account(billed=10000, paid=0), _account(billed=2000, paid=6000)]

    totals = billing.summarize_accounts(accounts)

    assert totals["outstanding_cents"] == 10000, "arrears are not reduced by someone else's credit"
    assert totals["credit_cents"] == 4000
    assert totals["net_balance_cents"] == 6000, "the netted figure is kept, just kept separately"


def test_rollup_counts_unpaid_apart_from_merely_outstanding():
    """`accounts_unpaid` is "has not paid a penny"; `accounts_outstanding` is
    "still owes something". A part payment is the second but not the first."""
    accounts = [_account(billed=10000, paid=0), _account(billed=10000, paid=4000)]

    totals = billing.summarize_accounts(accounts)

    assert totals["accounts_outstanding"] == 2
    assert totals["accounts_unpaid"] == 1


def test_a_settled_account_counts_as_paid_in_full():
    totals = billing.summarize_accounts([_account(billed=5000, paid=5000)])

    assert totals["accounts_outstanding"] == 0
    assert totals["accounts_paid_in_full"] == 1
    assert totals["outstanding_cents"] == 0
    assert totals["credit_cents"] == 0


def test_rollup_sums_each_billed_category():
    show = make_show(office_charge_cents=1000, sanctioning=[make_sanctioning("NSBA")])
    entries = [make_entry(cls=make_class(entry_fee_cents=10000))]
    reservations = [make_reservation(fee=make_fee(amount_cents=5000), quantity=1)]
    account = billing.build_account(show, entries, reservations, [])

    totals = billing.summarize_accounts([account, account])

    assert totals["accounts"] == 2
    assert totals["class_fee_total_cents"] == 20000
    assert totals["nsba_sanction_total_cents"] == 1200
    assert totals["office_charge_total_cents"] == 2000
    assert totals["reservation_total_cents"] == 10000
    assert totals["billed_cents"] == 33200


def test_rollup_groups_reservations_by_fee_across_exhibitors():
    """How many stalls the show actually sold. Keyed by fee id so a show's own
    custom fee is included with no change to this code."""
    stall = make_fee(code="STALL", label="Stall", amount_cents=5000)
    shavings = make_fee(code="SHAV", label="Shavings", unit="per_bag", amount_cents=900)
    show = make_show()

    accounts = [
        billing.build_account(show, [], [make_reservation(fee=stall, quantity=2)], []),
        billing.build_account(
            show, [], [make_reservation(fee=stall, quantity=1), make_reservation(fee=shavings, quantity=3)], []
        ),
    ]

    lines = {line["code"]: line for line in billing.summarize_accounts(accounts)["fee_lines"]}

    assert lines["STALL"]["quantity"] == 3
    assert lines["STALL"]["line_total_cents"] == 15000
    assert lines["SHAV"]["quantity"] == 3
    assert lines["SHAV"]["line_total_cents"] == 2700


def test_rollup_counts_how_many_units_went_at_the_early_rate():
    fee = make_fee(amount_cents=5000, early_amount_cents=4000, early_deadline=date(2026, 5, 1))
    show = make_show()
    accounts = [
        billing.build_account(
            show, [], [make_reservation(fee=fee, quantity=2, reserved_at=date(2026, 4, 1))], []
        ),
        billing.build_account(
            show, [], [make_reservation(fee=fee, quantity=1, reserved_at=date(2026, 6, 1))], []
        ),
    ]

    line = billing.summarize_accounts(accounts)["fee_lines"][0]

    assert line["quantity"] == 3
    assert line["early_rate_quantity"] == 2
    assert line["line_total_cents"] == 13000  # 2 × $40 + 1 × $50


def test_rollup_of_no_accounts_is_all_zeroes():
    totals = billing.summarize_accounts([])
    assert totals["accounts"] == 0
    assert totals["billed_cents"] == 0
    assert totals["outstanding_cents"] == 0
    assert totals["net_balance_cents"] == 0
    assert totals["fee_lines"] == []


# ── Side pot money, kept apart from the bill ──────────────────────────────────


def test_side_pot_pool_is_the_payback_percentage_of_the_buy_ins():
    pot = make_side_pot(entry_fee_cents=2000, payback_percent=80)

    money = billing.side_pot_money(pot, paid_entry_count=10, payouts=[])

    assert money["buy_ins_cents"] == 20000
    assert money["payout_pool_cents"] == 16000
    assert money["retained_cents"] == 4000


def test_side_pot_pool_floors_rather_than_rounding_up():
    """Integer division: the pot never pays out a cent it did not take."""
    pot = make_side_pot(entry_fee_cents=2500, payback_percent=70)

    money = billing.side_pot_money(pot, paid_entry_count=3, payouts=[])

    assert money["buy_ins_cents"] == 7500
    assert money["payout_pool_cents"] == 5250
    assert money["retained_cents"] == 2250


def test_side_pot_reports_what_has_actually_been_paid_out():
    pot = make_side_pot(entry_fee_cents=2000, payback_percent=100)

    money = billing.side_pot_money(pot, 5, [make_payout(6000), make_payout(4000)])

    assert money["paid_out_cents"] == 10000
    assert money["retained_cents"] == 0


def test_an_empty_side_pot_pays_out_nothing():
    money = billing.side_pot_money(make_side_pot(), paid_entry_count=0, payouts=[])
    assert money == {
        "buy_ins_cents": 0,
        "payout_pool_cents": 0,
        "paid_out_cents": 0,
        "retained_cents": 0,
    }


# ── Fee helpers ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("unit", ["per_stall", "per_bag", "per_night"])
def test_reservable_units_are_offered(unit):
    assert billing.reservable_fees([make_fee(unit=unit)])


@pytest.mark.parametrize("unit", ["per_entry", "flat", "per_horse"])
def test_non_reservable_units_are_not_offered(unit):
    """A class entry fee is never reserved a quantity of — it is charged per
    entry, so an early rate would have nothing to apply to."""
    assert billing.reservable_fees([make_fee(unit=unit)]) == []


def test_reservable_fees_keep_the_secretary_s_order():
    fees = [make_fee(code="A", unit="per_stall"), make_fee(code="X", unit="flat"), make_fee(code="B", unit="per_bag")]
    assert [f.code for f in billing.reservable_fees(fees)] == ["A", "B"]


def test_find_fee_returns_the_match_or_none():
    wanted, other = make_fee(), make_fee()
    assert billing.find_fee([other, wanted], wanted.id) is wanted
    assert billing.find_fee([other], wanted.id) is None
    assert billing.find_fee([], wanted.id) is None
