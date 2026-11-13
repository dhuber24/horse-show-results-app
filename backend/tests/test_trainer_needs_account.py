"""A horse names a trainer who signed up, and nothing makes a trainer row.

A `trainers` row used to be minted from a horse form: pick "Other", type a name
and an email, and a person who had never seen GaitDesk was on file, named on a
horse, under whatever address somebody guessed. Since 2026-11-13 a trainer exists
because they signed up. These pin `_resolve_horse_trainer_fields`, which every
horse create and edit runs.
"""
import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from routers.people import TRAINER_NEEDS_ACCOUNT, _resolve_horse_trainer_fields
from routers.trainers import router as trainers_router


class _Db:
    """Answers `get` from a dict; fails the test if anything is added."""

    def __init__(self, trainers=()):
        self.trainers = {t.id: t for t in trainers}

    async def get(self, model, key):
        return self.trainers.get(key)

    def add(self, obj):  # pragma: no cover - the failure is the point
        raise AssertionError(f"created {obj!r}")

    async def flush(self):  # pragma: no cover
        raise AssertionError("flushed a new row")


def _trainer(with_account=True):
    return SimpleNamespace(id=uuid4(), user_id=uuid4() if with_account else None, name="Avery Cole")


def _resolve(data, db, current=None):
    asyncio.run(_resolve_horse_trainer_fields(data, db, current=current))
    return data


def _refused(data, db, current=None):
    with pytest.raises(HTTPException) as caught:
        _resolve(data, db, current)
    assert caught.value.status_code == 400
    return caught.value.detail


def test_a_trainer_with_an_account_is_picked():
    trainer = _trainer()
    data = _resolve({"trainer_id": trainer.id, "trainer_name": "Avery Cole"}, _Db([trainer]))
    assert data["trainer_id"] == trainer.id
    assert data["trainer_name"] is None


def test_a_new_pick_without_an_account_is_refused():
    trainer = _trainer(with_account=False)
    assert _refused({"trainer_id": trainer.id}, _Db([trainer])) == TRAINER_NEEDS_ACCOUNT


def test_a_trainer_that_is_not_there_is_refused():
    assert _refused({"trainer_id": uuid4()}, _Db()) == "Selected trainer is not in the registry."


@pytest.mark.parametrize("fields", [
    {"trainer_first_name": "Sam", "trainer_last_name": "Reed", "trainer_email": "sam@example.com"},
    {"trainer_name": "Sam Reed", "trainer_phone": "555-0100"},
    {"trainer_email": "sam@example.com"},
])
def test_the_old_other_fields_never_make_a_trainer(fields):
    """What "Other - enter trainer details" sent. `_Db` fails on any add."""
    assert _refused(dict(fields), _Db()) == TRAINER_NEEDS_ACCOUNT


def test_blank_other_fields_are_only_dropped():
    """Every form used to send them as nulls; a stale one still may."""
    data = _resolve({"trainer_id": None, "trainer_first_name": None, "trainer_last_name": "", "trainer_email": None}, _Db())
    assert "trainer_first_name" not in data and "trainer_last_name" not in data and "trainer_email" not in data


def test_new_free_text_is_refused():
    assert _refused({"trainer_id": None, "trainer_name": "Sam Reed"}, _Db()) == TRAINER_NEEDS_ACCOUNT


def test_no_trainer_is_always_allowed():
    data = _resolve({"trainer_id": None, "trainer_name": ""}, _Db())
    assert data["trainer_name"] is None


def test_an_account_less_trainer_the_horse_already_names_stays():
    """Saving the horse for another reason re-sends its trainer, and must not lose it."""
    legacy = _trainer(with_account=False)
    horse = SimpleNamespace(trainer_id=legacy.id, trainer_name=None)
    data = _resolve({"trainer_id": legacy.id, "trainer_name": legacy.name}, _Db([legacy]), current=horse)
    assert data["trainer_id"] == legacy.id


def test_the_free_text_a_horse_already_carries_stays():
    horse = SimpleNamespace(trainer_id=None, trainer_name="Sam Reed")
    data = _resolve({"trainer_id": None, "trainer_name": "Sam Reed"}, _Db(), current=horse)
    assert data["trainer_name"] == "Sam Reed"


def test_changing_that_free_text_is_refused():
    horse = SimpleNamespace(trainer_id=None, trainer_name="Sam Reed")
    assert _refused({"trainer_name": "Pat Lane"}, _Db(), current=horse) == TRAINER_NEEDS_ACCOUNT


def test_nothing_creates_a_trainer_by_hand_either():
    """The admin's Add Trainer was the other way a row appeared without a sign-up."""
    assert not any(route.path == "/trainers/" and "POST" in route.methods for route in trainers_router.routes)
