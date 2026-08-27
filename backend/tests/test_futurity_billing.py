"""What a futurity enrollment costs, pinned down.

A futurity prices its classes off the entrant's category rather than off the
class row, so the arithmetic lives in `billing.futurity_charge_cents` and
nowhere else. These cases encode the reasons migration 107 gives for that
shape — most importantly that a futurity class carries no `entry_fee_cents` of
its own, and that lateness is decided by the day the enrollment was taken.
"""
from datetime import date

import billing
from tests.factories import (
    make_class,
    make_entry,
    make_fee_tier,
    make_futurity,
    make_futurity_entry,
    make_membership_option,
    make_show,
)


# ── The per-class rate comes from the tier, times classes entered ─────────────


def test_charge_is_tier_rate_times_classes_entered():
    halter = make_class(entry_fee_cents=0)
    trail = make_class(entry_fee_cents=0)
    horse = make_entry(cls=halter).horse_id

    enrollment = make_futurity_entry(tier=make_fee_tier(amount_cents=15000), horse_id=horse)
    futurity = make_futurity(classes=[halter, trail], entries=[enrollment])

    entries = [make_entry(cls=halter, horse_id=horse), make_entry(cls=trail, horse_id=horse)]
    lines, total = billing.futurity_lines([futurity], entries)

    assert total == 30000, "two classes at $150 each"
    assert lines[0]["class_count"] == 2
    assert lines[0]["tier_amount_cents"] == 15000


def test_the_three_categories_charge_three_different_amounts():
    """The whole reason a futurity is not a single `show_fees` amount."""
    cls = make_class(entry_fee_cents=0)
    charges = []
    for amount in (7500, 10000, 15000):
        horse = make_entry(cls=cls).horse_id
        enrollment = make_futurity_entry(
            tier=make_fee_tier(amount_cents=amount), horse_id=horse
        )
        futurity = make_futurity(classes=[cls], entries=[enrollment])
        _, total = billing.futurity_lines([futurity], [make_entry(cls=cls, horse_id=horse)])
        charges.append(total)
    assert charges == [7500, 10000, 15000]


def test_an_enrollment_with_no_tier_owes_no_per_class_money():
    """A futurity with no tiers configured is a half-built one. It must not
    invent a price — the API refuses the entry, and if one exists anyway the
    bill reads zero rather than guessing."""
    cls = make_class(entry_fee_cents=0)
    horse = make_entry(cls=cls).horse_id
    enrollment = make_futurity_entry(tier=None, horse_id=horse)
    futurity = make_futurity(
        classes=[cls], entries=[enrollment], office_fee_nonmember_cents=2000
    )
    _, total = billing.futurity_lines([futurity], [make_entry(cls=cls, horse_id=horse)])
    assert total == 2000, "office fee only"


# ── Only the futurity's own classes count ─────────────────────────────────────


def test_classes_outside_the_futurity_are_not_charged_at_the_tier_rate():
    """The horse is also in an ordinary class. That one is billed by
    `entry_fee_cents` in the class lines and must not be billed again here."""
    futurity_class = make_class(entry_fee_cents=0)
    ordinary = make_class(entry_fee_cents=3600)
    horse = make_entry(cls=futurity_class).horse_id

    enrollment = make_futurity_entry(tier=make_fee_tier(amount_cents=15000), horse_id=horse)
    futurity = make_futurity(classes=[futurity_class], entries=[enrollment])

    entries = [
        make_entry(cls=futurity_class, horse_id=horse),
        make_entry(cls=ordinary, horse_id=horse),
    ]
    lines, total = billing.futurity_lines([futurity], entries)
    assert lines[0]["class_count"] == 1
    assert total == 15000


def test_another_horses_entries_do_not_count_toward_this_enrollment():
    cls = make_class(entry_fee_cents=0)
    mine = make_entry(cls=cls).horse_id
    theirs = make_entry(cls=cls).horse_id

    enrollment = make_futurity_entry(tier=make_fee_tier(amount_cents=15000), horse_id=mine)
    futurity = make_futurity(classes=[cls], entries=[enrollment])

    entries = [make_entry(cls=cls, horse_id=mine), make_entry(cls=cls, horse_id=theirs)]
    lines, _ = billing.futurity_lines([futurity], entries)
    assert lines[0]["class_count"] == 1


def test_enrolled_but_not_entered_still_owes_the_office_fee():
    """The club took the paperwork. No class money, but the office fee stands."""
    cls = make_class(entry_fee_cents=0)
    enrollment = make_futurity_entry(tier=make_fee_tier(amount_cents=15000))
    futurity = make_futurity(
        classes=[cls], entries=[enrollment], office_fee_nonmember_cents=2000
    )
    lines, total = billing.futurity_lines([futurity], [])
    assert lines[0]["class_count"] == 0
    assert total == 2000


# ── Office fee follows membership ─────────────────────────────────────────────


