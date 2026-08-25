"""Routing an association class name to a discipline.

AQHA and APHA ship class lists with the discipline buried in the name, and this
table is what turns "RANCH TRAIL 13 AND UNDER" into Ranch Trail rather than
Trail. The ordering is the whole mechanism — a keyword placed above a more
specific one silently swallows it — so the last test here checks the table's
shape rather than any single lookup.
"""
import pytest

from rules.disciplines import DISCIPLINE_KEYWORDS, classify_class_name


def test_an_unmatched_name_falls_through_to_the_caller():
    """The caller's job is the per-show "Unassigned" placeholder; this says
    "I don't know" rather than guessing."""
    assert classify_class_name("Egg and Spoon Race") is None


def test_an_empty_name_is_not_a_crash():
    assert classify_class_name("") is None


def test_matching_is_case_insensitive():
    assert classify_class_name("junior western pleasure") == ("Western Pleasure", "placement")
    assert classify_class_name("JUNIOR WESTERN PLEASURE") == ("Western Pleasure", "placement")


@pytest.mark.parametrize(
    "name,discipline",
    [
        # Each of these would be mis-routed if the more specific keyword were
        # moved below its substring parent.
        ("RANCH TRAIL 13 AND UNDER", "Ranch Trail"),
        ("TIMED RANCH TRAIL", "Timed Ranch Trail"),
        ("IN-HAND TRAIL", "In-Hand Trail"),
        ("AMATEUR TRAIL", "Trail"),
        ("WORKING HUNTER UNDER SADDLE", "Working Hunter Under Saddle"),
        ("WORKING HUNTER", "Working Hunter"),
        ("HUNT SEAT EQUITATION OVER FENCES", "Equitation Over Fences"),
        ("HUNT SEAT EQUITATION", "Hunt Seat Equitation"),
        ("PERFORMANCE GRAND CHAMPION MARES", "Performance Halter"),
        ("GRAND CHAMPION MARES", "Halter"),
        ("RANCH RAIL PLEASURE", "Ranch Rail Pleasure"),
        ("RANCH PLEASURE", "Ranch Pleasure"),
    ],
)
def test_specific_keywords_win_over_their_substring_parents(name, discipline):
    result = classify_class_name(name)
    assert result is not None, f"{name!r} matched nothing"
    assert result[0] == discipline


@pytest.mark.parametrize(
    "name,score_type",
    [
        ("BARREL RACING", "time"),
        ("POLE BENDING", "time"),
        ("WESTERN HORSEMANSHIP", "pattern"),
        ("SHOWMANSHIP AT HALTER", "pattern"),
        ("WESTERN PLEASURE", "placement"),
        ("AGED GELDINGS", "placement"),
    ],
)
def test_score_type_comes_back_with_the_discipline(name, score_type):
    """A class's score type decides which scribe screen it opens, so a wrong
    one here sends a timed event to a placings card."""
    assert classify_class_name(name)[1] == score_type


def test_padded_abbreviations_do_not_match_bare_words():
    """`" HUS "` is padded on purpose so it cannot fire inside an unrelated
    word. Losing the padding is an easy "tidy-up" to make by accident."""
    assert classify_class_name("YOUTH W/T HUS 10 & UNDER")[0] == "Hunter Under Saddle"
    assert classify_class_name("CARTHUSIAN CLASS") is None


def test_every_row_declares_a_real_score_type():
    for keyword, discipline, score_type in DISCIPLINE_KEYWORDS:
        assert score_type in ("placement", "pattern", "time"), (
            f"{keyword!r} → {discipline!r} has score_type {score_type!r}"
        )


def test_no_keyword_is_shadowed_by_an_earlier_substring():
    """The table's ordering invariant, checked directly.

    If an earlier keyword is a substring of a later one, every name matching
    the later one hits the earlier one first and the later row is dead — the
    exact failure the module docstring warns about. Asserting the shape catches
    every future mis-ordered insertion, which no amount of example lookups can.
    """
    keywords = [k for k, _, _ in DISCIPLINE_KEYWORDS]

    shadowed = [
        (earlier, later)
        for i, earlier in enumerate(keywords)
        for later in keywords[i + 1:]
        if earlier in later
    ]

    assert not shadowed, (
        "these rows can never match — an earlier keyword already covers them: "
        + ", ".join(f"{later!r} shadowed by {earlier!r}" for earlier, later in shadowed)
    )
