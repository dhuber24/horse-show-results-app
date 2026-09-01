"""Who may call off a registration, and when.

Two rules, both easy to get wrong by one day or one column.

The **window** is inclusive of the deadline itself: "at least two weeks before
the show" is met by cancelling exactly fourteen days out, and an off-by-one here
sends somebody to the show office on the last day they were entitled to press
the button themselves.

The **roster predicate** is two conditions, not one. Every screen used to ask
whether `registered_at` was set; a cancelled registration still answers yes to
that, so anybody who cancelled would have gone on reading as entered right up to
the gate.
"""
from datetime import date
from types import SimpleNamespace

from cancellations import (
    CANCELLATION_NOTICE_DAYS,
    cancellation_window,
    is_cancelled,
    is_on_roster,
    may_self_cancel,
    self_cancel_deadline,
)

SHOW_START = date(2026, 6, 20)


def make_show_entry(**overrides) -> SimpleNamespace:
    defaults = dict(registered_at=date(2026, 3, 1), cancelled_at=None)
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


# ── The window ───────────────────────────────────────────────────────────────

def test_the_deadline_is_two_weeks_before_the_first_day():
    assert self_cancel_deadline(SHOW_START) == date(2026, 6, 6)
    assert CANCELLATION_NOTICE_DAYS == 14


def test_a_month_out_the_exhibitor_cancels_themselves():
    assert may_self_cancel(SHOW_START, as_of=date(2026, 5, 20)) is True


def test_the_deadline_day_itself_still_belongs_to_the_exhibitor():
    """Fourteen days out *is* two weeks' notice. The boundary is the whole
    point of the rule, so it is pinned rather than left to a comparison
    operator nobody re-reads."""
    assert may_self_cancel(SHOW_START, as_of=date(2026, 6, 6)) is True


def test_the_day_after_the_deadline_belongs_to_the_office():
    assert may_self_cancel(SHOW_START, as_of=date(2026, 6, 7)) is False


def test_during_the_show_it_is_still_the_office():
    assert may_self_cancel(SHOW_START, as_of=date(2026, 6, 21)) is False


def test_a_show_with_no_start_date_is_the_office_too():
    """Nothing to count back from. Refusing is the safe direction: the office
    can always cancel, and an exhibitor wrongly allowed to has already gone."""
    assert self_cancel_deadline(None) is None
    assert may_self_cancel(None, as_of=date(2026, 1, 1)) is False


def test_the_window_payload_says_why_as_well_as_whether():
    window = cancellation_window(SHOW_START, as_of=date(2026, 6, 10))

    assert window["self_service"] is False
    assert window["deadline"] == date(2026, 6, 6)
    assert window["days_until_show"] == 10
    assert window["notice_days"] == 14


# ── The roster predicate ─────────────────────────────────────────────────────

def test_a_completed_sign_up_is_on_the_roster():
    assert is_on_roster(make_show_entry()) is True


def test_a_cancelled_registration_is_not_on_the_roster():
    """The regression this predicate exists for: `registered_at` is still set,
    because cancelling marks the row rather than clearing the sign-up."""
    entry = make_show_entry(cancelled_at=date(2026, 5, 1))

    assert entry.registered_at is not None
    assert is_on_roster(entry) is False
    assert is_cancelled(entry) is True


def test_the_secretarys_shell_row_is_not_a_sign_up():
    """A NULL `registered_at` is the row a secretary creates while adding a late
    entry by hand — the office has no stall numbers for that person."""
    assert is_on_roster(make_show_entry(registered_at=None)) is False


def test_no_row_at_all_is_not_on_the_roster():
    assert is_on_roster(None) is False
    assert is_cancelled(None) is False
