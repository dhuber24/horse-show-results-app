"""The stall inspection fee at checkout (migration 209).

The Lodging step says the show inspects stalls before checkout, with an
optional fee. The desk's checkout then has a box: ticked, the show's fee goes on
the bill as an office charge tagged `stall_inspection`, once; unticked, it comes
off. The amount is always the show's, never the caller's.
"""
import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import billing
import routers.show_desk as desk
from models import Show, ShowAccountAdjustment
from schemas import BillAdjustmentLineOut, ShowDeskOut, ShowUpdate
from tests.factories import make_show


class _Db:
    """Just enough session for the two endpoints."""

    def __init__(self, show=None, user=None, show_entry=None, charge=None):
        self.show = show
        self.user = user
        self.show_entry = show_entry
        self.charge = charge
        self.added = []
        self.deleted = []
        self.commits = 0

    async def get(self, model, _id):
        return self.show if model is Show else self.user

    async def execute(self, query):
        # The charge lookup selects adjustments; the entry lookup show entries.
        found = self.charge if "show_account_adjustments" in str(query) else self.show_entry
        return SimpleNamespace(scalar_one_or_none=lambda: found)

    def add(self, row):
        self.added.append(row)

    async def delete(self, row):
        self.deleted.append(row)

    async def commit(self):
        self.commits += 1


def _no_access_check(monkeypatch, show_entry):
    async def allowed(*_args, **_kwargs):
        return None

    async def account_row(_show_id, _exhibitor_id, _db):
        return show_entry

    monkeypatch.setattr(desk, "_assert_show_access", allowed)
    monkeypatch.setattr(desk, "_account_row", account_row)


def _call(endpoint, db):
    return asyncio.run(
        endpoint(uuid4(), uuid4(), x_api_key="k", x_user_id=str(uuid4()), x_user_role="SHOW_ADMIN", db=db)
    )


def _show(required=True, fee=2500):
    return SimpleNamespace(stall_inspection_required=required, stall_inspection_fee_cents=fee)


def test_ticking_the_box_charges_the_shows_fee_once(monkeypatch):
    show_entry = SimpleNamespace(id=uuid4())
    _no_access_check(monkeypatch, show_entry)
    staff = SimpleNamespace(id=uuid4(), full_name="Barn Office")
    db = _Db(show=_show(fee=2500), user=staff)
    _call(desk.charge_stall_inspection_fee, db)
    assert len(db.added) == 1
    charge = db.added[0]
    assert charge.amount_cents == 2500
    assert charge.kind == "stall_inspection"
    assert charge.reason == "Stall inspection fee"
    assert charge.show_entry_id == show_entry.id
    assert charge.recorded_by_name == "Barn Office"
    assert db.commits == 1


def test_ticking_it_again_charges_nothing_more(monkeypatch):
    _no_access_check(monkeypatch, SimpleNamespace(id=uuid4()))
    db = _Db(show=_show(), charge=SimpleNamespace(id=uuid4()))
    _call(desk.charge_stall_inspection_fee, db)
    assert db.added == []
    assert db.commits == 0


@pytest.mark.parametrize("show", [_show(fee=None), _show(required=False)])
def test_no_fee_to_charge_is_refused(monkeypatch, show):
    _no_access_check(monkeypatch, SimpleNamespace(id=uuid4()))
    with pytest.raises(HTTPException) as refused:
        _call(desk.charge_stall_inspection_fee, _Db(show=show))
    assert refused.value.status_code == 409


def test_unticking_takes_the_charge_off(monkeypatch):
    _no_access_check(monkeypatch, None)
    charge = SimpleNamespace(id=uuid4())
    db = _Db(show_entry=SimpleNamespace(id=uuid4()), charge=charge)
    _call(desk.remove_stall_inspection_fee, db)
    assert db.deleted == [charge]
    assert db.commits == 1


def test_unticking_with_nothing_charged_changes_nothing(monkeypatch):
    _no_access_check(monkeypatch, None)
    db = _Db(show_entry=SimpleNamespace(id=uuid4()), charge=None)
    _call(desk.remove_stall_inspection_fee, db)
    assert db.deleted == []
    assert db.commits == 0


def test_the_bill_line_says_what_made_it():
    adjustment = ShowAccountAdjustment(
        id=uuid4(), amount_cents=2500, reason="Stall inspection fee", kind="stall_inspection"
    )
    typed = ShowAccountAdjustment(id=uuid4(), amount_cents=5000, reason="Lost stall card")
    bill = billing.build_bill(make_show(), [], [], adjustments=[adjustment, typed])
    kinds = {line["reason"]: line["kind"] for line in bill["adjustment_lines"]}
    assert kinds == {"Stall inspection fee": "stall_inspection", "Lost stall card": None}
    assert BillAdjustmentLineOut(**bill["adjustment_lines"][0]).kind == "stall_inspection"


def test_the_show_and_the_desk_carry_the_setting():
    update = ShowUpdate(stall_inspection_required=True, stall_inspection_fee_cents=2500)
    assert update.model_dump(exclude_unset=True) == {
        "stall_inspection_required": True,
        "stall_inspection_fee_cents": 2500,
    }
    with pytest.raises(ValueError):
        ShowUpdate(stall_inspection_fee_cents=0)
    out = ShowDeskOut(show_id=uuid4(), show_name="Show", show_status="ACTIVE")
    assert out.stall_inspection_required is False
    assert out.stall_inspection_fee_cents is None
