"""Team classes, and the riders on a team (migration 192).

What a team class is seeded from, what a request to name a team may and may not
say, and how a team is read out on the screens and in the exports. The writes
themselves need a database; these pin the rules they are built from.
"""
from datetime import date
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from data_export import ENTRIES, PLACINGS, build_data_export
from rules.disciplines import team_size
from show_reports import build_report
from teams import (
    Teammate,
    TeammateRequest,
    at_show,
    check_request,
    horse_label,
    is_team_class,
    rider_label,
    seats_for,
    team_out,
    team_shortfall,
)
from tests.test_data_export import (
    CLASS_A,
    ENTRY_ONE,
    EXHIBITOR_ONE,
    HORSE_ONE,
    a_class,
    a_record,
    an_entry,
    fields_by_key,
)

# ── Which classes a team rides, from the name ─────────────────────────────────


@pytest.mark.parametrize(
    "name, size",
    [
        ("Tandem Bareback", 2),
        ("Jr Rescue Race", 2),
        ("Ribbon Race", 2),
        ("4-In-A-Line", 4),
        ("Four In Line", 4),
        ("4 In A Line Barrels", 4),
        ("Pairs Pleasure", 2),
        ("Ranch Sorting", 2),
        ("Team Sorting", 3),
        ("Team Penning", 3),
        ("Musical Quadrille", 4),
    ],
)
def test_a_class_a_team_rides_is_seeded_from_its_name(name, size):
    assert team_size(name) == size


@pytest.mark.parametrize(
    "name",
    [
        "Western Pleasure",
        "Key Race",
        "Pole Bending",
        "Line Dance Costume",
        # Driving terms: one driver behind two horses is not a team of riders.
        "Tandem Driving",
        "Driving - Pair Over 54\"",
        # Left to the office: a relay's size varies, a leader is not a rider,
        # and a roping is entered heading and heeling separately.
        "Pony Express Relay",
        "Leadline",
        "Dally Team Roping-Heading",
        "",
        None,
    ],
)
def test_an_ordinary_class_has_no_team(name):
    assert team_size(name) is None


# ── Seats, and a short team ───────────────────────────────────────────────────


def a_team_class(size=2, **over):
    return SimpleNamespace(team_size=size, class_number="15", class_name="Tandem Bareback", **over)


def test_a_team_is_the_rider_who_entered_and_the_seats_beside_them():
    assert seats_for(a_team_class(2)) == 1
    assert seats_for(a_team_class(4)) == 3
    assert seats_for(a_team_class(None)) == 0


def test_a_short_team_is_counted_not_refused():
    assert team_shortfall(a_team_class(4), 1) == 2
    assert team_shortfall(a_team_class(4), 3) == 0
    assert team_shortfall(a_team_class(None), 0) == 0


def test_a_team_size_below_two_is_not_a_team_class():
    assert not is_team_class(a_team_class(None))
    assert not is_team_class(a_team_class(1))
    assert is_team_class(a_team_class(2))


def test_somebody_the_office_added_may_ride_on_a_team():
    # The office's own addition has no sign-up date -- the usual way the second
    # rider of a tandem team who shows nothing else arrives.
    assert at_show(SimpleNamespace(registered_at=None, cancelled_at=None))
    assert at_show(SimpleNamespace(registered_at=date(2026, 8, 1), cancelled_at=None))
    assert not at_show(SimpleNamespace(registered_at=date(2026, 8, 1), cancelled_at=date(2026, 8, 2)))
    assert not at_show(None)


# ── What a request to name a team may say ─────────────────────────────────────

ENTRANT, TEAMMATE, OTHER, TEAM_HORSE, OWN_HORSE = (uuid4() for _ in range(5))


def refusal(call) -> dict:
    with pytest.raises(HTTPException) as caught:
        call()
    return caught.value.detail


def test_an_ordinary_class_has_no_team_to_name():
    detail = refusal(lambda: check_request(a_team_class(None), ENTRANT, TEAM_HORSE, []))
    assert detail["code"] == "NOT_A_TEAM_CLASS"


def test_a_team_cannot_name_more_riders_than_the_class_seats():
    detail = refusal(
        lambda: check_request(
            a_team_class(2), ENTRANT, TEAM_HORSE, [TeammateRequest(TEAMMATE), TeammateRequest(OTHER)]
        )
    )
    assert detail["code"] == "TEAM_TOO_LARGE"
    assert "2 riders" in detail["message"]


def test_the_rider_who_entered_is_not_their_own_teammate():
    detail = refusal(lambda: check_request(a_team_class(2), ENTRANT, TEAM_HORSE, [TeammateRequest(ENTRANT)]))
    assert detail["code"] == "TEAMMATE_IS_ENTRANT"


def test_nobody_is_on_a_team_twice():
    detail = refusal(
        lambda: check_request(
            a_team_class(4), ENTRANT, TEAM_HORSE, [TeammateRequest(TEAMMATE), TeammateRequest(TEAMMATE)]
        )
    )
    assert detail["code"] == "TEAMMATE_TWICE"


def test_a_teammate_named_with_the_teams_horse_rides_the_teams_horse():
    tidy = check_request(
        a_team_class(4),
        ENTRANT,
        TEAM_HORSE,
        [TeammateRequest(TEAMMATE, TEAM_HORSE), TeammateRequest(OTHER, OWN_HORSE)],
    )
    assert tidy == [TeammateRequest(TEAMMATE, None), TeammateRequest(OTHER, OWN_HORSE)]


