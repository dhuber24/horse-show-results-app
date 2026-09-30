"""Where a show is, as the My Shows button prints it (`venue_location`)."""
from types import SimpleNamespace

from routers.my_shows import venue_location


def venue(city=None, state=None):
    return SimpleNamespace(name="Fairgrounds", city=city, state=state)


def test_a_town_and_state_read_as_one_line():
    assert venue_location(venue("Rochester", "MN")) == "Rochester, MN"


def test_a_lone_half_still_reads():
    assert venue_location(venue(city="Rochester")) == "Rochester"
    assert venue_location(venue(state="MN")) == "MN"


def test_blank_and_missing_are_nothing_to_print():
    assert venue_location(venue("  ", "")) is None
    assert venue_location(venue()) is None
    assert venue_location(None) is None
