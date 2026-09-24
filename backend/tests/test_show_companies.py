"""Paid features: who has one, and what an endpoint says to somebody who does not.

The switch is a row on a show company (migration 142), and three rules decide
what it reaches. An ADMIN has every feature, because GaitDesk staff support
every customer. Everybody else has what their companies have, and nothing
more. And a key the registry no longer names switches nothing on, so retiring
a feature is deleting its entry rather than a data clean-up somebody has to
remember.

The queries are not tested here -- the repo's tests run without a database on
purpose -- so the gate is exercised with the company lookup replaced.
"""
import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException

import show_companies
from show_companies import (
    FEATURES,
    SHOWBILL_IMPORT,
    features_for,
    feature_not_enabled_message,
    normalize_company_name,
    require_feature,
)


# ── Who has a feature ────────────────────────────────────────────────────────

def test_an_admin_has_every_feature_without_belonging_to_a_company():
    assert features_for("ADMIN", []) == set(FEATURES)


@pytest.mark.parametrize("role", ["SHOW_MANAGER", "SHOW_SECRETARY"])
def test_show_staff_in_no_company_have_nothing(role):
    assert features_for(role, []) == set()


def test_show_staff_have_what_their_companies_switched_on():
    assert features_for("SHOW_MANAGER", [SHOWBILL_IMPORT]) == {SHOWBILL_IMPORT}


def test_a_switch_for_a_feature_the_registry_no_longer_names_turns_nothing_on():
    """Retiring a feature is deleting its registry entry; a leftover row must not
    satisfy a gate for something that no longer exists."""
    assert features_for("SHOW_MANAGER", ["retired_feature", SHOWBILL_IMPORT]) == {SHOWBILL_IMPORT}


def test_the_show_bill_import_is_a_registered_feature():
    feature = FEATURES[SHOWBILL_IMPORT]
    assert feature.key == SHOWBILL_IMPORT
    assert feature.label and feature.description and feature.plan


# ── What a gated endpoint says ───────────────────────────────────────────────

def test_a_gate_on_an_unregistered_feature_fails_when_it_is_written():
    """A typo in a gate is a failed startup, not an endpoint nobody can reach."""
    with pytest.raises(ValueError):
        require_feature("showbil_import")


def _run_gate(role: str, company_features: set[str], monkeypatch) -> None:
    async def fake_lookup(db, user_id):
        return company_features

    monkeypatch.setattr(show_companies, "company_features_for_user", fake_lookup)
    gate = require_feature(SHOWBILL_IMPORT)
    asyncio.run(gate(x_user_id=str(uuid4()), x_user_role=role, db=None))


def test_the_gate_lets_in_somebody_whose_company_has_paid(monkeypatch):
    _run_gate("SHOW_SECRETARY", {SHOWBILL_IMPORT}, monkeypatch)


def test_the_gate_lets_in_an_admin_without_looking_anything_up(monkeypatch):
    async def must_not_be_called(db, user_id):
        raise AssertionError("an ADMIN needs no company lookup")

    monkeypatch.setattr(show_companies, "company_features_for_user", must_not_be_called)
    gate = require_feature(SHOWBILL_IMPORT)
    asyncio.run(gate(x_user_id=str(uuid4()), x_user_role="ADMIN", db=None))


def test_the_gate_refuses_somebody_whose_company_has_not_paid(monkeypatch):
    with pytest.raises(HTTPException) as refused:
        _run_gate("SHOW_MANAGER", set(), monkeypatch)
    assert refused.value.status_code == 403
    assert refused.value.detail == feature_not_enabled_message(SHOWBILL_IMPORT)


def test_the_refusal_names_the_feature_the_plan_and_who_to_ask():
    """The same plan the locked button names -- a 403 that says "paid feature"
    while the button says "upgrade to Pro" leaves somebody asking which."""
    message = feature_not_enabled_message(SHOWBILL_IMPORT)
    assert FEATURES[SHOWBILL_IMPORT].label in message
    assert FEATURES[SHOWBILL_IMPORT].plan in message
    assert "GaitDesk" in message


