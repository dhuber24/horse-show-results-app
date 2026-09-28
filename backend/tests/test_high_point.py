"""High-point standings (migration 147).

The public leaderboard was a placeholder that never added anything up. What it
does now is small and every part of it is a rule somebody will check against a
printed chart, so each is pinned here:

* the chart band is the largest one at or below the class size;
* each judge's card earns its own points;
* only a placed card earns, and a tie shares the place's points;
* standings are per division and per horse-and-rider, ranked 1, 2, 2, 4.
"""
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException

from high_point import (
    Card,
    build_chart,
    may_edit_point_system,
    may_use_point_system,
    place_limits,
    points_for,
    range_label,
    rank,
    tally,
)
from routers.high_point import AwardIn, Caller, _validated_awards, owning_company

SHOW = uuid4()
ALICE, BOB, CARA = uuid4(), uuid4(), uuid4()
HORSE_A, HORSE_B, HORSE_C, HORSE_A2 = uuid4(), uuid4(), uuid4(), uuid4()

# 6-5-4-3-2-1 whatever the class size. A row can award no more places than its
# class size (migration 150), so a flat scale is a row per size up to 6, each
# paying the same points for the places it has.
FLAT = build_chart([
    {"min_entries": size, "place": place, "points": points}
    for size in range(1, 7)
    for place, points in enumerate([6, 5, 4, 3, 2, 1][:size], start=1)
])

# Scaled by class size: one to two horses, three to five, six or more.
SCALED = build_chart([
    {"min_entries": 1, "place": 1, "points": 0.5},
    {"min_entries": 3, "place": 1, "points": 1},
    {"min_entries": 3, "place": 2, "points": 0.5},
    {"min_entries": 6, "place": 1, "points": 3},
    {"min_entries": 6, "place": 2, "points": 2},
    {"min_entries": 6, "place": 3, "points": 1},
])


def card(exhibitor, horse, place, *, class_id=None, division="Amateur", size=5,
         outcome="placed", show=SHOW, sort=1, name=None, horse_name=None):
    return Card(
        show_id=show,
        class_id=class_id or uuid4(),
        division_name=division,
        division_sort=sort,
        exhibitor_id=exhibitor,
        exhibitor_name=name or {ALICE: "Alice", BOB: "Bob", CARA: "Cara"}[exhibitor],
        horse_id=horse,
        horse_name=horse_name or "Horse",
        place=place,
        outcome=outcome,
        class_size=size,
    )


def test_flat_chart_ignores_class_size():
    assert points_for(FLAT, 1, 1) == 6
    assert points_for(FLAT, 3, 3) == 4
    assert points_for(FLAT, 6, 40) == 1
    assert points_for(FLAT, 7, 40) == 0


def test_a_row_is_a_range_that_ends_where_the_next_begins():
    """Rows starting at 3, 5 and 10 are 3-4, 5-9 and 10 or more (migration 152)."""
    limits = place_limits([10, 3, 5])
    assert limits == {3: 4, 5: 9, 10: 10}
    assert [range_label(m, limits) for m in (3, 5, 10)] == ["3-4", "5-9", "10 or more"]
    assert range_label(2, place_limits([2, 3])) == "2"


def test_a_row_may_pay_down_to_the_largest_class_in_its_range():
    """A 5-9 row is used by a class of nine, which has a 9th place."""
    awards = [AwardIn(min_entries=5, place=p, points=1) for p in range(1, 10)]
    awards.append(AwardIn(min_entries=10, place=1, points=2))
    assert _validated_awards(awards) == awards


def test_a_row_can_pay_no_place_beyond_its_range():
    with pytest.raises(HTTPException) as refused:
        _validated_awards([
            AwardIn(min_entries=3, place=5, points=1),
            AwardIn(min_entries=5, place=1, points=1),
        ])
    assert refused.value.status_code == 422
    assert "Classes of 3-4 can award at most 4 places" in refused.value.detail


def test_the_last_row_pays_at_most_its_first_size():
    """"45 or more" has only its first number to go by."""
    with pytest.raises(HTTPException) as refused:
        _validated_awards([AwardIn(min_entries=3, place=4, points=1)])
    assert refused.value.status_code == 422
    assert "Classes of 3 or more can award at most 3 places" in refused.value.detail


def test_a_flat_scale_is_two_rows():
    """6-5-4-3-2-1 whatever the size: 1-6, then 7 or more."""
    flat = [6, 5, 4, 3, 2, 1]
    chart = build_chart(
        [{"min_entries": 1, "place": p, "points": v} for p, v in enumerate(flat, 1)]
        + [{"min_entries": 7, "place": p, "points": v} for p, v in enumerate(flat, 1)]
    )
    assert points_for(chart, 3, 3) == 4
    assert points_for(chart, 6, 40) == 1


def test_largest_band_at_or_below_the_class_size_applies():
    assert points_for(SCALED, 1, 2) == Decimal("0.5")
    assert points_for(SCALED, 1, 3) == 1
    assert points_for(SCALED, 1, 5) == 1
    assert points_for(SCALED, 1, 6) == 3
    # The top band covers every bigger class, as a printed chart's last row does.
    assert points_for(SCALED, 3, 60) == 1
    # A place the band does not list earns nothing.
    assert points_for(SCALED, 2, 2) == 0


def test_a_class_smaller_than_every_band_earns_nothing():
    chart = build_chart([{"min_entries": 3, "place": 1, "points": 2}])
    assert points_for(chart, 1, 2) == 0
    assert points_for(chart, None, 10) == 0


