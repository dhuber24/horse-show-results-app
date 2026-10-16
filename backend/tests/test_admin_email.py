"""Mail to GaitDesk's admins (`show_companies.admin_emails` / `email_admins`).

A contact-form message, an upgrade request and a join request are each emailed
to every admin. What these pin is "every": each unlocked admin's address once,
each sent its own copy, one at a time so a per-second rate limit cannot refuse
the last few, and a refused send tried once more -- with one admin's failure
never costing the others theirs.
"""
import asyncio
import smtplib

import pytest
from sqlalchemy.dialects import postgresql

import mailer
import show_companies
from show_companies import admin_emails, email_admins, unique_addresses


@pytest.fixture(autouse=True)
def no_retry_pause(monkeypatch):
    monkeypatch.setattr(show_companies, "ADMIN_EMAIL_RETRY_SECONDS", 0)


class FakeSend:
    """Stands in for `mailer.send_email`: records every call, answers from a
    script per address (default True), and tracks how many were in flight."""

    def __init__(self, script=None):
        self.calls = []
        self.script = {to: list(answers) for to, answers in (script or {}).items()}
        self.in_flight = 0
        self.most_in_flight = 0

    async def __call__(self, to, subject, body, reply_to=None):
        self.in_flight += 1
        self.most_in_flight = max(self.most_in_flight, self.in_flight)
        await asyncio.sleep(0)  # let anything running alongside get a turn
        self.calls.append((to, subject, body, reply_to))
        self.in_flight -= 1
        answers = self.script.get(to)
        return answers.pop(0) if answers else True


def _run(monkeypatch, recipients, script=None, reply_to=None):
    fake = FakeSend(script)
    monkeypatch.setattr(show_companies, "send_email", fake)
    results = asyncio.run(email_admins(recipients, "Subject", "Body", reply_to))
    return fake, results


def test_every_admin_gets_their_own_copy(monkeypatch):
    admins = ["a@example.com", "b@example.com", "c@example.com"]
    fake, results = _run(monkeypatch, admins, reply_to="sender@example.com")

    assert [call[0] for call in fake.calls] == admins
    assert all(call[3] == "sender@example.com" for call in fake.calls)
    assert results == {to: True for to in admins}


def test_admins_are_mailed_one_at_a_time(monkeypatch):
    fake, _ = _run(monkeypatch, [f"admin{i}@example.com" for i in range(8)])
    assert fake.most_in_flight == 1


def test_a_refused_send_is_tried_once_more(monkeypatch):
    fake, results = _run(monkeypatch, ["a@example.com", "b@example.com"], {"a@example.com": [False, True]})

    assert [call[0] for call in fake.calls] == ["a@example.com", "a@example.com", "b@example.com"]
    assert results == {"a@example.com": True, "b@example.com": True}


def test_one_admin_failing_does_not_cost_the_others(monkeypatch):
    fake, results = _run(
        monkeypatch,
        ["a@example.com", "b@example.com", "c@example.com"],
        {"b@example.com": [False, False]},
    )

    assert results == {"a@example.com": True, "b@example.com": False, "c@example.com": True}
    # Two tries for the one that failed, and no more.
    assert [call[0] for call in fake.calls].count("b@example.com") == 2


def test_no_smtp_is_not_retried(monkeypatch):
    fake, results = _run(monkeypatch, ["a@example.com"], {"a@example.com": [None]})
    assert len(fake.calls) == 1
    assert results == {"a@example.com": None}


def test_an_address_listed_twice_is_mailed_once(monkeypatch):
    fake, _ = _run(monkeypatch, ["a@example.com", " A@Example.com ", "", "b@example.com"])
    assert [call[0] for call in fake.calls] == ["a@example.com", "b@example.com"]


def test_unique_addresses_drops_blanks_and_repeats():
    assert unique_addresses(["x@e.com", None, " ", "X@E.COM", "y@e.com"]) == ["x@e.com", "y@e.com"]


class FakeDb:
    def __init__(self, emails):
        self.emails = emails
        self.statement = None

    async def execute(self, statement):
        self.statement = statement
        emails = self.emails

        class Rows:
            def scalars(self):
                class Scalars:
                    def all(self):
                        return emails
                return Scalars()

        return Rows()


def test_the_recipients_are_every_unlocked_admin():
    db = FakeDb(["one@example.com", None, "ONE@example.com", "two@example.com"])
    assert asyncio.run(admin_emails(db)) == ["one@example.com", "two@example.com"]

    sql = str(db.statement.compile(dialect=postgresql.dialect()))
    assert "users.role =" in sql
    assert "users.is_approved IS true" in sql


def test_the_reply_to_header_reaches_the_message(monkeypatch):
    sent = []

    class FakeSmtp:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def starttls(self):
            pass

        def login(self, *args):
            pass

        def send_message(self, message):
            sent.append(message)

    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(smtplib, "SMTP", FakeSmtp)

    assert asyncio.run(mailer.send_email("admin@example.com", "Hi", "Body", "pat@example.com")) is True
    assert sent[0]["To"] == "admin@example.com"
    assert sent[0]["Reply-To"] == "pat@example.com"

    sent.clear()
    asyncio.run(mailer.send_email("admin@example.com", "Hi", "Body"))
    assert sent[0]["Reply-To"] is None
