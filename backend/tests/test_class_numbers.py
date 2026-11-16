"""Class numbers: the bill's as printed, or 1..N down the running order.

Pinned here (see `class_numbers.py`):

* **A show built by hand** is numbered down its running order, and a class
  entered by qualifying -- a Grand & Reserve champion class -- has no number
  and does not use one up, so the classes after it keep the bill's numbers.
* **A show read off its bill** keeps every number as printed through a move,
  and a class added later takes the next whole number after the highest.
* **A class with no number** is named without a stray "#" or "Class ()".
* **The import draft carries the printed number**, blank where the bill printed
  none.
"""
from types import SimpleNamespace

from class_numbers import class_label, hash_label, next_number, number_in_order
from tests.test_showbill_draft import build, payload
from tests.test_showbill_import import a_class, raw_read


def cls(name, number="", qualifying=False):
    return SimpleNamespace(
        class_name=name, class_number=number, entered_by_qualification=qualifying, sort_order=None
    )


def test_running_order_skips_a_grand_and_reserve_class():
    schedule = [
        cls("Yearling Stallions"),
        cls("Aged Stallions"),
        cls("Grand & Reserve Stallions", qualifying=True),
        cls("Yearling Geldings"),
    ]
    number_in_order(schedule, as_printed=False)
    assert [c.class_number for c in schedule] == ["1", "2", "", "3"]
    assert [c.sort_order for c in schedule] == [1, 2, 3, 4]


def test_numbers_as_printed_survive_a_move():
    schedule = [cls("Trail", "73N"), cls("Grand & Reserve Mares", "", True), cls("Halter", "5")]
    number_in_order(schedule, as_printed=True)
    assert [c.class_number for c in schedule] == ["73N", "", "5"]
    assert [c.sort_order for c in schedule] == [1, 2, 3]


def test_a_class_added_to_a_printed_show_takes_the_next_whole_number():
    assert next_number(["1", "5N", "112N", "", "A", "2-3"]) == "113"
    assert next_number([]) == "1"


def test_a_class_with_no_number_is_named_without_one():
    assert hash_label(cls("Grand & Reserve Mares")) == "Grand & Reserve Mares"
    assert class_label(cls("Grand & Reserve Mares")) == "Grand & Reserve Mares"
    assert hash_label(cls("Trail", "73N")) == "#73N Trail"
    assert class_label(cls("Trail", "73N")) == "Class 73N (Trail)"


def test_the_draft_keeps_the_bill_number_and_a_blank_for_a_championship():
    draft, _x = build(
        raw_read(
            classes=[
                a_class(name="Amateur Aged Stallions", number="4"),
                a_class(name="Amateur Grand/Reserve Stallions", number=None, is_championship=True),
                a_class(name="Amateur Performance Stallions", number="5N"),
            ]
        )
    )
    numbers = [c.class_number for c in payload(draft).classes]
    assert numbers == ["4", "", "5N"]
