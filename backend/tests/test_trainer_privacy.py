"""Who can read what about a trainer.

A trainer's record holds their login email, private phone, home zip and
compliance dates, and only a GaitDesk admin reads it. The dropdown on a horse
form, which any signed-in account fills in, reads an id and a name. These pin the
door each one uses, because the whole list was open to every account once, for
the sake of that dropdown, and nothing on screen showed it.
"""
import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import dependencies
from dependencies import require_admin, require_authenticated
from routers.trainers import list_trainer_names, router
from schemas import TrainerBasic, TrainerOut

KEY = "test-internal-key"
EVERY_OTHER_ROLE = ["SHOW_MANAGER", "SHOW_SECRETARY", "SCRIBE", "GATE_STEWARD", "EXHIBITOR", "TRAINER"]


def _route(path):
    return next(r for r in router.routes if r.path == path and "GET" in r.methods)


def _guards(path):
    return [d.call for d in _route(path).dependant.dependencies]


def test_the_whole_record_is_read_through_the_admin_guard():
    assert require_admin in _guards("/trainers/")
    assert _route("/trainers/").response_model == list[TrainerOut]


@pytest.mark.parametrize("role", EVERY_OTHER_ROLE)
def test_nobody_but_an_admin_gets_past_that_guard(role, monkeypatch):
    monkeypatch.setattr(dependencies, "INTERNAL_API_KEY", KEY)
    with pytest.raises(HTTPException) as refused:
        asyncio.run(require_admin(x_api_key=KEY, x_user_role=role))
    assert refused.value.status_code == 403


def test_an_admin_gets_past_it(monkeypatch):
    monkeypatch.setattr(dependencies, "INTERNAL_API_KEY", KEY)
    asyncio.run(require_admin(x_api_key=KEY, x_user_role="ADMIN"))


def test_a_picker_needs_only_to_be_signed_in():
    assert require_authenticated in _guards("/trainers/names")
    assert require_admin not in _guards("/trainers/names")
    assert _route("/trainers/names").response_model == list[TrainerBasic]


def test_what_any_account_can_read_is_an_id_and_a_name():
    """A field added here reaches every account, exhibitors included, so adding
    one has to be somebody's decision."""
    assert set(TrainerBasic.model_fields) == {"id", "name"}


def test_the_whole_record_stays_off_what_any_account_can_read():
    private = {
        "user_id", "user_email", "email", "phone", "private_phone", "zip_code",
        "safesport_completed_at", "background_check_expires_at", "has_liability_insurance",
        "is_pro", "pro_until", "pro_plan", "pro_request_plan", "pro_requested_at",
    }
    assert private <= set(TrainerOut.model_fields)
    assert not private & set(TrainerBasic.model_fields)


class _NamesDb:
    """Answers the one read, and keeps the query to look at."""

    def __init__(self, rows):
        self.rows = rows
        self.query = None

    async def execute(self, query):
        self.query = query
        rows = self.rows
        return SimpleNamespace(all=lambda: rows)


def test_the_picker_gets_every_trainer_by_id_and_name():
    rows = [SimpleNamespace(id=uuid4(), name="Avery Cole"), SimpleNamespace(id=uuid4(), name="Sam Reed")]
    answer = asyncio.run(list_trainer_names(_NamesDb(rows)))
    assert [(t.id, t.name) for t in answer] == [(r.id, r.name) for r in rows]


def test_only_those_two_columns_are_ever_read():
    """Reading the columns rather than the row, so nothing private is in reach."""
    db = _NamesDb([])
    asyncio.run(list_trainer_names(db))
    assert [column.name for column in db.query.selected_columns] == ["id", "name"]
