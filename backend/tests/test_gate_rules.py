"""The in-gate's rules (`backend/gate_rules.py`).

What the steward was asked for, pinned:

* a no-show counts as accounted for, so one rider who never came no longer
  holds a class at pending for good;
* ready is worked out from the riders, so a rider added late puts a ready
  class back to pending, and a scratch can make one ready;
* riders may be checked in for any class not yet started, but only the ring's
  next class may start -- the gate cannot change the order;
* starting a class finishes the classes in the ring ahead of it, unless it is
  run alongside them, and the next ordinary start finishes the whole group.
"""
from datetime import date
from types import SimpleNamespace
from uuid import uuid4

from gate_rules import (
    Tally,
    check_in_refusal,
    closed_by_start,
    gate_status,
    is_ready,
    lane,
    nothing_to_run,
    on_deck,
    reset_refusal,
    tally,
    transition_refusal,
)

DAY = date(2026, 10, 10)
MAIN = uuid4()
PEN = uuid4()

READY = Tally(entries=3, checked_in=3)
EMPTY = Tally()


def make_class(number: str, gate_status: str = "pending", ring=MAIN, day=DAY):
    return SimpleNamespace(
        id=uuid4(),
        class_number=number,
        class_name=f"Class {number}",
        class_date=day,
        ring_id=ring,
        gate_status=gate_status,
    )


def make_entry(checked_in=False, no_show=False, status="ENTERED"):
    return SimpleNamespace(gate_checked_in=checked_in, gate_no_show=no_show, status=status)


# ── Ready ─────────────────────────────────────────────────────────────────────


def test_a_no_show_counts_as_accounted_for():
    t = tally([make_entry(checked_in=True), make_entry(no_show=True)])
    assert t == Tally(entries=2, checked_in=1, no_show=1)
    assert is_ready(t)


def test_a_rider_still_to_check_in_holds_the_class():
    assert not is_ready(tally([make_entry(checked_in=True), make_entry()]))


def test_a_scratch_is_not_a_rider():
    # The office scratched the one rider who had not checked in: the class is
    # ready without the steward touching it.
    t = tally([make_entry(checked_in=True), make_entry(status="WITHDRAWN")])
    assert t.entries == 1
    assert is_ready(t)


def test_a_rider_added_to_a_ready_class_puts_it_back_to_pending():
    riders = [make_entry(checked_in=True), make_entry(checked_in=True)]
    assert gate_status("pending", tally(riders)) == "ready"
    riders.append(make_entry())
    assert gate_status("pending", tally(riders)) == "pending"


def test_a_stored_ready_is_read_off_the_riders_too():
    # Older rows stored `ready`; a rider added since must still count.
    assert gate_status("ready", Tally(entries=2, checked_in=1)) == "pending"


def test_a_started_class_keeps_its_status_whoever_is_added():
    assert gate_status("in_progress", Tally(entries=4, checked_in=3)) == "in_progress"
    assert gate_status("done", EMPTY) == "done"


def test_a_class_of_no_shows_has_nobody_to_ride_it():
    t = Tally(entries=2, no_show=2)
    assert nothing_to_run(t)
    assert not is_ready(t)
    assert nothing_to_run(EMPTY)
    assert not nothing_to_run(READY)


def test_no_show_wins_over_a_stale_check_in():
    # The endpoint never sets both; a row that somehow has both is a no-show.
    assert tally([make_entry(checked_in=True, no_show=True)]) == Tally(entries=1, no_show=1)


# ── Check-in ──────────────────────────────────────────────────────────────────


def test_check_in_is_open_for_any_class_not_yet_started():
    assert check_in_refusal(make_class("14", "pending")) is None
    assert check_in_refusal(make_class("14", "ready")) is None


def test_check_in_closes_once_the_class_is_in_the_ring():
    assert check_in_refusal(make_class("12", "in_progress"))
    assert check_in_refusal(make_class("12", "done"))


def test_clearing_check_ins_is_for_a_class_not_yet_started():
    assert reset_refusal(make_class("12", "pending")) is None
    assert reset_refusal(make_class("12", "in_progress"))


# ── Lanes ─────────────────────────────────────────────────────────────────────


def test_a_lane_is_one_ring_on_one_day_in_the_order_given():
    a, b = make_class("1"), make_class("2")
    other_ring = make_class("3", ring=PEN)
    other_day = make_class("4", day=date(2026, 10, 11))
    assert lane([a, other_ring, b, other_day], a) == [a, b]


def test_on_deck_is_the_first_class_not_yet_started():
    done, running, deck, later = (
        make_class("10", "done"),
        make_class("11", "in_progress"),
        make_class("12"),
        make_class("13", "ready"),
    )
    assert on_deck([done, running, deck, later]) is deck
    assert on_deck([done]) is None


