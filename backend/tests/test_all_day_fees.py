"""The All Day fee caps class entry fees (migration 186).

The show office adds up what an exhibitor owes per class and, where that comes
to more than the All Day fee, charges the All Day fee instead. Only the class
entry fees are replaced: an association's assessment, a club's sanction fee and
the show's per-class charges are charged in full on top.
"""
from datetime import date
from types import SimpleNamespace
from uuid import uuid4

import asyncio

import billing
from routers.show_fees import _resolve_scope_classes
from tests.factories import (
    make_class,
    make_class_sanction,
    make_entry,
    make_fee,
    make_judges,
    make_sanctioning,
    make_show,
)

SAT = date(2026, 6, 13)
SUN = date(2026, 6, 14)


def _all_day(amount_cents=18000, unit="all_day_per_horse", classes=(), label="All Day fee", **kw):
    return make_fee(
        code="all_day",
        label=label,
        unit=unit,
        amount_cents=amount_cents,
        scoped_classes=[SimpleNamespace(class_id=c.id) for c in classes],
        **kw,
    )


def _classes(n, fee=3600, day=SAT, **kw):
    return [make_class(class_number=i, entry_fee_cents=fee, class_date=day, **kw) for i in range(1, n + 1)]


def _entries(classes, horse_id, horse_name="Dakota"):
    return [make_entry(cls=c, horse_id=horse_id, horse_name=horse_name) for c in classes]


def test_class_fees_below_the_all_day_fee_are_charged_one_by_one():
    horse = uuid4()
    show = make_show(fees=[_all_day()])

    bill = billing.build_bill(show, _entries(_classes(3), horse), [])

    assert bill["all_day_lines"] == []
    assert bill["class_fee_total_cents"] == 3 * 3600
    assert bill["total_cents"] == 3 * 3600
    assert all(line["all_day_fee_id"] is None for line in bill["class_lines"])


def test_equal_to_the_all_day_fee_is_charged_per_class():
    """The office's rule is "more than": at exactly the cap nothing changes."""
    horse = uuid4()
    show = make_show(fees=[_all_day(amount_cents=5 * 3600)])

    bill = billing.build_bill(show, _entries(_classes(5), horse), [])

    assert bill["all_day_lines"] == []
    assert bill["total_cents"] == 5 * 3600


def test_class_fees_above_the_all_day_fee_are_replaced_by_it():
    horse = uuid4()
    fee = _all_day()
    show = make_show(fees=[fee])

    bill = billing.build_bill(show, _entries(_classes(6), horse), [])

    [line] = bill["all_day_lines"]
    assert line["line_total_cents"] == 18000
    assert line["class_fee_cents"] == 6 * 3600
    assert line["class_count"] == 6
    assert line["horse_name"] == "Dakota"
    assert bill["class_fee_total_cents"] == 0
    assert bill["all_day_total_cents"] == 18000
    assert bill["total_cents"] == 18000
    for class_line in bill["class_lines"]:
        assert class_line["fee_cents"] == 0
        assert class_line["list_fee_cents"] == 3600
        assert class_line["all_day_fee_id"] == fee.id


def test_a_per_horse_fee_caps_each_horse_separately():
    dakota, blue = uuid4(), uuid4()
    show = make_show(fees=[_all_day()])
    classes = _classes(6)

    entries = _entries(classes, dakota, "Dakota") + _entries(classes[:2], blue, "Blue")
    bill = billing.build_bill(show, entries, [])

    assert [l["horse_name"] for l in bill["all_day_lines"]] == ["Dakota"]
    assert bill["total_cents"] == 18000 + 2 * 3600


def test_a_per_exhibitor_fee_caps_every_horse_together():
    dakota, blue = uuid4(), uuid4()
    show = make_show(fees=[_all_day(unit="all_show_per_exhibitor")])
    classes = _classes(3)

    entries = _entries(classes, dakota, "Dakota") + _entries(classes, blue, "Blue")
    bill = billing.build_bill(show, entries, [])

    [line] = bill["all_day_lines"]
    assert line["horse_name"] is None
    assert line["class_count"] == 6
    assert bill["total_cents"] == 18000


def test_a_per_day_fee_caps_each_show_day_separately():
    horse = uuid4()
    show = make_show(fees=[_all_day()])
    saturday = _classes(6, day=SAT)
    sunday = [make_class(class_number=10 + i, entry_fee_cents=3600, class_date=SUN) for i in range(2)]

    bill = billing.build_bill(show, _entries(saturday + sunday, horse), [])

    assert [l["class_date"] for l in bill["all_day_lines"]] == [SAT]
    assert bill["total_cents"] == 18000 + 2 * 3600


def test_a_whole_show_fee_caps_every_day_together():
    horse = uuid4()
    show = make_show(fees=[_all_day(unit="all_show_per_horse")])
    saturday = _classes(3, day=SAT)
    sunday = [make_class(class_number=10 + i, entry_fee_cents=3600, class_date=SUN) for i in range(3)]

    bill = billing.build_bill(show, _entries(saturday + sunday, horse), [])

    [line] = bill["all_day_lines"]
    assert line["class_date"] is None
    assert bill["total_cents"] == 18000


