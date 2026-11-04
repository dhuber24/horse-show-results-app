"""Manage Subscriptions (migration 179): prices as a dated history, plans given
for free, and an admin reaching a trainer's card subscription.

These pin what somebody is charged and what they can use:

* a price is the latest row on or before its day, so a change never re-prices a
  show that started before it, and can't be set in the past;
* a raise on a show company's plan is refused inside the Terms' 30 days;
* while a comp or trial covers a day the company is on its plan, a show starting
  that day costs nothing, an unpaid Pro+ renewal is lifted, and what the company
  chose is what follows;
* a trainer's comp with no end survives every read of the date, and ending Pro
  ends the card too.
"""
import asyncio
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

import gaitdesk_invoices
import payment_events
import routers.people as people_router
import routers.trainers as trainers_router
import stripe_gateway
from gaitdesk_invoices import company_money, unsettled_shows, usage_statement
from show_companies import (
    BASIC,
    FREE,
    PRO,
    PRO_PLUS,
    covering_grant,
    effective_label,
    effective_plan,
    end_grant,
    frozen_since,
    grant_email,
    grant_plan,
    plan_catalog,
    price_notice_email,
    pro_plus_lapse,
    show_billing_plan,
)
from subscription_prices import (
    BASIC_RATE,
    PRO_PLUS_ANNUAL,
    PRO_RATE,
    STARTING_PRICES,
    TRAINER_MONTHLY,
    PriceBook,
    change_refusal,
)
from trainer_registry import PRO_NO_END, card_state, is_pro, pro_ending_soon

TODAY = date(2026, 11, 3)
EPOCH = date(1970, 1, 1)
BOOK = PriceBook(
    (
        (BASIC_RATE, EPOCH, 200),
        (PRO_RATE, EPOCH, 400),
        (PRO_RATE, date(2027, 1, 1), 500),
        (PRO_PLUS_ANNUAL, EPOCH, 149900),
    )
)


def grant(plan=PRO, kind="trial", starts=TODAY, ends=TODAY + timedelta(days=30)):
    return SimpleNamespace(plan=plan, kind=kind, starts_on=starts, ends_on=ends, id=uuid4())


def year(starts, ends, **extra):
    return SimpleNamespace(starts_on=starts, ends_on=ends, **extra)


# ── A price is a history ──────────────────────────────────────────────────────


def test_a_price_is_the_latest_row_on_or_before_its_day():
    assert BOOK.rate(PRO, date(2026, 12, 31)) == 400
    assert BOOK.rate(PRO, date(2027, 1, 1)) == 500


def test_the_last_price_set_for_a_day_wins():
    book = PriceBook(((BASIC_RATE, EPOCH, 200), (BASIC_RATE, TODAY, 300), (BASIC_RATE, TODAY, 250)))
    assert book.rate(BASIC, TODAY) == 250


def test_free_and_pro_plus_cost_nothing_per_exhibitor():
    assert BOOK.rate(FREE, TODAY) == 0
    assert BOOK.rate(PRO_PLUS, TODAY) == 0


def test_a_missing_row_falls_back_to_the_starting_price_never_to_free():
    assert STARTING_PRICES.rate(BASIC, TODAY) == 200
    assert STARTING_PRICES.rate(PRO, TODAY) == 400
    assert STARTING_PRICES.annual(TODAY) == 149900
    assert STARTING_PRICES.trainer("monthly", TODAY) == 1000
    assert STARTING_PRICES.trainer("annual", TODAY) == 10000


def test_an_upcoming_change_is_read_and_one_that_changes_nothing_is_not():
    assert BOOK.upcoming(PRO_RATE, TODAY) == (date(2027, 1, 1), 500)
    assert BOOK.upcoming(BASIC_RATE, TODAY) is None
    assert BOOK.upcoming(PRO_RATE, date(2027, 1, 1)) is None


def test_the_catalog_says_what_a_plan_costs_today_and_what_is_coming(monkeypatch):
    monkeypatch.setattr("show_companies.utc_today", lambda: TODAY)
    catalog = {p.key: p for p in plan_catalog(BOOK)}
    assert catalog[PRO].rate_cents == 400
    assert catalog[PRO].upcoming_cents == 500 and catalog[PRO].upcoming_on == date(2027, 1, 1)
    assert catalog[BASIC].upcoming_cents is None
    assert catalog[PRO_PLUS].annual_cents == 149900