# ── Company names ───────────────────────────────────────────────────────────

def test_a_company_name_is_trimmed_and_its_inner_spaces_closed_up():
    """The unique index compares lower(btrim(name)); two spaces in the middle
    would otherwise make a second company that prints identically."""
    assert normalize_company_name("  Minnesota  Paint\tClub ") == "Minnesota Paint Club"


@pytest.mark.parametrize("typed", [None, "", "   ", "\n\t"])
def test_a_blank_company_name_is_no_name(typed):
    assert normalize_company_name(typed) is None


# ── Where a show manager or secretary belongs (migration 143) ────────────────

from show_companies import (  # noqa: E402
    Placement,
    is_spare_personal_company,
    personal_company_name,
    plan_placement,
)

CLUB = uuid4()
OTHER = uuid4()


@pytest.mark.parametrize("role", ["EXHIBITOR", "SCRIBE", "GATE_STEWARD", "TRAINER", "ADMIN"])
def test_a_role_that_does_not_create_shows_is_put_in_no_company(role):
    assert plan_placement(role, None, None, set()) == Placement()
    assert plan_placement(role, "Minnesota Paint Club", None, set()) == Placement()


@pytest.mark.parametrize("role", ["SHOW_MANAGER", "SHOW_SECRETARY"])
def test_an_independent_gets_a_company_of_their_own(role):
    assert plan_placement(role, None, None, set()) == Placement(personal=True)


def test_somebody_already_in_a_company_is_not_given_another():
    """An admin promoting a club's secretary to manager must not hand them a
    second, personal company beside the club they already work for."""
    assert plan_placement("SHOW_MANAGER", None, None, {CLUB}) == Placement()


def test_a_name_nobody_has_used_creates_that_organization():
    assert plan_placement("SHOW_MANAGER", "Minnesota Paint Club", None, set()) == Placement(
        create_organization="Minnesota Paint Club"
    )


def test_typing_an_existing_organization_asks_to_join_and_never_joins():
    """The rule the whole request exists for: a paid feature reaches every
    account in a company, so knowing a club's name must not buy its plan."""
    placement = plan_placement("SHOW_SECRETARY", "Minnesota Paint Club", CLUB, set())
    assert placement.request_to_join == CLUB
    assert placement.create_organization is None
    # ...and they are never left in no company while the request waits.
    assert placement.personal is True


def test_a_request_from_somebody_already_elsewhere_adds_no_personal_company():
    placement = plan_placement("SHOW_SECRETARY", "Minnesota Paint Club", CLUB, {OTHER})
    assert placement == Placement(request_to_join=CLUB, personal=False)


def test_typing_the_organization_you_are_already_in_changes_nothing():
    assert plan_placement("SHOW_MANAGER", "Minnesota Paint Club", CLUB, {CLUB}) == Placement()


def test_an_independents_company_is_named_the_way_their_account_is():
    assert personal_company_name("  Sarah ", " Johnson ") == "Sarah Johnson"
    assert personal_company_name("Cher", "") == "Cher"


# ── An independent who joins an organization is no longer independent ───────

PERSON = uuid4()
SOMEBODY_ELSE = uuid4()


def test_an_unused_own_company_goes_when_its_person_joins_an_organization():
    assert is_spare_personal_company(PERSON, PERSON, feature_count=0, member_ids={PERSON})


def test_an_own_company_somebody_paid_for_stays():
    """A feature switched on is a payment; retiring the company would lose it."""
    assert not is_spare_personal_company(PERSON, PERSON, feature_count=1, member_ids={PERSON})


def test_an_own_company_other_people_were_added_to_stays():
    assert not is_spare_personal_company(PERSON, PERSON, feature_count=0, member_ids={PERSON, SOMEBODY_ELSE})


def test_nobody_elses_company_and_no_organization_is_ever_spare():
    assert not is_spare_personal_company(SOMEBODY_ELSE, PERSON, feature_count=0, member_ids={PERSON})
    assert not is_spare_personal_company(None, PERSON, feature_count=0, member_ids={PERSON})
