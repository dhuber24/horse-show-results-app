"""What the live screens' marquee carries, and what the office may set it to.

Both rules here fail quietly rather than loudly. A newline stored in a marquee
message renders as nothing -- the line just runs together wrong on a TV nobody
is standing next to. And a message mode with no message scrolls an empty band,
which reads to a lobby as the board having broken.
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routers.show_marquee import (
    MAX_MESSAGE_CHARS,
    marquee_payload,
    normalize_message,
    validate_update,
)


def row(mode: str, message: str | None) -> SimpleNamespace:
    return SimpleNamespace(mode=mode, message=message, updated_at=None)


# ── A marquee is one line ────────────────────────────────────────────────────

def test_line_breaks_and_runs_of_spaces_collapse_to_one_line():
    typed = "Class 22 has moved\nto Ring 2.\n\n   Lunch   until 1:00."
    assert normalize_message(typed) == "Class 22 has moved to Ring 2. Lunch until 1:00."


@pytest.mark.parametrize("typed", [None, "", "   ", "\n\t \n"])
def test_nothing_typed_is_no_message_rather_than_a_blank_one(typed):
    assert normalize_message(typed) is None


# ── What the board runs ─────────────────────────────────────────────────────

def test_a_show_that_never_set_a_marquee_scrolls_the_results():
    """No row is what every show had before migration 139."""
    payload = marquee_payload(None)
    assert payload["mode"] == "results"
    assert payload["effective_mode"] == "results"
    assert payload["message"] is None


@pytest.mark.parametrize("mode", ["message", "both"])
def test_a_message_mode_with_a_message_runs_as_chosen(mode):
    payload = marquee_payload(row(mode, "Full results are in the GaitDesk app"))
    assert payload["effective_mode"] == mode


@pytest.mark.parametrize("mode", ["message", "both"])
def test_a_message_mode_with_nothing_to_say_falls_back_to_the_results(mode):
    """The PUT refuses to create this, but the board must never scroll a blank band."""
    payload = marquee_payload(row(mode, None))
    assert payload["mode"] == mode
    assert payload["effective_mode"] == "results"


def test_going_back_to_the_results_keeps_the_message_for_next_time():
    payload = marquee_payload(row("results", "Lunch until 1:00"))
    assert payload["effective_mode"] == "results"
    assert payload["message"] == "Lunch until 1:00"


# ── What the office may set ─────────────────────────────────────────────────

@pytest.mark.parametrize("mode", ["message", "both"])
def test_choosing_the_message_with_nothing_typed_is_refused(mode):
    with pytest.raises(HTTPException) as refused:
        validate_update(mode, None)
    assert refused.value.status_code == 422


def test_the_results_need_no_message():
    validate_update("results", None)


def test_a_message_at_the_limit_is_accepted_and_one_over_is_refused():
    validate_update("message", "x" * MAX_MESSAGE_CHARS)
    with pytest.raises(HTTPException) as refused:
        validate_update("message", "x" * (MAX_MESSAGE_CHARS + 1))
    assert refused.value.status_code == 422
    assert str(MAX_MESSAGE_CHARS) in refused.value.detail
