"""Who may call off a registration, and when.

Two rules, both easy to get wrong by one day or one column.

The **window** is the show's status plus the show company's cut-off (migration
157): an exhibitor cancels their own registration while registration is open
and until the company's chosen number of days before the show -- 0, the
default, being until it starts. The cut-off day itself is still theirs: "at
least fourteen days' notice" is met by cancelling exactly fourteen days out.

The **roster predicate** is two conditions, not one. Every screen used to ask
whether `registered_at` was set; a cancelled registration still answers yes to
that, so anybody who cancelled would have gone on reading as entered right up to
the gate.
"""
from datetime import date
from types import SimpleNamespace

from cancellations import (
    cancellation_window,
    is_cancelled,
    is_on_roster,
    may_self_cancel,
    registration_blocker,
    self_cancel_deadline,
)
from routers.my_shows import withdrawn

SHOW_START = date(2026, 6, 20)


def make_show_entry(**overrides) -> SimpleNamespace:
    defaults = dict(registered_at=date(2026, 3, 1), cancelled_at=None)
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


# ── The window ───────────────────────────────────────────────────────────────

def test_the_exhibitor_cancels_themselves_while_registration_is_open():
    assert may_self_cancel("PUBLISHED") is True


def test_the_day_before_the_show_is_still_theirs():
    """No fortnight's notice any more: somebody who could still sign up can
    still change their mind."""
    window = cancellation_window("PUBLISHED", SHOW_START, as_of=date(2026, 6, 19))

    assert window["self_service"] is True
    assert window["days_until_show"] == 1


def test_once_the_show_is_running_it_is_the_office():
    assert may_self_cancel("ACTIVE") is False
    assert may_self_cancel("COMPLETED") is False


def test_a_status_nothing_recognises_is_the_office_too():
    """Refusing is the safe direction: the office can always cancel, and an
    exhibitor wrongly allowed to has already gone."""
    assert may_self_cancel(None) is False
    assert may_self_cancel("DRAFT") is False


def test_no_cut_off_has_no_deadline_date():
    """0 is until the show starts -- a status, not a date."""
    window = cancellation_window("ACTIVE", SHOW_START, as_of=date(2026, 6, 20))

    assert window == {
        "self_service": False,
        "days_until_show": 0,
        "days_before": 0,
        "deadline": None,
    }


# ── The company's cut-off ────────────────────────────────────────────────────

def test_a_fourteen_day_cut_off_falls_two_weeks_before_the_first_day():
    assert self_cancel_deadline(SHOW_START, 14) == date(2026, 6, 6)


def test_the_cut_off_day_itself_still_belongs_to_the_exhibitor():
    """Fourteen days out *is* fourteen days' notice. The boundary is the whole
    point of the setting, so it is pinned rather than left to a comparison
    operator nobody re-reads."""
    assert may_self_cancel("PUBLISHED", SHOW_START, 14, as_of=date(2026, 6, 6)) is True


def test_the_day_after_the_cut_off_belongs_to_the_office():
    assert may_self_cancel("PUBLISHED", SHOW_START, 14, as_of=date(2026, 6, 7)) is False


def test_a_cut_off_never_opens_a_show_that_is_running():
    """The cut-off narrows the status window; it cannot widen it."""
    assert may_self_cancel("ACTIVE", SHOW_START, 14, as_of=date(2026, 5, 1)) is False


def test_a_cut_off_with_no_start_date_is_the_office():
    """Nothing to count back from, so refuse: the office can always cancel."""
    assert may_self_cancel("PUBLISHED", None, 14, as_of=date(2026, 5, 1)) is False


def test_the_window_payload_names_the_cut_off_and_its_day():
    window = cancellation_window("PUBLISHED", SHOW_START, 14, as_of=date(2026, 6, 10))

    assert window["self_service"] is False
    assert window["days_before"] == 14
    assert window["deadline"] == date(2026, 6, 6)
    assert window["days_until_show"] == 10


# ── My Shows forgets a cancelled registration ────────────────────────────────

def test_a_cancelled_registration_drops_off_my_shows():
    assert withdrawn(make_show_entry(cancelled_at=date(2026, 5, 1)), []) is True


def test_a_live_registration_stays_on_my_shows():
    assert withdrawn(make_show_entry(), []) is False


def test_an_office_entry_only_show_stays_on_my_shows():
    """No sign-up row at all: a secretary entered them by hand, and that is a
    show they competed in."""
    assert withdrawn(None, [object()]) is False


def test_a_cancelled_registration_the_office_entered_again_stays():
    """Cancelling drops every class entry, so an entry here was put back by
    the show office afterwards -- somebody competing, whose show must not
    vanish from their list."""
    entry = make_show_entry(cancelled_at=date(2026, 5, 1))

    assert withdrawn(entry, [object()]) is False


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


# ── What stops a registration being taken apart ──────────────────────────────
#
# Cancelling and removing share one rule and differ in one fact. A cancellation
# keeps the row, so the payments on it survive; a removal deletes the row, and
# the payments would go with it.

def _blocker(**overrides):
    facts = dict(paid_out=False, in_settled_pot=False, competed=False, has_payments=False)
    facts.update(overrides)
    return registration_blocker(**facts)


def test_a_registration_with_nothing_on_it_can_be_removed():
    """Including one the exhibitor made themselves — signing up is no longer a
    reason the office cannot take somebody off the show."""
    assert _blocker() is None


def test_payments_stop_a_removal_and_point_at_the_cancel():
    blocked = _blocker(has_payments=True)
    assert blocked.code == "PAYMENTS_RECORDED"
    assert "Cancel it instead" in blocked.message


def test_payments_are_no_reason_to_refuse_a_cancellation():
    """The cancel never passes `has_payments`: keeping the money on the account
    is what a cancellation is for."""
    assert registration_blocker(paid_out=False, in_settled_pot=False, competed=False) is None


def test_a_placing_stops_both():
    assert _blocker(competed=True).code == "RESULTS_RECORDED"


def test_a_settled_pot_stops_both_even_without_a_payout():
    """Settling is irreversible. Taking an entry out of a settled pot would
    change a pool whose payouts are already written."""
    assert _blocker(in_settled_pot=True).code == "SIDE_POT_SETTLED"
    assert _blocker(paid_out=True).code == "SIDE_POT_SETTLED"


def test_competing_is_reported_ahead_of_the_payments():
    """Somebody who has been placed and has paid is told about the placing:
    cancelling would not get the office past that one either."""
    assert _blocker(competed=True, has_payments=True).code == "RESULTS_RECORDED"