def test_classes_outside_its_list_are_charged_on_top():
    horse = uuid4()
    breed = _classes(6)
    all_breed = [make_class(class_number=50, entry_fee_cents=1000)]
    show = make_show(fees=[_all_day(classes=breed)])

    bill = billing.build_bill(show, _entries(breed + all_breed, horse), [])

    assert bill["all_day_lines"][0]["class_count"] == 6
    assert bill["class_fee_total_cents"] == 1000
    assert bill["total_cents"] == 18000 + 1000


def test_breed_and_all_breed_fees_each_cap_their_own_classes():
    """A show runs one All Day fee for its breed classes and one for its
    All-Breed (club-sanctioned) classes. A cap covers a club's classes, which
    no automatic charge does."""
    wsca = make_sanctioning("WSCA", fee_amount_cents=0)
    breed = _classes(6)
    all_breed = [
        make_class(class_number=50 + i, entry_fee_cents=3200, sanctioning=[make_class_sanction(wsca)])
        for i in range(5)
    ]
    breed_fee = _all_day(classes=breed)
    all_breed_fee = _all_day(amount_cents=10000, classes=all_breed, label="All-Breed All Day fee")
    show = make_show(fees=[breed_fee, all_breed_fee], sanctioning=[wsca])

    dakota, blue = uuid4(), uuid4()
    entries = _entries(breed, dakota, "Dakota") + _entries(all_breed, blue, "Blue")
    bill = billing.build_bill(show, entries, [])

    assert sorted(l["line_total_cents"] for l in bill["all_day_lines"]) == [10000, 18000]
    assert bill["total_cents"] == 28000


def test_overlapping_lists_never_cap_one_class_twice():
    horse = uuid4()
    classes = _classes(6)
    first = _all_day(amount_cents=18000, classes=classes)
    second = _all_day(amount_cents=5000, classes=classes)
    show = make_show(fees=[first, second])

    bill = billing.build_bill(show, _entries(classes, horse), [])

    [line] = bill["all_day_lines"]
    assert line["show_fee_id"] == first.id
    assert bill["total_cents"] == 18000


def test_the_association_assessment_and_per_class_charges_stay_on_top():
    """MNSPHC's All Day fee "does not include APHA fees"."""
    horse = uuid4()
    assessment = make_fee(code="apha", label="APHA fee", unit="per_judge_per_entry", amount_cents=300)
    show = make_show(fees=[_all_day(), assessment], judges=make_judges(4))

    bill = billing.build_bill(show, _entries(_classes(6), horse), [])

    assert bill["all_day_total_cents"] == 18000
    assert bill["class_charge_total_cents"] == 6 * 300 * 4
    assert bill["total_cents"] == 18000 + 6 * 1200


def test_a_club_sanction_fee_stays_on_top():
    wsca = make_sanctioning("WSCA", fee_amount_cents=300)
    classes = [
        make_class(class_number=i, entry_fee_cents=3600, sanctioning=[make_class_sanction(wsca)])
        for i in range(6)
    ]
    show = make_show(fees=[_all_day()], sanctioning=[wsca])

    bill = billing.build_bill(show, _entries(classes, uuid4()), [])

    assert bill["all_day_total_cents"] == 18000
    assert bill["class_sanction_total_cents"] == 6 * 300
    assert bill["total_cents"] == 18000 + 1800


def test_free_and_futurity_classes_are_not_counted():
    horse = uuid4()
    classes = _classes(4)
    free = make_class(class_number=90, entry_fee_cents=0, is_free=True)
    futurity = make_class(class_number=91, entry_fee_cents=0, is_futurity_class=True)
    show = make_show(fees=[_all_day(amount_cents=10000)])

    bill = billing.build_bill(show, _entries(classes + [free, futurity], horse), [])

    [line] = bill["all_day_lines"]
    assert line["class_count"] == 4


def test_a_zero_priced_all_day_fee_caps_nothing():
    show = make_show(fees=[_all_day(amount_cents=0)])

    bill = billing.build_bill(show, _entries(_classes(6), uuid4()), [])

    assert bill["all_day_lines"] == []
    assert bill["total_cents"] == 6 * 3600


def test_the_show_roll_up_carries_the_all_day_money():
    show = make_show(fees=[_all_day()])
    account = billing.build_account(show, _entries(_classes(6), uuid4()), [], [])

    totals = billing.summarize_accounts([account])

    assert totals["all_day_total_cents"] == 18000
    assert totals["billed_cents"] == 18000


def test_an_all_day_fee_may_carry_a_class_list():
    cls = make_class()

    class _Result:
        def all(self):
            return [(cls.id,)]

    class _Db:
        async def execute(self, _stmt):
            return _Result()

    for unit in billing.ALL_DAY_FEE_UNITS:
        got = asyncio.run(
            _resolve_scope_classes(show_id=uuid4(), unit=unit, class_ids=[cls.id], db=_Db())
        )
        assert got == [cls.id]
