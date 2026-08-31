"""How deep every judge has to have placed before a class is posted.

APHA SC-110.I: "The show management must announce placings in all classes under
all judges of all contestants one through seven places after the class is
complete."

The scribe form has warned about *interior* gaps since the publish gate went in
— 1, 2, 4 with 3 missing. It says nothing about a card that simply stops, so
places 1-3 on a class of twenty read as finished to it. That is the shape a
half-entered card actually has, and it is what this covers.
"""
from types import SimpleNamespace
from uuid import uuid4

import pytest

from routers.results import placing_shortfall
from rules import get_rules
from rules.apha import PUBLISHED_PLACES


def result(place, judge_id=None):
    return SimpleNamespace(place=place, judge_id=judge_id)


def card(places, judge_id=None):
    return [result(p, judge_id) for p in places]


# ── The depth is a floor, capped by the class ────────────────────────────────

def test_a_full_card_of_seven_is_complete():
    assert placing_shortfall(card(range(1, 8)), 20, [], PUBLISHED_PLACES) == []


def test_a_card_that_stops_short_is_not():
    """The case the scribe form's interior-gap check cannot see."""
    shortfall = placing_shortfall(card([1, 2, 3]), 20, [], PUBLISHED_PLACES)

    assert shortfall == [{"judge_id": None, "missing": [4, 5, 6, 7]}]


def test_a_small_class_only_owes_what_it_has():
    """Four entries cannot fill seven places, and asking for them would make
    every small class unpostable."""
    assert placing_shortfall(card([1, 2, 3, 4]), 4, [], PUBLISHED_PLACES) == []


def test_an_interior_gap_is_still_caught():
    assert placing_shortfall(card([1, 2, 4, 5, 6, 7]), 20, [], PUBLISHED_PLACES) == [
        {"judge_id": None, "missing": [3]}
    ]


def test_placing_deeper_than_required_is_fine():
    assert placing_shortfall(card(range(1, 13)), 20, [], PUBLISHED_PLACES) == []


def test_a_class_with_no_entries_owes_nothing():
    """Nothing to place. Reporting seven missing places on an empty class would
    make it permanently unpostable."""
    assert placing_shortfall([], 0, [], PUBLISHED_PLACES) == []


# ── Under all judges ─────────────────────────────────────────────────────────

def test_every_assigned_judge_is_a_card():
    a, b = uuid4(), uuid4()
    results = card(range(1, 8), a) + card(range(1, 8), b)

    assert placing_shortfall(results, 20, [a, b], PUBLISHED_PLACES) == []


def test_a_judge_who_has_filed_nothing_is_reported():
    """The case that makes this key off the panel rather than off the results.
    Reading the judges out of the results would call this class complete."""
    a, b = uuid4(), uuid4()

    shortfall = placing_shortfall(card(range(1, 8), a), 20, [a, b], PUBLISHED_PLACES)

    assert shortfall == [{"judge_id": b, "missing": [1, 2, 3, 4, 5, 6, 7]}]


def test_only_the_short_card_is_reported():
    a, b = uuid4(), uuid4()
    results = card(range(1, 8), a) + card([1, 2], b)

    shortfall = placing_shortfall(results, 20, [a, b], PUBLISHED_PLACES)

    assert shortfall == [{"judge_id": b, "missing": [3, 4, 5, 6, 7]}]


def test_one_judges_placings_do_not_fill_anothers_card():
    """Every judge marks the same class on their own sheet. Pooling the places
    would let a complete card cover for an empty one."""
    a, b = uuid4(), uuid4()
    results = card([1, 2, 3, 4], a) + card([5, 6, 7], b)

    missing = {s["judge_id"]: s["missing"] for s in
               placing_shortfall(results, 20, [a, b], PUBLISHED_PLACES)}

    assert missing[a] == [5, 6, 7]
    assert missing[b] == [1, 2, 3, 4]


def test_a_show_with_no_judges_has_one_unattributed_card():
    """NULL `judge_id` is what "nobody was assigned" looks like on a result."""
    assert placing_shortfall(card([1, 2]), 20, [], PUBLISHED_PLACES) == [
        {"judge_id": None, "missing": [3, 4, 5, 6, 7]}
    ]


def test_results_on_the_unattributed_card_do_not_count_for_a_judge():
    a = uuid4()

    shortfall = placing_shortfall(card(range(1, 8)), 20, [a], PUBLISHED_PLACES)

    assert shortfall == [{"judge_id": a, "missing": [1, 2, 3, 4, 5, 6, 7]}]


# ── Where the number comes from ──────────────────────────────────────────────

def test_an_association_that_names_no_depth_checks_nothing():
    """An OPEN show answers to nobody about how deep it places. Inventing a
    number would block a jackpot that only pays three."""
    assert placing_shortfall(card([1]), 20, [], None) == []
    assert get_rules("OPEN").required_published_places(None) is None


def test_apha_requires_seven():
    assert get_rules("APHA").required_published_places(None) == PUBLISHED_PLACES


@pytest.mark.parametrize("bad", [None, 0])
def test_no_requirement_short_circuits(bad):
    assert placing_shortfall(card([]), 20, [uuid4()], bad) == []
