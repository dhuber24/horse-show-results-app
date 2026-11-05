"""Who can read a person's records.

Anybody can sign up as a Show Secretary or Manager and be approved at once, so an
office role says nothing about who somebody is. These pin that a list of everybody
is an admin's, that somebody's own records are theirs, and that a picker gets what
it needs and no more. The office still reads a person, through a show it works.
"""
import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import dependencies
from dependencies import require_admin, require_admin_or_show_admin
from routers import judges as judges_router
from routers import people as people_router
from routers.judges import list_judges
from routers.people import (
    exhibitors_router,
    horses_router,
    get_exhibitor_created_horses,
    get_exhibitor_my_horses,
    get_exhibitor_owned_horses,
    list_exhibitor_competition_cards,
    list_exhibitor_registrations,
    list_users_by_role,
    users_router,
)
from schemas import StaffPickOut

KEY = "test-internal-key"
OFFICE = ["SHOW_MANAGER", "SHOW_SECRETARY"]
EVERYBODY_ELSE = ["SCRIBE", "GATE_STEWARD", "EXHIBITOR", "TRAINER"]


def _route(router, path):
    return next(r for r in router.routes if r.path == path and "GET" in r.methods)


def _guards(router, path):
    return [d.call for d in _route(router, path).dependant.dependencies]


@pytest.mark.parametrize(
    "path",
    [
        "/exhibitors/",
        "/exhibitors/registry",
        "/exhibitors/duplicates",
        "/exhibitors/{exhibitor_id}/merge-candidates",
        "/exhibitors/{exhibitor_id}/merge-summary",
    ],
)
def test_a_list_of_everybody_is_an_admins(path):
    guards = _guards(exhibitors_router, path)
    assert require_admin in guards
    assert require_admin_or_show_admin not in guards


def test_a_list_of_every_horse_is_an_admins():
    guards = _guards(horses_router, "/horses/")
    assert require_admin in guards
    assert require_admin_or_show_admin not in guards


class _Db:
    """Answers `db.get` with one exhibitor, and every read with an empty list."""

    def __init__(self, exhibitor=None, rows=()):
        self.exhibitor = exhibitor
        self.rows = list(rows)

    async def get(self, _model, _id):
        return self.exhibitor

    async def execute(self, query):
        self.query = query
        rows = self.rows
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))


OWNER = str(uuid4())
STRANGER = str(uuid4())
OWN_RECORDS = [
    list_exhibitor_registrations,
    list_exhibitor_competition_cards,
    get_exhibitor_owned_horses,
    get_exhibitor_created_horses,
]


def _read(endpoint, user, role):
    db = _Db(SimpleNamespace(user_id=OWNER))
    return asyncio.run(endpoint(uuid4(), user_id=user, x_user_role=role, db=db))


@pytest.mark.parametrize("endpoint", OWN_RECORDS)
@pytest.mark.parametrize("role", OFFICE + EVERYBODY_ELSE)
def test_somebodys_own_records_are_refused_to_anybody_else(endpoint, role):
    with pytest.raises(HTTPException) as refused:
        _read(endpoint, STRANGER, role)
    assert refused.value.status_code == 403


@pytest.mark.parametrize("endpoint", OWN_RECORDS)
def test_they_can_read_their_own(endpoint):
    assert _read(endpoint, OWNER, "EXHIBITOR") == []


@pytest.mark.parametrize("endpoint", OWN_RECORDS)
def test_an_admin_can_read_anybodys(endpoint):
    assert _read(endpoint, STRANGER, "ADMIN") == []


@pytest.mark.parametrize("role", EVERYBODY_ELSE)
def test_a_horse_list_is_refused_to_somebody_elses_account(role):
    with pytest.raises(HTTPException) as refused:
        _read(get_exhibitor_my_horses, STRANGER, role)
    assert refused.value.status_code == 403


def _reaching(monkeypatch, answer):
    async def may_reach(*_args, **_kwargs):
        return answer

    monkeypatch.setattr(people_router, "caller_may_reach_exhibitor", may_reach)


@pytest.mark.parametrize("role", OFFICE)
def test_the_office_can_read_a_horse_list_to_enter_somebody_at_the_desk(role, monkeypatch):
    _reaching(monkeypatch, True)
    assert _read(get_exhibitor_my_horses, STRANGER, role) == []


@pytest.mark.parametrize("role", OFFICE)
def test_an_office_that_cannot_reach_somebody_cannot_read_their_horses(role, monkeypatch):
    _reaching(monkeypatch, False)
    with pytest.raises(HTTPException) as refused:
        _read(get_exhibitor_my_horses, STRANGER, role)
    assert refused.value.status_code == 403


def test_somebody_in_an_unverified_office_still_reads_their_own_horses(monkeypatch):
    _reaching(monkeypatch, False)
    assert _read(get_exhibitor_my_horses, OWNER, "SHOW_MANAGER") == []


