"""When exhibitors may move into their stalls (migration 181): the day and the
hour as `update_show` will store them."""
from datetime import date, time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routers.shows import _settle_stalls_open


def show(day=None, hour=None, end=date(2026, 5, 17)):
    return SimpleNamespace(stalls_open_date=day, stalls_open_time=hour, end_date=end)


def test_a_day_and_an_hour_are_taken():
    updates = {"stalls_open_date": date(2026, 5, 14), "stalls_open_time": time(12, 0)}
    _settle_stalls_open(updates, show())
    assert updates == {"stalls_open_date": date(2026, 5, 14), "stalls_open_time": time(12, 0)}


def test_a_day_alone_is_taken():
    updates = {"stalls_open_date": date(2026, 5, 14)}
    _settle_stalls_open(updates, show())
    assert updates == {"stalls_open_date": date(2026, 5, 14)}


def test_an_hour_on_a_day_already_stored_is_taken():
    updates = {"stalls_open_time": time(8, 0)}
    _settle_stalls_open(updates, show(day=date(2026, 5, 14)))
    assert updates == {"stalls_open_time": time(8, 0)}


def test_an_hour_on_no_day_is_refused():
    with pytest.raises(HTTPException) as err:
        _settle_stalls_open({"stalls_open_time": time(12, 0)}, show())
    assert err.value.status_code == 422


def test_clearing_the_day_clears_the_hour():
    updates = {"stalls_open_date": None}
    _settle_stalls_open(updates, show(day=date(2026, 5, 14), hour=time(12, 0)))
    assert updates == {"stalls_open_date": None, "stalls_open_time": None}


def test_the_last_day_of_the_show_is_allowed():
    _settle_stalls_open({"stalls_open_date": date(2026, 5, 17)}, show())


def test_a_day_after_the_show_is_refused():
    with pytest.raises(HTTPException) as err:
        _settle_stalls_open({"stalls_open_date": date(2026, 5, 18)}, show())
    assert err.value.status_code == 422


def test_the_show_end_moving_in_the_same_save_is_what_counts():
    _settle_stalls_open(
        {"stalls_open_date": date(2026, 5, 20), "end_date": date(2026, 5, 21)}, show()
    )
