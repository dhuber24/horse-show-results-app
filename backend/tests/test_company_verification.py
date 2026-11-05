"""Who a show company reaches before it has shown who it is (migration 180).

Anybody can sign up as a Show Secretary or Manager and be approved at once, so until
GaitDesk has verified a company it reaches only people who signed up to its shows and
people it typed in itself. These pin the rule and, because it is only as good as its
list of doors, that every way onto a roster asks it or has a stated reason not to.

This suite has no database, so the queries are compiled here rather than run.
"""
import ast
import asyncio
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

import company_verification
import payment_events
from company_verification import (
    NOT_VERIFIED_CODE,
    _horses,
    _people,
    _Reach,
    caller_is_verified,
    caller_may_read_horse_documents,
    caller_may_reach_exhibitor,
    exhibitors_out_of_reach,
    judge_contact_rule,
    show_reaches_everybody,
)
from models import Exhibitor, Horse, ShowCompany
from routers import backnumbers, entries, futurities, horse_documents, show_desk
from schemas import ExhibitorMergeRequest, FuturityEntryCreate, ShowDeskExhibitorAdd, ShowDeskExhibitorCreate
from show_companies import (
    VERIFIED_BY_ADMIN,
    VERIFIED_BY_PAYMENT,
    record_pro_plus,
    remove_verification,
    verify_company,
)

ROUTERS = Path(__file__).resolve().parent.parent / "routers"
SHOW = uuid4()
CALLER = str(uuid4())

# ── Every door, named ─────────────────────────────────────────────────────

# Writes a roster row or an entry for somebody the caller names, so it asks first.
ASKS = {
    ("backnumbers.py", "bulk_update_back_numbers"),
    ("entries.py", "create_entry"),
    ("show_desk.py", "add_exhibitor_to_roster"),
}
# Writes one too, and here is why that is nobody new.
NOBODY_NEW = {
    ("backnumbers.py", "auto_assign_back_numbers"): "numbers people already entered at this show",
    ("payments.py", "_ensure_show_entry"): "the exhibitor paying their own balance",
    ("show_desk.py", "create_exhibitor_at_desk"): "a record it has just typed in",
    ("show_financials.py", "record_payment"): "calls _assert_exhibitor_on_roster first",
    ("show_registration.py", "save_signup"): "the caller signing themselves up",
    ("show_registration.py", "register_for_show"): "the caller entering themselves",
}
GATES = {"assert_may_reach_exhibitors", "assert_may_enter", "assert_may_reach_horse"}


def _router_functions():
    for path in sorted(ROUTERS.glob("*.py")):
        for node in ast.parse(path.read_text(encoding="utf-8")).body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                yield path.name, node


def _calls(function) -> set[str]:
    return {n.func.id for n in ast.walk(function) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}


def test_every_writer_of_a_roster_row_or_an_entry_is_accounted_for():
    """A new door fails this until somebody decides whether it asks. That is the
    point: the rule is only as good as this list."""
    writers = {
        (name, function.name)
        for name, function in _router_functions()
        if _calls(function) & {"ShowEntry", "Entry"}
    }
    assert writers == ASKS | set(NOBODY_NEW)


@pytest.mark.parametrize(
    "door",
    sorted(
        ASKS
        | {
            ("show_desk.py", "merge_exhibitor_at_desk"),
            ("show_desk.py", "list_merge_candidates_at_desk"),
            ("futurities.py", "add_entry"),
        }
    ),
)
def test_each_door_asks(door):
    function = next(f for name, f in _router_functions() if (name, f.name) == door)
    assert _calls(function) & GATES


def test_a_payment_recorded_by_the_office_is_for_somebody_already_on_the_roster():
    function = next(f for name, f in _router_functions() if (name, f.name) == ("show_financials.py", "record_payment"))
    assert "_assert_exhibitor_on_roster" in _calls(function)


# ── A door refuses ────────────────────────────────────────────────────────


async def _nothing(*_args, **_kwargs):
    return None


class _Rows(list):
    def all(self):
        return list(self)


