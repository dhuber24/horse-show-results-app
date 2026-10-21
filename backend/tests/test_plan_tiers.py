"""GaitDesk Free and Pro+, and how a show is priced once a company picks its
own plan (migration 169).

Free sets up no show. Pro+ is a prepaid year: every Pro feature, no
per-exhibitor charge for a show that starts in it -- and since migration 175
it renews as Pro+, freezing the company's unfinished shows while the renewal
is unpaid, unless the company chose Basic or Pro to follow it. Because a
company now chooses its plan, a show is priced at the highest plan the
company held across its dates.

Pure functions only; the suite runs without a database.
"""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from show_companies import (
    BASIC,
    FEATURES,
    FREE,
    PLANS,
    PRO,
    PRO_PLUS,
    REQUESTABLE,
    RENEWAL_NOTICE_DAYS,
    effective_plan,
    frozen_since,
    keep_pro_plus,
    next_pro_plus_term,
    pro_plus_lapse,
    plan_confirmation_email,
    plan_features,
    renewal_reminder_due,
    renewal_reminder_email,
    set_company_plan,
    sets_up_shows,
    show_billing_plan,
    show_setup_choice,
)


def year(starts: date, ends: date, sent=None):
    return SimpleNamespace(starts_on=starts, ends_on=ends, renewal_reminder_sent_at=sent)


def at(day: date, plan: str):
    return (datetime(day.year, day.month, day.day, 15, tzinfo=timezone.utc), plan)


JAN1 = date(2026, 1, 1)
DEC31 = date(2026, 12, 31)


# ── The tiers ─────────────────────────────────────────────────────────────────

def test_pro_plus_is_1499_a_year_with_every_pro_feature_and_no_per_exhibitor_charge():
    pro_plus = PLANS[PRO_PLUS]
    assert pro_plus.annual_cents == 149900
    assert pro_plus.rate_cents == 0
    assert plan_features(PRO_PLUS) == plan_features(PRO) == frozenset(FEATURES)


def test_free_sets_up_no_show_and_every_paid_plan_does():
    assert not sets_up_shows(FREE)
    assert all(sets_up_shows(p) for p in (BASIC, PRO, PRO_PLUS))


def test_a_company_picks_basic_or_pro_itself_but_asks_for_pro_plus():
    assert PLANS[BASIC].self_serve and PLANS[PRO].self_serve
    assert not PLANS[PRO_PLUS].self_serve and not PLANS[FREE].self_serve
    assert PRO_PLUS in REQUESTABLE


# ── What a company is on today ────────────────────────────────────────────────

def test_a_paid_year_makes_the_company_pro_plus_while_it_lasts():
    terms = [year(JAN1, DEC31)]
    assert effective_plan(BASIC, terms, date(2026, 6, 1)) == PRO_PLUS
    assert effective_plan(BASIC, terms, DEC31) == PRO_PLUS


def test_a_company_that_chose_a_plan_to_follow_pro_plus_moves_onto_it():
    assert effective_plan(PRO, [year(JAN1, DEC31)], date(2027, 1, 1)) == PRO


# ── Pro+ renews as Pro+ (migration 175) ───────────────────────────────────────

def test_an_unpaid_renewal_puts_the_company_on_no_plan_from_the_day_after():
    terms = [year(JAN1, DEC31)]
    assert pro_plus_lapse(True, terms, DEC31) is None
    assert pro_plus_lapse(True, terms, date(2027, 1, 1)) == date(2027, 1, 1)
    assert pro_plus_lapse(True, terms, date(2027, 3, 1)) == date(2027, 1, 1)
    # On no plan: it sets up no show and has no feature until it pays or picks one.
    assert effective_plan(PRO, terms, date(2027, 1, 1), renews=True) == FREE


def test_a_company_that_does_not_renew_never_lapses():
    assert pro_plus_lapse(False, [year(JAN1, DEC31)], date(2027, 1, 1)) is None


def test_a_company_waiting_on_its_first_year_has_not_lapsed():
    assert pro_plus_lapse(True, [year(date(2026, 2, 1), date(2027, 1, 31))], JAN1) is None


def test_a_show_running_when_the_year_runs_out_freezes_mid_show():
    terms = [year(JAN1, DEC31)]
    assert frozen_since(True, terms, date(2027, 1, 2), date(2027, 1, 1)) == date(2027, 1, 1)


def test_a_show_still_to_come_is_frozen():
    assert frozen_since(True, [year(JAN1, DEC31)], date(2027, 5, 10), date(2027, 1, 5)) == date(2027, 1, 1)


