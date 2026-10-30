"""Which number goes on the exhibitor's back.

A back number lives on `show_entries.back_number` -- or, at a show that numbers
horses (migration 161), on `show_horse_numbers`, and at one that numbers each
exhibitor on each horse (migration 178), on `show_pair_numbers`.
`entries.back_number` is a legacy per-entry column that nothing writes any
more, so it is NULL on every recent entry — reading it directly produces a
silent column of dashes rather than an error, which is how it went unnoticed on
four screens at once. These tests pin the precedence that `backnumbers.py`
exists to enforce.
"""
from uuid import uuid4

from backnumbers import (
    HORSE_NUMBERS,
    PAIR_NUMBERS,
    PER_EXHIBITOR,
    PER_HORSE,
    PER_PAIR,
    ShowBackNumbers,
    number_table,
    resolve_back_number,
    sort_key,
)
from tests.factories import make_entry


def _per_exhibitor(by_exhibitor: dict) -> ShowBackNumbers:
    return ShowBackNumbers(kind=PER_EXHIBITOR, by_exhibitor=by_exhibitor)


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
        kind=PER_HORSE,
        by_key={(horse_id,): number for horse_id, number in by_horse.items()},
        horses_by_exhibitor=horses_by_exhibitor or {},
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


def test_a_horse_numbered_show_lists_everybody_on_the_horse_as_wearing_its_number():
    """Why a side pot buy-in by number asks for a name there: the number is the
    horse's, and both of its riders wear it."""
    youth, amateur, horse_id = uuid4(), uuid4(), uuid4()
    numbers = _per_horse({horse_id: 40}, {youth: {horse_id}, amateur: {horse_id}})

    assert sorted(numbers.wearers_of(40), key=str) == sorted([youth, amateur], key=str)
    assert numbers.wearers_of(41) == []


# -- A show that numbers each exhibitor on each horse (migration 178) ----------


def _per_pair(by_pair: dict, horses_by_exhibitor: dict | None = None) -> ShowBackNumbers:
    """`by_pair` maps (exhibitor_id, horse_id) to the number."""
    if horses_by_exhibitor is None:
        horses_by_exhibitor = {}
        for exhibitor_id, horse_id in by_pair:
            horses_by_exhibitor.setdefault(exhibitor_id, set()).add(horse_id)
    return ShowBackNumbers(kind=PER_PAIR, by_key=dict(by_pair), horses_by_exhibitor=horses_by_exhibitor)


def test_two_exhibitors_on_one_horse_wear_two_numbers_at_a_pair_numbered_show():
    """The point of the third kind: the youth and the amateur who both show
    the horse are two entries in the ring, and each wears their own number."""
    youth, amateur, horse_id = uuid4(), uuid4(), uuid4()
    numbers = _per_pair({(youth, horse_id): 40, (amateur, horse_id): 41})

    assert numbers.resolve(youth, horse_id) == 40
    assert numbers.resolve(amateur, horse_id) == 41
    assert numbers.for_exhibitor(youth) == [40]
    assert numbers.for_exhibitor(amateur) == [41]


def test_one_exhibitor_wears_a_number_per_horse_at_a_pair_numbered_show():
    exhibitor_id, dandy, pistol = uuid4(), uuid4(), uuid4()
    numbers = _per_pair({(exhibitor_id, dandy): 113, (exhibitor_id, pistol): 112})

    assert numbers.resolve(exhibitor_id, dandy) == 113
    assert numbers.for_exhibitor(exhibitor_id) == [112, 113]
    assert numbers.label_for_exhibitor(exhibitor_id) == "112, 113"


def test_a_pair_number_is_never_lent_to_another_rider_of_the_horse():
    """An amateur not yet numbered on the youth's horse wears nothing, rather
    than the youth's number -- which is exactly what a horse-numbered show
    would hand them, and exactly what this show does not do."""
    youth, amateur, horse_id = uuid4(), uuid4(), uuid4()
    numbers = _per_pair({(youth, horse_id): 40}, {youth: {horse_id}, amateur: {horse_id}})

    assert numbers.resolve(amateur, horse_id) is None
    assert numbers.for_exhibitor(amateur) == []


def test_a_pair_number_names_its_one_wearer():
    """Why a side pot buy-in by number needs no name at a pair-numbered show."""
    youth, amateur, horse_id = uuid4(), uuid4(), uuid4()
    numbers = _per_pair({(youth, horse_id): 40, (amateur, horse_id): 41})

    assert numbers.wearers_of(41) == [amateur]


def test_a_pair_numbered_show_ignores_a_stale_exhibitor_number():
    exhibitor_id, horse_id = uuid4(), uuid4()
    entry = make_entry(exhibitor_id=exhibitor_id, horse_id=horse_id)
    numbers = _per_pair({(exhibitor_id, horse_id): 7})
    numbers.by_exhibitor = {exhibitor_id: 99}

    assert resolve_back_number(entry, numbers) == 7


def test_an_entry_with_no_horse_has_no_number_at_a_pair_numbered_show():
    entry = make_entry(exhibitor_id=uuid4(), horse_id=None)

    assert resolve_back_number(entry, _per_pair({(uuid4(), uuid4()): 9})) is None


def test_the_number_beside_a_horse_is_none_at_an_exhibitor_numbered_show():
    """The desk draws no box beside a horse there; the exhibitor has one."""
    exhibitor_id = uuid4()
    numbers = _per_exhibitor({exhibitor_id: 42})

    assert numbers.horse_number(exhibitor_id, uuid4()) is None
    assert numbers.horse_preference(exhibitor_id, uuid4()) is None


def test_a_request_beside_a_horse_is_read_by_the_same_key_as_its_number():
    exhibitor_id, horse_id = uuid4(), uuid4()
    numbers = ShowBackNumbers(
        kind=PER_PAIR,
        preferred_by_key={(exhibitor_id, horse_id): 42},
        horses_by_exhibitor={exhibitor_id: {horse_id}},
    )

    assert numbers.horse_number(exhibitor_id, horse_id) is None
    assert numbers.horse_preference(exhibitor_id, horse_id) == 42
    assert numbers.horse_preference(uuid4(), horse_id) is None


# -- Where each kind keeps its numbers -----------------------------------------


def test_each_kind_reads_its_own_table():
    assert number_table(PER_EXHIBITOR) is None
    assert number_table(PER_HORSE) is HORSE_NUMBERS
    assert number_table(PER_PAIR) is PAIR_NUMBERS


def test_a_horse_number_is_keyed_on_the_horse_whoever_shows_it():
    horse_id = uuid4()

    assert HORSE_NUMBERS.key(uuid4(), horse_id) == HORSE_NUMBERS.key(uuid4(), horse_id) == (horse_id,)
    assert HORSE_NUMBERS.key(None, horse_id) == (horse_id,)
    assert HORSE_NUMBERS.key(uuid4(), None) is None


def test_a_pair_number_is_keyed_on_the_exhibitor_and_horse_together():
    exhibitor_id, horse_id = uuid4(), uuid4()

    assert PAIR_NUMBERS.key(exhibitor_id, horse_id) == (exhibitor_id, horse_id)
    assert PAIR_NUMBERS.key(None, horse_id) is None
    assert PAIR_NUMBERS.key(exhibitor_id, None) is None