class _Db:
    """Answers `db.get` with a row carrying the id it was asked for, and records
    every write so a refusal can be seen to have written nothing."""

    def __init__(self):
        self.added = []
        self.committed = False

    async def get(self, _model, row_id):
        return SimpleNamespace(id=row_id, user_id=None, show_id=SHOW, back_number_per="exhibitor")

    async def scalar(self, _query):
        return None

    async def execute(self, _query):
        return SimpleNamespace(scalars=_Rows, scalar_one_or_none=lambda: None, first=lambda: None)

    def add(self, row):
        self.added.append(row)

    async def flush(self):
        pass

    async def commit(self):
        self.committed = True

    async def refresh(self, _row):
        pass


@pytest.fixture
def stranger(monkeypatch):
    """The office of a company GaitDesk hasn't verified, reaching nobody."""

    async def no(*_args, **_kwargs):
        return False

    async def no_reach(*_args, **_kwargs):
        return _Reach(shows=[], typists=[])

    async def nobody(*_args, **_kwargs):
        return set()

    monkeypatch.setattr(company_verification, "show_is_verified", no)
    monkeypatch.setattr(company_verification, "_show_reach", no_reach)
    monkeypatch.setattr(company_verification, "_within", nobody)
    for module in (show_desk, backnumbers, entries):
        monkeypatch.setattr(module, "_assert_show_access", _nothing)


def _refused(call, db):
    with pytest.raises(HTTPException) as refused:
        asyncio.run(call)
    assert refused.value.status_code == 403
    assert refused.value.detail["code"] == NOT_VERIFIED_CODE
    assert db.added == [] and not db.committed


def _headers():
    return {"x_api_key": "key", "x_user_id": CALLER, "x_user_role": "SHOW_SECRETARY"}


def test_the_desk_refuses_to_add_somebody_out_of_reach(stranger, monkeypatch):
    monkeypatch.setattr(show_desk, "_get_show_or_404", _nothing)
    db = _Db()
    body = ShowDeskExhibitorAdd(exhibitor_id=uuid4())
    _refused(show_desk.add_exhibitor_to_roster(SHOW, body, db=db, **_headers()), db)


def test_the_desk_refuses_to_merge_somebody_out_of_reach(stranger):
    db = _Db()
    body = ExhibitorMergeRequest(remove_exhibitor_id=uuid4())
    _refused(show_desk.merge_exhibitor_at_desk(SHOW, uuid4(), body, db=db, **_headers()), db)


def test_the_desk_refuses_to_list_merge_candidates_for_somebody_out_of_reach(stranger):
    db = _Db()
    _refused(show_desk.list_merge_candidates_at_desk(SHOW, uuid4(), db=db, **_headers()), db)


def test_a_back_number_cannot_put_somebody_out_of_reach_on_the_roster(stranger, monkeypatch):
    monkeypatch.setattr(backnumbers, "number_kind", lambda _show: backnumbers.PER_EXHIBITOR)
    db = _Db()
    body = backnumbers.BulkBackNumberUpdate(
        assignments=[backnumbers.BackNumberAssignment(exhibitor_id=uuid4(), back_number=7)]
    )
    _refused(backnumbers.bulk_update_back_numbers(SHOW, body, db=db, **_headers()), db)


def _entry_body(horse_id=None):
    return entries.EntryCreate(horse_id=horse_id or uuid4(), exhibitor_id=uuid4())


def _stub_entry_loads(monkeypatch):
    async def row(*_args, **_kwargs):
        return SimpleNamespace(status="OPEN", score_type="rail", class_name="Trail", division=None)

    for name in ("_get_show_or_404", "_get_class_or_404", "_get_horse_or_404", "_get_exhibitor_or_404"):
        monkeypatch.setattr(entries, name, row)


def test_an_entry_cannot_put_somebody_out_of_reach_on_the_show(stranger, monkeypatch):
    _stub_entry_loads(monkeypatch)
    db = _Db()
    _refused(entries.create_entry(SHOW, uuid4(), _entry_body(), db=db, **_headers()), db)


def test_an_entry_cannot_bring_a_horse_out_of_reach_under_somebody_typed_in(stranger, monkeypatch):
    """Typing a name in is free, so a person within reach proves nothing about the
    horse: the horse has to be on somebody's profile."""
    _stub_entry_loads(monkeypatch)

    async def everybody(_db, _reach, wanted):
        return set(wanted)

    monkeypatch.setattr(company_verification, "_within", everybody)
    db = _Db()
    _refused(entries.create_entry(SHOW, uuid4(), _entry_body(), db=db, **_headers()), db)