# ── Changing a price ──────────────────────────────────────────────────────────


def test_a_price_cannot_start_in_the_past():
    message = change_refusal(BOOK, BASIC_RATE, 100, TODAY - timedelta(days=1), TODAY)
    assert "past" in message


def test_a_raise_needs_thirty_days_notice():
    assert "30 days" in change_refusal(BOOK, BASIC_RATE, 300, TODAY + timedelta(days=29), TODAY)
    assert change_refusal(BOOK, BASIC_RATE, 300, TODAY + timedelta(days=30), TODAY) is None


def test_a_cut_can_start_today():
    assert change_refusal(BOOK, BASIC_RATE, 100, TODAY, TODAY) is None


def test_a_raise_is_measured_against_the_price_on_its_own_day():
    """Pro is already scheduled to reach $5 on January 1, so $4.50 from February
    is a cut by then, and needs no notice of its own."""
    assert change_refusal(BOOK, PRO_RATE, 450, date(2027, 2, 1), TODAY) is None


def test_a_trainer_price_needs_no_notice_since_it_reaches_new_subscribers_only():
    assert change_refusal(BOOK, TRAINER_MONTHLY, 2000, TODAY, TODAY) is None


def test_a_price_paid_by_card_cannot_go_below_stripes_minimum():
    assert "50 cents" in change_refusal(BOOK, TRAINER_MONTHLY, 49, TODAY, TODAY)
    assert "50 cents" in change_refusal(BOOK, PRO_PLUS_ANNUAL, 0, TODAY, TODAY)


def test_a_per_exhibitor_price_can_be_free_but_not_negative():
    assert change_refusal(BOOK, BASIC_RATE, 0, TODAY, TODAY) is None
    assert "negative" in change_refusal(BOOK, BASIC_RATE, -1, TODAY, TODAY)


def test_an_unknown_price_and_no_change_are_refused():
    assert change_refusal(BOOK, "gold_rate", 100, TODAY, TODAY)
    assert "already" in change_refusal(BOOK, BASIC_RATE, 200, TODAY, TODAY)


def test_the_price_notice_says_what_a_change_does_not_touch():
    _subject, body = price_notice_email("Minnesota Paint Club", PRO_RATE, 400, 500, date(2027, 1, 1))
    assert "$4 to $5" in body and "January 1, 2027" in body
    assert "starts before January 1, 2027 is billed at the old price" in body
    _subject, body = price_notice_email("Minnesota Paint Club", PRO_PLUS_ANNUAL, 149900, 169900, date(2027, 1, 1))
    assert "$1,499 to $1,699" in body and "already paid for keeps its price" in body


# ── A plan given for free ─────────────────────────────────────────────────────


def test_a_grant_covers_its_days_and_one_with_no_end_runs_on():
    trial = grant(ends=TODAY + timedelta(days=30))
    assert covering_grant([trial], TODAY) is trial
    assert covering_grant([trial], TODAY + timedelta(days=30)) is trial
    assert covering_grant([trial], TODAY + timedelta(days=31)) is None
    assert covering_grant([trial], TODAY - timedelta(days=1)) is None
    assert covering_grant([grant(kind="comp", ends=None)], date(2099, 1, 1)) is not None


def test_a_company_is_on_its_grant_then_back_on_what_it_chose():
    trial = grant(BASIC)
    assert effective_plan(FREE, [], TODAY, grants=[trial]) == BASIC
    assert effective_plan(FREE, [], TODAY + timedelta(days=31), grants=[trial]) == FREE
    assert effective_plan(PRO, [], TODAY + timedelta(days=31), grants=[trial]) == PRO


def test_a_paid_pro_plus_year_beats_a_grant():
    assert effective_plan(FREE, [year(TODAY, TODAY)], TODAY, grants=[grant(BASIC)]) == PRO_PLUS


