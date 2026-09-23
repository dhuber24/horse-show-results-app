"""Folding two exhibitor records into one.

Most of `exhibitor_merge` is a move -- fourteen columns across twelve tables
repointed at the record that is staying -- and moves are dull. What is not dull
is the handful of places where both records hold an answer and only one can
survive, because getting one of those wrong is how a merge takes somebody off
the roster, reprices their stalls, or writes a blank over a detail they gave the
office months ago.

Those three decisions are pure functions for exactly this reason, and this is
where they are pinned. The SQL around them is not tested here: the repo's tests
run without a database on purpose (see `tests/factories.py`), and a fake session
that agreed with itself about a `UPDATE ... WHERE` would be testing the fake.
"""
from datetime import date, datetime, timezone
from types import SimpleNamespace

from exhibitor_merge import (
    adopt_standing,
    fill_profile_blanks,
    is_live,
    merge_reservation,
    normalize_email,
    normalize_name,
)

SIGNED_UP = datetime(2026, 4, 2, tzinfo=timezone.utc)
SIGNED_UP_LATER = datetime(2026, 6, 11, tzinfo=timezone.utc)
CANCELLED = datetime(2026, 5, 1, tzinfo=timezone.utc)


def make_roster_row(**overrides) -> SimpleNamespace:
    """A `show_entries` row, defaulted to a live sign-up holding no number."""
    defaults = dict(
        registered_at=SIGNED_UP,
        cancelled_at=None,
        cancelled_by_user_id=None,
        cancellation_reason=None,
        back_number=None,
        preferred_back_number=None,
        arrival_date=None,
        departure_date=None,
        registration_notes=None,
        stall_request=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def make_reservation(**overrides) -> SimpleNamespace:
    defaults = dict(quantity=0, reserved_at=date(2026, 5, 1))
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def make_profile(**overrides) -> SimpleNamespace:
    defaults = dict(
        email=None,
        phone=None,
        address=None,
        city=None,
        state=None,
        zip=None,
        date_of_birth=None,
        emergency_contact_name=None,
        emergency_contact_phone=None,
        parent_guardian_name=None,
        parent_guardian_phone=None,
        apha_member_number=None,
        apha_member_expiry=None,
        amateur_card_number=None,
        amateur_card_expiry=None,
        amateur_novice_codes=None,
        created_by_user_id=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


# ── Normalising ──────────────────────────────────────────────────────────────

def test_a_name_is_matched_on_its_words_not_its_spacing():
    assert normalize_name("  Sarah   Johnson ") == normalize_name("Sarah Johnson")


def test_an_email_is_matched_without_case_or_stray_space():
    assert normalize_email("  Sarah@Example.COM ") == "sarah@example.com"


def test_nothing_normalises_to_something():
    assert normalize_name(None) == ""
    assert normalize_email(None) == ""


# ── Which roster row's standing survives ─────────────────────────────────────

def test_on_the_roster_is_signed_up_and_not_cancelled():
    assert is_live(make_roster_row()) is True
    assert is_live(make_roster_row(registered_at=None)) is False
    assert is_live(make_roster_row(cancelled_at=CANCELLED)) is False


def test_a_live_signup_beats_a_shell_row_the_office_opened():
    # The office row is the survivor -- it carries the back number and the
    # entries -- but it was never a sign-up, and the person did sign up.
    keep = make_roster_row(registered_at=None, back_number=42)
    remove = make_roster_row(registered_at=SIGNED_UP)
    adopt_standing(keep, remove)
    assert keep.registered_at == SIGNED_UP
    assert is_live(keep)


def test_a_live_signup_beats_a_cancelled_one():
    """Cancelled under the old record, signed up again under the new one. They
    are entered, and a merge must not be what takes them off the stall chart."""
    keep = make_roster_row(registered_at=SIGNED_UP, cancelled_at=CANCELLED,
                           cancellation_reason="Truck broke down")
    remove = make_roster_row(registered_at=SIGNED_UP_LATER)
    adopt_standing(keep, remove)
    assert keep.cancelled_at is None
    assert keep.cancellation_reason is None
    assert keep.registered_at == SIGNED_UP_LATER


def test_a_cancellation_survives_when_neither_row_is_live():
    # Nobody re-entered. Clearing the marker here would report somebody as
    # entered who is not.
    keep = make_roster_row(registered_at=SIGNED_UP, cancelled_at=CANCELLED)
    remove = make_roster_row(registered_at=None)
    adopt_standing(keep, remove)
    assert keep.cancelled_at == CANCELLED


def test_a_live_survivor_is_left_alone_by_a_cancelled_record():
    keep = make_roster_row(registered_at=SIGNED_UP)
    remove = make_roster_row(registered_at=SIGNED_UP_LATER, cancelled_at=CANCELLED)
    adopt_standing(keep, remove)
    assert keep.registered_at == SIGNED_UP
    assert keep.cancelled_at is None


def test_a_back_number_is_adopted_only_where_the_survivor_has_none():
    keep = make_roster_row(back_number=None)
    adopt_standing(keep, make_roster_row(back_number=87))
    assert keep.back_number == 87


def test_the_survivors_own_back_number_is_never_overruled():
    """Both rows carry a number, so the office is looking at both and has picked
    which record to keep. The number on the person's back is the one it issued."""
    keep = make_roster_row(back_number=42)
    adopt_standing(keep, make_roster_row(back_number=87))
    assert keep.back_number == 42


def test_a_requested_number_comes_across_too():
    keep = make_roster_row(back_number=42, preferred_back_number=None)
    adopt_standing(keep, make_roster_row(back_number=87, preferred_back_number=7))
    assert keep.preferred_back_number == 7


def test_the_stall_request_and_arrival_fill_blanks_only():
    keep = make_roster_row(stall_request=None, registration_notes="Arriving late")
    remove = make_roster_row(stall_request="Next to the Smith barn",
                             registration_notes="Ignore me")
    adopt_standing(keep, remove)
    assert keep.stall_request == "Next to the Smith barn"
    assert keep.registration_notes == "Arriving late"


# ── Two bookings of one fee ──────────────────────────────────────────────────

def test_booked_quantities_are_added_rather_than_chosen_between():
    # Four stalls under one record and two under the other is six stalls, not
    # four and not two -- either way round somebody arrives to find they have
    # fewer than the show set aside for them.
    held = make_reservation(quantity=4)
    merge_reservation(held, make_reservation(quantity=2))
    assert held.quantity == 6


def test_the_earlier_booking_date_survives():
    """`reserved_at` picks between a fee's early rate and its standard one.
    Repricing an April booking at a July date is the one thing an early rate
    exists to promise against."""
    held = make_reservation(quantity=1, reserved_at=date(2026, 7, 1))
    merge_reservation(held, make_reservation(quantity=1, reserved_at=date(2026, 4, 3)))
    assert held.reserved_at == date(2026, 4, 3)


def test_a_later_booking_date_does_not_push_the_rate_forward():
    held = make_reservation(quantity=1, reserved_at=date(2026, 4, 3))
    merge_reservation(held, make_reservation(quantity=1, reserved_at=date(2026, 7, 1)))
    assert held.reserved_at == date(2026, 4, 3)


# ── The profile ──────────────────────────────────────────────────────────────

def test_the_office_details_fill_the_new_accounts_blanks():
    # The whole reason a merge is worth more than a delete: the phone number
    # the office took at the counter in April is still the one to ring.
    keep = make_profile()
    remove = make_profile(phone="555-0101", emergency_contact_name="Dale Johnson")
    filled = fill_profile_blanks(keep, remove)
    assert keep.phone == "555-0101"
    assert keep.emergency_contact_name == "Dale Johnson"
    assert set(filled) == {"phone", "emergency_contact_name"}


def test_an_answer_the_survivor_already_has_is_never_overwritten():
    """The record somebody chose to keep is the one whose details they were
    looking at when they chose it."""
    keep = make_profile(phone="555-0199")
    fill_profile_blanks(keep, make_profile(phone="555-0101"))
    assert keep.phone == "555-0199"


def test_an_empty_string_counts_as_a_blank_to_fill():
    # A form that posts "" for an untouched box is how these rows get written.
    keep = make_profile(city="")
    fill_profile_blanks(keep, make_profile(city="Rochester"))
    assert keep.city == "Rochester"


def test_an_empty_string_is_never_what_gets_carried_across():
    keep = make_profile(city=None)
    assert fill_profile_blanks(keep, make_profile(city="")) == []
    assert keep.city is None


def test_the_staff_member_who_typed_the_office_record_in_is_kept():
    """`created_by_user_id` is how an office record is told apart from the
    accountless seed data the name pickers exclude. Losing it on a merge would
    drop the person out of every picker at the next show."""
    keep = make_profile(created_by_user_id=None)
    fill_profile_blanks(keep, make_profile(created_by_user_id="staff-uuid"))
    assert keep.created_by_user_id == "staff-uuid"