def test_a_show_that_finished_inside_the_year_stays_open():
    assert frozen_since(True, [year(JAN1, DEC31)], DEC31, date(2027, 1, 5)) is None


def test_nothing_freezes_while_a_year_covers_today_or_once_the_renewal_is_paid():
    terms = [year(JAN1, DEC31), year(date(2027, 1, 1), date(2027, 12, 31))]
    assert frozen_since(True, terms, date(2027, 5, 10), date(2027, 1, 5)) is None


def test_a_renewal_paid_late_is_backdated_to_the_day_after_the_year_ended():
    assert next_pro_plus_term(DEC31, date(2027, 2, 10), renewing=True) == (date(2027, 1, 1), date(2027, 12, 31))


def test_a_renewal_a_whole_year_late_starts_today():
    assert next_pro_plus_term(DEC31, date(2028, 1, 5), renewing=True)[0] == date(2028, 1, 5)


def _renewing(plan=PRO, renews=True, terms=None):
    return SimpleNamespace(
        id=uuid4(), plan=plan, renews_pro_plus=renews, subscriptions=terms or [], upgrade_requests=[]
    )


def test_picking_basic_or_pro_stops_pro_plus_renewing_and_unfreezes_the_company():
    company = _renewing(PRO, terms=[year(JAN1, DEC31)])
    db = _Db()
    assert set_company_plan(company, BASIC, None, db) is True
    assert company.renews_pro_plus is False and company.plan == BASIC
    assert pro_plus_lapse(company.renews_pro_plus, company.subscriptions, date(2027, 1, 5)) is None


def test_picking_the_plan_it_already_holds_still_stops_the_renewal_and_is_logged():
    company = _renewing(PRO)
    db = _Db()
    assert set_company_plan(company, PRO, None, db) is True
    assert company.renews_pro_plus is False and [row.plan for row in db.added] == [PRO]
    assert set_company_plan(company, PRO, None, db) is False


def test_pro_plus_goes_back_on_renewing_only_during_a_year():
    today = date.today()
    company = _renewing(BASIC, renews=False, terms=[year(today - timedelta(days=10), today + timedelta(days=300))])
    db = _Db()
    assert keep_pro_plus(company, None, db) is True and company.renews_pro_plus is True
    assert [row.plan for row in db.added] == [PRO_PLUS]
    lapsed = _renewing(BASIC, renews=False, terms=[year(today - timedelta(days=400), today - timedelta(days=36))])
    with pytest.raises(HTTPException) as refused:
        keep_pro_plus(lapsed, None, _Db())
    assert refused.value.status_code == 409


def test_an_unknown_plan_is_free():
    assert effective_plan("platinum", [], JAN1) == FREE


# ── Pricing a show ────────────────────────────────────────────────────────────

def test_a_show_starting_inside_a_pro_plus_year_is_covered():
    assert show_billing_plan([at(JAN1, PRO)], [year(JAN1, DEC31)], date(2026, 12, 30), date(2027, 1, 2)) == PRO_PLUS


def test_a_show_is_priced_at_the_plan_in_effect_on_its_first_day():
    changes = [at(date(2026, 1, 1), BASIC), at(date(2026, 3, 1), PRO)]
    assert show_billing_plan(changes, [], date(2026, 2, 10), date(2026, 2, 12)) == BASIC
    assert show_billing_plan(changes, [], date(2026, 4, 10), date(2026, 4, 12)) == PRO


def test_moving_down_during_the_show_does_not_lower_its_price():
    """Run Pro on Saturday, switch to Basic on Sunday: the show was a Pro show."""
    changes = [at(date(2026, 1, 1), PRO), at(date(2026, 5, 10), BASIC)]
    assert show_billing_plan(changes, [], date(2026, 5, 9), date(2026, 5, 10)) == PRO


def test_moving_up_during_the_show_prices_it_at_the_higher_plan():
    changes = [at(date(2026, 1, 1), BASIC), at(date(2026, 5, 10), PRO)]
    assert show_billing_plan(changes, [], date(2026, 5, 9), date(2026, 5, 10)) == PRO


def test_a_change_after_the_show_closes_does_not_touch_it():
    changes = [at(date(2026, 1, 1), PRO), at(date(2026, 5, 11), BASIC)]
    assert show_billing_plan(changes, [], date(2026, 5, 9), date(2026, 5, 10)) == PRO


def test_no_show_is_free_even_at_a_company_that_was_on_free():
    assert show_billing_plan([at(JAN1, FREE)], [], date(2026, 2, 1), date(2026, 2, 2)) == BASIC


def test_a_show_from_before_the_first_logged_change_takes_the_earliest_plan():
    assert show_billing_plan([at(date(2026, 6, 1), PRO)], [], date(2026, 2, 1), date(2026, 2, 2)) == PRO


