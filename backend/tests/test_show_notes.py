"""General show notes (migration 184): one for exhibitors on the public show
payload, one for the show office that never is."""
import uuid
from datetime import date

from models import Show
from routers.shows import _serialize
from schemas import ShowOut, ShowUpdate, StallPeriodIn, StallPeriodOut


def a_show(**kwargs) -> Show:
    return Show(
        id=uuid.uuid4(),
        name="Spring Fling",
        show_type_id=uuid.uuid4(),
        start_date=date(2026, 5, 15),
        end_date=date(2026, 5, 17),
        status="PUBLISHED",
        back_number_per="exhibitor",
        **kwargs,
    )


def test_the_public_notes_are_on_the_show_payload():
    payload = _serialize(a_show(public_notes="Dogs on a leash, please."))
    assert payload["public_notes"] == "Dogs on a leash, please."


def test_the_office_notes_are_never_on_the_show_payload():
    # GET /shows/{id} answers anybody, signed in or not.
    payload = _serialize(a_show(office_notes="Gate keys are with Pat."))
    assert "office_notes" not in payload
    assert "Gate keys are with Pat." not in repr(payload)


def test_the_public_schema_has_no_office_notes():
    assert "office_notes" not in ShowOut.model_fields


def test_both_notes_are_written_through_the_show_update():
    body = ShowUpdate(public_notes="Office opens at 7.", office_notes="Order ribbons.")
    assert body.model_dump(exclude_unset=True) == {
        "public_notes": "Office opens at 7.",
        "office_notes": "Order ribbons.",
    }


def test_a_note_cleared_to_whitespace_is_stored_as_none():
    body = ShowUpdate(public_notes="   \n ", office_notes="")
    assert body.model_dump(exclude_unset=True) == {"public_notes": None, "office_notes": None}


def test_a_note_keeps_its_line_breaks_but_loses_its_edges():
    body = ShowUpdate(public_notes="  Line one\nLine two  ")
    assert body.public_notes == "Line one\nLine two"


# -- Move-in notes (migration 199: by stall period) ---------------------------

def _period(**fields):
    return StallPeriodIn(
        name="Full show", move_in_date=date(2027, 9, 22), move_out_date=date(2027, 9, 27), **fields
    )


def test_move_in_notes_are_the_periods_not_the_shows():
    """Each period can have its own instructions, so the notes are sent and
    read with the period, and the show no longer carries any."""
    assert "move_in_notes" in StallPeriodOut.model_fields
    assert "move_in_notes" not in ShowOut.model_fields
    assert "move_in_notes" not in ShowUpdate.model_fields
    assert "move_in_notes" not in _serialize(a_show())


def test_period_move_in_notes_cleared_to_whitespace_are_stored_as_none():
    assert _period(move_in_notes="  \n ").move_in_notes is None


def test_period_move_in_notes_keep_their_line_breaks_but_lose_their_edges():
    assert _period(move_in_notes="  Line one\nLine two  ").move_in_notes == "Line one\nLine two"