def test_each_judges_card_counts():
    class_id = uuid4()
    cards = [card(ALICE, HORSE_A, 1, class_id=class_id), card(ALICE, HORSE_A, 2, class_id=class_id)]
    [division] = tally(cards, FLAT)
    [row] = division["standings"]
    assert row["points"] == 11
    assert row["class_count"] == 1


def test_only_a_placed_card_earns():
    cards = [
        card(ALICE, HORSE_A, None, outcome="disqualified"),
        card(BOB, HORSE_B, 3, outcome="eliminated"),
        card(CARA, HORSE_C, 2),
    ]
    [division] = tally(cards, FLAT)
    assert [r["exhibitor_name"] for r in division["standings"]] == ["Cara"]


def test_a_tie_shares_the_places_points():
    class_id = uuid4()
    cards = [card(ALICE, HORSE_A, 2, class_id=class_id), card(BOB, HORSE_B, 2, class_id=class_id)]
    [division] = tally(cards, FLAT)
    assert [r["points"] for r in division["standings"]] == [5, 5]
    assert [r["rank"] for r in division["standings"]] == [1, 1]


def test_standings_are_per_horse_and_rider_and_per_division():
    cards = [
        card(ALICE, HORSE_A, 1),
        card(ALICE, HORSE_A2, 2),
        card(ALICE, HORSE_A, 1, division="Youth 14-18", sort=0),
    ]
    divisions = tally(cards, FLAT)
    # Division order follows the show's own sort order.
    assert [d["name"] for d in divisions] == ["Youth 14-18", "Amateur"]
    amateur = divisions[1]["standings"]
    assert [(r["horse_id"], r["points"]) for r in amateur] == [(str(HORSE_A), 6), (str(HORSE_A2), 5)]


def test_divisions_match_by_name_across_shows():
    other_show = uuid4()
    cards = [
        card(ALICE, HORSE_A, 1, division="Amateur"),
        card(ALICE, HORSE_A, 2, division="  amateur ", show=other_show),
    ]
    [division] = tally(cards, FLAT)
    [row] = division["standings"]
    assert row["points"] == 11
    assert row["show_count"] == 2


def test_competition_ranking():
    assert rank([Decimal(10), Decimal(8), Decimal(8), Decimal(5)]) == [1, 2, 2, 4]
    assert rank([]) == []


def test_nothing_placed_means_no_divisions():
    assert tally([card(ALICE, HORSE_A, 9)], FLAT) == []


# ── Who may use a points system (migration 148) ──────────────────────────────

CLUB, OTHER_CLUB = uuid4(), uuid4()


def test_an_admin_may_use_every_system_including_one_no_company_owns():
    assert may_use_point_system("ADMIN", CLUB, [])
    assert may_use_point_system("ADMIN", None, [])


def test_staff_use_their_own_companies_systems_and_the_standard_ones():
    assert may_use_point_system("SHOW_SECRETARY", CLUB, [CLUB])
    assert not may_use_point_system("SHOW_SECRETARY", OTHER_CLUB, [CLUB])
    # A system no company owns is a GaitDesk standard one (migration 151).
    assert may_use_point_system("SHOW_MANAGER", None, [CLUB])


def test_a_standard_system_is_only_gaitdesks_to_change():
    assert not may_edit_point_system("SHOW_MANAGER", None, [CLUB])
    assert may_edit_point_system("ADMIN", None, [])
    assert may_edit_point_system("SHOW_SECRETARY", CLUB, [CLUB])
    assert not may_edit_point_system("SHOW_SECRETARY", OTHER_CLUB, [CLUB])


SHOW = uuid4()


def test_a_shows_own_chart_is_in_nobodys_library():
    """Migration 153. It has no company, so without the show check it would read
    as a GaitDesk standard system and turn up in every company's picker -- and
    could then score another show or a circuit."""
    assert not may_use_point_system("SHOW_MANAGER", None, [CLUB], SHOW)
    assert not may_use_point_system("ADMIN", None, [], SHOW)


def test_a_shows_own_chart_is_changed_through_its_show_not_the_library():
    assert not may_edit_point_system("ADMIN", None, [], SHOW)
    assert not may_edit_point_system("SHOW_SECRETARY", None, [CLUB], SHOW)


def test_somebody_in_one_company_need_not_say_which():
    assert owning_company(Caller(ALICE, "SHOW_MANAGER", [CLUB]), None) == CLUB


def test_somebody_in_two_companies_must_choose():
    with pytest.raises(HTTPException) as refused:
        owning_company(Caller(ALICE, "SHOW_MANAGER", [CLUB, OTHER_CLUB]), None)
    assert refused.value.status_code == 422
    assert owning_company(Caller(ALICE, "SHOW_MANAGER", [CLUB, OTHER_CLUB]), OTHER_CLUB) == OTHER_CLUB


def test_nobody_keeps_a_system_under_somebody_elses_company():
    with pytest.raises(HTTPException) as refused:
        owning_company(Caller(ALICE, "SHOW_SECRETARY", [CLUB]), OTHER_CLUB)
    assert refused.value.status_code == 403


def test_an_admin_may_keep_one_under_any_company_or_none():
    assert owning_company(Caller(ALICE, "ADMIN", []), OTHER_CLUB) == OTHER_CLUB
    assert owning_company(Caller(ALICE, "ADMIN", []), None) is None