def test_a_team_with_nobody_named_yet_is_a_valid_request():
    assert check_request(a_team_class(2), ENTRANT, TEAM_HORSE, []) == []


# ── How a team is read out ────────────────────────────────────────────────────


def teammate(name, horse_id=None, horse_name=None, position=2):
    return Teammate(uuid4(), name, horse_id, horse_name, position)


def test_a_team_is_read_out_as_its_riders():
    team = [teammate("Jennifer Peterson")]
    assert rider_label("Bella Drevlow", team) == "Bella Drevlow / Jennifer Peterson"
    assert rider_label("Bella Drevlow", []) == "Bella Drevlow"


def test_a_tandem_team_rides_one_horse():
    assert horse_label("Krymsun Tiger", [teammate("Jennifer Peterson")]) == "Krymsun Tiger"


def test_each_horse_a_teammate_brought_is_listed_once():
    team = [
        teammate("Jack Whalen", uuid4(), "Kasey", 2),
        teammate("Sue Ahlgren", uuid4(), "Marvin", 3),
        teammate("Amy Lund", uuid4(), "Kasey", 4),
    ]
    assert horse_label("Midas", team) == "Midas / Kasey / Marvin"


def test_the_screens_get_the_team_and_whos_still_to_name():
    out = team_out(a_team_class(4), [teammate("Jack Whalen", uuid4(), "Kasey")])
    assert out["team_short"] == 2
    assert [m["exhibitor_name"] for m in out["team_members"]] == ["Jack Whalen"]
    assert out["team_members"][0]["horse_name"] == "Kasey"


# ── The reports and the Data Export ───────────────────────────────────────────

TEAMMATE_ID, TEAMMATE_HORSE = uuid4(), uuid4()


def a_team_record(*, named=True):
    members = (
        [{"exhibitor_id": TEAMMATE_ID, "name": "Jennifer Peterson", "horse_id": None, "horse_name": None}]
        if named
        else []
    )
    entry = an_entry(
        ENTRY_ONE,
        EXHIBITOR_ONE,
        HORSE_ONE,
        CLASS_A,
        exhibitor_name="Bella Drevlow",
        rider_label="Bella Drevlow / Jennifer Peterson" if named else "Bella Drevlow",
        horse_name="Krymsun Tiger",
        horse_label="Krymsun Tiger",
        team_members=members,
    )
    return a_record(classes=[a_class(CLASS_A, "15", team_size=2)], entries=[entry])


def show_results_rows(record):
    return build_report("results", record)["rows"]


def test_show_results_prints_the_team():
    rows = show_results_rows(a_team_record())
    assert rows[0]["exhibitor"] == "Bella Drevlow / Jennifer Peterson"


def test_the_export_keeps_the_entrant_in_the_exhibitor_columns():
    export = build_data_export(a_team_record())
    row = export[PLACINGS][0]
    assert row["exhibitor_name"] == "Bella Drevlow"
    assert row["exhibitor_id"] == str(EXHIBITOR_ONE)


def test_the_export_lists_each_teammate_with_the_horse_they_rode():
    export = build_data_export(a_team_record())
    row = export[ENTRIES][0]
    assert row["teammates"] == "Jennifer Peterson"
    assert row["teammate_ids"] == str(TEAMMATE_ID)
    # She rode the team's horse, so that is the horse she is listed with.
    assert row["teammate_horses"] == "Krymsun Tiger"
    assert row["teammate_horse_ids"] == str(HORSE_ONE)


def test_the_team_columns_are_on_once_a_team_has_a_rider_named():
    fields = fields_by_key(build_data_export(a_team_record()))
    assert fields["teammates"]["default"] is True
    assert fields["teammates"]["group"] == "team"


def test_a_team_class_with_nobody_named_offers_the_columns_off():
    fields = fields_by_key(build_data_export(a_team_record(named=False)))
    assert fields["teammates"]["default"] is False


def test_a_show_with_no_team_class_is_not_offered_team_columns():
    fields = fields_by_key(build_data_export(a_record()))
    assert "teammates" not in fields


# ── One team per rider where every team rides at once ─────────────────────────


def test_a_rail_class_has_every_team_in_the_ring_at_once():
    from teams import rides_together

    assert rides_together(SimpleNamespace(score_type="placement"))
    assert not rides_together(SimpleNamespace(score_type="time"))
    assert not rides_together(SimpleNamespace(score_type="pattern"))


def test_a_second_ride_names_whose_team_it_is():
    from teams import already_riding

    detail = already_riding(a_team_class(2), "Jennifer Peterson", "Tess Tandem").detail
    assert detail["code"] == "ALREADY_RIDING"
    assert detail["message"].startswith(
        "Jennifer Peterson already rides in Class 15 (Tandem Bareback), on Tess Tandem's team."
    )


def test_the_exhibitor_is_told_in_the_second_person():
    from teams import already_riding

    detail = already_riding(a_team_class(2), None, "Tess Tandem").detail
    assert detail["message"].startswith("You already ride in Class 15 (Tandem Bareback), on Tess Tandem's team.")
