"""A competition card is a year's card, and that is the whole design.

Every APHA card these rows describe runs 1 January to 31 December, so the expiry
is derived rather than stored and renewing is raising the year. What is worth
pinning is the pair of things that are *not* on the list — plain Youth and Youth
Walk-Trot 5-10, which APHA's own notice does not name — and the fact that an
association the app has no card rules for offers none rather than defaulting to
APHA's.
"""
from datetime import date

import pytest

from competition_cards import (
    ALL_CARD_DIVISIONS,
    APHA_CARD_DIVISIONS,
    MAX_CARD_YEAR,
    MIN_CARD_YEAR,
    card_divisions_for,
    card_expiry,
    current_card_year,
    division_label,
    is_current,
    issues_cards,
)


# ── The one date ─────────────────────────────────────────────────────────────

def test_a_card_expires_on_the_last_day_of_its_year():
    assert card_expiry(2026) == date(2026, 12, 31)


def test_a_card_is_good_through_its_own_last_day():
    # Inclusive: somebody showing on 31 December holds a valid card, and an
    # off-by-one here turns them away at the gate on the last show of the year.
    assert is_current(2026, date(2026, 12, 31))
    assert not is_current(2026, date(2027, 1, 1))


def test_a_card_is_judged_against_the_date_it_is_given_not_today():
    # The signature has no default on purpose — a show office asks whether the
    # card covers *the show*, the same rule health paperwork follows.
    assert is_current(2025, date(2025, 6, 1))
    assert not is_current(2025, date(2026, 6, 1))


def test_next_years_card_is_current_today():
    # Renewing early is the normal case in December, and a 2027 card held in
    # 2026 is not somehow invalid.
    assert is_current(2027, date(2026, 12, 15))


def test_the_card_year_is_the_calendar_year():
    assert current_card_year(date(2026, 1, 1)) == 2026
    assert current_card_year(date(2026, 12, 31)) == 2026


# ── Which cards exist ────────────────────────────────────────────────────────

def test_apha_issues_the_five_cards_its_own_notice_names():
    assert set(APHA_CARD_DIVISIONS) == {
        "AMATEUR",
        "NOVICE_AMATEUR",
        "AMATEUR_WALK_TROT",
        "NOVICE_YOUTH",
        "YOUTH_WALK_TROT_11_18",
    }


@pytest.mark.parametrize("division", ["YOUTH", "YOUTH_WALK_TROT_5_10", "OPEN", "SOLID_PAINT_BRED"])
def test_divisions_that_need_no_card_are_absent(division):
    # APHA's entry-form notice lists the cards that expire on 31 December and
    # names none of these. Youth eligibility is age and youth membership; Open
    # and Solid Paint-Bred are not carded at all. Adding one here would have the
    # app chasing a card nobody issues.
    assert division not in ALL_CARD_DIVISIONS


def test_an_association_with_no_card_rules_on_file_offers_none():
    # Not "issues none" — the app has not been given AQHA's card rules, and
    # guessing a year-end would be filed, read at a desk and found out at a gate.
    assert card_divisions_for("AQHA") == ()
    assert not issues_cards("AQHA")
    assert not issues_cards(None)


def test_the_association_code_is_matched_regardless_of_how_it_was_typed():
    assert card_divisions_for(" apha ") == APHA_CARD_DIVISIONS
    assert issues_cards("apha")


# ── Labels ───────────────────────────────────────────────────────────────────

def test_a_division_reads_the_way_the_rule_book_writes_it():
    # `.title()` on the stored value gives "Youth Walk Trot 11 18".
    assert division_label("YOUTH_WALK_TROT_11_18") == "Youth Walk-Trot 11-18"
    assert division_label("NOVICE_AMATEUR") == "Novice Amateur"


def test_every_card_division_has_a_label():
    for division in ALL_CARD_DIVISIONS:
        assert division_label(division) != division


# ── Bounds ───────────────────────────────────────────────────────────────────

def test_the_year_bounds_bracket_a_real_card_year():
    assert MIN_CARD_YEAR <= 2026 <= MAX_CARD_YEAR
