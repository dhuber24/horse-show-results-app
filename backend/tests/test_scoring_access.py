"""Who may do a scribe's work at a show: placings, scores, posting, the card.

ADMIN and SCRIBE anywhere, by role, as always. A show manager or secretary at
the shows they work -- and **only** there, which is the rule that fails
quietly: a check that let any secretary through would let one company's
office post another company's results.
"""
import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException

import show_access
from show_access import require_scoring_access

SHOW = uuid4()
USER = str(uuid4())


def check(role, works=False, key="test-key", monkeypatch=None):
    async def fake_works_show(db, show_id, user_id, role_):
        return works

    if monkeypatch is not None:
        monkeypatch.setattr(show_access, "works_show", fake_works_show)
    return asyncio.run(
        require_scoring_access(
            show_id=SHOW, x_api_key=key, x_user_id=USER, x_user_role=role, db=None
        )
    )


@pytest.fixture(autouse=True)
def api_key(monkeypatch):
    monkeypatch.setattr(show_access, "INTERNAL_API_KEY", "test-key")


@pytest.mark.parametrize("role", ["ADMIN", "SCRIBE"])
def test_an_admin_or_scribe_scores_any_show_without_a_lookup(role):
    # db=None: a lookup would fail, so passing proves there was none.
    assert check(role) is None


@pytest.mark.parametrize("role", ["SHOW_MANAGER", "SHOW_SECRETARY"])
def test_the_show_office_scores_the_shows_it_works(role, monkeypatch):
    assert check(role, works=True, monkeypatch=monkeypatch) is None


@pytest.mark.parametrize("role", ["SHOW_MANAGER", "SHOW_SECRETARY"])
def test_the_show_office_does_not_score_another_companys_show(role, monkeypatch):
    with pytest.raises(HTTPException) as refused:
        check(role, works=False, monkeypatch=monkeypatch)
    assert refused.value.status_code == 403


@pytest.mark.parametrize("role", ["EXHIBITOR", "TRAINER", "GATE_STEWARD", "JUDGE"])
def test_nobody_else_scores(role, monkeypatch):
    # Even where a lookup would say yes, these roles never reach it.
    with pytest.raises(HTTPException) as refused:
        check(role, works=True, monkeypatch=monkeypatch)
    assert refused.value.status_code == 403


def test_a_request_without_the_internal_key_is_refused_before_the_role():
    with pytest.raises(HTTPException) as refused:
        check("ADMIN", key="not-the-key")
    assert refused.value.status_code == 401
