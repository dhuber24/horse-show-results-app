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


@pytest.mark.parametrize(
    "name,discipline",
    [
        # Every speed class on the 2026 WSCA Championship Show bill, as the
        # bill reader returned them -- each came in as Unassigned / placings
        # when the table only knew "BARREL RACING" and "POLE BENDING".
        ("Sr. Pennant", "Pennant Race"),
        ("Sr++ Poles", "Pole Bending"),
        ("Pet Pony Poles", "Pole Bending"),
        ("PW Key Race", "Key Race"),
        ("4-In-A-Line", "Four in Line"),
        ("Unassisted Canter Pole Weaving", "Pole Weaving"),
        ("Assisted Walk Trot Key Race", "Key Race"),
        ("Assisted Walk Trot Barrels", "Barrel Racing"),
        ("Sr++ Jumping F8", "Jumping Figure 8"),
        ("Rescue Race", "Rescue Race"),
        ("Ribbon Race", "Ribbon Race"),
        ("Int. Barrels", "Barrel Racing"),
        ("$1,000 Added SIDEPOT 5D Barrels", "Barrel Racing"),
        ("Futurity 4D Sidepot Barrels", "Barrel Racing"),
        # Other spellings of the same games.
        ("4 In A Line Barrels", "Four in Line"),
        ("Jr Keyhole", "Keyhole Race"),
        ("Two Barrel Flags", "Flag Race"),
    ],
)
def test_saddle_club_games_are_timed(name, discipline):
    assert classify_class_name(name) == (discipline, "time")


def test_egg_and_spoon_is_not_timed():
    """The one WSCA game the rulebook calls a "Game event" rather than a
    "Timed event": run by elimination, so it stays on placings."""
    assert classify_class_name("Jr. Egg & Spoon Games") is None


def test_jumping_figure_8_is_timed_but_plain_jumping_is_judged():
    assert classify_class_name("Jr. Jumping F8")[1] == "time"
    assert classify_class_name("Open Jumping") == ("Jumping", "pattern")


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
