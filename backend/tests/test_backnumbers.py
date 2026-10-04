"""Which number goes on the exhibitor's back.

A back number lives on `show_entries.back_number` -- or, at a show that numbers
horses (migration 161), on `show_horse_numbers`. `entries.back_number` is a
legacy per-entry column that nothing writes any more, so it is NULL on every
recent entry — reading it directly produces a silent column of dashes rather
than an error, which is how it went unnoticed on four screens at once. These
tests pin the precedence that `backnumbers.py` exists to enforce.
"""
from uuid import uuid4

from backnumbers import ShowBackNumbers, resolve_back_number, sort_key
from tests.factories import make_entry


def _per_exhibitor(by_exhibitor: dict) -> ShowBackNumbers:
    return ShowBackNumbers(per_horse=False, by_exhibitor=by_exhibitor)


def test_the_show_level_number_wins_over_the_legacy_column():
    """Both set and disagreeing is the case that matters: the show-level number
    is the one the office issued and the one on the horse."""
    exhibitor_id = uuid4()
    entry = make_entry(exhibitor_id=exhibitor_id, back_number=7)

    assert resolve_back_number(entry, _per_exhibitor({exhibitor_id: 42})) == 42


def test_the_show_level_number_is_used_when_the_legacy_column_is_null():
    """The ordinary modern case — every entry created since assignment moved to
    `show_entries`."""
    exhibitor_id = uuid4()
    entry = make_entry(exhibitor_id=exhibitor_id, back_number=None)

    assert resolve_back_number(entry, _per_exhibitor({exhibitor_id: 42})) == 42


def test_the_legacy_column_still_answers_for_an_old_entry():
    """An exhibitor absent from the map has no show-level number, so a row that
    predates the move keeps rendering."""
    entry = make_entry(exhibitor_id=uuid4(), back_number=7)

    assert resolve_back_number(entry, _per_exhibitor({})) == 7


def test_no_number_anywhere_resolves_to_none():
    entry = make_entry(exhibitor_id=uuid4(), back_number=None)

    assert resolve_back_number(entry, _per_exhibitor({})) is None


def test_another_exhibitors_number_is_never_borrowed():
    entry = make_entry(exhibitor_id=uuid4(), back_number=None)

    assert resolve_back_number(entry, _per_exhibitor({uuid4(): 42})) is None


def test_unassigned_sorts_after_every_assigned_number():
    assert sorted([None, 42, 1, None, 7], key=sort_key) == [1, 7, 42, None, None]


def test_the_lowest_free_number_fills_the_first_gap():
    """What a sign-up with no requested number is given: the first number
    nothing holds, not one past the highest."""
    from backnumbers import lowest_free_number

    assert lowest_free_number(set()) == 1
    assert lowest_free_number({1, 2, 3}) == 4
    assert lowest_free_number({1, 3, 24}) == 2


# -- A show that numbers horses (migration 161) --------------------------------


def _per_horse(by_horse: dict, horses_by_exhibitor: dict | None = None) -> ShowBackNumbers:
    return ShowBackNumbers(
        per_horse=True, by_horse=by_horse, horses_by_exhibitor=horses_by_exhibitor or {}
    )


def test_a_horse_numbered_show_reads_the_horses_number():
    """The exhibitor's own number, if a stale one survives from before the show
    was switched, is not what they wear on this horse."""
    exhibitor_id, horse_id = uuid4(), uuid4()
    entry = make_entry(exhibitor_id=exhibitor_id, horse_id=horse_id)
    numbers = _per_horse({horse_id: 112})
    numbers.by_exhibitor = {exhibitor_id: 7}

    assert resolve_back_number(entry, numbers) == 112


def test_one_exhibitor_wears_a_number_per_horse():
    exhibitor_id, dandy, pistol = uuid4(), uuid4(), uuid4()
    numbers = _per_horse({dandy: 113, pistol: 112}, {exhibitor_id: {dandy, pistol}})

    assert numbers.resolve(exhibitor_id, dandy) == 113
    assert numbers.resolve(exhibitor_id, pistol) == 112
    assert numbers.for_exhibitor(exhibitor_id) == [112, 113]
    assert numbers.first_for_exhibitor(exhibitor_id) == 112
    assert numbers.label_for_exhibitor(exhibitor_id) == "112, 113"


def test_two_exhibitors_on_one_horse_wear_the_same_number():
    """APHA SC-160.D numbers the horse: the youth and the amateur who both show
    it wear its number."""
    youth, amateur, horse_id = uuid4(), uuid4(), uuid4()
    numbers = _per_horse({horse_id: 40}, {youth: {horse_id}, amateur: {horse_id}})

    assert numbers.resolve(youth, horse_id) == numbers.resolve(amateur, horse_id) == 40


def test_an_unnumbered_horse_resolves_to_none_not_its_riders_other_number():
    exhibitor_id, numbered, unnumbered = uuid4(), uuid4(), uuid4()
    numbers = _per_horse({numbered: 5}, {exhibitor_id: {numbered, unnumbered}})

    assert numbers.resolve(exhibitor_id, unnumbered) is None
    assert numbers.for_exhibitor(exhibitor_id) == [5]


def test_an_entry_with_no_horse_has_no_number_at_a_horse_numbered_show():
    """Deleting a horse nulls `entries.horse_id`; the entry survives with
    nothing to wear rather than borrowing somebody's number."""
    entry = make_entry(exhibitor_id=uuid4(), horse_id=None)

    assert resolve_back_number(entry, _per_horse({uuid4(): 9})) is None


def test_an_exhibitor_with_no_horses_entered_wears_nothing_yet():
    numbers = _per_horse({uuid4(): 1})

    assert numbers.for_exhibitor(uuid4()) == []
    assert numbers.first_for_exhibitor(uuid4()) is None
    assert numbers.label_for_exhibitor(uuid4()) is None


def test_an_exhibitor_numbered_show_reports_at_most_one_number():
    exhibitor_id = uuid4()
    numbers = _per_exhibitor({exhibitor_id: 42})

    assert numbers.for_exhibitor(exhibitor_id) == [42]
    assert numbers.label_for_exhibitor(exhibitor_id) == "42"
    assert numbers.for_exhibitor(uuid4()) == []
