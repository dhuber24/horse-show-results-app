"""GaitDesk Basic and GaitDesk Pro (migration 168).

A company is on a plan, and the plan carries the features; an add-on switch
gives a Basic company one Pro feature. Pro screens used *at* a show ask the
show's company, not the caller's. And the usage statement is each show's
roster at the plan's rate, priced in `billing.py`.

Like the rest of the suite these run without a database, so the gates are
exercised with the show lookup replaced.
"""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import show_companies
from billing import billable_exhibitor_count, platform_usage
from show_companies import (
    ASSOCIATION_EXPORT,
    BASIC,
    DEFAULT_PLAN,
    FEATURES,
    FINANCIAL_REPORTS,
    LIVE_BOARDS,
    ONLINE_PAYMENTS,
    PLANS,
    PRO,
    SHOWBILL_IMPORT,
    combined_features,
    company_features,
    plan_catalog,
    plan_features,
    require_show_feature,
    show_feature_not_enabled_message,
)


# ── What each plan includes and costs ─────────────────────────────────────────

def test_basic_is_two_dollars_and_pro_four_per_exhibitor():
    assert PLANS[BASIC].rate_cents == 200
    assert PLANS[PRO].rate_cents == 400


def test_basic_includes_no_paid_feature():
    """Running the show -- registration, the gate, scribing, live results,
    billing and payment recording -- is not a paid feature at all."""
    assert plan_features(BASIC) == frozenset()


@pytest.mark.parametrize(
    "feature", [SHOWBILL_IMPORT, FINANCIAL_REPORTS, ASSOCIATION_EXPORT, LIVE_BOARDS, ONLINE_PAYMENTS]
)
def test_pro_includes_every_paid_feature(feature):
    assert feature in plan_features(PRO)
    assert FEATURES[feature].plan == PLANS[PRO].label


def test_an_unknown_plan_includes_nothing():
    assert plan_features("platinum") == frozenset()
    assert plan_features(None) == frozenset()


def test_a_new_company_starts_on_free():
    """Existing companies were grandfathered onto Pro by migration 168; since
    169 every company after them starts on Free and picks a plan to set up a
    show."""
    assert DEFAULT_PLAN == "free"


def test_the_catalog_lists_both_plans_with_what_they_include():
    catalog = {p.key: p for p in plan_catalog()}
    assert set(catalog) == {"free", BASIC, PRO, "pro_plus"}
    assert catalog[PRO].includes and catalog[BASIC].includes
    assert set(catalog[PRO].features) == set(FEATURES)


# ── A plan is the only way to a feature (migration 170) ──────────────────────

def test_a_basic_company_has_no_paid_feature():
    assert combined_features([BASIC]) == set()


def test_companies_together_have_the_best_of_their_plans():
    assert combined_features([BASIC, PRO]) == set(FEATURES)


def test_a_loaded_company_has_its_plans_features_and_nothing_else():
    """A leftover switch row from before migration 170 turns nothing on."""
    company = SimpleNamespace(plan=BASIC, renews_pro_plus=False, subscriptions=[], features=[SimpleNamespace(feature=LIVE_BOARDS)])
    assert company_features(company) == set()
    assert company_features(SimpleNamespace(plan=PRO, renews_pro_plus=False, subscriptions=[], features=[])) == set(FEATURES)


# ── The gate at a show ────────────────────────────────────────────────────────

def _run_show_gate(feature: str, role: str, features_at_show: set[str], monkeypatch) -> None:
    async def fake_show_features(db, show_id):
        return features_at_show

    monkeypatch.setattr(show_companies, "show_features", fake_show_features)
    gate = require_show_feature(feature)
    asyncio.run(gate(show_id=uuid4(), x_user_role=role, db=None))


def test_a_show_gate_on_an_unregistered_feature_fails_when_it_is_written():
    with pytest.raises(ValueError):
        require_show_feature("live_bords")


def test_a_pro_show_lets_its_office_in(monkeypatch):
    _run_show_gate(FINANCIAL_REPORTS, "SHOW_SECRETARY", set(plan_features(PRO)), monkeypatch)


def test_a_basic_show_refuses_its_office_and_names_the_plan(monkeypatch):
    with pytest.raises(HTTPException) as refused:
        _run_show_gate(FINANCIAL_REPORTS, "SHOW_MANAGER", set(), monkeypatch)
    assert refused.value.status_code == 403
    assert refused.value.detail == show_feature_not_enabled_message(FINANCIAL_REPORTS)
    assert PLANS[PRO].label in refused.value.detail
    assert "this show's company" in refused.value.detail


def test_an_admin_passes_a_show_gate_without_a_lookup(monkeypatch):
    async def must_not_be_called(db, show_id):
        raise AssertionError("an ADMIN needs no show lookup")

    monkeypatch.setattr(show_companies, "show_features", must_not_be_called)
    asyncio.run(require_show_feature(LIVE_BOARDS)(show_id=uuid4(), x_user_role="ADMIN", db=None))


# ── The usage statement ───────────────────────────────────────────────────────

NOW = datetime(2026, 6, 1, tzinfo=timezone.utc)


def _show_entry(registered: bool = True, cancelled: bool = False):
    return SimpleNamespace(registered_at=NOW if registered else None, cancelled_at=NOW if cancelled else None)


def test_only_the_roster_is_billed():
    """A cancelled registration, and the shell row the office makes for a
    late entry, are nobody the show ran."""
    rows = [_show_entry(), _show_entry(), _show_entry(cancelled=True), _show_entry(registered=False)]
    assert billable_exhibitor_count(rows) == 2


def test_a_show_is_charged_its_exhibitors_at_the_plan_rate():
    assert platform_usage(37, PLANS[PRO].rate_cents) == {
        "exhibitor_count": 37,
        "rate_cents": 400,
        "amount_cents": 14800,
    }
    assert platform_usage(37, PLANS[BASIC].rate_cents)["amount_cents"] == 7400


def test_a_show_with_nobody_on_it_costs_nothing():
    assert platform_usage(0, PLANS[PRO].rate_cents)["amount_cents"] == 0
