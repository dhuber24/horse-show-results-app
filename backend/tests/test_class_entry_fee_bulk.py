"""One price for a group of classes: the Show Fees step's class prices.

A bill prices classes in a handful of rates, so the step shows them grouped by
price and reprices a group in one write. It refuses what one class's PATCH
refuses -- a free class, a futurity class -- and refuses the whole group rather
than repricing most of it.
"""
import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from routers import classes as classes_router
from schemas import ClassBulkEntryFee


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _Db:
    def __init__(self, rows):
        self.rows = rows
        self.commits = 0

    async def execute(self, _stmt):
        return _Result(self.rows)

    async def commit(self):
        self.commits += 1


def _class(cents=2000, *, free=False, futurity=False, number="15", name="Tandem Bareback"):
    return SimpleNamespace(
        id=uuid4(),
        class_number=number,
        class_name=name,
        entry_fee_cents=cents,
        is_free=free,
        is_futurity_class=futurity,
    )


def _call(monkeypatch, rows, cents, ids=None):
    async def allowed(*_args, **_kwargs):
        return None

    monkeypatch.setattr(classes_router, "_assert_show_access", allowed)
    db = _Db(rows)
    body = ClassBulkEntryFee(class_ids=ids or [r.id for r in rows], entry_fee_cents=cents)
    result = asyncio.run(
        classes_router.set_classes_entry_fee(
            uuid4(), body, x_api_key="k", x_user_id=str(uuid4()), x_user_role="SHOW_ADMIN", db=db
        )
    )
    return result, db


def test_every_class_in_the_group_takes_the_new_price(monkeypatch):
    rows = [_class(0), _class(0, number="96", name="Rescue Race"), _class(0, number="97", name="Ribbon Race")]

    result, db = _call(monkeypatch, rows, 4000)

    assert [r.entry_fee_cents for r in rows] == [4000, 4000, 4000]
    assert result["entry_fee_cents"] == 4000
    assert db.commits == 1


def test_a_free_class_refuses_the_whole_group(monkeypatch):
    rows = [_class(2000), _class(0, free=True, number="1", name="Leadline")]

    with pytest.raises(HTTPException) as err:
        _call(monkeypatch, rows, 2200)

    assert err.value.status_code == 422
    assert "Class 1 (Leadline) is free" in err.value.detail
    assert rows[0].entry_fee_cents == 2000, "nothing repriced"


def test_a_free_class_may_still_be_set_to_nothing(monkeypatch):
    rows = [_class(0, free=True)]

    _call(monkeypatch, rows, 0)

    assert rows[0].entry_fee_cents == 0


def test_a_futurity_class_is_never_priced_here(monkeypatch):
    rows = [_class(0, futurity=True, number="41", name="Futurity 2 Yr. Old Western Pleasure")]

    with pytest.raises(HTTPException) as err:
        _call(monkeypatch, rows, 8500)

    assert err.value.status_code == 409
    assert err.value.detail["code"] == "FUTURITY_CLASS_PRICED"


def test_a_class_not_in_the_show_refuses_the_lot(monkeypatch):
    rows = [_class(2000)]

    with pytest.raises(HTTPException) as err:
        _call(monkeypatch, rows, 2200, ids=[rows[0].id, uuid4()])

    assert err.value.status_code == 404
    assert rows[0].entry_fee_cents == 2000
