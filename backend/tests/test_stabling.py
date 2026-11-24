"""Stall periods, what a stall line sells, and whether an exhibitor's stalls
cover their horses (migration 194).

Modelled on WSCA's 2026 Championship Show: Wednesday 4 PM move-in, pleasure
classes Thursday and Friday, games classes Saturday to Monday. A full-show
stall runs Wednesday to Monday; a pleasure stall Wednesday to Friday, out an
hour after your last class; a games stall from 9 PM Friday to Monday.
"""
import asyncio
from datetime import date, datetime, time
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from models import ShowFee
from routers.show_fees import _check_move_in, _check_stall_fields
from schemas import ShowFeeOut
from routers.show_fees import _check_one_per_exhibitor
from stabling import (
    ADD_ON,
    BOX,
    TIE,
    is_horse_stall,
    HORSE_STALLS_SHORT,
    PASS_WITHOUT_STALL,
    earliest_move_in,
    stalls_open_from,
    is_early_move_in,
    pass_refusal,
    TACK,
    TACK_STALL_HORSES,
    covers,
    period_days,
    stall_checks,
    stall_kind_of,
)

WED, THU, FRI, SAT, SUN, MON = (date(2026, 9, d) for d in range(23, 29))


def period(name, move_in, move_out, *, move_in_time=None):
    return SimpleNamespace(
        id=uuid4(), name=name, move_in_date=move_in, move_in_time=move_in_time,
        move_out_date=move_out,
    )


FULL = period("Full show", WED, MON, move_in_time=time(16, 0))
PLEASURE = period("Pleasure", WED, FRI, move_in_time=time(16, 0))
GAMES = period("Games", FRI, MON, move_in_time=time(21, 0))


def stall(label="Box stall", *, period=None, kind=None, code="stall", per_tack=None, unit="per_stall"):
    return SimpleNamespace(
        id=uuid4(), unit=unit, code=code, label=label, stall_kind=kind,
        stall_period_id=period.id if period else None, horses_per_tack_stall=per_tack,
    )


def show(required=True):
    return SimpleNamespace(stall_per_horse_required=required)


def horses(**days):
    """`horses(Buddy=[THU, FRI])` -> the shape `horse_days_by_exhibitor` returns."""
    return {uuid4(): (name, set(dates)) for name, dates in days.items()}


def checks(fees, booked, horse_days, *, periods=(FULL, PLEASURE, GAMES), required=True):
    return stall_checks(
        show=show(required), fees=fees, periods=periods, booked=booked, horse_days=horse_days
    )


# -- What a line sells --------------------------------------------------------

def test_a_stated_kind_wins():
    assert stall_kind_of(stall("Stall", kind=TACK)) == TACK


def test_an_unstated_line_is_read_from_itself():
    """Every line before migration 194, and every one the show bill import
    writes, has no kind stated."""
    assert stall_kind_of(stall("Box stall")) == BOX
    assert stall_kind_of(stall("Stall")) == BOX
    assert stall_kind_of(stall("Tie Stall - Full show")) == TIE
    assert stall_kind_of(stall("Stall", code="tie_stall")) == TIE
    assert stall_kind_of(stall("Tack Stall - Games")) == TACK
    assert stall_kind_of(stall("Stall", code="tack_stall")) == TACK
    assert stall_kind_of(stall("Early Move-In Pass", code="early_move_in")) == ADD_ON
    assert stall_kind_of(stall("Early arrival", code="early_arrival_stall")) == ADD_ON


def test_a_word_that_only_contains_tack_is_not_a_tack_stall():
    assert stall_kind_of(stall("Stackable stall")) == BOX
    assert stall_kind_of(stall("Tied-off stall")) == BOX


def test_box_and_tie_stalls_stand_a_horse_and_a_tack_stall_does_not():
    """Migration 198: the three stall types a period prices."""
    assert is_horse_stall(stall("Stall", kind=BOX))
    assert is_horse_stall(stall("Stall", kind=TIE))
    assert not is_horse_stall(stall("Stall", kind=TACK))
    assert not is_horse_stall(stall("Early Move-In Pass", code="early_move_in"))


