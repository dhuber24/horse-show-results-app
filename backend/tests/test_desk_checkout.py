"""Checking an exhibitor out at the desk (migration 200).

The office's last step with somebody leaving: any charge still owed is added
first (an office charge, migration 197), then they are marked out -- when, and
by whom. A record, never a gate: nothing refuses over a balance still owing.
"""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import routers.show_desk as desk
from schemas import ShowDeskExhibitorOut


class _Db:
    """Just enough session for the two endpoints."""

    def __init__(self, user=None, show_entry=None):
        self.user = user
        self.show_entry = show_entry
        self.commits = 0

    async def get(self, _model, _id):
        return self.user

    async def execute(self, _query):
        return SimpleNamespace(scalar_one_or_none=lambda: self.show_entry)

    async def commit(self):
        self.commits += 1


def _no_access_check(monkeypatch, show_entry):
    async def allowed(*_args, **_kwargs):
        return None

    async def account_row(_show_id, _exhibitor_id, _db):
        return show_entry

    monkeypatch.setattr(desk, "_assert_show_access", allowed)
    monkeypatch.setattr(desk, "_account_row", account_row)


def _call(endpoint, db, user_id):
    return asyncio.run(
        endpoint(uuid4(), uuid4(), x_api_key="k", x_user_id=str(user_id), x_user_role="SHOW_ADMIN", db=db)
    )


def test_checking_out_records_when_and_by_whom(monkeypatch):
    show_entry = SimpleNamespace(checked_out_at=None, checked_out_by=None, checked_out_by_name=None)
    _no_access_check(monkeypatch, show_entry)
    staff = SimpleNamespace(id=uuid4(), full_name="Stall Admin")
    db = _Db(user=staff)
    before = datetime.now(timezone.utc)
    _call(desk.check_out_exhibitor, db, staff.id)
    assert show_entry.checked_out_at >= before
    assert show_entry.checked_out_by == staff.id
    assert show_entry.checked_out_by_name == "Stall Admin"
    assert db.commits == 1


def test_undoing_a_checkout_clears_it(monkeypatch):
    show_entry = SimpleNamespace(
        checked_out_at=datetime(2027, 9, 27, 15, 42, tzinfo=timezone.utc),
        checked_out_by=uuid4(),
        checked_out_by_name="Stall Admin",
    )
    _no_access_check(monkeypatch, show_entry)
    db = _Db(show_entry=show_entry)
    _call(desk.undo_check_out, db, uuid4())
    assert show_entry.checked_out_at is None
    assert show_entry.checked_out_by is None
    assert show_entry.checked_out_by_name is None
    assert db.commits == 1


def test_undoing_when_never_checked_out_changes_nothing(monkeypatch):
    _no_access_check(monkeypatch, None)
    db = _Db(show_entry=None)
    _call(desk.undo_check_out, db, uuid4())
    assert db.commits == 0


def test_the_desk_payload_carries_the_checkout():
    out = ShowDeskExhibitorOut(
        exhibitor_id=uuid4(),
        exhibitor_name="Stall Rider",
        checked_out_at=datetime(2027, 9, 27, 15, 42, tzinfo=timezone.utc),
        checked_out_by_name="Stall Admin",
    )
    assert out.checked_out_by_name == "Stall Admin"
    assert ShowDeskExhibitorOut(exhibitor_id=uuid4(), exhibitor_name="Somebody").checked_out_at is None
