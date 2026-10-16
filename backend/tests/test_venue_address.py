"""The venue's street address on one line, as the show payload sends it
(`venue_address`) for the pin that opens the venue in a maps app."""
from types import SimpleNamespace

from routers.shows import _venue_address


def venue(address=None, city=None, state=None, zip=None):
    return SimpleNamespace(name="Fairgrounds", address=address, city=city, state=state, zip=zip)


def test_the_zip_follows_the_state():
    assert (
        _venue_address(venue("1421 3rd Ave SE", "Rochester", "MN", "55904"))
        == "1421 3rd Ave SE, Rochester, MN 55904"
    )


def test_what_is_there_still_reads():
    assert _venue_address(venue(city="Rochester", state="MN")) == "Rochester, MN"
    assert _venue_address(venue(address="1421 3rd Ave SE", zip="55904")) == "1421 3rd Ave SE, 55904"


def test_blank_and_missing_are_nothing_to_send():
    assert _venue_address(venue("  ", "", None, " ")) is None
    assert _venue_address(venue()) is None
    assert _venue_address(None) is None