def test_a_line_not_priced_per_stall_sells_no_stall():
    assert stall_kind_of(stall("Tack room", unit="per_night")) is None


# -- Which days a period covers ----------------------------------------------

def test_an_evening_move_in_does_not_cover_that_days_classes():
    assert period_days(GAMES) == (SAT, MON)
    assert not covers(GAMES, FRI)


def test_the_move_out_day_is_covered():
    """The pleasure stall is held until an hour after your last class Friday."""
    assert covers(PLEASURE, FRI)
    assert not covers(PLEASURE, SAT)


def test_a_morning_move_in_or_one_with_no_hour_covers_its_day():
    assert covers(period("One day", SAT, SAT, move_in_time=time(6, 0)), SAT)
    assert covers(period("One day", SAT, SAT), SAT)


def test_no_period_is_the_whole_show():
    assert covers(None, MON)


# -- A stall for every horse ---------------------------------------------------

def test_one_whole_show_stall_per_horse_is_enough():
    box = stall()
    assert checks([box], {box.id: 2}, horses(Buddy=[THU, SAT], Rio=[SAT]), periods=()) == []


def test_two_horses_on_one_stall_are_flagged_once_for_the_days_they_share():
    box = stall()
    found = checks([box], {box.id: 1}, horses(Buddy=[SAT, SUN], Rio=[SAT, SUN]), periods=())
    assert found == [
        {"code": HORSE_STALLS_SHORT, "dates": [SAT, SUN], "horses": ["Buddy", "Rio"], "stalls": 1}
    ]


def test_a_pleasure_stall_does_not_cover_a_saturday_class():
    pleasure = stall("Box stall - Pleasure", period=PLEASURE)
    found = checks([pleasure], {pleasure.id: 1}, horses(Buddy=[THU, SAT]))
    assert [c["dates"] for c in found] == [[SAT]]


def test_a_pleasure_stall_and_a_games_stall_cover_one_horse_each_side():
    pleasure = stall("Box stall - Pleasure", period=PLEASURE)
    games = stall("Box stall - Games", period=GAMES)
    booked = {pleasure.id: 1, games.id: 1}
    assert checks([pleasure, games], booked, horses(Buddy=[THU, FRI], Rio=[SAT, MON])) == []


def test_the_games_stall_does_not_stand_a_second_horse_on_friday():
    """It opens at 9 PM, after the pleasure classes."""
    pleasure = stall("Box stall - Pleasure", period=PLEASURE)
    games = stall("Box stall - Games", period=GAMES)
    found = checks(
        [pleasure, games], {pleasure.id: 1, games.id: 1}, horses(Buddy=[FRI], Rio=[FRI])
    )
    assert found[0]["dates"] == [FRI] and found[0]["stalls"] == 1


def test_a_tack_stall_or_a_pass_covers_no_horse():
    box = stall()
    tack = stall("Tack stall")
    pass_ = stall("Early Move-In Pass", code="early_move_in")
    booked = {box.id: 1, tack.id: 1, pass_.id: 1}
    found = checks([box, tack, pass_], booked, horses(Buddy=[SAT], Rio=[SAT]), periods=())
    assert found[0]["stalls"] == 1


def test_nothing_is_checked_unless_the_office_asked_for_a_stall_per_horse():
    box = stall()
    assert checks([box], {}, horses(Buddy=[SAT]), required=False) == []


def test_nothing_is_checked_at_a_show_selling_no_horse_stall():
    tack = stall("Tack stall")
    assert checks([tack], {}, horses(Buddy=[SAT])) == []


def test_a_horse_with_no_classes_needs_no_stall():
    box = stall()
    assert checks([box], {}, {}) == []


# -- Horses per tack stall ------------------------------------------------------

