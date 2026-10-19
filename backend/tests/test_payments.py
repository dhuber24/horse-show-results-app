"""Online payments through Stripe (migration 172).

Three kinds of money, and GaitDesk only ever holds its own: a trainer's Pro
subscription and a show company's GaitDesk invoice on GaitDesk's account, and
an exhibitor's payment on the show company's own account. These pin the rules
that decide what anybody is charged, without a database or a Stripe account:

* the card fee is grossed up so the payee nets the amount, capped at the card
  network's 3% ceiling, and added only to a **credit** card -- never debit,
  prepaid, unknown, or a bank payment;
* an invoice is priced off the usage statement, once per show or Pro+ year,
  and only once a show has finished;
* paying an invoice marks its Pro+ years paid, and a second report of the
  same payment changes nothing;
* a Pro subscription invoice moves `pro_until` to the end of the period paid
  for, read the same way in every Stripe API version;
* nothing is offered, and nothing is trusted, without Stripe's keys.
"""
import asyncio
import json
import time
from datetime import date, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest

import payment_events
import stripe_gateway
from billing import (
    CARD_FEE_CAP_BP,
    card_fee_cents,
    invoice_due_on,
    invoice_status,
    payment_quote,
    surcharge_applies,
)
from gaitdesk_invoices import Invoiced, InvoiceRef, InvoiceRefused, invoice_lines
from routers.payments import NOT_AT_THIS_SHOW, NOTHING_TO_PAY, _Context, unavailable_reason
from show_companies import ONLINE_PAYMENTS

TODAY = date(2026, 10, 17)
RATE = (290, 30)  # 2.9% + 30c


# ── The card fee ──────────────────────────────────────────────────────────────

