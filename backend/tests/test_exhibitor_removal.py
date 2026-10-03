"""Removing an exhibitor record outright, from the admin's registry.

The delete itself is three statements; what matters is which records it is
allowed near. A record with a login, a show history or a signed waiver holds
something somebody else depends on, and each refusal has to say what to do
instead -- the registry shows the sentence, not the code. Pure function, so no
database (see `tests/factories.py`).
"""
from exhibitor_merge import removal_refusal

EMPTY = dict(shows=0, class_entries=0, horses=0, memberships=0, signatures=0, payments_cents=0)


def summary(**overrides) -> dict:
    return {**EMPTY, **overrides}


def test_an_accountless_record_holding_nothing_may_go():
    assert removal_refusal("Sam Rider", False, summary()) is None


def test_the_persons_own_profile_goes_with_the_record():
    # Horses stay on file (owner name carried to `owner_name`); memberships and
    # documents belonged to nobody else.
    assert removal_refusal("Sam Rider", False, summary(horses=2, memberships=1)) is None


def test_a_record_with_a_login_is_refused_and_pointed_at_users():
    refusal = removal_refusal("Sam Rider", True, summary())
    assert refusal["code"] == "HAS_ACCOUNT"
    assert "Users" in refusal["message"]


def test_the_login_is_named_before_anything_else_it_holds():
    refusal = removal_refusal("Sam Rider", True, summary(shows=1, class_entries=3, signatures=1))
    assert refusal["code"] == "HAS_ACCOUNT"


def test_a_roster_row_is_show_history():
    refusal = removal_refusal("Sam Rider", False, summary(shows=1))
    assert refusal["code"] == "HAS_SHOW_HISTORY"
    assert "1 show)" in refusal["message"]


def test_a_class_entry_without_a_roster_row_is_still_show_history():
    refusal = removal_refusal("Sam Rider", False, summary(class_entries=2))
    assert refusal["code"] == "HAS_SHOW_HISTORY"
    assert "(2 class entries)" in refusal["message"]


def test_show_history_says_what_it_holds_and_what_to_do_instead():
    message = removal_refusal("Sam Rider", False, summary(shows=2, class_entries=1))["message"]
    assert message.startswith("Sam Rider has show history on file (2 shows, 1 class entry).")
    assert "join this record" in message
    assert "registration desk" in message


def test_a_signed_waiver_is_refused_even_off_every_roster():
    refusal = removal_refusal("Sam Rider", False, summary(signatures=1))
    assert refusal["code"] == "HAS_SIGNATURES"
    assert "1 show waiver." in refusal["message"]


def test_missing_figures_read_as_nothing_held():
    assert removal_refusal("Sam Rider", False, {}) is None
