"""The contact form for GaitDesk itself (`routers/gaitdesk_contact.py`).

What these pin: a topic the form never offered is refused, the honeypot is
recognised, and the courtesy email to the admins cannot carry a header the
sender wrote -- the subject is built from their name, and a name is free text.
"""
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from routers.gaitdesk_contact import (
    TOPICS,
    GaitDeskContactCreate,
    is_bot,
    notification_email,
    topic_label,
)


def _body(**overrides) -> GaitDeskContactCreate:
    fields = {
        "topic": "running_shows",
        "sender_name": "Pat Rider",
        "sender_email": "pat@example.com",
        "message": "We run four shows a year. How do we start?",
    }
    fields.update(overrides)
    return GaitDeskContactCreate(**fields)


def _message(**overrides):
    fields = {
        "topic": "problem",
        "sender_name": "Pat Rider",
        "sender_email": "pat@example.com",
        "sender_phone": None,
        "organization": None,
        "subject": None,
        "message": "The results page will not load.",
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def test_every_topic_the_form_offers_is_accepted():
    for key in TOPICS:
        assert _body(topic=key).topic == key


def test_a_topic_the_form_never_offered_is_refused():
    with pytest.raises(ValidationError):
        _body(topic="free_money")


def test_there_is_always_somewhere_for_a_message_to_go():
    assert "other" in TOPICS


def test_a_retired_topic_still_reads_as_something():
    assert topic_label("old_topic") == "Old topic"


def test_the_hidden_field_marks_a_bot():
    assert is_bot(_body(website="http://spam.example"))
    assert not is_bot(_body())
    assert not is_bot(_body(website="   "))


def test_an_empty_message_is_refused():
    with pytest.raises(ValidationError):
        _body(message="")


def test_the_email_subject_is_one_line_whatever_the_name_says():
    subject, _ = notification_email(_message(sender_name="Pat\r\nBcc: everyone@example.com"), None)
    assert "\n" not in subject and "\r" not in subject
    assert subject.startswith("GaitDesk contact: Reporting a problem")


def test_the_email_says_whether_the_sender_was_signed_in():
    _, anonymous = notification_email(_message(), None)
    assert "Not signed in." in anonymous

    account = SimpleNamespace(full_name="Pat Rider", email="pat@example.com", role="SHOW_SECRETARY")
    _, signed_in = notification_email(_message(), account)
    assert "Signed in as: Pat Rider (pat@example.com, SHOW_SECRETARY)" in signed_in


def test_the_email_carries_the_message_and_where_to_find_it():
    _, body = notification_email(_message(organization="Valley Paint Club", subject="Help"), None)
    assert "The results page will not load." in body
    assert "Club or company: Valley Paint Club" in body
    assert "Subject: Help" in body
    assert "/admin/contact-messages" in body
    assert "Replying to this email goes to pat@example.com" in body