def test_a_games_tack_stall_needs_its_horses_in_the_games_period():
    games_box = stall("Box stall - Games", period=GAMES)
    full_box = stall("Box stall - Full", period=FULL)
    games_tack = stall("Tack stall - Games", period=GAMES, kind=TACK, per_tack=4)
    booked = {games_box.id: 2, full_box.id: 2, games_tack.id: 1}

    found = checks([games_box, full_box, games_tack], booked, {}, required=False)

    assert found == [{
        "code": TACK_STALL_HORSES,
        "show_fee_id": games_tack.id,
        "label": "Tack stall - Games",
        "period": "Games",
        "tack_stalls": 1,
        "horses_per_tack_stall": 4,
        "horse_stalls": 2,
    }]


def test_two_tack_stalls_need_twice_the_horses():
    box = stall("Box stall - Full", period=FULL)
    tack = stall("Tack stall - Full", period=FULL, per_tack=3)
    assert checks([box, tack], {box.id: 3, tack.id: 1}, {}) == []
    assert checks([box, tack], {box.id: 5, tack.id: 2}, {})[0]["horse_stalls"] == 5


def test_a_tack_stall_with_no_minimum_is_never_flagged():
    """WSCA: no minimum for a pleasure tack stall."""
    tack = stall("Tack stall - Pleasure", period=PLEASURE)
    assert checks([tack], {tack.id: 1}, {}) == []


# -- The fee endpoint's stall fields -------------------------------------------

class _Found:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _Db:
    """Answers the one query the check makes: is this period on the show."""

    def __init__(self, on_show: bool):
        self._on_show = on_show

    async def execute(self, _stmt):
        return _Found(uuid4() if self._on_show else None)


def _check(unit="per_stall", *, label="Box stall", code="stall", kind=None, period_id=None,
           per_tack=None, on_show=True):
    return asyncio.run(
        _check_stall_fields(
            show_id=uuid4(), unit=unit, code=code, label=label, stall_kind=kind,
            stall_period_id=period_id, horses_per_tack_stall=per_tack, db=_Db(on_show),
        )
    )


def test_a_stall_line_takes_a_kind_a_period_and_a_tack_minimum():
    _check(kind=TACK, period_id=uuid4(), per_tack=4)


def test_stall_fields_on_a_camping_line_are_refused():
    with pytest.raises(HTTPException) as err:
        _check("per_night", kind=BOX)
    assert err.value.status_code == 422


def test_a_period_from_another_show_is_refused():
    with pytest.raises(HTTPException) as err:
        _check(period_id=uuid4(), on_show=False)
    assert err.value.status_code == 422


def test_a_tack_minimum_on_a_horse_stall_is_refused():
    with pytest.raises(HTTPException) as err:
        _check(kind=TIE, per_tack=4)
    assert err.value.status_code == 422


def test_an_imported_tack_stall_with_no_kind_stated_may_take_a_minimum():
    _check(label="Tack stall", per_tack=3)


def test_the_api_says_what_an_unstated_line_sells():
    fee = ShowFee(
        id=uuid4(), show_id=uuid4(), code="tack_stall", label="Tack stall", amount_cents=5500,
        unit="per_stall", sort_order=0, min_quantity=0, created_at=datetime.now(),
    )
    fee.scoped_classes = []
    assert ShowFeeOut.model_validate(fee).stall_kind == TACK
    assert ShowFeeOut.model_validate(fee).model_dump()["stall_kind"] == TACK


# -- When Early Move-In Pass holders may move in (migration 195) --------------

def test_the_pass_takes_a_move_in_day_and_an_hour():
    _check_move_in(unit="per_stall", move_in_date=date(2027, 9, 21), move_in_time=time(18, 0))
    _check_move_in(unit="per_stall", move_in_date=date(2027, 9, 21), move_in_time=None)


def test_a_move_in_hour_needs_its_day():
    with pytest.raises(HTTPException) as err:
        _check_move_in(unit="per_stall", move_in_date=None, move_in_time=time(18, 0))
    assert err.value.status_code == 422