def test_a_grant_lifts_an_unpaid_renewal_for_as_long_as_it_runs():
    ended = [year(date(2025, 1, 1), date(2025, 12, 31))]
    trial = grant(PRO)
    assert pro_plus_lapse(True, ended, TODAY, [trial]) is None
    assert effective_plan(PRO, ended, TODAY, True, [trial]) == PRO
    assert frozen_since(True, ended, TODAY + timedelta(days=5), TODAY, [trial]) is None
    after = TODAY + timedelta(days=31)
    assert pro_plus_lapse(True, ended, after, [trial]) == date(2026, 1, 1)
    assert frozen_since(True, ended, after, after, [trial]) == date(2026, 1, 1)


def test_the_label_says_a_plan_was_given_and_a_paid_year_does_not_mention_it():
    assert effective_label(PRO, None, grant(PRO, "trial")) == "GaitDesk Pro (free trial)"
    assert effective_label(PRO, None, grant(PRO, "comp")) == "GaitDesk Pro (complimentary)"
    assert effective_label(PRO_PLUS, None, grant(PRO)) == "GaitDesk Pro+"


def _company(**extra):
    defaults = dict(id=uuid4(), name="Minnesota Paint Club", grants=[], upgrade_requests=[])
    return SimpleNamespace(**{**defaults, **extra})


def _give(company, plan=PRO, kind="trial", starts=TODAY, ends=TODAY + timedelta(days=30)):
    return grant_plan(company, plan=plan, kind=kind, starts_on=starts, ends_on=ends, note=" a club we like ", granted_by=None)


def test_giving_a_plan_leaves_the_companys_own_choice_alone():
    company = _company(plan=FREE)
    given = _give(company)
    assert company.plan == FREE
    assert company.grants == [given]
    assert given.note == "a club we like"


def test_a_trial_needs_an_end_and_a_comp_does_not():
    with pytest.raises(HTTPException) as refused:
        _give(_company(), kind="trial", ends=None)
    assert refused.value.status_code == 422
    assert _give(_company(), kind="comp", ends=None).ends_on is None


@pytest.mark.parametrize("plan", [PRO_PLUS, FREE, "gold"])
def test_only_basic_and_pro_can_be_given(plan):
    with pytest.raises(HTTPException):
        _give(_company(), plan=plan)


def test_a_grant_cannot_end_before_it_starts():
    with pytest.raises(HTTPException):
        _give(_company(), ends=TODAY - timedelta(days=1))


@pytest.mark.parametrize(
    "starts, ends",
    [
        (TODAY + timedelta(days=30), TODAY + timedelta(days=40)),  # starts on its last day
        (TODAY - timedelta(days=5), TODAY),  # ends on its first day
        (TODAY - timedelta(days=5), None),  # no end, so it reaches it
    ],
)
def test_two_grants_cannot_overlap(starts, ends):
    company = _company()
    _give(company)
    with pytest.raises(HTTPException) as refused:
        _give(company, kind="comp", starts=starts, ends=ends)
    assert refused.value.status_code == 409


def test_a_grant_can_follow_another():
    company = _company()
    _give(company)
    assert _give(company, starts=TODAY + timedelta(days=31), ends=TODAY + timedelta(days=60))


def test_giving_a_plan_answers_the_requests_it_satisfies(monkeypatch):
    monkeypatch.setattr("show_companies.utc_today", lambda: TODAY)
    asked = SimpleNamespace(feature="live_boards")
    company = _company(upgrade_requests=[asked, SimpleNamespace(feature="pro_plus")])
    _give(company)
    assert [r.feature for r in company.upgrade_requests] == ["pro_plus"]


def test_ending_a_grant_makes_yesterday_its_last_day_so_todays_show_is_not_covered():
    given = grant(starts=TODAY - timedelta(days=10))
    company = _company(grants=[given])
    end_grant(company, given, TODAY)
    assert given.ends_on == TODAY - timedelta(days=1)
    assert covering_grant(company.grants, TODAY) is None
    assert covering_grant(company.grants, TODAY - timedelta(days=5)) is given


def test_ending_a_grant_that_covered_nothing_removes_it():
    given = grant(starts=TODAY)
    company = _company(grants=[given])
    end_grant(company, given, TODAY)
    assert company.grants == []


