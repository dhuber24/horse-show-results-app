"""How the desk reads an exhibitor's contact details off their profile.

Almost all of this is reading columns. The part worth pinning down is which
email address wins, because there are two of them and they answer different
questions:

* `users.email` is what somebody signs in with, so it is an address that
  demonstrably reaches them;
* `exhibitors.email` (migration 140) is what the office wrote on a paper entry
  blank, and it is the *only* address there is for a walk-up record with no
  account.

The account wins where there is one — same precedence as the exhibitor
registry — and a *different* office address is reported beside it rather than
dropped, since that is either the better address or a typo and both are worth
seeing before somebody emails a bill into the void.

The other thing pinned here is that none of it is a check: `_build_contact`
runs after `outstanding` is counted, and an exhibitor with nothing on file is
somebody to telephone rather than paperwork anybody owes.
"""
from types import SimpleNamespace

from routers.show_office import _build_contact


def make_exhibitor(**kwargs):
    """An exhibitor row with every contact column empty unless named."""
    fields = {
        "email": None,
        "phone": None,
        "address": None,
        "city": None,
        "state": None,
        "zip": None,
        "parent_guardian_name": None,
        "parent_guardian_phone": None,
        "user": None,
    }
    fields.update(kwargs)
    return SimpleNamespace(**fields)


def account(email):
    return SimpleNamespace(email=email)


# ── Which email wins ───────────────────────────────────────────────────────────


def test_account_email_wins_over_the_one_the_office_wrote_down():
    contact = _build_contact(
        make_exhibitor(email="desk@example.com", user=account("signin@example.com"))
    )
    assert contact["email"] == "signin@example.com"
    assert contact["email_source"] == "account"


def test_the_office_address_is_still_reported_when_it_differs():
    contact = _build_contact(
        make_exhibitor(email="desk@example.com", user=account("signin@example.com"))
    )
    assert contact["office_email"] == "desk@example.com"


def test_the_same_address_twice_is_not_two_facts():
    """Written down at the desk and later signed up with. One address."""
    contact = _build_contact(
        make_exhibitor(email="Sam@Example.com", user=account("sam@example.com"))
    )
    assert contact["email"] == "sam@example.com"
    assert contact["office_email"] is None


def test_an_office_record_falls_back_to_what_was_written_down():
    """No account at all — the entry blank is the only address there is."""
    contact = _build_contact(make_exhibitor(email="walkup@example.com"))
    assert contact["email"] == "walkup@example.com"
    assert contact["email_source"] == "office"
    # Not a second copy of the one already shown.
    assert contact["office_email"] is None


def test_an_account_with_no_office_address_reports_no_second_one():
    contact = _build_contact(make_exhibitor(user=account("only@example.com")))
    assert contact["email"] == "only@example.com"
    assert contact["email_source"] == "account"
    assert contact["office_email"] is None


def test_no_address_anywhere_names_no_source():
    contact = _build_contact(make_exhibitor())
    assert contact["email"] is None
    assert contact["email_source"] is None


# ── Blank is missing, not a value ──────────────────────────────────────────────


def test_whitespace_is_not_an_email_address():
    """A saved-then-emptied box leaves "" behind, which must read as missing
    rather than as a mailto: link to nowhere."""
    contact = _build_contact(make_exhibitor(email="   ", user=account("  ")))
    assert contact["email"] is None
    assert contact["email_source"] is None
    assert contact["has_any"] is False


def test_whitespace_columns_come_back_as_none():
    contact = _build_contact(make_exhibitor(phone="  ", city=" ", address=""))
    assert contact["phone"] is None
    assert contact["city"] is None
    assert contact["address"] is None


# ── has_any ────────────────────────────────────────────────────────────────────


def test_has_any_is_false_with_an_empty_profile():
    assert _build_contact(make_exhibitor())["has_any"] is False


def test_a_phone_number_alone_is_something():
    assert _build_contact(make_exhibitor(phone="555-0100"))["has_any"] is True


def test_a_guardian_number_alone_is_something():
    """A youth exhibitor is reached through their guardian, so a profile
    carrying only that number is not an empty one."""
    assert _build_contact(make_exhibitor(parent_guardian_phone="555-0199"))["has_any"] is True


def test_a_state_alone_is_not_a_way_to_reach_anybody():
    """Rendering "Contact: MN" over an otherwise empty profile would be worse
    than saying there is nothing on file."""
    assert _build_contact(make_exhibitor(state="MN"))["has_any"] is False


# ── The rest of the block ──────────────────────────────────────────────────────


def test_the_postal_parts_are_passed_through_unjoined():
    """Joined for display in the browser, the way a colour and a pattern are —
    the parts are the stored fact."""
    contact = _build_contact(
        make_exhibitor(address="12 Barn Road", city="Eagan", state="MN", zip="55123")
    )
    assert contact["address"] == "12 Barn Road"
    assert contact["city"] == "Eagan"
    assert contact["state"] == "MN"
    assert contact["zip"] == "55123"


def test_the_guardian_is_carried_separately_from_the_emergency_contact():
    """Who you ring first, as against who you ring if something happens. The
    emergency contact has its own block and its own chase."""
    contact = _build_contact(
        make_exhibitor(parent_guardian_name="Pat Miller", parent_guardian_phone="555-0143")
    )
    assert contact["guardian_name"] == "Pat Miller"
    assert contact["guardian_phone"] == "555-0143"


def test_nothing_here_claims_to_be_a_check():
    """No status, no verification, nothing countable. If a key ever appears
    that looks like a sign-off, `outstanding` is the next thing to check."""
    contact = _build_contact(make_exhibitor(phone="555-0100"))
    assert "status" not in contact
    assert "outstanding" not in contact
