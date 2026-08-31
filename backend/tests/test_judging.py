"""Adding up a judge's card.

The app used to hold one typed number per entry per judge. A real card is a base
score, a run of maneuver or fence scores, and penalties deducted from the total —
and the number that was being typed is the *output* of that arithmetic.

CLAUDE.md's "does not calculate penalties" line is amended deliberately here. The
boundary that has not moved: the app does not judge, does not decide what a
maneuver is worth, and does not decide which penalty applies. Every number on the
card was called by a judge and written down by a scribe. It adds them up, and a
human may overrule the arithmetic.
"""
from decimal import Decimal
from types import SimpleNamespace

import pytest

from judging import (
    compute_score,
    effective_score,
    is_overridden,
    validate_maneuver,
    validate_penalty,
)


def system(base=70, low=-3, high=3, step=0.5, ceiling=None):
    return SimpleNamespace(
        base_score=Decimal(str(base)) if base is not None else None,
        maneuver_min=Decimal(str(low)),
        maneuver_max=Decimal(str(high)),
        maneuver_step=Decimal(str(step)),
        score_max=Decimal(str(ceiling)) if ceiling is not None else None,
        unit_label="Maneuver",
        unit_count=None,
    )


def maneuver(score):
    return SimpleNamespace(score=None if score is None else Decimal(str(score)))


def penalty(value):
    return SimpleNamespace(value=Decimal(str(value)))


# ── The sum ───────────────────────────────────────────────────────────────────

def test_a_clean_run_scores_its_base():
    assert compute_score(system(), [maneuver(0), maneuver(0)], []) == Decimal("70")


def test_maneuvers_add_and_penalties_take_off():
    """+1, +½, −1 against a 5-point penalty: 70 + 0.5 − 5."""
    total = compute_score(
        system(),
        [maneuver(1), maneuver(0.5), maneuver(-1)],
        [penalty(5)],
    )

    assert total == Decimal("65.5")


def test_half_points_do_not_drift():
    """Six halves through float arithmetic lands on 72.99999999999999."""
    total = compute_score(system(), [maneuver(0.5)] * 6, [])

    assert total == Decimal("73")


def test_an_empty_card_scores_nothing_rather_than_its_base():
    """A card nobody has marked is not a 70 — writing one would put every
    unjudged entry into the placings at the same score."""
    assert compute_score(system(), [], []) is None
    assert compute_score(system(), [maneuver(None), maneuver(None)], []) is None


def test_a_penalty_alone_is_a_marked_card():
    """The judge called something. That the maneuvers are blank does not make it
    an empty sheet."""
    assert compute_score(system(), [], [penalty(5)]) == Decimal("65")


def test_a_system_with_no_base_is_the_sum_of_its_maneuvers():
    assert compute_score(system(base=None), [maneuver(3), maneuver(2)], []) == Decimal("5")


def test_the_ceiling_holds():
    """AM-111.F is scored on a 0-100 scale."""
    fences = system(base=70, low=-1.5, high=1.5, ceiling=100)
    total = compute_score(fences, [maneuver(1.5)] * 30, [])

    assert total == Decimal("100")


def test_a_card_never_goes_negative():
    """Far enough below zero is a zero score, which is an outcome on the result
    (migration 121), not a negative number on the sheet."""
    assert compute_score(system(), [maneuver(-3)], [penalty(100)]) == Decimal("0")


# ── The override ──────────────────────────────────────────────────────────────

def test_the_computed_figure_is_what_the_card_is_worth():
    card = SimpleNamespace(computed_score=Decimal("71.5"), override_score=None)

    assert effective_score(card) == Decimal("71.5")
    assert is_overridden(card) is False


def test_an_override_wins():
    card = SimpleNamespace(computed_score=Decimal("71.5"), override_score=Decimal("68"))

    assert effective_score(card) == Decimal("68")
    assert is_overridden(card) is True


def test_an_override_of_zero_is_an_answer():
    """A falsy check here would silently hand back the computed figure."""
    card = SimpleNamespace(computed_score=Decimal("71.5"), override_score=Decimal("0"))

    assert effective_score(card) == Decimal("0")
    assert is_overridden(card) is True


def test_an_override_matching_the_arithmetic_still_counts_as_one():
    """Somebody looked at the number and pinned it; un-pinning is a separate
    act, and the audit row should not read as a no-op."""
    card = SimpleNamespace(computed_score=Decimal("70"), override_score=Decimal("70"))

    assert is_overridden(card) is True


def test_an_unmarked_card_is_worth_nothing():
    assert effective_score(SimpleNamespace(computed_score=None, override_score=None)) is None


# ── What the system allows ────────────────────────────────────────────────────

def test_a_maneuver_inside_the_range_passes():
    assert validate_maneuver(system(), Decimal("1.5")) is None
    assert validate_maneuver(system(), Decimal("-3")) is None


def test_a_maneuver_outside_the_range_is_reported():
    assert "between" in validate_maneuver(system(), Decimal("4"))


def test_a_maneuver_off_the_step_is_reported():
    """Half points, not quarter points."""
    assert "multiple" in validate_maneuver(system(), Decimal("1.25"))


def test_an_unmarked_maneuver_is_not_an_error():
    """A maneuver the judge has not got to yet is blank, not wrong."""
    assert validate_maneuver(system(), None) is None


def test_the_over_fences_range_is_its_own():
    fences = system(low=-1.5, high=1.5)

    assert validate_maneuver(fences, Decimal("1.5")) is None
    assert "between" in validate_maneuver(fences, Decimal("2"))


# ── What a penalty may be worth ───────────────────────────────────────────────

def test_a_fixed_penalty_must_be_its_own_value():
    """Typing 4 against a 3-point penalty means the wrong row was picked."""
    three = SimpleNamespace(value=Decimal("3"), min_value=None, max_value=None)

    assert validate_penalty(three, Decimal("3")) is None
    assert "fixed" in validate_penalty(three, Decimal("4"))


def test_a_range_penalty_is_the_judge_s_call_within_it():
    """About a third of AM-111.F's table is stated as a range."""
    ranged = SimpleNamespace(value=None, min_value=Decimal("1"), max_value=Decimal("5"))

    assert validate_penalty(ranged, Decimal("3")) is None
    assert "between" in validate_penalty(ranged, Decimal("6"))


def test_a_penalty_with_no_catalog_row_is_unconstrained():
    """It is what the judge called and nobody has loaded. The alternative is the
    scribe hunting for the nearest wrong answer."""
    assert validate_penalty(None, Decimal("7.5")) is None