def test_office_fee_is_the_member_rate_for_members():
    cls = make_class(entry_fee_cents=0)
    horse = make_entry(cls=cls).horse_id
    futurity = make_futurity(
        classes=[cls],
        entries=[
            make_futurity_entry(
                tier=make_fee_tier(amount_cents=0), horse_id=horse, is_member=True
            )
        ],
        office_fee_member_cents=1000,
        office_fee_nonmember_cents=2000,
    )
    _, total = billing.futurity_lines([futurity], [make_entry(cls=cls, horse_id=horse)])
    assert total == 1000


def test_office_fee_is_charged_once_per_horse_not_per_class():
    a, b, c = (make_class(entry_fee_cents=0) for _ in range(3))
    horse = make_entry(cls=a).horse_id
    futurity = make_futurity(
        classes=[a, b, c],
        entries=[make_futurity_entry(tier=make_fee_tier(amount_cents=0), horse_id=horse)],
        office_fee_nonmember_cents=2000,
    )
    entries = [make_entry(cls=k, horse_id=horse) for k in (a, b, c)]
    _, total = billing.futurity_lines([futurity], entries)
    assert total == 2000


# ── The club membership bought with the entry ────────────────────────────────


def test_a_membership_bought_at_entry_is_charged_once():
    """The form sells a membership alongside the entry. It is not per class and
    not per horse-class combination — one card, one charge."""
    a, b = make_class(entry_fee_cents=0), make_class(entry_fee_cents=0)
    horse = make_entry(cls=a).horse_id
    futurity = make_futurity(
        classes=[a, b],
        entries=[
            make_futurity_entry(
                tier=make_fee_tier(amount_cents=15000),
                horse_id=horse,
                membership=make_membership_option(amount_cents=3000),
            )
        ],
    )
    entries = [make_entry(cls=k, horse_id=horse) for k in (a, b)]
    lines, total = billing.futurity_lines([futurity], entries)
    assert lines[0]["membership_fee_cents"] == 3000
    assert lines[0]["membership_name"] == "Single Membership"
    assert total == 30000 + 3000


def test_buying_a_membership_does_not_change_the_office_fee():
    """Two separate questions on the form, and they stay separate here. The
    office fee follows the card the entrant already holds; the membership is one
    they are buying. Somebody joining on the day pays the non-member office fee
    and the membership, which is what the paper form charges them."""
    cls = make_class(entry_fee_cents=0)
    horse = make_entry(cls=cls).horse_id
    futurity = make_futurity(
        classes=[cls],
        entries=[
            make_futurity_entry(
                tier=make_fee_tier(amount_cents=0),
                horse_id=horse,
                is_member=False,
                membership=make_membership_option(
                    name="Household Membership", amount_cents=4000
                ),
            )
        ],
        office_fee_member_cents=1000,
        office_fee_nonmember_cents=2000,
    )
    _, total = billing.futurity_lines([futurity], [make_entry(cls=cls, horse_id=horse)])
    assert total == 2000 + 4000


def test_no_membership_bought_adds_nothing():
    cls = make_class(entry_fee_cents=0)
    horse = make_entry(cls=cls).horse_id
    futurity = make_futurity(
        classes=[cls],
        entries=[
            make_futurity_entry(tier=make_fee_tier(amount_cents=15000), horse_id=horse)
        ],
    )
    lines, total = billing.futurity_lines([futurity], [make_entry(cls=cls, horse_id=horse)])
    assert lines[0]["membership_fee_cents"] == 0
    assert lines[0]["membership_name"] is None
    assert total == 15000


def test_an_enrollment_stub_with_no_membership_attribute_still_bills():
    """Every caller and stub predating migration 109 hands over an enrollment
    with no `membership_option` at all. A futurity selling no membership must
    total exactly what it did before."""
    cls = make_class(entry_fee_cents=0)
    horse = make_entry(cls=cls).horse_id
    enrollment = make_futurity_entry(
        tier=make_fee_tier(amount_cents=15000), horse_id=horse
    )
    del enrollment.membership_option
    futurity = make_futurity(classes=[cls], entries=[enrollment])
    _, total = billing.futurity_lines([futurity], [make_entry(cls=cls, horse_id=horse)])
    assert total == 15000


# ── Lateness is decided by the enrollment date, never by today ────────────────


def test_late_fee_applies_per_class_when_entered_after_the_deadline():
    a, b = make_class(entry_fee_cents=0), make_class(entry_fee_cents=0)
    horse = make_entry(cls=a).horse_id
    futurity = make_futurity(
        classes=[a, b],
        entries=[
            make_futurity_entry(
                tier=make_fee_tier(amount_cents=15000),
                horse_id=horse,
                entered_at=date(2027, 8, 20),
            )
        ],
        entry_deadline=date(2027, 8, 18),
        late_fee_cents=15000,
    )
    entries = [make_entry(cls=k, horse_id=horse) for k in (a, b)]
    lines, total = billing.futurity_lines([futurity], entries)
    assert lines[0]["is_late"] is True
    assert lines[0]["late_fee_cents"] == 30000
    assert total == 60000, "two classes at $150, plus $150 late on each"