def test_ending_a_grant_already_over_changes_nothing():
    given = grant(starts=TODAY - timedelta(days=10), ends=TODAY - timedelta(days=5))
    end_grant(_company(grants=[given]), given, TODAY)
    assert given.ends_on == TODAY - timedelta(days=5)


def test_the_email_says_what_follows_a_trial():
    given = grant(BASIC, ends=date(2026, 12, 1))
    _subject, body = grant_email("Minnesota Paint Club", given, FREE, prices=STARTING_PRICES)
    assert "December 1, 2026" in body
    assert "can't set up a new show" in body
    assert "$2 per exhibitor" in body
    _subject, body = grant_email("Minnesota Paint Club", grant(PRO, ends=date(2026, 12, 1)), PRO, prices=STARTING_PRICES)
    assert "goes back to GaitDesk Pro" in body and "$4 per exhibitor" in body
    _subject, body = grant_email("Minnesota Paint Club", grant(PRO, "comp", ends=None), FREE, prices=STARTING_PRICES)
    assert "no end date" in body and "goes back" not in body


# ── What a show costs ─────────────────────────────────────────────────────────


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def scalars(self):
        return self

    def all(self):
        return self.rows


class _UsageDb:
    """Answers `usage_statement`'s two reads: the shows, then their entries."""

    def __init__(self, shows, entries):
        self.answers = [_Rows(shows), _Rows(entries)]

    async def execute(self, _query):
        return self.answers.pop(0)


def _show(start, end=None):
    return SimpleNamespace(
        id=uuid4(), name="Fall Classic", start_date=start, end_date=end or start, status="COMPLETED"
    )


def _usage(company_grants, show, plan=PRO, book=BOOK, monkeypatch=None):
    registered = datetime(2026, 1, 1, tzinfo=timezone.utc)
    entries = [SimpleNamespace(show_id=show.id, registered_at=registered, cancelled_at=None) for _ in range(10)]
    company = SimpleNamespace(
        id=uuid4(),
        name="Minnesota Paint Club",
        plan=plan,
        grants=company_grants,
        subscriptions=[],
        plan_changes=[(datetime(2020, 1, 1, tzinfo=timezone.utc), plan)],
    )
    return asyncio.run(usage_statement(_UsageDb([show], entries), company, book))


@pytest.fixture
def nothing_invoiced(monkeypatch):
    async def none(_db, _company_id):
        return gaitdesk_invoices.Invoiced(shows={}, years={})

    monkeypatch.setattr(gaitdesk_invoices, "invoiced_for_company", none)


def test_a_show_keeps_the_price_in_force_on_its_first_day(nothing_invoiced):
    """Pro goes from $4 to $5 on January 1. A show starting December 31 and
    running into January is still at $4: the Terms promise it."""
    line = _usage([], _show(date(2026, 12, 31), date(2027, 1, 2))).shows[0]
    assert line.rate_cents == 400 and line.amount_cents == 4000


def test_a_show_starting_on_the_day_of_a_change_is_at_the_new_price(nothing_invoiced):
    assert _usage([], _show(date(2027, 1, 1))).shows[0].rate_cents == 500


def test_a_show_starting_inside_a_grant_costs_nothing_and_says_why(nothing_invoiced):
    line = _usage([grant(PRO, "trial")], _show(TODAY)).shows[0]
    assert line.rate_cents == 0 and line.amount_cents == 0
    assert line.billing_plan == PRO
    assert line.billing_plan_label == "GaitDesk Pro (free trial)"


def test_a_show_starting_after_a_grant_ends_is_billed(nothing_invoiced):
    line = _usage([grant(BASIC, "trial")], _show(TODAY + timedelta(days=31)), plan=BASIC).shows[0]
    assert line.rate_cents == 200 and line.amount_cents == 2000


def test_a_show_after_a_trial_on_free_is_billed_as_basic(nothing_invoiced):
    """No show is free: the trial ended, and the company never chose a plan."""
    line = _usage([grant(PRO, "trial")], _show(TODAY + timedelta(days=31)), plan=FREE).shows[0]
    assert line.billing_plan == BASIC and line.rate_cents == 200


