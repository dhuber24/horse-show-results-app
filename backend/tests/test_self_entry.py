"""An exhibitor signing up, and entering and scratching their own classes.

The class doors stay open once a show is ACTIVE unless the show office said
otherwise, so what matters is where they close: a finished class is the show
office's alone, and a class in the ring cannot be entered from a phone. Sign-up
closes on the last day the office gave. Pure functions, pinned here without a
database.
"""
from datetime import date, datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from self_entry import (
    CLASS_START,
    SELF_ENTRY_STATUSES,
    SHOW_START,
    class_completed,
    class_entry_closed_refusal,
    class_entry_open,
    class_under_way,
    entry_refusal,
    registration_window,
    scratch_refusal,
    self_entry_statuses,
    signup_closed_refusal,
    signup_open,
    unnominated,
)

POSTED = datetime(2026, 9, 27, 15, 0, tzinfo=timezone.utc)


def make_class(gate_status="pending", results_published_at=None):
    return SimpleNamespace(
        class_number="12",
        class_name="Western Pleasure Amateur",
        gate_status=gate_status,
        results_published_at=results_published_at,
    )


# ── When the doors are open ───────────────────────────────────────────────────


def test_the_class_doors_stay_open_while_the_show_runs():
    assert SELF_ENTRY_STATUSES == {"PUBLISHED", "ACTIVE"}


@pytest.mark.parametrize("status", ["DRAFT", "COMPLETED", "CANCELLED"])
def test_nor_before_it_is_published_or_after_it_is_over(status):
    assert status not in SELF_ENTRY_STATUSES


# ── What counts as finished ──────────────────────────────────────────────────


def test_a_class_the_gate_has_finished_is_completed():
    assert class_completed(make_class(gate_status="done"))


def test_a_class_with_posted_results_is_completed_even_without_the_gate_screen():
    """Plenty of shows never run the gate screen; posting the results is the
    other way a class is known to be over."""
    assert class_completed(make_class(gate_status="pending", results_published_at=POSTED))


@pytest.mark.parametrize("gate", ["pending", "ready", "in_progress"])
def test_a_class_not_yet_finished_is_not_completed(gate):
    assert not class_completed(make_class(gate_status=gate))


def test_a_class_in_the_ring_is_under_way():
    assert class_under_way(make_class(gate_status="in_progress"))


def test_a_class_posted_while_the_gate_still_says_in_progress_is_finished_not_under_way():
    cls = make_class(gate_status="in_progress", results_published_at=POSTED)
    assert class_completed(cls)
    assert not class_under_way(cls)


# ── Entering ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("gate", ["pending", "ready"])
def test_a_class_not_yet_started_can_be_entered(gate):
    assert entry_refusal(make_class(gate_status=gate)) is None


def test_a_class_under_way_cannot_be_entered_from_a_phone():
    refusal = entry_refusal(make_class(gate_status="in_progress"))
    assert refusal["code"] == "CLASS_UNDER_WAY"
    assert "in-gate" in refusal["message"]


def test_a_class_already_run_cannot_be_entered():
    assert entry_refusal(make_class(gate_status="done"))["code"] == "CLASS_COMPLETED"
    assert entry_refusal(make_class(results_published_at=POSTED))["code"] == "CLASS_COMPLETED"


# ── Scratching ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("gate", ["pending", "ready"])
def test_a_class_not_yet_started_can_be_scratched(gate):
    assert scratch_refusal(make_class(gate_status=gate), has_result=False) is None


def test_a_class_under_way_can_still_be_scratched_before_the_horse_has_a_result():
    """A horse that has not gone yet can still be pulled; only a finished class
    is the office's alone."""
    assert scratch_refusal(make_class(gate_status="in_progress"), has_result=False) is None


def test_a_finished_class_is_the_show_offices_to_scratch():
    for cls in (make_class(gate_status="done"), make_class(results_published_at=POSTED)):
        refusal = scratch_refusal(cls, has_result=False)
        assert refusal["code"] == "CLASS_COMPLETED"
        assert "show office" in refusal["message"]


def test_a_horse_with_a_result_cannot_be_scratched_before_the_class_is_marked_finished():
    """Deleting the entry would take its placing with it."""
    refusal = scratch_refusal(make_class(gate_status="in_progress"), has_result=True)
    assert refusal["code"] == "RESULT_RECORDED"


# ── Futurity classes at a live show ──────────────────────────────────────────


def make_futurity(name, *nominations):
    return SimpleNamespace(
        name=name,
        entries=[SimpleNamespace(show_entry_id=se, horse_id=h) for se, h in nominations],
    )


