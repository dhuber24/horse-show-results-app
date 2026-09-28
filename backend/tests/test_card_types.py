"""How each class is placed: the four card types (migration 155).

`score_type` stays the engine's field, and a card type maps onto exactly one;
scored and equitation are the two that share `pattern`, which is the only reason
the card type is stored at all.
"""
from datetime import date
from types import SimpleNamespace

from card_types import (
    SCORE_TYPE_FOR,
    derived_card_type,
    effective_card_type,
    sheet_fits,
)
from routers.classes import scoring_blocker


def test_every_card_type_maps_to_an_engine_score_type():
    assert SCORE_TYPE_FOR == {
        "placing": "placement",
        "scored": "pattern",
        "equitation": "pattern",
        "timed": "time",
    }


def test_the_score_type_decides_placing_and_timed_outright():
    assert derived_card_type("placement", "Western Pleasure") == "placing"
    assert derived_card_type("time", "Barrel Racing") == "timed"


def test_a_pattern_class_is_equitation_when_the_rider_works_a_pattern():
    # On the ground (showmanship) or mounted (horsemanship, equitation).
    assert derived_card_type("pattern", "Showmanship") == "equitation"
    assert derived_card_type("pattern", "Horsemanship") == "equitation"
    assert derived_card_type("pattern", "Hunt Seat Equitation") == "equitation"
    # A class the classifier left unassigned is read by its own name.
    assert derived_card_type("pattern", "Unassigned", "Youth Showmanship 13 & Under") == "equitation"


def test_any_other_pattern_class_is_a_scored_card():
    assert derived_card_type("pattern", "Reining") == "scored"
    assert derived_card_type("pattern", "Trail") == "scored"
    assert derived_card_type("pattern", "Ranch Riding") == "scored"


def test_a_sheet_decides_before_the_name_does():
    assert derived_card_type("pattern", "Trail", sheet_card_type="equitation") == "equitation"


def test_the_offices_choice_wins_while_it_agrees_with_the_score_type():
    assert effective_card_type("scored", "pattern", "Showmanship") == "scored"
    assert effective_card_type("equitation", "pattern", "Reining") == "equitation"


def test_a_choice_the_score_type_no_longer_agrees_with_is_ignored():
    # Somebody changed the class to a rail class in the class editor; listing it
    # as a scored card would describe a class the scribe ranks by hand.
    assert effective_card_type("scored", "placement", "Trail") == "placing"
    assert effective_card_type("timed", "pattern", "Showmanship") == "equitation"


def test_only_score_based_cards_carry_a_sheet_and_only_their_own():
    assert sheet_fits("equitation", "equitation")
    assert not sheet_fits("scored", "equitation")
    assert sheet_fits("scored", None)  # an uncategorised sheet is offered to both
    assert not sheet_fits("placing", None)
    assert not sheet_fits("timed", "scored")


def _cls(number, score_type, results):
    return SimpleNamespace(
        class_number=number,
        class_name=f"Class {number}",
        class_date=date(2026, 8, 21),
        sort_order=int(number),
        score_type=score_type,
        results=results,
    )


def test_a_class_with_placings_filed_keeps_its_score_type():
    refusal = scoring_blocker([_cls("12", "placement", ["filed"])], "pattern")
    assert refusal and "#12" in refusal


def test_scored_and_equitation_may_swap_over_filed_placings():
    # Both place by score, so the filed scores still mean the same thing.
    assert scoring_blocker([_cls("12", "pattern", ["filed"])], "pattern") is None


def test_a_class_with_nothing_filed_may_change_freely():
    assert scoring_blocker([_cls("12", "placement", [])], "time") is None