def test_a_comped_show_never_holds_the_company_back(nothing_invoiced):
    past = _usage(
        [grant(PRO, "comp", starts=date(2026, 1, 1), ends=None)], _show(TODAY - timedelta(days=1))
    )
    assert unsettled_shows(past, date(2020, 1, 1), TODAY) == []


def test_a_plan_is_ranked_by_what_it_is_not_what_it_costs():
    """An admin may price Basic above Pro. A show held across both is still Pro."""
    changes = [(date(2020, 1, 1), BASIC), (date(2026, 5, 10), PRO)]
    assert show_billing_plan(changes, [], date(2026, 5, 9), date(2026, 5, 11)) == PRO


# ── A company's line on the list ──────────────────────────────────────────────


def _invoice(amount, due, paid=None, void=None, pending=None):
    return SimpleNamespace(amount_cents=amount, due_on=due, paid_on=paid, voided_at=void, payment_pending_at=pending)


def _money(invoices=(), usage=None, years=(), grants=()):
    return company_money(invoices, usage, date(2020, 1, 1), TODAY, years, grants, 30, 7)


def test_the_list_counts_what_is_owed_and_nothing_paid_or_void():
    money = _money(
        [
            _invoice(1000, TODAY + timedelta(days=5)),
            _invoice(2000, TODAY - timedelta(days=5)),
            _invoice(4000, TODAY - timedelta(days=5), paid=TODAY),
            _invoice(8000, TODAY - timedelta(days=5), void=datetime.now(timezone.utc)),
            _invoice(16000, TODAY + timedelta(days=5), pending=datetime.now(timezone.utc)),
        ]
    )
    assert money["open_invoice_count"] == 2
    assert money["overdue_invoice_count"] == 1
    assert money["processing_invoice_count"] == 1
    assert money["open_amount_cents"] == 3000


def test_a_company_with_no_show_has_nothing_to_settle():
    money = _money()
    assert money["show_count"] == 0 and money["unsettled_show_count"] == 0


def test_the_list_flags_a_renewal_due_unless_the_next_year_is_bought():
    ending = year(TODAY - timedelta(days=340), TODAY + timedelta(days=20), payment_received_on=TODAY, price_cents=1)
    assert _money(years=[ending])["renewal_due"] is True
    following = year(TODAY + timedelta(days=21), TODAY + timedelta(days=380), payment_received_on=TODAY, price_cents=1)
    assert _money(years=[ending, following])["renewal_due"] is False


def test_the_list_counts_a_year_owed_but_not_a_complimentary_one():
    owed = year(TODAY, TODAY, payment_received_on=None, price_cents=149900)
    comped = year(TODAY, TODAY, payment_received_on=TODAY, price_cents=0)
    assert _money(years=[owed, comped])["unpaid_year_count"] == 1


def test_the_list_flags_a_grant_ending_within_the_week():
    assert _money(grants=[grant(ends=TODAY + timedelta(days=7))])["grant_ending_soon"] is True
    assert _money(grants=[grant(ends=TODAY + timedelta(days=8))])["grant_ending_soon"] is False
    assert _money(grants=[grant(kind="comp", ends=None)])["grant_ending_soon"] is False


# ── A trainer ─────────────────────────────────────────────────────────────────


def _trainer(**extra):
    defaults = dict(pro_until=None, stripe_subscription_id=None, pro_grant=None, pro_grant_note=None, pro_plan=None)
    return SimpleNamespace(**{**defaults, **extra})


def test_a_comp_with_no_end_is_pro_and_never_ending():
    trainer = _trainer(pro_until=PRO_NO_END, pro_grant="comp")
    assert is_pro(trainer, date(2099, 1, 1))
    assert not pro_ending_soon(trainer, TODAY)


def test_pro_about_to_run_out_is_flagged_unless_a_card_renews_it():
    assert pro_ending_soon(_trainer(pro_until=TODAY + timedelta(days=30)), TODAY)
    assert not pro_ending_soon(_trainer(pro_until=TODAY + timedelta(days=31)), TODAY)
    assert not pro_ending_soon(_trainer(pro_until=TODAY + timedelta(days=5), stripe_subscription_id="sub_1"), TODAY)
    assert not pro_ending_soon(_trainer(pro_until=TODAY - timedelta(days=1)), TODAY)