def test_a_futurity_cannot_bring_a_horse_out_of_reach(stranger, monkeypatch):
    monkeypatch.setattr(futurities, "_load_futurity", _nothing)
    db = _Db()
    body = FuturityEntryCreate(show_entry_id=uuid4(), horse_id=uuid4())
    _refused(futurities.add_entry(SHOW, uuid4(), body, x_user_id=CALLER, x_user_role="SHOW_SECRETARY", db=db), db)


def _people_on_file(monkeypatch, row):
    async def on_file(_email, _db):
        return [(row, None)]

    monkeypatch.setattr(show_desk, "records_with_email", on_file)
    monkeypatch.setattr(show_desk, "_get_show_or_404", _nothing)
    monkeypatch.setattr(show_desk, "assign_back_number_if_missing", _nothing)


def test_an_address_on_file_is_not_named_to_a_company_that_cannot_reach_it(stranger, monkeypatch):
    """Naming it would tell a stranger who an address belongs to. They get a record
    of their own, holding what they typed and nothing of the person's."""
    row = SimpleNamespace(id=uuid4(), full_name="Somebody Else", user_id=uuid4(), created_by_user_id=None)
    _people_on_file(monkeypatch, row)
    db = _Db()
    body = ShowDeskExhibitorCreate(first_name="Sam", last_name="Reed", email="taken@example.com")
    answer = asyncio.run(show_desk.create_exhibitor_at_desk(SHOW, body, db=db, **_headers()))
    assert answer["exhibitor_name"] == "Sam Reed"
    assert db.committed


def test_an_address_on_file_is_still_asked_about_for_somebody_within_reach(stranger, monkeypatch):
    row = SimpleNamespace(id=uuid4(), full_name="Somebody Known", user_id=uuid4(), created_by_user_id=None)
    _people_on_file(monkeypatch, row)

    async def everybody(_db, _reach, wanted):
        return set(wanted)

    monkeypatch.setattr(company_verification, "_within", everybody)
    db = _Db()
    body = ShowDeskExhibitorCreate(first_name="Sam", last_name="Reed", email="known@example.com")
    with pytest.raises(HTTPException) as asked:
        asyncio.run(show_desk.create_exhibitor_at_desk(SHOW, body, db=db, **_headers()))
    assert asked.value.status_code == 409
    assert asked.value.detail["code"] == "EMAIL_ON_FILE"
    assert [m["full_name"] for m in asked.value.detail["matches"]] == ["Somebody Known"]
    assert db.added == []


def test_merge_candidates_leave_out_anybody_out_of_reach(monkeypatch):
    near, far = uuid4(), uuid4()

    async def candidates(_exhibitor, _db):
        return [{"exhibitor_id": near}, {"exhibitor_id": far}]

    async def hidden(*_args, **_kwargs):
        return {far}

    async def summary(_id, _db):
        return {}

    monkeypatch.setattr(show_desk, "_assert_show_access", _nothing)
    monkeypatch.setattr(show_desk, "assert_may_reach_exhibitors", _nothing)
    monkeypatch.setattr(show_desk, "exhibitors_out_of_reach", hidden)
    monkeypatch.setattr(show_desk, "merge_candidates", candidates)
    monkeypatch.setattr(show_desk, "merge_summary", summary)
    answer = asyncio.run(show_desk.list_merge_candidates_at_desk(SHOW, uuid4(), db=_Db(), **_headers()))
    assert [c["exhibitor_id"] for c in answer] == [near]


# ── Who is within reach ───────────────────────────────────────────────────


def _no_db(*_args, **_kwargs):
    raise AssertionError("asked the database")


NO_DB = SimpleNamespace(execute=_no_db, scalar=_no_db)


def test_an_admin_reaches_everybody_at_anybodys_show():
    assert asyncio.run(show_reaches_everybody(NO_DB, SHOW, "ADMIN"))
    assert asyncio.run(exhibitors_out_of_reach(NO_DB, SHOW, [uuid4()], CALLER, "ADMIN")) == set()


def test_a_verified_company_reaches_everybody(monkeypatch):
    async def yes(*_args, **_kwargs):
        return True

    monkeypatch.setattr(company_verification, "show_is_verified", yes)
    assert asyncio.run(exhibitors_out_of_reach(NO_DB, SHOW, [uuid4()], CALLER, "SHOW_SECRETARY")) == set()


