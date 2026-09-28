"""My Company Staff: a company's own managers and secretaries manage its people.

The Show Companies screens stay a GaitDesk admin's, because features and notes
stand for a payment. What moved to the company is who works for it, and the
rules that keep that safe are small enough to pin without a database:

* only show managers and secretaries use the door;
* only the companies they are already in -- so nobody can add themselves to
  a company, only colleagues to their own;
* nobody leaves their own company, and a company's staff cannot leave it empty;
* and nobody is *added* from here at all: the company vouches, a GaitDesk
  admin approves (migration 149), because membership carries paid features.
"""
import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import routers.my_company as my_company
from show_companies import member_removal_refusal, staff_request_email, vouch_for_member

ME, COLLEAGUE, STRANGER = uuid4(), uuid4(), uuid4()


def _company(member_ids, owner=None):
    return SimpleNamespace(
        id=uuid4(),
        name="Minnesota Paint Club",
        owner_user_id=owner,
        members=[SimpleNamespace(user_id=uid) for uid in member_ids],
    )


# ── Who may use the door ─────────────────────────────────────────────────────

@pytest.mark.parametrize("role", ["SHOW_MANAGER", "SHOW_SECRETARY"])
def test_show_office_roles_may_manage_their_company(role):
    assert my_company._caller(str(ME), role) == ME


@pytest.mark.parametrize("role", ["ADMIN", "SCRIBE", "GATE_STEWARD", "EXHIBITOR", "TRAINER"])
def test_nobody_else_uses_this_door(role):
    """An ADMIN manages every company from Show Companies and belongs to none."""
    with pytest.raises(HTTPException) as refused:
        my_company._caller(str(ME), role)
    assert refused.value.status_code == 403


def test_a_member_reaches_their_company(monkeypatch):
    company = _company({ME, COLLEAGUE})

    async def load(_db, _company_id):
        return company

    monkeypatch.setattr(my_company, "_load", load)
    assert asyncio.run(my_company._my_company(company.id, ME, None)) is company


def test_a_company_you_are_not_in_is_refused(monkeypatch):
    """The whole safety of the door: to add anybody you must already be inside,
    so knowing a company's id is not a way into its paid features."""
    company = _company({COLLEAGUE})

    async def load(_db, _company_id):
        return company

    monkeypatch.setattr(my_company, "_load", load)
    with pytest.raises(HTTPException) as refused:
        asyncio.run(my_company._my_company(company.id, STRANGER, None))
    assert refused.value.status_code == 403


# ── Who may be taken out ─────────────────────────────────────────────────────

def _refusal(target, members, owner=None, caller=ME):
    return member_removal_refusal(
        company_name="Minnesota Paint Club",
        owner_user_id=owner,
        target_user_id=target,
        target_name="Jane Smith",
        member_ids=set(members),
        caller_user_id=caller,
    )


def test_a_colleague_may_be_removed():
    assert _refusal(COLLEAGUE, {ME, COLLEAGUE}) is None


def test_you_may_leave_while_somebody_else_stays():
    assert _refusal(ME, {ME, COLLEAGUE}) is None


def test_the_last_person_cannot_leave_the_company_empty():
    message = _refusal(ME, {ME})
    assert message and "only person" in message


def test_an_admin_may_empty_a_company():
    """No caller: the admin's door. Closing a company is GaitDesk's call."""
    assert _refusal(ME, {ME}, caller=None) is None


def test_nobody_is_removed_from_their_own_company():
    for caller in (ME, None):
        message = _refusal(COLLEAGUE, {ME, COLLEAGUE}, owner=COLLEAGUE, caller=caller)
        assert message and "own company" in message


# ── Adding is a request a GaitDesk admin approves (migration 149) ────────────

def _person(uid=None):
    return SimpleNamespace(id=uid or uuid4(), full_name="Jane Smith")


def _with_requests(member_ids, requests=()):
    company = _company(member_ids)
    company.join_requests = list(requests)
    return company


def test_asking_to_add_somebody_is_a_request_never_a_membership():
    company = _with_requests({ME})
    person = _person()
    assert vouch_for_member(company, person, ME) is True
    assert [m.user_id for m in company.members] == [ME]
    [request] = company.join_requests
    assert (request.user_id, request.source, request.vouched_by_user_id) == (person.id, "company", ME)


def test_approving_a_signup_request_vouches_for_it_rather_than_adding():
    person = _person()
    asked = SimpleNamespace(user_id=person.id, source="signup", vouched_by_user_id=None, vouched_at=None)
    company = _with_requests({ME}, [asked])
    assert vouch_for_member(company, person, ME) is True
    assert company.join_requests == [asked] and asked.vouched_by_user_id == ME
    assert [m.user_id for m in company.members] == [ME]


def test_a_second_vouch_changes_nothing_and_mails_nobody():
    person = _person()
    vouched = SimpleNamespace(user_id=person.id, source="company", vouched_by_user_id=COLLEAGUE, vouched_at=None)
    company = _with_requests({ME, COLLEAGUE}, [vouched])
    assert vouch_for_member(company, person, ME) is False
    assert vouched.vouched_by_user_id == COLLEAGUE


def test_somebody_already_in_the_company_is_refused():
    company = _with_requests({ME, COLLEAGUE})
    with pytest.raises(HTTPException) as refused:
        vouch_for_member(company, _person(COLLEAGUE), ME)
    assert refused.value.status_code == 409


def _mail(asked_at_signup):
    return staff_request_email(
        company_id=uuid4(),
        company_name="Minnesota Paint Club",
        voucher_name="Dan Huber",
        voucher_email="dan@example.com",
        person_name="Jane Smith",
        person_email="jane@example.com",
        person_role="SHOW_SECRETARY",
        asked_at_signup=asked_at_signup,
        features=["Start a show from its show bill"],
    )


def test_the_admin_email_says_who_vouched_who_for_and_what_they_would_get():
    subject, body = _mail(asked_at_signup=False)
    assert subject == "Minnesota Paint Club asked to add Jane Smith"
    assert "Dan Huber (dan@example.com) asked to add Jane Smith" in body
    assert "jane@example.com, Show Secretary" in body
    assert "Start a show from its show bill" in body
    assert "/admin/companies/" in body


def test_the_admin_email_says_when_the_person_asked_first():
    _, body = _mail(asked_at_signup=True)
    assert "asked to join when they signed up" in body

