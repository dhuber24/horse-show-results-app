"""The hour on an early rate's reserve-by date (migration 190).

Printed as typed, local to the venue, and never read by the biller: which rate a
booking pays still turns on the day. The only rule is that an hour needs a day.
"""
from datetime import date, time

import pytest
from fastapi import HTTPException

from billing import early_rate_is_open
from routers.show_fees import _assert_deadline_time_valid
from tests.factories import make_fee


def test_an_hour_needs_a_day():
    with pytest.raises(HTTPException) as err:
        _assert_deadline_time_valid(None, time(17, 0))
    assert err.value.status_code == 422


@pytest.mark.parametrize("deadline,hour", [
    (date(2026, 5, 1), time(17, 0)),
    (date(2026, 5, 1), None),
    (None, None),
])
def test_a_day_with_or_without_an_hour_is_fine(deadline, hour):
    _assert_deadline_time_valid(deadline, hour)


def test_the_hour_does_not_move_the_rate():
    """Display precision only: a booking made on the deadline day keeps the early
    rate whatever hour is printed, as `futurities.entry_deadline_time` does."""
    fee = make_fee(
        unit="per_stall",
        amount_cents=8500,
        early_amount_cents=6000,
        early_deadline=date(2026, 5, 1),
        early_deadline_time=time(9, 0),
    )
    assert early_rate_is_open(fee, date(2026, 5, 1))
    assert not early_rate_is_open(fee, date(2026, 5, 2))