def test_an_unverified_company_reaches_only_who_is_within_reach(stranger, monkeypatch):
    near, far = uuid4(), uuid4()

    async def only_near(_db, _reach, wanted):
        return wanted & {near}

    monkeypatch.setattr(company_verification, "_within", only_near)
    assert asyncio.run(exhibitors_out_of_reach(NO_DB, SHOW, [near, far], CALLER, "SHOW_SECRETARY")) == {far}


def test_nobody_to_check_asks_nothing():
    assert asyncio.run(exhibitors_out_of_reach(NO_DB, SHOW, [], CALLER, "SHOW_SECRETARY")) == set()


@pytest.mark.parametrize("role", ["SCRIBE", "GATE_STEWARD", "EXHIBITOR", "TRAINER"])
def test_only_an_office_account_answers_to_a_company(role):
    assert not asyncio.run(caller_is_verified(NO_DB, CALLER, role))
    assert not asyncio.run(caller_may_reach_exhibitor(NO_DB, CALLER, role, uuid4()))
    assert not asyncio.run(caller_may_read_horse_documents(NO_DB, CALLER, role, uuid4()))


def test_an_admin_is_always_verified():
    assert asyncio.run(caller_is_verified(NO_DB, CALLER, "ADMIN"))


REACH = _Reach(shows=[uuid4()], typists=[uuid4()])


def _sql(query) -> str:
    return str(query.compile(dialect=postgresql.dialect()))


def test_the_people_within_reach_are_a_roster_an_entry_or_a_record_it_typed():
    sql = _sql(select(Exhibitor.id).where(Exhibitor.id.in_([uuid4()]), Exhibitor.id.in_(_people(REACH))))
    assert "show_entries.show_id" in sql
    assert "classes.show_id" in sql
    assert "exhibitors.created_by_user_id" in sql


def test_a_record_stops_being_something_it_typed_once_an_account_has_it():
    assert "exhibitors.user_id IS NULL" in _sql(_people(REACH))


def test_a_link_to_a_horse_nobody_owns_opens_no_paperwork():
    """Anybody can link one to their own profile, so the link says nothing about
    whose its Coggins is. It still lets the desk enter the horse."""
    documents = _sql(select(Horse.id).where(Horse.id == uuid4(), Horse.id.in_(_horses(REACH, documents=True))))
    entering = _sql(select(Horse.id).where(Horse.id == uuid4(), Horse.id.in_(_horses(REACH))))
    assert "horses.owner_exhibitor_id IS NOT NULL" in documents
    assert "horses.owner_exhibitor_id IS NOT NULL" not in entering


def test_a_judge_is_read_by_who_typed_them_in_until_the_company_is_verified(monkeypatch):
    me = uuid4()

    async def no(*_args, **_kwargs):
        return False

    async def reach(*_args, **_kwargs):
        return _Reach(shows=[], typists=[me])

    monkeypatch.setattr(company_verification, "show_is_verified", no)
    monkeypatch.setattr(company_verification, "_show_reach", reach)
    rule = asyncio.run(judge_contact_rule(NO_DB, str(me), "SHOW_SECRETARY", SHOW))
    assert rule(SimpleNamespace(created_by_user_id=me))
    assert not rule(SimpleNamespace(created_by_user_id=uuid4()))
    assert not rule(SimpleNamespace(created_by_user_id=None))


def test_a_verified_company_reads_every_judge(monkeypatch):
    async def yes(*_args, **_kwargs):
        return True

    monkeypatch.setattr(company_verification, "show_is_verified", yes)
    rule = asyncio.run(judge_contact_rule(NO_DB, CALLER, "SHOW_SECRETARY", SHOW))
    assert rule(SimpleNamespace(created_by_user_id=None))


# ── A horse's paperwork ───────────────────────────────────────────────────


def _viewing(monkeypatch, *, reach, owner):
    async def may_read(*_args, **_kwargs):
        return reach

    async def is_owner(*_args, **_kwargs):
        return owner

    monkeypatch.setattr(horse_documents, "caller_may_read_horse_documents", may_read)
    monkeypatch.setattr(horse_documents, "_is_owner", is_owner)


HORSE = SimpleNamespace(id=uuid4(), owner_exhibitor_id=uuid4())


@pytest.mark.parametrize("role", ["SHOW_MANAGER", "SHOW_SECRETARY"])
def test_the_office_reads_the_paperwork_of_a_horse_within_its_reach(role, monkeypatch):
    _viewing(monkeypatch, reach=True, owner=False)
    asyncio.run(horse_documents._assert_can_view(HORSE, CALLER, role, None))