def test_a_class_no_futurity_judges_needs_no_nomination():
    assert unnominated([], uuid4(), uuid4()) == []


def test_a_nominated_horse_may_enter_its_futurity_class():
    roster_row, horse = uuid4(), uuid4()
    futurity = make_futurity("Yearling Longe Line", (roster_row, horse))
    assert unnominated([futurity], roster_row, horse) == []


def test_an_unnominated_horse_is_sent_to_the_office():
    roster_row, horse = uuid4(), uuid4()
    futurity = make_futurity("Yearling Longe Line", (roster_row, uuid4()))
    assert unnominated([futurity], roster_row, horse) == [futurity]


def test_another_exhibitors_nomination_of_the_same_horse_does_not_count():
    horse = uuid4()
    futurity = make_futurity("Yearling Longe Line", (uuid4(), horse))
    assert unnominated([futurity], uuid4(), horse) == [futurity]


def test_a_nomination_in_any_one_covering_futurity_is_enough():
    roster_row, horse = uuid4(), uuid4()
    first = make_futurity("Breeders", (roster_row, uuid4()))
    second = make_futurity("Stakes", (roster_row, horse))
    assert unnominated([first, second], roster_row, horse) == []


# ── The show office's two answers (migration 159) ────────────────────────────


def test_class_changes_run_until_each_class_starts_where_the_show_says_so():
    assert class_entry_open("PUBLISHED", CLASS_START)
    assert class_entry_open("ACTIVE", CLASS_START)


def test_class_changes_stop_when_the_show_starts_where_the_show_says_so():
    assert class_entry_open("PUBLISHED", SHOW_START)
    assert not class_entry_open("ACTIVE", SHOW_START)


def test_an_unanswered_show_keeps_what_every_show_did_before_the_question():
    """Nothing already taking entries changes under anybody."""
    assert self_entry_statuses(None) == SELF_ENTRY_STATUSES
    assert class_entry_open("ACTIVE", None)


@pytest.mark.parametrize("closes", [CLASS_START, SHOW_START, None])
@pytest.mark.parametrize("status", ["DRAFT", "COMPLETED"])
def test_no_answer_opens_a_show_that_is_not_taking_entries(status, closes):
    assert not class_entry_open(status, closes)


DEADLINE = date(2026, 10, 1)


def test_sign_up_is_open_up_to_and_including_the_last_day():
    """"Entries close the 1st" takes an entry on the 1st."""
    assert signup_open("PUBLISHED", DEADLINE, as_of=date(2026, 9, 30))
    assert signup_open("PUBLISHED", DEADLINE, as_of=DEADLINE)


def test_sign_up_closes_the_day_after():
    assert not signup_open("PUBLISHED", DEADLINE, as_of=date(2026, 10, 2))


def test_an_unanswered_deadline_leaves_sign_up_open_until_the_show_starts():
    assert signup_open("PUBLISHED", None, as_of=date(2030, 1, 1))
    assert not signup_open("ACTIVE", None)


@pytest.mark.parametrize("status", ["DRAFT", "ACTIVE", "COMPLETED"])
def test_a_deadline_never_opens_sign_up_outside_published(status):
    assert not signup_open(status, DEADLINE, as_of=date(2026, 9, 1))


def make_show(status="PUBLISHED", entry_deadline=DEADLINE, self_entry_closes=SHOW_START):
    return SimpleNamespace(
        status=status, entry_deadline=entry_deadline, self_entry_closes=self_entry_closes
    )


def test_the_window_reports_both_answers_and_whether_each_is_open():
    window = registration_window(make_show(status="ACTIVE"), as_of=date(2026, 10, 3))
    assert window == {
        "signup_open": False,
        "signup_deadline": DEADLINE,
        "class_entry_open": False,
        "class_entry_closes": SHOW_START,
        "answered": True,
    }


def test_the_window_reads_an_unanswered_show_as_class_start_and_says_so():
    window = registration_window(make_show(entry_deadline=None, self_entry_closes=None))
    assert window["class_entry_closes"] == CLASS_START
    assert window["answered"] is False


def test_the_sign_up_refusal_names_the_day_and_the_way_in():
    refusal = signup_closed_refusal(make_show())
    assert refusal["code"] == "SIGNUP_CLOSED"
    assert "October 1" in refusal["message"]
    assert "show office" in refusal["message"]


def test_the_class_refusal_sends_them_to_the_office():
    refusal = class_entry_closed_refusal()
    assert refusal["code"] == "CLASS_ENTRY_CLOSED"
    assert "office" in refusal["message"]