def test_a_move_in_day_on_a_line_not_priced_per_stall_is_refused():
    with pytest.raises(HTTPException) as err:
        _check_move_in(unit="per_night", move_in_date=date(2027, 9, 21), move_in_time=None)
    assert err.value.status_code == 422


# -- ...and until when (migration 203) ------------------------------------------

def test_the_pass_window_can_end_later_that_day_or_on_a_later_one():
    day = date(2026, 9, 23)
    _check_move_in(unit="per_stall", move_in_date=day, move_in_time=time(14, 0),
                   move_in_end_date=day, move_in_end_time=time(16, 0))
    _check_move_in(unit="per_stall", move_in_date=day, move_in_time=time(18, 0),
                   move_in_end_date=date(2026, 9, 24), move_in_end_time=time(8, 0))
    _check_move_in(unit="per_stall", move_in_date=day, move_in_time=None, move_in_end_date=day)


@pytest.mark.parametrize(
    "start, start_time, end, end_time, says",
    [
        (date(2026, 9, 23), time(16, 0), date(2026, 9, 23), time(14, 0), "end after it starts"),
        (date(2026, 9, 23), time(16, 0), date(2026, 9, 23), time(16, 0), "end after it starts"),
        (date(2026, 9, 23), None, date(2026, 9, 22), None, "end after it starts"),
        (None, None, date(2026, 9, 23), None, "move in from before"),
        (date(2026, 9, 23), None, None, time(16, 0), "end time needs an end day"),
    ],
)
def test_a_pass_window_that_ends_before_it_starts_is_refused(start, start_time, end, end_time, says):
    with pytest.raises(HTTPException) as err:
        _check_move_in(unit="per_stall", move_in_date=start, move_in_time=start_time,
                       move_in_end_date=end, move_in_end_time=end_time)
    assert err.value.status_code == 422 and says in err.value.detail


# -- Early move-in passes, one per period (migration 196) ----------------------

def a_pass(period=None, *, one_each=False, code=None):
    fee = stall(
        "Early Move-In Pass", period=period,
        code=code or (f"early_move_in_{period.id.hex[:8]}" if period else "early_move_in"),
    )
    fee.one_per_exhibitor = one_each
    return fee


def test_a_period_pass_is_a_pass_and_an_add_on():
    p = a_pass(PLEASURE)
    assert is_early_move_in(p) and stall_kind_of(p) == ADD_ON
    assert not is_early_move_in(stall("Box stall"))


def test_a_pass_per_stall_is_flagged_beyond_the_stalls_of_its_period():
    pleasure_box = stall("Box stall - Pleasure", period=PLEASURE)
    games_box = stall("Box stall - Games", period=GAMES)
    p = a_pass(PLEASURE)
    booked = {pleasure_box.id: 1, games_box.id: 3, p.id: 2}
    found = checks([pleasure_box, games_box, p], booked, {}, required=False)
    assert found == [{
        "code": PASS_WITHOUT_STALL, "show_fee_id": p.id, "label": "Early Move-In Pass",
        "period": "Pleasure", "passes": 2, "stalls": 1, "one_per_exhibitor": False,
    }]
    assert checks([pleasure_box, p], {pleasure_box.id: 2, p.id: 2}, {}, required=False) == []


def test_a_tack_stall_moves_in_early_too():
    box = stall("Box stall - Pleasure", period=PLEASURE)
    tack = stall("Tack stall - Pleasure", period=PLEASURE, kind=TACK)
    p = a_pass(PLEASURE)
    assert checks([box, tack, p], {box.id: 1, tack.id: 1, p.id: 2}, {}, required=False) == []


def test_a_pass_per_exhibitor_needs_one_stall_in_its_period():
    games_box = stall("Box stall - Games", period=GAMES)
    p = a_pass(PLEASURE, one_each=True)
    found = checks([games_box, p], {games_box.id: 2, p.id: 1}, {}, required=False)
    assert [(c["code"], c["stalls"], c["one_per_exhibitor"]) for c in found] == [
        (PASS_WITHOUT_STALL, 0, True)
    ]
    pleasure_box = stall("Box stall - Pleasure", period=PLEASURE)
    assert checks([pleasure_box, p], {pleasure_box.id: 3, p.id: 1}, {}, required=False) == []


