"""The welcome a new account is sent: facts for its role, and tips to start.

What these pin: every role an account can hold has a welcome of its own, so a
new role cannot ship with a generic one by accident; the message never tells
somebody to sign in with a password they were never given; and sending it
never raises, because an account is already committed by the time it goes.
"""
import asyncio

import pytest

import welcome_email
from routers.people import VALID_ROLES
from welcome_email import (
    FALLBACK_WELCOME,
    ROLE_WELCOMES,
    send_welcome_email,
    welcome_for,
    welcome_message,
)


@pytest.fixture(autouse=True)
def _public_url(monkeypatch):
    monkeypatch.setenv("PUBLIC_APP_URL", "https://gaitdesk.example/")


# ── Every role has its own welcome ────────────────────────────────────────────


@pytest.mark.parametrize("role", sorted(VALID_ROLES))
def test_every_role_has_a_welcome_of_its_own(role):
    """A role added to `VALID_ROLES` without an entry here would be welcomed
    with the fallback, which says nothing about what that person can do."""
    assert role in ROLE_WELCOMES


@pytest.mark.parametrize("role", sorted(ROLE_WELCOMES))
def test_every_welcome_has_facts_and_a_couple_of_tips(role):
    welcome = ROLE_WELCOMES[role]
    assert len(welcome.facts) >= 3
    assert len(welcome.tips) >= 2
    assert welcome.start_path.startswith("/")


# ── What the message says ─────────────────────────────────────────────────────


@pytest.mark.parametrize("role", sorted(ROLE_WELCOMES))
def test_the_message_greets_by_name_and_says_where_to_sign_in(role):
    subject, body = welcome_message("Jolene", "jolene@example.com", role)

    assert subject == "Welcome to GaitDesk"
    assert body.startswith("Hi Jolene,")
    assert f"GaitDesk {ROLE_WELCOMES[role].label} account" in body
    # The trailing slash on PUBLIC_APP_URL is not doubled into the links.
    assert "Sign in at https://gaitdesk.example/login with jolene@example.com." in body
    assert f"https://gaitdesk.example{ROLE_WELCOMES[role].start_path}" in body


@pytest.mark.parametrize("role", sorted(ROLE_WELCOMES))
def test_every_fact_and_tip_reaches_the_body(role):
    _, body = welcome_message("Jolene", "jolene@example.com", role)
    welcome = ROLE_WELCOMES[role]

    for fact in welcome.facts:
        assert fact.format(url="https://gaitdesk.example") in body
    for tip in welcome.tips:
        assert tip.format(url="https://gaitdesk.example") in body
    # No placeholder is left unfilled.
    assert "{url}" not in body


@pytest.mark.parametrize("role", sorted(ROLE_WELCOMES))
def test_every_role_is_told_to_set_a_security_question(role):
    """`/forgot-password` asks the account's own question. Without one, only an
    administrator can reset the password -- learned on the day it is needed."""
    _, body = welcome_message("Jolene", "jolene@example.com", role)
    assert "Set a security question under My Account (https://gaitdesk.example/profile)" in body


def test_tips_are_numbered_with_the_security_question_last():
    _, body = welcome_message("Jolene", "jolene@example.com", "EXHIBITOR")
    tips = [line for line in body.splitlines() if line[:2] in ("1.", "2.", "3.", "4.")]

    assert [line[:2] for line in tips] == ["1.", "2.", "3."]
    assert tips[-1].startswith("3. Set a security question")


# ── An account somebody else made ────────────────────────────────────────────


def test_an_account_set_up_by_staff_says_its_password_came_from_them():
    """The person has never seen this password; telling them only to sign in
    would send them to a login screen they cannot get past."""
    _, body = welcome_message("Pat", "pat@example.com", "SCRIBE", set_up_by_staff=True)
    assert "you didn't choose its password" in body
    assert "Ask whoever set it up for the password" in body


def test_an_account_somebody_signed_up_for_says_nothing_about_that():
    _, body = welcome_message("Pat", "pat@example.com", "EXHIBITOR")
    assert "didn't choose its password" not in body


def test_an_invite_names_the_show_it_assigned():
    _, body = welcome_message(
        "Pat", "pat@example.com", "SCRIBE", show_name="Paint-O-Rama 2026"
    )
    assert "You've been assigned to Paint-O-Rama 2026." in body


def test_no_show_named_without_one():
    _, body = welcome_message("Pat", "pat@example.com", "SCRIBE")
    assert "assigned to" not in body.split("WHAT YOU CAN DO")[0]


# ── Odd input never stops the welcome ────────────────────────────────────────


@pytest.mark.parametrize("first_name", ["", "   ", None])
def test_a_missing_first_name_still_greets(first_name):
    _, body = welcome_message(first_name, "pat@example.com", "EXHIBITOR")
    assert body.startswith("Hi there,")


@pytest.mark.parametrize("role", ["SOMETHING_NEW", "", None])
def test_an_unknown_role_gets_the_plain_welcome(role):
    assert welcome_for(role) is FALLBACK_WELCOME
    _, body = welcome_message("Pat", "pat@example.com", role)
    assert "your GaitDesk account is ready" in body
    # Still told how to reset their own password.
    assert "Set a security question" in body


# ── Sending ──────────────────────────────────────────────────────────────────


def test_sending_hands_the_message_to_the_mailer(monkeypatch):
    sent = []

    async def fake_send(to, subject, body):
        sent.append((to, subject, body))
        return True

    monkeypatch.setattr(welcome_email, "send_email", fake_send)

    result = asyncio.run(
        send_welcome_email("pat@example.com", "Pat", "GATE_STEWARD", set_up_by_staff=True)
    )

    assert result is True
    [(to, subject, body)] = sent
    assert to == "pat@example.com"
    assert subject == "Welcome to GaitDesk"
    assert "GaitDesk Gate Steward account" in body
    assert "you didn't choose its password" in body


def test_without_smtp_nothing_is_sent_and_nothing_raises(monkeypatch):
    """Local dev, a fresh clone: the sign-up has already committed, and the
    welcome quietly does nothing."""
    monkeypatch.delenv("SMTP_HOST", raising=False)
    assert asyncio.run(send_welcome_email("pat@example.com", "Pat", "EXHIBITOR")) is None