def test_an_entry_taken_on_the_deadline_itself_is_not_late():
    cls = make_class(entry_fee_cents=0)
    horse = make_entry(cls=cls).horse_id
    futurity = make_futurity(
        classes=[cls],
        entries=[
            make_futurity_entry(
                tier=make_fee_tier(amount_cents=15000),
                horse_id=horse,
                entered_at=date(2027, 8, 18),
            )
        ],
        entry_deadline=date(2027, 8, 18),
        late_fee_cents=15000,
    )
    lines, total = billing.futurity_lines([futurity], [make_entry(cls=cls, horse_id=horse)])
    assert lines[0]["is_late"] is False
    assert total == 15000


def test_an_early_enrollment_stays_cheap_however_late_the_bill_is_read():
    """The rule `fee_rate_cents` follows for reservations. Deciding lateness
    against today would drop a late fee on everyone the moment the deadline
    passed — including people who entered in April."""
    cls = make_class(entry_fee_cents=0)
    horse = make_entry(cls=cls).horse_id
    futurity = make_futurity(
        classes=[cls],
        entries=[
            make_futurity_entry(
                tier=make_fee_tier(amount_cents=15000),
                horse_id=horse,
                entered_at=date(2027, 4, 1),
            )
        ],
        entry_deadline=date(2027, 8, 18),
        late_fee_cents=15000,
    )
    lines, _ = billing.futurity_lines([futurity], [make_entry(cls=cls, horse_id=horse)])
    assert lines[0]["is_late"] is False


def test_no_deadline_means_nothing_is_ever_late():
    cls = make_class(entry_fee_cents=0)
    horse = make_entry(cls=cls).horse_id
    futurity = make_futurity(
        classes=[cls],
        entries=[
            make_futurity_entry(
                tier=make_fee_tier(amount_cents=15000),
                horse_id=horse,
                entered_at=date(2099, 1, 1),
            )
        ],
        late_fee_cents=15000,
    )
    lines, _ = billing.futurity_lines([futurity], [make_entry(cls=cls, horse_id=horse)])
    assert lines[0]["is_late"] is False


# ── build_bill folds it in without disturbing anything else ───────────────────


def test_build_bill_adds_futurity_money_to_the_total():
    show = make_show()
    futurity_class = make_class(entry_fee_cents=0)
    ordinary = make_class(entry_fee_cents=3600)
    horse = make_entry(cls=ordinary).horse_id

    entries = [
        make_entry(cls=ordinary, horse_id=horse),
        make_entry(cls=futurity_class, horse_id=horse),
    ]
    futurity = make_futurity(
        classes=[futurity_class],
        entries=[
            make_futurity_entry(tier=make_fee_tier(amount_cents=15000), horse_id=horse)
        ],
        office_fee_nonmember_cents=2000,
    )

    bill = billing.build_bill(show, entries, [], [futurity])
    assert bill["class_fee_total_cents"] == 3600, "the futurity class itself is $0"
    assert bill["futurity_total_cents"] == 17000
    assert bill["total_cents"] == 3600 + 17000
    assert len(bill["futurity_lines"]) == 1


def test_build_bill_without_futurities_is_unchanged():
    """Every existing caller passes three arguments. A show with no futurity
    must total exactly what it did before, and still carry the new keys so the
    response shape does not depend on the data."""
    show = make_show()
    cls = make_class(entry_fee_cents=2500)
    bill = billing.build_bill(show, [make_entry(cls=cls)], [])
    assert bill["futurity_total_cents"] == 0
    assert bill["futurity_lines"] == []
    assert bill["total_cents"] == 2500


def test_summarize_accounts_rolls_futurity_money_up():
    show = make_show()
    cls = make_class(entry_fee_cents=0)
    horse = make_entry(cls=cls).horse_id
    futurity = make_futurity(
        classes=[cls],
        entries=[
            make_futurity_entry(tier=make_fee_tier(amount_cents=15000), horse_id=horse)
        ],
    )
    account = billing.build_account(
        show, [make_entry(cls=cls, horse_id=horse)], [], [], [futurity]
    )
    totals = billing.summarize_accounts([account])
    assert totals["futurity_total_cents"] == 15000
    assert totals["billed_cents"] == 15000


def test_summarize_accounts_tolerates_a_bill_built_before_futurities():
    """`summarize_accounts` reads the key with .get for exactly this — an
    account dict assembled by a caller that passes no futurities."""
    show = make_show()
    cls = make_class(entry_fee_cents=2500)
    account = billing.build_account(show, [make_entry(cls=cls)], [], [])
    del account["bill"]["futurity_total_cents"]
    totals = billing.summarize_accounts([account])
    assert totals["futurity_total_cents"] == 0