def test_a_company_with_no_history_is_priced_at_basic():
    assert show_billing_plan([], [], JAN1, JAN1) == BASIC


# ── A Pro+ year ───────────────────────────────────────────────────────────────

def test_a_new_year_runs_from_today_to_the_day_before_its_anniversary():
    assert next_pro_plus_term(None, date(2026, 10, 17)) == (date(2026, 10, 17), date(2027, 10, 16))


def test_a_renewal_paid_early_starts_the_day_after_the_current_year_ends():
    assert next_pro_plus_term(date(2026, 12, 31), date(2026, 12, 1)) == (date(2027, 1, 1), date(2027, 12, 31))


def test_a_lapsed_year_renewed_late_starts_today():
    assert next_pro_plus_term(date(2026, 1, 31), date(2026, 3, 5))[0] == date(2026, 3, 5)


def test_a_year_starting_on_29_february_ends_on_27_february():
    assert next_pro_plus_term(None, date(2028, 2, 29)) == (date(2028, 2, 29), date(2029, 2, 27))


# ── The renewal reminder ──────────────────────────────────────────────────────

def test_the_reminder_is_due_a_month_before_the_year_ends():
    term = year(JAN1, DEC31)
    assert not renewal_reminder_due(term, [term], DEC31 - timedelta(days=RENEWAL_NOTICE_DAYS + 1))
    assert renewal_reminder_due(term, [term], DEC31 - timedelta(days=RENEWAL_NOTICE_DAYS))
    assert renewal_reminder_due(term, [term], DEC31)


def test_the_reminder_goes_once():
    term = year(JAN1, DEC31, sent=datetime(2026, 12, 2, tzinfo=timezone.utc))
    assert not renewal_reminder_due(term, [term], date(2026, 12, 10))


def test_a_year_already_renewed_gets_no_reminder():
    term, renewal = year(JAN1, DEC31), year(date(2027, 1, 1), date(2027, 12, 31))
    assert not renewal_reminder_due(term, [term, renewal], date(2026, 12, 10))


def test_the_reminder_says_when_and_what_happens_without_renewal():
    subject, body = renewal_reminder_email("Minnesota Paint Club", DEC31, PRO)
    assert "December 31" in subject
    assert "$1,499" in body
    assert "GaitDesk Pro" in body and "$4 per exhibitor" in body
    assert "Nothing is lost" in body


def test_the_reminder_for_a_company_returning_to_basic_says_pro_features_turn_off():
    _subject, body = renewal_reminder_email("Minnesota Paint Club", DEC31, BASIC)
    assert "GaitDesk Basic" in body and "turn off" in body


def test_the_reminder_for_a_company_that_renews_says_its_shows_freeze():
    _subject, body = renewal_reminder_email("Minnesota Paint Club", DEC31, PRO, renews=True)
    assert "frozen" in body and "choose GaitDesk Basic or Pro" in body
    assert "Exhibitors can still sign up" in body


# ── Telling the company it is subscribed ──────────────────────────────────────

def test_the_basic_and_pro_confirmations_say_nothing_is_charged_until_after_the_show():
    for plan, price in ((BASIC, "$2"), (PRO, "$4")):
        subject, body = plan_confirmation_email("Minnesota Paint Club", plan)
        assert PLANS[plan].label in subject
        assert f"{price} per exhibitor" in body and "after the show" in body


def test_the_pro_plus_confirmation_gives_the_dates_and_what_follows():
    _subject, body = plan_confirmation_email(
        "Minnesota Paint Club", PRO_PLUS, term=(JAN1, DEC31), returns_to=PRO
    )
    assert "January 1, 2026" in body and "December 31, 2026" in body
    assert "a month before it ends" in body and "GaitDesk Pro" in body


def test_the_pro_plus_confirmation_says_it_renews_and_what_freezes_meanwhile():
    _subject, body = plan_confirmation_email(
        "Minnesota Paint Club", PRO_PLUS, term=(JAN1, DEC31), renews=True
    )
    assert "renews as GaitDesk Pro+ for $1,499" in body and "frozen" in body


# ── Setting up a show ─────────────────────────────────────────────────────────

CLUB, OWN, OTHER = uuid4(), uuid4(), uuid4()


def test_a_caller_whose_companies_are_all_on_free_cannot_set_up_a_show():
    with pytest.raises(HTTPException) as refused:
        show_setup_choice([(CLUB, None, "Minnesota Paint Club", FREE)], "SHOW_MANAGER")
    assert refused.value.status_code == 403
    assert "Minnesota Paint Club is on GaitDesk Free" in refused.value.detail
    assert "nothing is charged until after the show" in refused.value.detail