class _FakeDb:
    def __init__(self, trainer):
        self.trainer = trainer

    async def execute(self, _query):
        trainer = self.trainer
        return SimpleNamespace(scalar_one_or_none=lambda: trainer)


def _renewal(end):
    return {
        "customer": "cus_1",
        "parent": {"subscription_details": {"subscription": "sub_1"}},
        "lines": {"data": [{"period": {"end": int(datetime(end.year, end.month, end.day, 12, tzinfo=timezone.utc).timestamp())}}]},
    }


def test_paying_turns_a_trial_into_a_paid_subscription():
    trainer = _trainer(id=uuid4(), pro_until=TODAY + timedelta(days=5), pro_grant="trial", pro_grant_note="promo")
    assert asyncio.run(payment_events.apply_trainer_renewal(_renewal(TODAY + timedelta(days=30)), _FakeDb(trainer)))
    assert trainer.pro_until == TODAY + timedelta(days=30)
    assert trainer.pro_grant is None and trainer.pro_grant_note is None


def test_paying_never_cuts_short_a_comp_with_no_end():
    trainer = _trainer(id=uuid4(), pro_until=PRO_NO_END, pro_grant="comp")
    asyncio.run(payment_events.apply_trainer_renewal(_renewal(TODAY + timedelta(days=30)), _FakeDb(trainer)))
    assert trainer.pro_until == PRO_NO_END
    assert trainer.pro_grant == "comp"


# ── Deleting a trainer ends their card ────────────────────────────────────────


class _DeleteDb:
    """Records what a delete did, and in what order."""

    def __init__(self, record, flush_error=None):
        self.record = record
        self.flush_error = flush_error
        self.calls = []

    async def get(self, _model, _id):
        return self.record

    async def execute(self, _query):
        record = self.record
        return SimpleNamespace(scalar_one_or_none=lambda: record)

    async def delete(self, _row):
        self.calls.append("delete")

    async def flush(self):
        self.calls.append("flush")
        if self.flush_error:
            raise self.flush_error

    async def commit(self):
        self.calls.append("commit")

    async def rollback(self):
        self.calls.append("rollback")


def _cards(monkeypatch, *, configured=True, error=None):
    cancelled = []

    def cancel(subscription_id):
        if error:
            raise error
        cancelled.append(subscription_id)

    monkeypatch.setattr(stripe_gateway, "configured", lambda: configured)
    monkeypatch.setattr(stripe_gateway, "cancel_subscription", cancel)
    return cancelled


def _on_card(subscription_id="sub_1"):
    return SimpleNamespace(id=uuid4(), user_id=None, stripe_subscription_id=subscription_id)


def test_deleting_a_trainer_cancels_their_card_before_it_commits(monkeypatch):
    cancelled = _cards(monkeypatch)
    db = _DeleteDb(_on_card())
    asyncio.run(trainers_router.delete_trainer(uuid4(), db))
    assert cancelled == ["sub_1"]
    assert db.calls == ["delete", "flush", "commit"]


def test_a_refused_cancellation_deletes_nothing(monkeypatch):
    _cards(monkeypatch, error=stripe_gateway.PaymentError("Stripe said no."))
    db = _DeleteDb(_on_card())
    with pytest.raises(HTTPException) as refused:
        asyncio.run(trainers_router.delete_trainer(uuid4(), db))
    assert refused.value.status_code == 502 and "Stripe said no." in refused.value.detail
    assert "commit" not in db.calls and db.calls[-1] == "rollback"


def test_a_delete_the_database_refuses_cancels_nothing(monkeypatch):
    cancelled = _cards(monkeypatch)
    db = _DeleteDb(_on_card(), flush_error=IntegrityError("delete", {}, Exception("in use")))
    with pytest.raises(HTTPException) as refused:
        asyncio.run(trainers_router.delete_trainer(uuid4(), db))
    assert refused.value.status_code == 409
    assert cancelled == []


def test_a_trainer_with_no_card_never_reaches_stripe(monkeypatch):
    cancelled = _cards(monkeypatch)
    asyncio.run(trainers_router.delete_trainer(uuid4(), _DeleteDb(_on_card(None))))
    assert cancelled == []


