"""A show is run by a company, and the company's staff work it (migration 156).

Setup Step 1's Staff section is the company's own staff list, so the rules
worth pinning are the ones that decide *which* company and *who may change
it*:

* a new show goes to its creator's company only when that is not a guess;
* the company's staff work the show with no per-show row, and nobody else
  does unless assigned by hand -- a scribe in a company included;
* only the company's own people (or an admin) change who works for it from
  here, and only they may move its show to another company.

The queries are not tested here -- the repo's tests run without a database on
purpose -- so the access check is exercised with its lookups replaced.
"""
import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

import show_access
from routers.show_company_staff import may_change_company, may_manage
from show_companies import default_show_company

ME, COLLEAGUE, GUEST = uuid4(), uuid4(), uuid4()
CLUB, OTHER_CLUB, MY_OWN = uuid4(), uuid4(), uuid4()


# ── Which company a new show runs under ──────────────────────────────────────

def test_somebody_in_one_company_gets_it():
    """Nearly everybody: an independent has their own, a club member has the club."""
    assert default_show_company([(CLUB, None)]) == CLUB
    assert default_show_company([(MY_OWN, ME)]) == MY_OWN


def test_the_club_wins_over_a_company_of_their_own():
    """Their own company was kept because it had a feature on or somebody else
    in it; the club is still who they work for."""
    assert default_show_company([(MY_OWN, ME), (CLUB, None)]) == CLUB


def test_two_clubs_is_not_guessed():
    """A freelance secretary could be setting up either club's show, and a guess
    hands it to the wrong club's staff. Step 1 asks."""
    assert default_show_company([(CLUB, None), (OTHER_CLUB, None)]) is None
    assert default_show_company([(CLUB, None), (OTHER_CLUB, None), (MY_OWN, ME)]) is None


def test_nobody_in_a_company_gets_none():
    """An admin creating a show chooses on Step 1."""
    assert default_show_company([]) is None


# ── Who works the show ───────────────────────────────────────────────────────

def _fake_db(assigned: bool):
    class Result:
        def first(self):
            return object() if assigned else None

    async def execute(_query):
        return Result()

    return SimpleNamespace(execute=execute)


def _works(role, *, assigned=False, in_company=False, monkeypatch):
    async def member(_db, _show_id, _user_id):
        return in_company

    monkeypatch.setattr(show_access, "in_show_company", member)
    return asyncio.run(show_access.works_show(_fake_db(assigned), uuid4(), ME, role))


@pytest.mark.parametrize("role", ["SHOW_MANAGER", "SHOW_SECRETARY"])
def test_the_companys_staff_work_the_show_with_no_row(role, monkeypatch):
    assert _works(role, in_company=True, monkeypatch=monkeypatch)


@pytest.mark.parametrize("role", ["SHOW_MANAGER", "SHOW_SECRETARY"])
def test_a_guest_works_it_through_a_row(role, monkeypatch):
    assert _works(role, assigned=True, monkeypatch=monkeypatch)


@pytest.mark.parametrize("role", ["SHOW_MANAGER", "SHOW_SECRETARY"])
def test_neither_is_nobody(role, monkeypatch):
    assert not _works(role, monkeypatch=monkeypatch)


@pytest.mark.parametrize("role", ["SCRIBE", "GATE_STEWARD", "EXHIBITOR", "TRAINER"])
def test_a_company_does_not_make_anybody_else_show_office(role, monkeypatch):
    """Only an admin could put a scribe in a company, and it must not hand them
    the show's setup and money."""
    assert not _works(role, assigned=True, in_company=True, monkeypatch=monkeypatch)


def test_an_admin_works_every_show(monkeypatch):
    assert _works("ADMIN", monkeypatch=monkeypatch)


# ── Who may change the company from Step 1 ───────────────────────────────────

def test_the_companys_own_staff_manage_it():
    assert may_manage("SHOW_SECRETARY", ME, {ME, COLLEAGUE})


def test_a_guest_on_the_show_does_not():
    """Working one show is not working for the club: the My Company Staff rule."""
    assert not may_manage("SHOW_SECRETARY", GUEST, {ME, COLLEAGUE})


def test_an_admin_manages_every_company():
    assert may_manage("ADMIN", GUEST, {ME, COLLEAGUE})


# ── Who may put the show under a company, or move it ─────────────────────────

def test_a_show_with_no_company_takes_one_of_the_callers():
    assert may_change_company("SHOW_MANAGER", ME, None, {CLUB})


def test_nobody_with_no_company_can_give_it_one():
    assert not may_change_company("SHOW_MANAGER", ME, None, set())


def test_the_companys_staff_move_it_somewhere_else_they_work():
    assert may_change_company("SHOW_MANAGER", ME, {ME, COLLEAGUE}, {CLUB, OTHER_CLUB})


def test_with_nowhere_else_to_go_there_is_no_move():
    assert not may_change_company("SHOW_MANAGER", ME, {ME, COLLEAGUE}, {CLUB})


def test_a_guest_cannot_take_the_show_to_their_own_club():
    """Moving a show changes who works it: a freelance secretary who also works
    for a rival club must not be able to lock the club out of its own show."""
    assert not may_change_company("SHOW_SECRETARY", GUEST, {ME, COLLEAGUE}, {OTHER_CLUB, MY_OWN})


def test_an_admin_may_always_move_it():
    assert may_change_company("ADMIN", GUEST, {ME}, set())