def test_an_independent_on_free_is_told_about_their_account_not_their_own_name():
    with pytest.raises(HTTPException) as refused:
        show_setup_choice([(OWN, uuid4(), "Jane Smith", FREE)], "SHOW_SECRETARY")
    assert refused.value.detail.startswith("Your account is on GaitDesk Free")


def test_a_show_goes_to_the_company_that_can_run_it():
    """A freelancer whose own company is on Free and whose club is on Basic
    sets the show up under the club."""
    companies = [(OWN, uuid4(), "Jane Smith", FREE), (CLUB, None, "Minnesota Paint Club", BASIC)]
    assert show_setup_choice(companies, "SHOW_SECRETARY") == CLUB


def test_a_pro_plus_company_sets_up_shows():
    assert show_setup_choice([(CLUB, None, "Club", PRO_PLUS)], "SHOW_MANAGER") == CLUB


def test_two_companies_that_can_run_it_leave_the_choice_to_step_1():
    companies = [(CLUB, None, "Club", PRO), (OTHER, None, "Other Club", BASIC)]
    assert show_setup_choice(companies, "SHOW_MANAGER") is None


def test_an_admin_is_never_refused():
    assert show_setup_choice([], "ADMIN") is None


def test_a_company_whose_pro_plus_renewal_is_unpaid_is_told_so_not_that_it_is_on_free():
    with pytest.raises(HTTPException) as refused:
        show_setup_choice(
            [(CLUB, None, "Minnesota Paint Club", FREE)], "SHOW_MANAGER", lapsed={CLUB: date(2027, 1, 1)}
        )
    assert refused.value.detail.startswith("Minnesota Paint Club's GaitDesk Pro+ year ended on December 31, 2026")
    assert "Renew it, or choose GaitDesk Basic or Pro" in refused.value.detail


# ── Starting a Pro+ year without a payment (migration 171) ────────────────────

from show_companies import record_pro_plus  # noqa: E402


class _Db:
    def __init__(self):
        self.added = []

    def add(self, row):
        self.added.append(row)


def _company(plan=BASIC):
    return SimpleNamespace(id=uuid4(), plan=plan, renews_pro_plus=False, subscriptions=[], upgrade_requests=[])


def _start(company, price_cents, received_on, db=None):
    return record_pro_plus(
        company,
        starts_on=JAN1,
        ends_on=DEC31,
        price_cents=price_cents,
        payment_method=None,
        payment_reference=None,
        recorded_by=None,
        db=db or _Db(),
        payment_received_on=received_on,
    )


def test_an_admin_can_start_a_pro_plus_year_before_it_is_paid_for():
    company = _company()
    term = _start(company, 149900, None)
    assert term.payment_received_on is None
    assert effective_plan(company.plan, company.subscriptions, date(2026, 6, 1)) == PRO_PLUS


def test_a_paid_year_records_the_day_it_was_paid():
    term = _start(_company(), 149900, date(2026, 1, 5))
    assert term.payment_received_on == date(2026, 1, 5)


def test_a_complimentary_year_is_never_owed():
    term = _start(_company(), 0, None)
    assert term.price_cents == 0 and term.payment_received_on is not None


def test_a_company_given_pro_plus_renews_it_and_keeps_its_own_plan_as_it_was():
    """Migration 175: Pro+ renews as Pro+. A Free company is no longer moved to
    Pro for after it -- nothing follows Pro+ unless the company chooses it."""
    db = _Db()
    company = _company(FREE)
    _start(company, 149900, None, db)
    assert company.renews_pro_plus is True
    assert company.plan == FREE and [row.plan for row in db.added] == [PRO_PLUS]


def test_a_show_that_started_while_a_renewal_was_unpaid_is_priced_by_the_plan_picked_after():
    """Pro before Pro+, the renewal lapses, the show starts frozen and the
    company picks Basic mid-show: a Basic show, not a Pro one."""
    changes = [at(date(2025, 1, 1), PRO), at(JAN1, PRO_PLUS), at(date(2027, 2, 6), BASIC)]
    assert show_billing_plan(changes, [year(JAN1, DEC31)], date(2027, 2, 5), date(2027, 2, 7)) == BASIC


def test_a_show_inside_a_pro_plus_year_is_still_covered_with_pro_plus_in_the_log():
    changes = [at(date(2025, 1, 1), PRO), at(JAN1, PRO_PLUS)]
    assert show_billing_plan(changes, [year(JAN1, DEC31)], date(2026, 6, 1), date(2026, 6, 2)) == PRO_PLUS