def test_they_can_read_their_own_horse_list():
    assert _read(get_exhibitor_my_horses, OWNER, "EXHIBITOR") == []


# ── The staff pickers ─────────────────────────────────────────────────────────


def _verified_caller(monkeypatch, answer):
    async def is_verified(*_args, **_kwargs):
        return answer

    monkeypatch.setattr(people_router, "caller_is_verified", is_verified)


def _by_role(role, caller, monkeypatch, rows=(), db=None):
    monkeypatch.setattr(dependencies, "INTERNAL_API_KEY", KEY)
    return asyncio.run(
        list_users_by_role(role=role, x_api_key=KEY, x_user_id=STRANGER, x_user_role=caller, db=db or _Db(rows=rows))
    )


@pytest.mark.parametrize("caller", OFFICE)
@pytest.mark.parametrize("role", ["EXHIBITOR", "TRAINER", "SCRIBE", "GATE_STEWARD", "ADMIN"])
def test_an_office_account_cannot_list_anybody_but_office_staff(caller, role, monkeypatch):
    with pytest.raises(HTTPException) as refused:
        _by_role(role, caller, monkeypatch)
    assert refused.value.status_code == 403


@pytest.mark.parametrize("caller", EVERYBODY_ELSE)
def test_nobody_outside_the_office_can_list_staff(caller, monkeypatch):
    with pytest.raises(HTTPException) as refused:
        _by_role("SHOW_MANAGER", caller, monkeypatch)
    assert refused.value.status_code == 403


@pytest.mark.parametrize("caller", OFFICE)
@pytest.mark.parametrize("role", OFFICE)
def test_the_office_can_list_who_it_can_pick(caller, role, monkeypatch):
    _verified_caller(monkeypatch, True)
    person = SimpleNamespace(full_name="Sam Reed")
    assert _by_role(role, caller, monkeypatch, [person]) == [person]


def test_a_verified_office_picks_from_every_office_account(monkeypatch):
    _verified_caller(monkeypatch, True)
    db = _Db()
    _by_role("SHOW_SECRETARY", "SHOW_MANAGER", monkeypatch, db=db)
    assert "users.id IN" not in str(db.query)


def test_an_unverified_office_picks_only_from_its_own_people(monkeypatch):
    """Every other office account's login is no business of a stranger's."""
    _verified_caller(monkeypatch, False)
    colleague = uuid4()

    async def colleagues(*_args, **_kwargs):
        return [colleague]

    monkeypatch.setattr(people_router, "colleagues_of", colleagues)
    db = _Db()
    _by_role("SHOW_SECRETARY", "SHOW_MANAGER", monkeypatch, db=db)
    assert "users.id IN" in str(db.query)


@pytest.mark.parametrize("role", ["EXHIBITOR", "SHOW_MANAGER", "SCRIBE"])
def test_an_admin_can_list_anybody(role, monkeypatch):
    assert _by_role(role, "ADMIN", monkeypatch) == []


def test_a_picker_carries_who_somebody_is_and_nothing_about_their_account():
    assert _route(users_router, "/users/by-role").response_model == list[StaffPickOut]
    assert set(StaffPickOut.model_fields) == {"id", "role", "first_name", "last_name", "full_name", "email"}


# ── The judge registry ────────────────────────────────────────────────────────


def _judge():
    return SimpleNamespace(
        created_by_user_id=None,
        id=uuid4(),
        first_name="Pat",
        last_name="Lane",
        email="pat@example.com",
        phone="555-0100",
        is_active=True,
        associations=[],
        user_id=uuid4(),
        user_email="pat-login@example.com",
        created_at=None,
    )


def _judges(role, judge):
    return asyncio.run(
        list_judges(include_inactive=False, x_user_id=STRANGER, x_user_role=role, db=_Db(rows=[judge]))
    )


def _contact_rule(monkeypatch, answer):
    async def rule(*_args, **_kwargs):
        return lambda _judge: answer

    monkeypatch.setattr(judges_router, "judge_contact_rule", rule)


@pytest.mark.parametrize("role", OFFICE)
def test_the_office_reads_a_judges_contact_details_but_not_their_login(role, monkeypatch):
    _contact_rule(monkeypatch, True)
    answer = _judges(role, _judge())[0]
    assert answer.email == "pat@example.com" and answer.phone == "555-0100"
    assert answer.user_id is None and answer.user_email is None


@pytest.mark.parametrize("role", OFFICE)
def test_an_unverified_office_gets_a_judges_name_and_not_their_contact_details(role, monkeypatch):
    _contact_rule(monkeypatch, False)
    answer = _judges(role, _judge())[0]
    assert answer.first_name == "Pat"
    assert answer.email is None and answer.phone is None


def test_an_admin_reads_a_judges_login():
    judge = _judge()
    assert _judges("ADMIN", judge)[0].user_email == "pat-login@example.com"
