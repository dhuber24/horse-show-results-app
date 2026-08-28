"""What an exhibitor owes, pinned down.

Every case here encodes an invariant `billing.py`'s own docstrings already
state. That is deliberate: the module is careful and well-reasoned, and the
risk is not that it is wrong today but that a later edit quietly trades one of
those reasons away. Three screens quote these numbers and a show office
collects on them, so a silent regression here charges a real person the wrong
amount.
"""
from datetime import date
from uuid import uuid4

import pytest

import billing
from tests.factories import (
    make_class_sanction,
    make_class,
    make_entry,
    make_fee,
    make_judges,
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


# ── Club sanctioning (migration 113) ──────────────────────────────────────────


def test_sanction_rates_reads_the_per_class_fee_off_each_club():
    nsba = make_sanctioning("NSBA", per_class_fee_cents=300)
    wsca = make_sanctioning("WSCA", per_class_fee_cents=200)
    rates = billing.sanction_rates(make_show(sanctioning=[nsba, wsca]))
    assert rates == {nsba.association_id: 300, wsca.association_id: 200}


def test_sanction_rates_drops_a_club_with_no_fee_set():
    """A show that enrolled a club without pricing it charges nothing, rather
    than putting a $0.00 line on every entry."""
    unpriced = make_sanctioning("WSCA", per_class_fee_cents=0)
    rates = billing.sanction_rates(make_show(sanctioning=[unpriced]))
    assert rates == {}


def test_sanction_rates_tolerates_a_row_with_no_association():
    """A sanctioning row whose association did not load must not raise — the
    bill is not the place to discover a dangling reference."""
    dangling = make_sanctioning(None, per_class_fee_cents=300)
    nsba = make_sanctioning("NSBA", per_class_fee_cents=500)
    rates = billing.sanction_rates(make_show(sanctioning=[dangling, nsba]))
    assert rates[nsba.association_id] == 500


def test_sanction_rates_handles_a_null_collection():
    assert billing.sanction_rates(make_show(sanctioning=None)) == {}


def test_an_undesignated_class_carries_no_sanction_fee():
    """The whole point of migration 113. A show carrying NSBA sanctioning runs
    plenty of classes NSBA has nothing to do with, and the exhibitor entering
    one of those owes nothing on it."""
    nsba = make_sanctioning("NSBA", per_class_fee_cents=300)
    rates = billing.sanction_rates(make_show(sanctioning=[nsba]))
    assert billing.class_sanction_cents(make_class(), rates) == 0


def test_a_designated_class_carries_that_club_s_fee():
    nsba = make_sanctioning("NSBA", per_class_fee_cents=300)
    rates = billing.sanction_rates(make_show(sanctioning=[nsba]))
    cls = make_class(sanctioning=[make_class_sanction(nsba)])
    assert billing.class_sanction_cents(cls, rates) == 300


def test_a_dual_sanctioned_class_carries_both_fees():
    """Two clubs approving the same class is two sanction fees, not the larger
    of the two — each club collects its own."""
    nsba = make_sanctioning("NSBA", per_class_fee_cents=300)
    wsca = make_sanctioning("WSCA", per_class_fee_cents=200)
    rates = billing.sanction_rates(make_show(sanctioning=[nsba, wsca]))
    cls = make_class(
        sanctioning=[make_class_sanction(nsba), make_class_sanction(wsca)]
    )
    assert billing.class_sanction_cents(cls, rates) == 500


def test_a_designation_for_a_club_the_show_dropped_charges_nothing():
    """Removing a club in Step 3 leaves its class designations behind. They
    must price at zero rather than at whatever the club used to charge."""
    dropped = make_sanctioning("WSCA", per_class_fee_cents=200)
    cls = make_class(sanctioning=[make_class_sanction(dropped)])
    assert billing.class_sanction_cents(cls, rates={}) == 0


def test_sanction_fee_does_not_scale_with_the_entry_fee():
    """It is a flat per-class amount, not a percentage. A $100 class and a $25
    class designated for the same club owe the same."""
    nsba = make_sanctioning("NSBA", per_class_fee_cents=300)
    rates = billing.sanction_rates(make_show(sanctioning=[nsba]))
    for fee in (0, 2500, 10000):
        cls = make_class(entry_fee_cents=fee, sanctioning=[make_class_sanction(nsba)])
        assert billing.class_sanction_cents(cls, rates) == 300



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
    assert bill["sanction_total_cents"] == 0
    assert bill["office_charge_total_cents"] == 1000
    assert bill["reservation_total_cents"] == 10000
    assert bill["total_cents"] == 16500
    assert bill["total_cents"] == (
        bill["class_fee_total_cents"]
        + bill["sanction_total_cents"]
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


def test_bill_charges_sanction_per_entry():
    """Money is per entry, not per class — an exhibitor showing two horses in
    the same pattern class owes two sanction fees."""
    nsba = make_sanctioning("NSBA", per_class_fee_cents=600)
    show = make_show(sanctioning=[nsba])
    cls = make_class(entry_fee_cents=10000, sanctioning=[make_class_sanction(nsba)])
    entries = [make_entry(cls=cls) for _ in range(2)]

    bill = billing.build_bill(show, entries, [])

    assert bill["sanction_total_cents"] == 1200
    assert all(line["sanction_cents"] == 600 for line in bill["class_lines"])


def test_bill_charges_sanction_only_on_the_designated_classes():
    """The regression migration 113 exists to prevent: an NSBA show billing a
    sanction fee on every class an exhibitor entered."""
    nsba = make_sanctioning("NSBA", per_class_fee_cents=300)
    show = make_show(sanctioning=[nsba])
    entries = [
        make_entry(cls=make_class(sanctioning=[make_class_sanction(nsba)])),
        make_entry(cls=make_class()),
        make_entry(cls=make_class()),
    ]

    bill = billing.build_bill(show, entries, [])

    assert bill["sanction_total_cents"] == 300, "one designated class, not three"
    assert [line["sanction_cents"] for line in bill["class_lines"]] == [300, 0, 0]


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
    show = make_show(
        office_charge_cents=1000,
        sanctioning=[make_sanctioning("NSBA", per_class_fee_cents=600)],
    )
    entries = [
        make_entry(
            cls=make_class(
                entry_fee_cents=10000,
                sanctioning=[make_class_sanction(show.sanctioning[0])],
            )
        )
    ]
    reservations = [make_reservation(fee=make_fee(amount_cents=5000), quantity=1)]
    account = billing.build_account(show, entries, reservations, [])

    totals = billing.summarize_accounts([account, account])

    assert totals["accounts"] == 2
    assert totals["class_fee_total_cents"] == 20000
    assert totals["sanction_total_cents"] == 1200
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


# ── The show's own automatic charges (migration 112) ──────────────────────────


def _charged(fee, entries, judges=0):
    """Bill one exhibitor at a show carrying exactly this one automatic fee."""
    return billing.build_bill(
        make_show(fees=[fee], judges=make_judges(judges)), entries, []
    )


def test_a_per_exhibitor_charge_is_charged_once_however_many_horses():
    fee = make_fee(code="gate", label="Gate fee", unit="per_exhibitor", amount_cents=1500)
    bill = _charged(fee, [make_entry(), make_entry()])
    assert bill["charge_total_cents"] == 1500
    assert bill["charge_lines"][0]["quantity"] == 1


def test_a_per_horse_charge_counts_distinct_horses():
    """Two entries on one horse is one horse, the same rule the per-horse office
    charge follows — a drug fee is levied on the animal, not on the paperwork."""
    horse = uuid4()
    fee = make_fee(code="drug", label="Drug fee", unit="per_horse", amount_cents=800)
    bill = _charged(fee, [make_entry(horse_id=horse), make_entry(horse_id=horse), make_entry()])
    assert bill["charge_total_cents"] == 1600
    assert bill["charge_lines"][0]["quantity"] == 2


def test_a_per_judge_per_horse_charge_multiplies_both():
    fee = make_fee(code="judge", label="Judge fee", unit="per_judge_per_horse", amount_cents=500)
    bill = _charged(fee, [make_entry(), make_entry()], judges=3)
    assert bill["charge_total_cents"] == 3000
    line = bill["charge_lines"][0]
    assert (line["judge_count"], line["horse_count"], line["quantity"]) == (3, 2, 6)


def test_a_per_judge_per_exhibitor_charge_ignores_the_horse_count():
    """The half of "per judge" that the split exists to keep apart.

    Same fee, same panel, same two horses as the test above — and a fifth of
    the money. Which of the two a show means is not recoverable from the amount,
    which is why the unit says it.
    """
    fee = make_fee(code="judge", unit="per_judge_per_exhibitor", amount_cents=500)
    bill = _charged(fee, [make_entry(), make_entry()], judges=3)
    assert bill["charge_total_cents"] == 1500


def test_an_automatic_charge_needs_entries():
    """Signing up is not entering. Somebody holding a stall and no classes has
    not incurred the show's per-horse costs — the rule `office_charge_total_cents`
    already applies."""
    fee = make_fee(code="gate", unit="per_exhibitor", amount_cents=1500)
    assert _charged(fee, [])["charge_total_cents"] == 0


def test_a_free_charge_produces_no_line():
    """`POST /shows/{id}/fees/seed` writes its templates at $0 for the secretary
    to fill in. A column of $0.00 rows teaches people to skim the bill."""
    fee = make_fee(code="drug", unit="per_horse", amount_cents=0)
    assert _charged(fee, [make_entry()])["charge_lines"] == []


def test_a_per_judge_charge_is_nothing_without_a_panel():
    """No judges assigned yet is zero judges, not one. Guessing at a panel size
    would bill a number the show never agreed to."""
    fee = make_fee(code="judge", unit="per_judge_per_horse", amount_cents=500)
    assert _charged(fee, [make_entry()], judges=0)["charge_lines"] == []


@pytest.mark.parametrize("unit", ["flat", "per_entry", "per_class_per_horse", "percent_of_entry"])
def test_price_list_units_bill_nobody(unit):
    """`flat` because the app cannot derive who left the stall dirty; the rest
    because `classes.entry_fee_cents` already charges per entry and billing a
    `standard_class` row on top of it would double every class."""
    fee = make_fee(code="x", unit=unit, amount_cents=2500)
    assert _charged(fee, [make_entry()])["charge_total_cents"] == 0


def test_a_reservable_fee_is_never_charged_automatically():
    """A stall the exhibitor did not book is not a stall they owe for."""
    fee = make_fee(code="stall", unit="per_stall", amount_cents=5000)
    assert _charged(fee, [make_entry()])["charge_total_cents"] == 0


def test_charges_are_added_to_the_bill_total():
    show = make_show(
        office_charge_cents=1000,
        fees=[
            make_fee(code="gate", unit="per_exhibitor", amount_cents=1500),
            make_fee(code="drug", unit="per_horse", amount_cents=800),
        ],
        judges=make_judges(2),
    )
    bill = billing.build_bill(show, [make_entry(cls=make_class(entry_fee_cents=2500))], [])
    # 2500 class + 1000 office + 1500 gate + 800 drug
    assert bill["charge_total_cents"] == 2300
    assert bill["total_cents"] == 5800


def test_the_rollup_keeps_charges_apart_from_reservations():
    """Both are `show_fees` rows and they are summarised separately.

    The Stalls, Shavings & Camping report foots `fee_lines` against
    `reservation_total_cents`; a drug fee nobody booked appearing there would
    leave that sheet's rows disagreeing with its own total.
    """
    fee = make_fee(code="drug", label="Drug fee", unit="per_horse", amount_cents=800)
    show = make_show(fees=[fee])
    accounts = [
        billing.build_account(show, [make_entry()], [], []),
        billing.build_account(show, [make_entry(), make_entry()], [], []),
    ]
    totals = billing.summarize_accounts(accounts)
    assert totals["fee_lines"] == []
    assert totals["charge_total_cents"] == 2400
    (charge,) = totals["charge_lines"]
    assert (charge["quantity"], charge["exhibitors"], charge["line_total_cents"]) == (3, 2, 2400)


def test_automatic_fees_are_the_other_half_of_reservable_fees():
    fees = [
        make_fee(code="A", unit="per_horse"),
        make_fee(code="B", unit="per_stall"),
        make_fee(code="C", unit="flat"),
        make_fee(code="D", unit="per_judge_per_exhibitor"),
    ]
    assert [f.code for f in billing.automatic_fees(fees)] == ["A", "D"]
    assert [f.code for f in billing.reservable_fees(fees)] == ["B"]


# ── Fee helpers ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "unit", ["per_stall", "per_bag", "per_night", "per_day", "per_show"]
)
def test_reservable_units_are_offered(unit):
    assert billing.reservable_fees([make_fee(unit=unit)])


@pytest.mark.parametrize("unit", ["per_night", "per_day", "per_show"])
def test_a_reservation_is_priced_the_same_whatever_the_unit_calls_it(unit):
    """The unit names what the quantity counts; it never enters the arithmetic.

    Camping is one line item priced by the night, by the day or by the show
    (migrations 108, 111), and all three go through this same rate x quantity.
    That is exactly why `PATCH /shows/{id}/fees/{fee_id}` refuses to change the
    unit on a fee somebody has already reserved: nothing downstream would
    notice that "3 nights" had become "3 days" or "3 spots", and the bill would
    just quietly say something else.
    """
    fee = make_fee(code="camping", unit=unit, amount_cents=6000)
    bill = billing.build_bill(
        make_show(), [], [make_reservation(fee=fee, quantity=3)]
    )
    assert bill["reservation_total_cents"] == 18000
    assert bill["reservation_lines"][0]["unit"] == unit


@pytest.mark.parametrize(
    "unit", ["per_entry", "flat", "per_horse", "per_judge_per_horse"]
)
def test_non_reservable_units_are_not_offered(unit):
    """A class entry fee is never reserved a quantity of — it is charged per
    entry, so an early rate would have nothing to apply to. Nor is a charge the
    show applies to everybody: `per_horse` and `per_judge_per_horse` bill
    automatically, which is the opposite of something you book."""
    assert billing.reservable_fees([make_fee(unit=unit)]) == []


def test_reservable_fees_keep_the_secretary_s_order():
    fees = [make_fee(code="A", unit="per_stall"), make_fee(code="X", unit="flat"), make_fee(code="B", unit="per_bag")]
    assert [f.code for f in billing.reservable_fees(fees)] == ["A", "B"]


def test_find_fee_returns_the_match_or_none():
    wanted, other = make_fee(), make_fee()
    assert billing.find_fee([other, wanted], wanted.id) is wanted
    assert billing.find_fee([other], wanted.id) is None
    assert billing.find_fee([], wanted.id) is None