# ── Starting ──────────────────────────────────────────────────────────────────


def test_the_on_deck_class_starts_once_ready():
    running, deck = make_class("11", "in_progress"), make_class("12")
    assert transition_refusal(deck, "in_progress", [running, deck], READY) is None


def test_a_later_class_cannot_start_ahead_of_the_one_on_deck_even_ready():
    deck, later = make_class("12"), make_class("13")
    refusal = transition_refusal(later, "in_progress", [deck, later], READY)
    assert refusal and "#12" in refusal


def test_a_class_with_riders_still_to_check_in_cannot_start():
    deck = make_class("12")
    assert transition_refusal(deck, "in_progress", [deck], Tally(entries=3, checked_in=2))


def test_a_class_with_nobody_to_ride_is_skipped_not_started():
    deck = make_class("12")
    refusal = transition_refusal(deck, "in_progress", [deck], Tally(entries=2, no_show=2))
    assert refusal and "Skip" in refusal


def test_starting_closes_the_class_in_the_ring_ahead():
    done, running, deck = make_class("10", "done"), make_class("11", "in_progress"), make_class("12")
    assert closed_by_start(deck, [done, running, deck], concurrent=False) == [running]


def test_a_concurrent_start_leaves_the_ring_running():
    running, deck = make_class("11", "in_progress"), make_class("12")
    assert transition_refusal(deck, "in_progress", [running, deck], READY, concurrent=True) is None
    assert closed_by_start(deck, [running, deck], concurrent=True) == []


def test_the_next_ordinary_start_closes_the_whole_group():
    a, b, c = make_class("11", "in_progress"), make_class("12", "in_progress"), make_class("13", "in_progress")
    deck = make_class("14")
    assert closed_by_start(deck, [a, b, c, deck], concurrent=False) == [a, b, c]


def test_a_concurrent_start_needs_something_in_the_ring():
    done, deck = make_class("11", "done"), make_class("12")
    assert transition_refusal(deck, "in_progress", [done, deck], READY, concurrent=True)


def test_a_start_never_reaches_into_another_ring():
    running_main = make_class("11", "in_progress")
    running_pen = make_class("50", "in_progress", ring=PEN)
    deck = make_class("12")
    classes = [running_main, running_pen, deck]
    assert closed_by_start(deck, lane(classes, deck), concurrent=False) == [running_main]


# ── Finishing, skipping, undoing ──────────────────────────────────────────────


def test_a_running_class_can_always_be_marked_done():
    running, later = make_class("12", "in_progress"), make_class("13")
    assert transition_refusal(running, "done", [running, later], READY) is None


def test_an_empty_class_on_deck_can_be_skipped():
    deck = make_class("12")
    assert transition_refusal(deck, "done", [deck], EMPTY) is None
    assert transition_refusal(deck, "done", [deck], Tally(entries=1, no_show=1)) is None


def test_a_class_further_down_the_day_cannot_be_skipped_early():
    # Skipping marks it completed, which would shut out a late entry.
    deck, later = make_class("12"), make_class("13")
    assert transition_refusal(later, "done", [deck, later], EMPTY)


def test_a_class_with_riders_checked_in_is_not_skipped():
    deck = make_class("12")
    assert transition_refusal(deck, "done", [deck], Tally(entries=2, checked_in=1, no_show=1))


def test_undoing_a_start_puts_the_class_back():
    running, deck = make_class("12", "in_progress"), make_class("13")
    assert transition_refusal(running, "pending", [running, deck], READY) is None


def test_a_start_cannot_be_undone_once_a_later_class_has_started():
    first, second = make_class("12", "in_progress"), make_class("13", "in_progress")
    assert transition_refusal(first, "pending", [first, second], READY)
    assert transition_refusal(second, "pending", [first, second], READY) is None


def test_a_finished_class_is_reopened_not_put_back_to_waiting():
    done = make_class("12", "done")
    assert transition_refusal(done, "pending", [done], READY)


def test_a_class_closed_by_a_start_can_be_reopened_to_run_alongside_it():
    # The steward meant "run with" and tapped "start": reopening the class
    # that start closed runs the two together.
    closed, running = make_class("12", "done"), make_class("13", "in_progress")
    assert transition_refusal(closed, "in_progress", [closed, running], EMPTY) is None


def test_a_class_cannot_be_reopened_once_a_later_class_has_finished():
    early, later, running = make_class("10", "done"), make_class("11", "done"), make_class("12", "in_progress")
    refusal = transition_refusal(early, "in_progress", [early, later, running], EMPTY)
    assert refusal and "#11" in refusal