def test_the_fee_is_grossed_up_so_the_payee_nets_the_amount():
    """On $5,000 the cap does not bind: the fee covers the processor's cut of
    the amount *and* of the fee itself."""
    fee = card_fee_cents(500_000, *RATE)
    assert fee == 14_964
    total = 500_000 + fee
    processor_takes = -(-(total * 290) // 10_000) + 30
    assert total - processor_takes >= 500_000 - 1


def test_the_fee_never_exceeds_three_percent():
    """Below about $2,300 the gross-up would pass Visa's 3% ceiling, so the
    payee absorbs the last few cents rather than over-charge."""
    assert card_fee_cents(10_000, *RATE) == 300
    assert card_fee_cents(1_000, *RATE) == 30
    for amount in (100, 2_500, 99_999, 230_000, 1_000_000):
        assert card_fee_cents(amount, *RATE) <= amount * CARD_FEE_CAP_BP // 10_000


def test_nothing_owed_is_no_fee():
    assert card_fee_cents(0, *RATE) == 0
    assert card_fee_cents(-500, *RATE) == 0


@pytest.mark.parametrize(
    "method_type, funding, applies",
    [
        ("card", "credit", True),
        ("card", "debit", False),
        ("card", "prepaid", False),
        ("card", "unknown", False),
        ("card", None, False),
        ("us_bank_account", None, False),
        ("link", None, False),
    ],
)
def test_only_a_credit_card_is_ever_surcharged(method_type, funding, applies):
    assert surcharge_applies(method_type, funding) is applies


def test_a_company_that_absorbs_the_fee_charges_the_balance_alone():
    quote = payment_quote(10_000, "card", "credit", False, *RATE)
    assert quote == {"amount_cents": 10_000, "card_fee_cents": 0, "total_cents": 10_000}


def test_a_company_that_passes_the_fee_on_charges_credit_cards_only():
    assert payment_quote(10_000, "card", "credit", True, *RATE)["total_cents"] == 10_300
    assert payment_quote(10_000, "card", "debit", True, *RATE)["total_cents"] == 10_000
    assert payment_quote(10_000, "us_bank_account", None, True, *RATE)["total_cents"] == 10_000


# ── GaitDesk invoices ─────────────────────────────────────────────────────────

def test_an_invoice_is_due_thirty_days_after_it_is_issued():
    assert invoice_due_on(TODAY) == date(2026, 11, 16)


def _invoice(**kw):
    base = dict(voided_at=None, paid_on=None, payment_pending_at=None, due_on=TODAY + timedelta(days=5))
    base.update(kw)
    return SimpleNamespace(**base)


def test_invoice_status():
    assert invoice_status(_invoice(), TODAY) == "open"
    assert invoice_status(_invoice(due_on=TODAY - timedelta(days=1)), TODAY) == "overdue"
    assert invoice_status(_invoice(payment_pending_at=object()), TODAY) == "processing"
    assert invoice_status(_invoice(paid_on=TODAY, due_on=TODAY - timedelta(days=9)), TODAY) == "paid"
    assert invoice_status(_invoice(voided_at=object(), paid_on=TODAY), TODAY) == "void"


SHOW_A, SHOW_B, SHOW_RUNNING = uuid4(), uuid4(), uuid4()
YEAR_OWED, YEAR_PAID, YEAR_FREE = uuid4(), uuid4(), uuid4()


def _usage():
    def show(show_id, name, end, count, rate):
        return SimpleNamespace(
            show_id=show_id, show_name=name, end_date=end, exhibitor_count=count,
            rate_cents=rate, amount_cents=count * rate, billing_plan="pro" if rate == 400 else "basic",
        )

    def year(year_id, price, paid):
        return SimpleNamespace(
            id=year_id, starts_on=date(2026, 1, 1), ends_on=date(2026, 12, 31),
            price_cents=price, payment_received_on=paid,
        )

    return SimpleNamespace(
        shows=[
            show(SHOW_A, "Spring Fling", date(2026, 5, 3), 120, 400),
            show(SHOW_B, "Summer Classic", date(2026, 7, 12), 80, 200),
            show(SHOW_RUNNING, "Fall Futurity", TODAY + timedelta(days=1), 60, 400),
        ],
        subscriptions=[
            year(YEAR_OWED, 149_900, None),
            year(YEAR_PAID, 149_900, date(2026, 1, 2)),
            year(YEAR_FREE, 0, None),
        ],
    )


def _nothing_invoiced():
    return Invoiced(shows={}, years={})


def test_an_invoice_copies_its_lines_off_the_usage_statement():
    lines = invoice_lines(_usage(), [SHOW_A, SHOW_B], [YEAR_OWED], _nothing_invoiced(), TODAY)
    assert [(l["kind"], l["amount_cents"]) for l in lines] == [
        ("show", 48_000), ("show", 16_000), ("pro_plus", 149_900),
    ]
    assert lines[0]["exhibitor_count"] == 120 and lines[0]["rate_cents"] == 400


def test_a_show_still_running_cannot_be_invoiced():
    with pytest.raises(InvoiceRefused, match="has not finished"):
        invoice_lines(_usage(), [SHOW_RUNNING], [], _nothing_invoiced(), TODAY)


def test_a_show_is_invoiced_once():
    invoiced = Invoiced(shows={SHOW_A: InvoiceRef(uuid4(), "GD-00007")}, years={})
    with pytest.raises(InvoiceRefused, match="GD-00007"):
        invoice_lines(_usage(), [SHOW_A], [], invoiced, TODAY)


@pytest.mark.parametrize("year_id, message", [(YEAR_PAID, "already paid"), (YEAR_FREE, "complimentary")])
def test_a_paid_or_complimentary_year_is_not_invoiced(year_id, message):
    with pytest.raises(InvoiceRefused, match=message):
        invoice_lines(_usage(), [], [year_id], _nothing_invoiced(), TODAY)


def test_another_companys_show_is_refused():
    with pytest.raises(InvoiceRefused, match="not run by this company"):
        invoice_lines(_usage(), [uuid4()], [], _nothing_invoiced(), TODAY)


def test_an_empty_invoice_is_refused():
    with pytest.raises(InvoiceRefused, match="at least one"):
        invoice_lines(_usage(), [], [], _nothing_invoiced(), TODAY)


def _issued_invoice(year_ids):
    return SimpleNamespace(
        id=uuid4(), number=42, paid_on=None, payment_method=None, payment_reference=None,
        card_fee_cents=0, payment_pending_at=object(), stripe_payment_intent_id=None,
        lines=[SimpleNamespace(subscription_id=y) for y in year_ids],
    )


def test_paying_an_invoice_marks_its_pro_plus_years_paid():
    year = SimpleNamespace(id=YEAR_OWED, payment_received_on=None, payment_method=None, payment_reference=None)
    invoice = _issued_invoice([YEAR_OWED])
    assert payment_events.mark_invoice_paid(
        invoice, [year], paid_on=TODAY, method="card", reference="Online, Visa ending 4242",
        card_fee_cents=4_475, payment_intent_id="pi_1",
    )
    assert invoice.paid_on == TODAY and invoice.card_fee_cents == 4_475
    assert invoice.payment_pending_at is None
    assert year.payment_received_on == TODAY
    assert year.payment_reference == "GaitDesk invoice GD-00042"


def test_a_second_report_of_the_same_payment_changes_nothing():
    invoice = _issued_invoice([])
    payment_events.mark_invoice_paid(invoice, [], paid_on=TODAY, method="ach", reference=None)
    assert not payment_events.mark_invoice_paid(
        invoice, [], paid_on=TODAY + timedelta(days=3), method="card", reference=None, card_fee_cents=99
    )
    assert invoice.paid_on == TODAY and invoice.payment_method == "ach" and invoice.card_fee_cents == 0


# ── Trainer Registry Pro ──────────────────────────────────────────────────────

def _subscription_invoice(start: date, end: date, *, old_api: bool):
    def ts(d):
        return int(time.mktime(d.timetuple())) + 12 * 3600

    invoice = {"customer": "cus_1", "lines": {"data": [{"period": {"start": ts(start), "end": ts(end)}}]}}
    if old_api:
        invoice["subscription"] = "sub_1"
    else:
        invoice["parent"] = {"subscription_details": {"subscription": "sub_1"}}
    return invoice


@pytest.mark.parametrize("old_api", [True, False])
def test_a_paid_renewal_is_read_the_same_in_every_api_version(old_api):
    monthly = _subscription_invoice(date(2026, 10, 17), date(2026, 11, 17), old_api=old_api)
    assert payment_events._period_end_and_plan(monthly) == (date(2026, 11, 17), "monthly")
    assert payment_events._invoice_subscription_id(monthly) == "sub_1"
    annual = _subscription_invoice(date(2026, 10, 17), date(2027, 10, 17), old_api=old_api)
    assert payment_events._period_end_and_plan(annual) == (date(2027, 10, 17), "annual")


def test_an_invoice_without_a_period_moves_nothing():
    assert payment_events._period_end_and_plan({"lines": {"data": []}}) == (None, None)


class _FakeDb:
    """Just enough session for the renewal and event handlers."""

    def __init__(self, trainer=None, seen_event=False):
        self.trainer = trainer
        self.seen_event = seen_event
        self.added = []
        self.committed = False

    async def get(self, model, key):
        if model.__name__ == "StripeEvent":
            return object() if self.seen_event else None
        return None

    async def execute(self, statement):
        trainer = self.trainer
        return SimpleNamespace(scalar_one_or_none=lambda: trainer)

    def add(self, row):
        self.added.append(row)

    async def commit(self):
        self.committed = True


def test_a_renewal_moves_pro_until_forward_and_never_back():
    trainer = SimpleNamespace(id=uuid4(), pro_until=date(2026, 12, 25), pro_plan=None, stripe_subscription_id=None)
    db = _FakeDb(trainer)
    invoice = _subscription_invoice(date(2026, 10, 17), date(2026, 11, 17), old_api=False)
    assert asyncio.run(payment_events.apply_trainer_renewal(invoice, db))
    assert trainer.pro_until == date(2026, 12, 25)  # an admin's longer date stands
    assert trainer.stripe_subscription_id == "sub_1"

    trainer.pro_until = date(2026, 10, 1)
    asyncio.run(payment_events.apply_trainer_renewal(invoice, db))
    assert trainer.pro_until == date(2026, 11, 17)
    assert trainer.pro_plan == "monthly"


def test_an_event_already_handled_is_not_applied_again():
    db = _FakeDb(seen_event=True)
    outcome = asyncio.run(payment_events.handle_event({"id": "evt_1", "type": "invoice.paid"}, False, db))
    assert outcome == "duplicate"
    assert db.added == [] and not db.committed


def test_an_event_is_recorded_with_its_effect():
    db = _FakeDb()
    outcome = asyncio.run(payment_events.handle_event(
        {"id": "evt_2", "type": "charge.dispute.created", "data": {"object": {}}}, False, db
    ))
    assert outcome == "ignored"
    assert [r.id for r in db.added] == ["evt_2"] and db.committed


def test_an_online_payment_reads_like_one_on_the_list_with_no_card_digits():
    """No part of a card number is kept in GaitDesk's database (migration 173)."""
    assert payment_events.method_label("card", "visa") == "Online, Visa card"
    assert payment_events.method_label("card") == "Online, card"
    assert payment_events.method_label("us_bank_account") == "Online, bank transfer"
    assert not any(ch.isdigit() for ch in payment_events.method_label("card", "mastercard"))


# ── An exhibitor paying a show company ────────────────────────────────────────

@pytest.fixture
def stripe_keys(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_placeholder")
    monkeypatch.setenv("STRIPE_PUBLISHABLE_KEY", "pk_test_placeholder")


def _ctx(*, connected=True, charges=True, features=(ONLINE_PAYMENTS,), balance=12_500):
    company = SimpleNamespace(
        name="Minnesota Paint Club", stripe_account_id="acct_1" if connected else None,
        stripe_charges_enabled=charges, pass_card_fees=True,
    )
    account = {"balance_cents": balance} if balance is not None else None
    return _Context(SimpleNamespace(id=uuid4()), SimpleNamespace(), company, account, set(features))


def test_an_exhibitor_pays_online_where_everything_is_in_place(stripe_keys):
    assert unavailable_reason(_ctx()) is None


def test_nothing_is_offered_without_stripe(monkeypatch):
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    monkeypatch.delenv("STRIPE_PUBLISHABLE_KEY", raising=False)
    assert unavailable_reason(_ctx()) == stripe_gateway.NOT_CONFIGURED


@pytest.mark.parametrize(
    "ctx_kwargs",
    [{"connected": False}, {"charges": False}, {"features": ()}],
    ids=["no account", "account not finished", "plan without online payments"],
)
def test_a_show_whose_company_cannot_take_payments_says_so(stripe_keys, ctx_kwargs):
    assert unavailable_reason(_ctx(**ctx_kwargs)) == NOT_AT_THIS_SHOW


@pytest.mark.parametrize("balance", [0, -2_000, None], ids=["settled", "in credit", "no account"])
def test_nothing_owed_is_nothing_to_pay(stripe_keys, balance):
    assert unavailable_reason(_ctx(balance=balance)) == NOTHING_TO_PAY


# ── Stripe's keys ─────────────────────────────────────────────────────────────

def test_both_keys_are_needed(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
    monkeypatch.delenv("STRIPE_PUBLISHABLE_KEY", raising=False)
    assert not stripe_gateway.configured()
    monkeypatch.setenv("STRIPE_PUBLISHABLE_KEY", "pk_test_x")
    assert stripe_gateway.configured()


def test_the_card_rate_defaults_to_stripes_standard(monkeypatch):
    monkeypatch.delenv("STRIPE_CARD_PERCENT_BP", raising=False)
    monkeypatch.setenv("STRIPE_CARD_FIXED_CENTS", "not a number")
    assert stripe_gateway.card_rate() == (290, 30)


def test_an_event_is_never_trusted_without_a_signing_secret(stripe_keys, monkeypatch):
    monkeypatch.delenv("STRIPE_WEBHOOK_SECRET", raising=False)
    with pytest.raises(stripe_gateway.BadSignature):
        stripe_gateway.verify_event(b'{"id": "evt_1"}', "t=1,v1=abc")


def test_a_signed_event_is_accepted_and_a_tampered_one_is_not(stripe_keys, monkeypatch):
    stripe = pytest.importorskip("stripe")
    secret = "whsec_test_placeholder"
    monkeypatch.setenv("STRIPE_CONNECT_WEBHOOK_SECRET", secret)
    payload = json.dumps({"id": "evt_3", "type": "account.updated"}).encode()
    stamp = int(time.time())
    signature = stripe.WebhookSignature._compute_signature(f"{stamp}.{payload.decode()}", secret)
    header = f"t={stamp},v1={signature}"
    assert stripe_gateway.verify_event(payload, header, connect=True)["id"] == "evt_3"
    with pytest.raises(stripe_gateway.BadSignature):
        stripe_gateway.verify_event(payload.replace(b"evt_3", b"evt_4"), header, connect=True)
    with pytest.raises(stripe_gateway.BadSignature):
        stripe_gateway.verify_event(payload, header, connect=False)



# ── Settling up after a show (migration 173) ──────────────────────────────────

from gaitdesk_invoices import settle_up_message, unsettled_shows  # noqa: E402

SETTLE_FROM = date(2026, 6, 1)


def _line(name, end, amount, *, invoice=None, settled=False):
    return SimpleNamespace(
        show_id=uuid4(), show_name=name, end_date=end, amount_cents=amount,
        invoice_id=uuid4() if invoice else None, invoice_label=invoice, invoice_settled=settled,
    )


def test_a_finished_unpaid_show_holds_the_company_back():
    usage = SimpleNamespace(shows=[
        _line("Summer Classic", date(2026, 7, 12), 16_000),
        _line("Fall Futurity", date(2026, 10, 16), 24_000, invoice="GD-00003"),
    ])
    held = unsettled_shows(usage, SETTLE_FROM, TODAY)
    assert [l.show_name for l in held] == ["Summer Classic", "Fall Futurity"]


@pytest.mark.parametrize(
    "line",
    [
        _line("Still running", TODAY, 16_000),
        _line("Not finished", TODAY + timedelta(days=2), 16_000),
        _line("Before the rule", SETTLE_FROM - timedelta(days=1), 16_000),
        _line("Inside a Pro+ year", date(2026, 8, 2), 0),
        _line("Paid", date(2026, 8, 9), 16_000, invoice="GD-00002", settled=True),
    ],
    ids=["ends today", "future", "before settle_shows_from", "costs nothing", "paid or bank payment on its way"],
)
def test_these_shows_never_hold_a_company_back(line):
    assert unsettled_shows(SimpleNamespace(shows=[line]), SETTLE_FROM, TODAY) == []


def test_the_block_says_what_is_owed_and_how_to_settle_it():
    message = settle_up_message("Minnesota Paint Club", [_line("Summer Classic", date(2026, 7, 12), 16_000)])
    assert "Summer Classic" in message and "$160.00" in message
    assert "My Company" in message and "check" in message


def test_creating_a_show_is_refused_while_the_company_owes(monkeypatch):
    import show_companies
    from fastapi import HTTPException

    company_id = uuid4()

    async def chosen(db, user_id, role):
        return company_id

    async def owes(db, cid):
        return "owes for Summer Classic" if cid == company_id else None

    monkeypatch.setattr(show_companies, "_show_setup_company", chosen)
    monkeypatch.setattr(show_companies, "settle_up_block", owes)
    with pytest.raises(HTTPException) as refused:
        asyncio.run(show_companies.show_setup_company_for(None, uuid4(), "SHOW_MANAGER"))
    assert refused.value.status_code == 403 and "Summer Classic" in refused.value.detail
    assert asyncio.run(show_companies.show_setup_blocked(None, uuid4(), "SHOW_MANAGER")) == "owes for Summer Classic"


def test_a_company_that_has_paid_sets_up_its_show(monkeypatch):
    import show_companies

    company_id = uuid4()

    async def chosen(db, user_id, role):
        return company_id

    async def clear(db, cid):
        return None

    monkeypatch.setattr(show_companies, "_show_setup_company", chosen)
    monkeypatch.setattr(show_companies, "settle_up_block", clear)
    assert asyncio.run(show_companies.show_setup_company_for(None, uuid4(), "SHOW_MANAGER")) == company_id


# ── A Pro+ year GaitDesk starts on credit is invoiced (migration 173) ─────────

from gaitdesk_invoices import invoice_email, invoice_pay_url  # noqa: E402


def _pro_plus_invoice():
    return SimpleNamespace(
        id=uuid4(), number=7, company_name="Minnesota Paint Club", amount_cents=149_900,
        due_on=date(2026, 11, 17), note=None,
    )


def test_the_invoice_email_links_straight_to_paying_it():
    invoice = _pro_plus_invoice()
    line = SimpleNamespace(kind="pro_plus", description="GaitDesk Pro+, Oct 18, 2026 to Oct 17, 2027",
                           exhibitor_count=None, rate_cents=None, amount_cents=149_900)
    subject, body = invoice_email(
        invoice, [line], pay_online=True,
        intro="GaitDesk has started a Pro+ year for Minnesota Paint Club, and invoice GD-00007 is due for it.",
    )
    assert subject == "GaitDesk invoice GD-00007: $1,499.00 due Nov 17, 2026"
    assert body.startswith("GaitDesk has started a Pro+ year")
    assert invoice_pay_url(invoice) in body
    assert invoice_pay_url(invoice).endswith(f"/admin/my-company?invoice={invoice.id}")
    assert "bank transfer" in body and "check" in body


def test_without_online_payment_the_invoice_email_asks_for_a_check():
    invoice = _pro_plus_invoice()
    _, body = invoice_email(invoice, [], pay_online=False)
    assert "Pay by check" in body and "GD-00007" in body
    assert "credit card" not in body
