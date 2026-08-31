"""Five outcomes, and a tie the judge broke.

`results.place` was NOT NULL, so every row on a card had to claim a placing.
The rule book needs more states than that and they report differently: a cow
work zero score is a real number and a No Score is not (SC-265.E.4-6), an Over
Fences elimination during a ride-off is still placed last in that group
(AM-111.D), and flat equitation's disqualification is worded "should not be
placed".

The tie half is AM-115.B.2 and the pattern class procedures, which all say the
same thing — equal scores are separated at the judge's discretion. The app used
to flag two 71.5s `is_tie` and post them as a shared place, and the only way to
record the judge's answer was to edit one of the scores they called.
"""
from types import SimpleNamespace
from uuid import uuid4

import pytest

from placings import best_placing, is_placed, place_key, placed_only, reported_outcome
from routers.results import placing_shortfall, rank_card, unresolved_ties
from rules import get_rules
from rules.apha import PUBLISHED_PLACES


def row(place=None, score=None, outcome="placed", judge_id=None, tiebreak=None, entry_id=None):
    return SimpleNamespace(
        place=place,
        raw_score=score,
        outcome=outcome,
        tiebreak_rank=tiebreak,
        is_tie=False,
        judge_id=judge_id,
        entry_id=entry_id or uuid4(),
    )


# ── Ranking a card ────────────────────────────────────────────────────────────

def test_a_pattern_card_ranks_highest_first():
    rows = [row(score=68.0), row(score=72.5), row(score=70.0)]

    rank_card("pattern", rows)

    assert [r.place for r in rows] == [3, 1, 2]


def test_a_time_card_ranks_fastest_first():
    rows = [row(score=18.9), row(score=17.2), row(score=21.0)]

    rank_card("time", rows)

    assert [r.place for r in rows] == [2, 1, 3]


def test_equal_scores_share_a_place_and_are_flagged():
    rows = [row(score=71.5), row(score=71.5), row(score=68.0)]

    rank_card("pattern", rows)

    assert [r.place for r in rows] == [1, 1, 3]
    assert [r.is_tie for r in rows] == [True, True, False]


def test_a_broken_tie_takes_two_places_and_neither_score_moves():
    """The judge's answer goes in `tiebreak_rank`, not into one of the scores."""
    first = row(score=71.5, tiebreak=1)
    second = row(score=71.5, tiebreak=2)

    rank_card("pattern", [first, second, row(score=68.0)])

    assert (first.place, second.place) == (1, 2)
    assert (first.is_tie, second.is_tie) == (False, False)
    assert (float(first.raw_score), float(second.raw_score)) == (71.5, 71.5)


def test_ranking_a_tie_only_on_one_side_is_still_an_answer():
    """Two horses, one named above the other, is a complete decision."""
    named = row(score=71.5, tiebreak=1)
    other = row(score=71.5)

    rank_card("pattern", [other, named])

    assert (named.place, other.place) == (1, 2)
    assert not named.is_tie and not other.is_tie


def test_a_tiebreak_never_reaches_across_different_scores():
    """A rank on a score nobody tied with must not reorder the card."""
    rows = [row(score=72.0, tiebreak=9), row(score=70.0, tiebreak=1)]

    rank_card("pattern", rows)

    assert [r.place for r in rows] == [1, 2]


# ── Outcomes stay out of the ranking ──────────────────────────────────────────

def test_a_disqualified_row_is_not_ranked_and_keeps_no_place():
    dq = row(score=71.0, outcome="disqualified")
    rows = [row(score=68.0), dq, row(score=70.0)]

    rank_card("pattern", rows)

    assert dq.place is None
    assert [rows[0].place, rows[2].place] == [2, 1]


def test_a_no_score_does_not_take_the_place_below_the_last_scored_horse():
    """It is out of the class, not last in it."""
    rows = [row(score=70.0), row(outcome="no_score")]

    rank_card("pattern", rows)

    assert [r.place for r in rows] == [1, None]


def test_a_declared_zero_is_ranked_below_everyone_who_scored():
    """SC-265.E.4-6 separates a zero from a No Score, and a zero is comparable —
    it belongs at the bottom of the sheet, not off it."""
    zero = row(score=0.0, outcome="zero_score")
    rows = [zero, row(score=70.0), row(score=64.0)]

    rank_card("pattern", rows)

    assert [r.place for r in rows] == [3, 1, 2]


def test_a_zero_and_a_no_score_are_not_the_same_result():
    zero = row(score=0.0, outcome="zero_score")
    none = row(outcome="no_score")

    rank_card("pattern", [row(score=70.0), zero, none])

    assert zero.place == 2
    assert none.place is None


def test_an_elimination_the_scribe_placed_keeps_that_place():
    """AM-111.D — eliminated during a ride-off, still placed last in the group.

    The app cannot know a ride-off happened, so it must not overwrite the answer.
    """
    eliminated = row(place=4, outcome="eliminated")
    rows = [row(score=70.0), eliminated]

    rank_card("pattern", rows)

    assert eliminated.place == 4


def test_a_non_placed_row_is_never_left_flagged_as_tied():
    stale = row(place=None, outcome="no_score")
    stale.is_tie = True

    rank_card("pattern", [stale, row(score=70.0)])

    assert stale.is_tie is False


# ── Unresolved ties ───────────────────────────────────────────────────────────

