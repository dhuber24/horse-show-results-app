"""Which fees may name their classes.

Every class is the default -- an empty list -- and a manager narrows a fee by
unticking classes. A list is accepted on an automatic charge, which it narrows,
and on a fee quoted per class, whose list the show bill prints. It is refused on
a reserved or flat fee, where nothing would ever read it.
"""
import asyncio
import uuid

import pytest
from fastapi import HTTPException

from billing import AUTOMATIC_FEE_UNITS, PER_CLASS_FEE_UNITS
from routers.show_fees import _resolve_scope_classes


class _Rows:
    def __init__(self, ids):
        self._ids = ids

    def all(self):
        return [(i,) for i in self._ids]


class _Db:
    """Answers the one query the check makes: which of these ids are on the show."""

    def __init__(self, ids):
        self._ids = ids

    async def execute(self, _stmt):
        return _Rows(self._ids)


def _resolve(unit, class_ids, known=()):
    return asyncio.run(
        _resolve_scope_classes(
            show_id=uuid.uuid4(), unit=unit, class_ids=class_ids, db=_Db(list(known))
        )
    )


@pytest.mark.parametrize("unit", ["per_entry", "per_judge_per_entry", "per_class_per_horse"])
def test_a_fee_quoted_per_class_may_be_narrowed(unit):
    cls = uuid.uuid4()
    assert _resolve(unit, [cls], known=[cls]) == [cls]


@pytest.mark.parametrize("unit", ["per_entry", "per_judge_per_entry", "per_class_per_horse"])
def test_a_fee_quoted_per_class_defaults_to_every_class(unit):
    # Nothing to choose is not an unanswered question: empty is the whole schedule.
    assert _resolve(unit, []) == []


@pytest.mark.parametrize("unit", ["per_stall", "per_bag", "per_night", "flat", "percent_of_entry"])
def test_a_reserved_or_flat_fee_cannot_carry_a_class_list(unit):
    with pytest.raises(HTTPException) as exc:
        _resolve(unit, [uuid.uuid4()])
    assert exc.value.status_code == 422


def test_a_class_from_another_show_is_refused():
    with pytest.raises(HTTPException) as exc:
        _resolve("per_entry", [uuid.uuid4()], known=[])
    assert exc.value.status_code == 422


def test_the_assessment_is_both_per_class_and_automatic():
    # The one per-class unit that bills. Its list narrows the charge; the other
    # two per-class units carry a list for the show bill alone.
    assert set(PER_CLASS_FEE_UNITS) & set(AUTOMATIC_FEE_UNITS) == {"per_judge_per_entry"}
