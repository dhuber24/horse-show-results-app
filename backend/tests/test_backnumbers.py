"""Which number goes on the exhibitor's back.

A back number lives on `show_entries.back_number`. `entries.back_number` is a
legacy per-entry column that nothing writes any more, so it is NULL on every
recent entry — reading it directly produces a silent column of dashes rather
than an error, which is how it went unnoticed on four screens at once. These
tests pin the precedence that `backnumbers.py` exists to enforce.
"""
from uuid import uuid4

from backnumbers import resolve_back_number, sort_key
from tests.factories import make_entry


def test_the_show_level_number_wins_over_the_legacy_column():
    """Both set and disagreeing is the case that matters: the show-level number
    is the one the office issued and the one on the horse."""
    exhibitor_id = uuid4()
    entry = make_entry(exhibitor_id=exhibitor_id, back_number=7)

    assert resolve_back_number(entry, {exhibitor_id: 42}) == 42


def test_the_show_level_number_is_used_when_the_legacy_column_is_null():
    """The ordinary modern case — every entry created since assignment moved to
    `show_entries`."""
    exhibitor_id = uuid4()
    entry = make_entry(exhibitor_id=exhibitor_id, back_number=None)

    assert resolve_back_number(entry, {exhibitor_id: 42}) == 42


def test_the_legacy_column_still_answers_for_an_old_entry():
    """An exhibitor absent from the map has no show-level number, so a row that
    predates the move keeps rendering."""
    entry = make_entry(exhibitor_id=uuid4(), back_number=7)

    assert resolve_back_number(entry, {}) == 7


def test_no_number_anywhere_resolves_to_none():
    entry = make_entry(exhibitor_id=uuid4(), back_number=None)

    assert resolve_back_number(entry, {}) is None


def test_another_exhibitors_number_is_never_borrowed():
    entry = make_entry(exhibitor_id=uuid4(), back_number=None)

    assert resolve_back_number(entry, {uuid4(): 42}) is None


def test_unassigned_sorts_after_every_assigned_number():
    assert sorted([None, 42, 1, None, 7], key=sort_key) == [1, 7, 42, None, None]