def test_no_ties_is_no_question():
    assert unresolved_ties([row(place=1), row(place=2)]) == []


def test_a_shared_place_is_reported_with_both_entries():
    a, b = row(place=1), row(place=1)
    a.is_tie = b.is_tie = True

    ties = unresolved_ties([a, b, row(place=3)])

    assert len(ties) == 1
    assert ties[0]["place"] == 1
    assert set(ties[0]["entry_ids"]) == {a.entry_id, b.entry_id}


def test_ties_are_reported_per_card():
    """Two judges each tying their own first place is two questions, not one."""
    one, two = uuid4(), uuid4()
    rows = []
    for judge in (one, two):
        a, b = row(place=1, judge_id=judge), row(place=1, judge_id=judge)
        a.is_tie = b.is_tie = True
        rows += [a, b]

    ties = unresolved_ties(rows)

    assert len(ties) == 2
    assert {t["judge_id"] for t in ties} == {one, two}


def test_a_broken_tie_never_reaches_the_publish_gate():
    """rank_card resolves it, so there is nothing left for this to find."""
    rows = [row(score=71.5, tiebreak=1), row(score=71.5, tiebreak=2)]
    rank_card("pattern", rows)

    assert unresolved_ties(rows) == []


# ── Which associations ask ────────────────────────────────────────────────────

def test_an_open_show_may_post_a_shared_place():
    """Nobody to answer to, and an open jackpot may well pay two thirds."""
    assert get_rules("OPEN").ties_must_be_broken(SimpleNamespace(score_type="pattern")) is False


def test_apha_requires_a_scored_tie_to_be_broken():
    assert get_rules("APHA").ties_must_be_broken(SimpleNamespace(score_type="pattern")) is True
    assert get_rules("APHA").ties_must_be_broken(SimpleNamespace(score_type="time")) is True


def test_apha_leaves_a_placement_class_tie_alone():
    """That one the scribe ticked deliberately, recording what the judge already
    decided on paper. A scored tie is one the app derived from two numbers."""
    assert get_rules("APHA").ties_must_be_broken(SimpleNamespace(score_type="placement")) is False


# ── Placing depth, against entries that could not be placed ───────────────────

def test_a_judge_who_threw_two_out_owes_two_fewer_places():
    """Twenty entries, this judge disqualified fourteen: six places is the most
    that card could ever fill, and asking for seven makes the class unpostable."""
    rows = [row(place=p) for p in range(1, 7)]
    rows += [row(outcome="disqualified") for _ in range(14)]

    assert placing_shortfall(rows, 20, [], PUBLISHED_PLACES) == []


def test_the_cap_is_per_card_not_per_class():
    """One judge disqualifying a horse must not excuse the other judge from
    placing it."""
    strict, lenient = uuid4(), uuid4()
    rows = [row(place=p, judge_id=strict) for p in range(1, 7)]
    rows.append(row(outcome="disqualified", judge_id=strict))
    rows += [row(place=p, judge_id=lenient) for p in range(1, 7)]

    shortfall = placing_shortfall(rows, 7, [strict, lenient], PUBLISHED_PLACES)

    assert shortfall == [{"judge_id": lenient, "missing": [7]}]


def test_a_placed_elimination_still_fills_its_slot():
    rows = [row(place=p) for p in range(1, 7)]
    rows.append(row(place=7, outcome="eliminated"))

    assert placing_shortfall(rows, 20, [], PUBLISHED_PLACES) == []


def test_rows_without_an_outcome_attribute_are_treated_as_placed():
    """Every row written before migration 121 backfilled to 'placed', and the
    older tests build rows that have no such field at all."""
    rows = [SimpleNamespace(place=p, judge_id=None) for p in range(1, 8)]

    assert placing_shortfall(rows, 20, [], PUBLISHED_PLACES) == []


# ── Reading a placing off a card that may not have one ────────────────────────

def test_best_placing_ignores_the_card_that_threw_the_entry_out():
    """A judge who disqualified a horse did not rank it last."""
    kept = row(place=4)
    thrown = row(outcome="disqualified")

    assert best_placing([thrown, kept]) is kept


def test_best_placing_is_none_when_no_card_placed_the_entry():
    assert best_placing([row(outcome="no_score"), row(outcome="disqualified")]) is None
    assert best_placing([]) is None


def test_an_unplaced_row_sorts_behind_every_placed_one():
    assert place_key(row(place=99)) < place_key(row(outcome="no_score"))


def test_a_declared_zero_that_placed_counts_as_a_placing():
    """It is in the running, so best-of and the side pots have to see it."""
    zero = row(place=6, score=0.0, outcome="zero_score")

    assert is_placed(zero) is True
    assert best_placing([zero]) is zero


def test_placed_only_drops_a_placed_outcome_that_carries_no_place():
    """Half-written rows exist; a 'placed' row with no place has not been ranked."""
    assert placed_only([row(outcome="placed", place=None)]) == []
    assert is_placed(row(outcome="placed", place=None)) is False


def test_reported_outcome_names_what_happened_when_nothing_was_placed():
    assert reported_outcome([row(outcome="no_score")]) == "no_score"


def test_reported_outcome_stays_quiet_when_there_is_a_placing_to_show():
    assert reported_outcome([row(place=2), row(outcome="disqualified")]) is None
    assert reported_outcome([]) is None