@pytest.mark.parametrize("role", ["SHOW_MANAGER", "SHOW_SECRETARY"])
def test_the_office_of_an_unverified_company_cannot_read_any_horses_paperwork(role, monkeypatch):
    _viewing(monkeypatch, reach=False, owner=False)
    with pytest.raises(HTTPException) as refused:
        asyncio.run(horse_documents._assert_can_view(HORSE, CALLER, role, None))
    assert refused.value.status_code == 403


def test_somebody_in_an_unverified_office_still_reads_their_own_horses_paperwork(monkeypatch):
    _viewing(monkeypatch, reach=False, owner=True)
    asyncio.run(horse_documents._assert_can_view(HORSE, CALLER, "SHOW_MANAGER", None))


# ── How a company comes to be verified ────────────────────────────────────


def _company(**fields):
    return ShowCompany(name="Bar T Shows", plan="basic", renews_pro_plus=False, **fields)


def test_an_admin_verifies_a_company_and_answers_its_request():
    admin = uuid4()
    company = _company(verification_requested_at=datetime.now(timezone.utc))
    assert verify_company(company, VERIFIED_BY_ADMIN, by=admin)
    assert company.verified_at is not None
    assert company.verified_how == VERIFIED_BY_ADMIN and company.verified_by_user_id == admin
    assert company.verification_requested_at is None


def test_verifying_a_verified_company_changes_nothing():
    first = datetime(2026, 1, 1, tzinfo=timezone.utc)
    company = _company(verified_at=first, verified_how="existing")
    assert not verify_company(company, VERIFIED_BY_ADMIN, by=uuid4())
    assert company.verified_at == first and company.verified_how == "existing"


def test_an_admin_taking_it_away_outlasts_a_payment():
    company = _company()
    verify_company(company, VERIFIED_BY_ADMIN, by=uuid4())
    remove_verification(company)
    assert company.verified_at is None and company.verified_how is None
    assert not verify_company(company, VERIFIED_BY_PAYMENT)
    assert company.verified_at is None


def test_an_admin_can_put_it_back():
    company = _company()
    remove_verification(company)
    assert verify_company(company, VERIFIED_BY_ADMIN, by=uuid4())
    assert company.verified_at is not None and company.verification_removed_at is None


def _invoice(company, **fields):
    defaults = {"company_id": uuid4(), "voided_at": None, "amount_cents": 200}
    return SimpleNamespace(**{**defaults, **fields}), SimpleNamespace(get=_returning(company))


def _returning(row):
    async def get(_model, _id):
        return row

    return get


def test_paying_an_invoice_verifies_a_company():
    company = _company()
    invoice, db = _invoice(company)
    asyncio.run(payment_events.verify_for_payment(db, invoice))
    assert company.verified_how == VERIFIED_BY_PAYMENT


@pytest.mark.parametrize(
    "fields",
    [
        {"amount_cents": 0},
        {"voided_at": datetime(2026, 1, 1, tzinfo=timezone.utc)},
        {"company_id": None},
    ],
)
def test_an_invoice_for_nothing_or_a_void_one_verifies_nobody(fields):
    company = _company()
    invoice, db = _invoice(company, **fields)
    asyncio.run(payment_events.verify_for_payment(db, invoice))
    assert company.verified_at is None


class _Adds:
    def add(self, _row):
        pass


def _year(company, price_cents, received_on):
    return record_pro_plus(
        company,
        starts_on=date(2026, 1, 1),
        ends_on=date(2026, 12, 31),
        price_cents=price_cents,
        payment_method=None,
        payment_reference=None,
        recorded_by=None,
        db=_Adds(),
        payment_received_on=received_on,
    )


def test_a_paid_pro_plus_year_verifies_a_company():
    company = _company()
    _year(company, 149900, date(2026, 1, 1))
    assert company.verified_how == VERIFIED_BY_PAYMENT


def test_a_year_on_credit_or_a_free_one_verifies_nobody():
    """Nothing has been paid, and a comp is GaitDesk's to give to a stranger on trial."""
    for price, received in ((149900, None), (0, None), (0, date(2026, 1, 1))):
        company = _company()
        _year(company, price, received)
        assert company.verified_at is None
