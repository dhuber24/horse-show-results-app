"""Saddle-club high point (migration 193): which club a placing counts for."""
from uuid import uuid4

from club_points import ClubContext, _code_for, tally_clubs
from high_point import Card, build_chart

SHOW = uuid4()
ANN, BEN, CAL = uuid4(), uuid4(), uuid4()
DASSEL, SKY = uuid4(), uuid4()
FLAT = build_chart([{"min_entries": 1, "place": p, "points": pts} for p, pts in [(1, 6), (2, 5), (3, 4)]])


def card(rider, place, *, team=False, teammates=(), entry=None, class_id=None):
    return Card(
        show_id=SHOW, class_id=class_id or uuid4(), division_name="Open", division_sort=1,
        exhibitor_id=rider, exhibitor_name="x", horse_id=uuid4(), horse_name="h",
        place=place, outcome="placed", class_size=5, judge_id=None, team_class=team,
        teammates=tuple((t, "t") for t in teammates), entry_id=entry,
    )


def ctx(rule="each_rider", seat=None):
    return ClubContext(
        primary={(SHOW, ANN): DASSEL, (SHOW, BEN): SKY, (SHOW, CAL): SKY},
        seat=seat or {},
        team_rule={SHOW: rule},
        names={DASSEL: "Dassel", SKY: "Sky Hi"},
    )


def points(table):
    return {row["club_name"]: row["points"] for row in table["standings"]}


def test_an_individual_placing_counts_for_the_primary_club_only():
    assert points(tally_clubs([card(ANN, 1)], FLAT, ctx())) == {"Dassel": 6}


def test_each_riders_club_earns_a_teams_placing_once():
    table = tally_clubs([card(ANN, 1, team=True, teammates=[BEN, CAL])], FLAT, ctx())
    assert points(table) == {"Dassel": 6, "Sky Hi": 6}


def test_the_entrants_club_alone_when_the_office_says_so():
    table = tally_clubs([card(ANN, 1, team=True, teammates=[BEN])], FLAT, ctx("entrant"))
    assert points(table) == {"Dassel": 6}


def test_team_classes_count_for_no_club_when_the_office_says_so():
    assert points(tally_clubs([card(ANN, 1, team=True, teammates=[BEN])], FLAT, ctx("none"))) == {}


def test_a_seat_rides_for_the_riders_other_declared_club():
    entry = uuid4()
    table = tally_clubs([card(ANN, 2, team=True, teammates=[BEN], entry=entry)], FLAT, ctx(seat={(entry, ANN): SKY}))
    assert points(table) == {"Sky Hi": 5}


def test_no_club_setup_means_no_club_table():
    assert tally_clubs([card(ANN, 1)], FLAT, None) is None


def test_a_rider_with_no_club_earns_no_club_anything():
    assert points(tally_clubs([card(uuid4(), 1)], FLAT, ctx())) == {}


def test_a_club_code_is_made_from_its_name():
    assert _code_for("Dassel Saddle Club") == "SC-DASSEL-SADDLE-CLU"