def test_the_whole_show_pass_counts_every_stall():
    box = stall("Box stall - Games", period=GAMES)
    p = a_pass()
    assert checks([box, p], {box.id: 1, p.id: 1}, {}, required=False) == []



# -- An exhibitor may not add a pass without its stall -----------------------

PERIODS = {p.id: p for p in (FULL, PLEASURE, GAMES)}


def test_an_exhibitor_cannot_book_a_period_pass_with_no_stall_in_that_period():
    games_box = stall("Box stall - Games", period=GAMES)
    p = a_pass(PLEASURE)
    refusal = pass_refusal([games_box, p], {games_box.id: 1, p.id: 1}, {}, PERIODS)
    assert refusal == {
        "code": PASS_WITHOUT_STALL,
        "message": "Early Move-In Pass needs a stall in the Pleasure period. Book the stall first.",
        "show_fee_id": str(p.id),
    }


def test_an_exhibitor_cannot_book_more_passes_than_stalls_in_the_period():
    box = stall("Box stall - Pleasure", period=PLEASURE)
    p = a_pass(PLEASURE)
    refusal = pass_refusal([box, p], {box.id: 1, p.id: 2}, {}, PERIODS)
    assert refusal["message"] == (
        "Early Move-In Pass: 2 passes for 1 stall in the Pleasure period. "
        "One pass moves one stall in early."
    )
    assert pass_refusal([box, p], {box.id: 2, p.id: 2}, {}, PERIODS) is None


def test_a_per_exhibitor_pass_is_refused_with_no_stall_and_allowed_with_one():
    box = stall("Box stall - Pleasure", period=PLEASURE)
    p = a_pass(PLEASURE, one_each=True)
    assert pass_refusal([box, p], {p.id: 1}, {}, PERIODS) is not None
    assert pass_refusal([box, p], {box.id: 1, p.id: 1}, {}, PERIODS) is None


def test_a_pass_already_on_file_does_not_refuse_saving_the_rest_of_the_booking():
    """A pass booked before the rule, or since its stall was dropped, does not
    hold up a save of the other lines; only adding more is refused."""
    box = stall("Box stall - Pleasure", period=PLEASURE)
    p = a_pass(PLEASURE)
    assert pass_refusal([box, p], {p.id: 1}, {p.id: 1}, PERIODS) is None
    assert pass_refusal([box, p], {p.id: 2}, {p.id: 1}, PERIODS) is not None


def test_only_an_add_on_is_priced_per_exhibitor():
    _check_one_per_exhibitor(
        unit="per_stall", code="early_move_in", label="Early Move-In Pass",
        stall_kind=None, one_per_exhibitor=True,
    )
    with pytest.raises(HTTPException) as err:
        _check_one_per_exhibitor(
            unit="per_stall", code="stall", label="Box stall",
            stall_kind="box", one_per_exhibitor=True,
        )
    assert err.value.status_code == 422


def test_stalls_open_with_periods_is_the_earliest_move_in():
    assert earliest_move_in([GAMES, FULL, PLEASURE]) in (FULL, PLEASURE)
    no_hour = period("Early", WED, MON)
    assert earliest_move_in([FULL, no_hour]) is no_hour
    assert earliest_move_in([]) is None


def test_stalls_open_is_the_first_move_in_and_none_without_periods():
    first = earliest_move_in([GAMES, FULL, PLEASURE])
    assert stalls_open_from([GAMES, FULL, PLEASURE]) == (first.move_in_date, first.move_in_time)
    no_hour = period("Early", WED, MON)
    assert stalls_open_from([FULL, no_hour]) == (no_hour.move_in_date, None)
    # Move-in is set only by period: removing the last one clears the day the
    # show prints as "stalls open", rather than leaving it behind.
    assert stalls_open_from([]) == (None, None)