def test_without_stripe_keys_a_delete_still_goes_through(monkeypatch):
    cancelled = _cards(monkeypatch, configured=False)
    db = _DeleteDb(_on_card())
    asyncio.run(trainers_router.delete_trainer(uuid4(), db))
    assert cancelled == [] and "commit" in db.calls


def test_deleting_a_trainers_user_account_cancels_their_card_too(monkeypatch):
    cancelled = _cards(monkeypatch)
    db = _DeleteDb(_on_card("sub_2"))
    asyncio.run(people_router.delete_user(uuid4(), db))
    assert cancelled == ["sub_2"]
    assert db.calls.index("flush") < db.calls.index("commit")


def test_a_refused_cancellation_keeps_the_user_account(monkeypatch):
    _cards(monkeypatch, error=stripe_gateway.PaymentError("Stripe said no."))
    db = _DeleteDb(_on_card())
    with pytest.raises(HTTPException) as refused:
        asyncio.run(people_router.delete_user(uuid4(), db))
    assert refused.value.status_code == 502
    assert "commit" not in db.calls


# ── A card subscription, as Stripe has it ─────────────────────────────────────


def test_a_subscription_renews_until_something_says_otherwise():
    assert card_state({"status": "active"})["renews"] is True
    assert card_state({"status": "active", "cancel_at_period_end": True})["renews"] is False
    # Stripe's portal may set a date rather than the flag.
    assert card_state({"status": "active", "cancel_at": 1_800_000_000})["renews"] is False
    assert card_state({"status": "canceled"})["renews"] is False


@pytest.mark.parametrize(
    "subscription",
    [
        {"status": "active", "current_period_end": 1_800_000_000},
        {"status": "active", "items": {"data": [{"current_period_end": 1_800_000_000}]}},
    ],
)
def test_the_period_end_is_read_in_every_api_version(subscription):
    assert card_state(subscription)["period_end"] == date(2027, 1, 15)


def test_with_no_period_nothing_is_made_up():
    assert card_state({"status": "active"})["period_end"] is None


class _Sub:
    """A fake `stripe` module, for the one call that handles its errors itself."""

    class StripeError(Exception):
        pass

    class CardError(StripeError):
        pass

    class InvalidRequestError(StripeError):
        user_message = None

    def __init__(self, on_cancel, on_retrieve):
        self.Subscription = SimpleNamespace(cancel=on_cancel, retrieve=on_retrieve)


def _raises(error):
    def fail(*_a, **_k):
        raise error

    return fail


def _fake_stripe(monkeypatch, on_cancel, on_retrieve):
    fake = _Sub(on_cancel, on_retrieve)
    monkeypatch.setattr(stripe_gateway, "_sdk", lambda: fake)
    monkeypatch.setattr(stripe_gateway, "secret_key", lambda: "sk_test_placeholder")
    return fake


def test_a_subscription_stripe_no_longer_has_counts_as_ended(monkeypatch):
    missing = _Sub.InvalidRequestError("No such subscription")
    _fake_stripe(monkeypatch, _raises(missing), _raises(missing))
    assert stripe_gateway.cancel_subscription("sub_gone") is None


def test_a_subscription_already_cancelled_counts_as_ended(monkeypatch):
    _fake_stripe(monkeypatch, _raises(_Sub.InvalidRequestError("done")), lambda *_a, **_k: {"status": "canceled"})
    assert stripe_gateway.cancel_subscription("sub_done") is None


def test_a_refused_cancellation_of_a_live_subscription_is_reported(monkeypatch):
    _fake_stripe(monkeypatch, _raises(_Sub.InvalidRequestError("no")), lambda *_a, **_k: {"status": "active"})
    with pytest.raises(stripe_gateway.PaymentError):
        stripe_gateway.cancel_subscription("sub_live")


def test_stripe_being_down_is_reported_not_taken_for_ended(monkeypatch):
    _fake_stripe(monkeypatch, _raises(_Sub.StripeError("down")), _raises(_Sub.StripeError("down")))
    with pytest.raises(stripe_gateway.PaymentError):
        stripe_gateway.cancel_subscription("sub_live")
