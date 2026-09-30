"""What an exhibitor has to have on file before they can enter a show.

The list is short on purpose, and the split between what blocks and what only
prompts is the part worth pinning. Blocking items are facts only the exhibitor
holds and can type in a minute; a membership number is not one of those, because
the desk verifies it against a card and one can be bought at the counter — the
same reasoning that took the block off health paperwork.
"""
from datetime import date
from types import SimpleNamespace
from uuid import uuid4

from exhibitor_profile import (
    age_on,
    is_minor,
    missing_blocking,
    profile_checklist,
    profile_complete,
)


def make_exhibitor(**overrides) -> SimpleNamespace:
    """Defaulted complete, so a test names only the thing it is about."""
    defaults = dict(
        full_name="Susan Miller",
        date_of_birth=date(1984, 4, 2),
        phone="555-0100",
        address="12 Bridle Lane",
        city="Rochester",
        state="MN",
        zip="55901",
        emergency_contact_name="Dale Miller",
        emergency_contact_phone="555-0101",
        registrations=[],
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def item(checklist, key):
    return next(i for i in checklist if i["key"] == key)


def test_a_filled_in_profile_with_a_horse_is_complete():
    checklist = profile_checklist(make_exhibitor(), horse_count=1)

    assert profile_complete(checklist)
    assert missing_blocking(checklist) == []


def test_every_contact_field_blocks():
    for field in (
        "full_name",
        "date_of_birth",
        "phone",
        "address",
        "emergency_contact_name",
    ):
        checklist = profile_checklist(
            make_exhibitor(**{field: None}), horse_count=1
        )
        assert not profile_complete(checklist), field


def test_a_whitespace_only_field_is_not_filled_in():
    """A space bar is not a telephone number, and `if not value` on a string
    that is `"  "` is True in Python and False to anyone reading the form."""
    checklist = profile_checklist(make_exhibitor(phone="   "), horse_count=1)

    assert not item(checklist, "phone")["complete"]


def test_no_horse_blocks():
    checklist = profile_checklist(make_exhibitor(), horse_count=0)

    assert missing_blocking(checklist) == ["At least one horse"]


def test_half_an_address_names_the_missing_half():
    """The hint is what the screen prints, so it has to say which of the four
    boxes is empty rather than "address incomplete"."""
    checklist = profile_checklist(
        make_exhibitor(city=None, zip=None), horse_count=1
    )

    hint = item(checklist, "address")["hint"]
    assert "city" in hint and "ZIP" in hint
    assert "street address" not in hint


def test_an_emergency_contact_needs_both_halves():
    """Both or neither, the same rule the desk's own endpoint enforces: a name
    with no number still reads as missing everywhere it is checked."""
    checklist = profile_checklist(
        make_exhibitor(emergency_contact_phone=None), horse_count=1
    )

    assert not item(checklist, "emergency_contact")["complete"]
    assert "phone" in item(checklist, "emergency_contact")["hint"]


# ── Memberships prompt, never block ──────────────────────────────────────────

def test_a_missing_membership_is_asked_for_but_does_not_block():
    apha = uuid4()
    checklist = profile_checklist(
        make_exhibitor(), horse_count=1, associations=[(apha, "APHA")]
    )

    memberships = item(checklist, "memberships")
    assert memberships["complete"] is False
    assert memberships["blocking"] is False
    assert "APHA" in memberships["hint"]
    # The whole point: the exhibitor still gets in.
    assert profile_complete(checklist)


def test_a_membership_on_file_ticks_the_row():
    apha = uuid4()
    checklist = profile_checklist(
        make_exhibitor(),
        horse_count=1,
        associations=[(apha, "APHA")],
        registered_association_ids={apha},
    )

    assert item(checklist, "memberships")["complete"] is True


def test_a_club_the_exhibitor_has_not_joined_is_named_alongside_the_breed_body():
    apha, nsba = uuid4(), uuid4()
    checklist = profile_checklist(
        make_exhibitor(),
        horse_count=1,
        associations=[(apha, "APHA"), (nsba, "NSBA")],
        registered_association_ids={apha},
    )

    hint = item(checklist, "memberships")["hint"]
    assert "NSBA" in hint and "APHA" not in hint


def test_a_show_with_no_affiliation_is_not_asked_about_memberships():
    """An Open show with no clubs is not waiting on anybody's card, and a row
    that can never be ticked is one people learn to scroll past."""
    checklist = profile_checklist(make_exhibitor(), horse_count=1)

    assert not any(i["key"] == "memberships" for i in checklist)


# ── A minor needs a parent or guardian ───────────────────────────────────────

SHOW_DAY = date(2026, 6, 13)


def test_a_minor_without_a_guardian_is_blocked():
    checklist = profile_checklist(
        make_exhibitor(date_of_birth=date(2012, 1, 5)), horse_count=1, as_of=SHOW_DAY
    )

    guardian = item(checklist, "parent_guardian")
    assert guardian["blocking"] is True
    assert guardian["complete"] is False
    assert guardian["step"] == "details"
    assert missing_blocking(checklist) == ["Parent / guardian"]


def test_a_guardian_needs_both_halves():
    """Both or neither, like the emergency contact: a name the office cannot
    ring is not somebody answerable for the child."""
    checklist = profile_checklist(
        make_exhibitor(
            date_of_birth=date(2012, 1, 5), parent_guardian_name="Pat Miller"
        ),
        horse_count=1,
        as_of=SHOW_DAY,
    )

    guardian = item(checklist, "parent_guardian")
    assert guardian["complete"] is False
    assert guardian["hint"] == "Missing phone"


def test_a_minor_with_a_guardian_on_file_is_complete():
    checklist = profile_checklist(
        make_exhibitor(
            date_of_birth=date(2012, 1, 5),
            parent_guardian_name="Pat Miller",
            parent_guardian_phone="555-0143",
        ),
        horse_count=1,
        as_of=SHOW_DAY,
    )

    assert item(checklist, "parent_guardian")["complete"] is True
    assert profile_complete(checklist)


def test_an_adult_is_never_asked_about_a_guardian():
    checklist = profile_checklist(make_exhibitor(), horse_count=1, as_of=SHOW_DAY)

    assert not any(i["key"] == "parent_guardian" for i in checklist)


def test_no_date_of_birth_means_no_guardian_row():
    """The date of birth row is already blocking, and asking for a guardian of
    somebody whose age nobody knows would be a guess."""
    checklist = profile_checklist(
        make_exhibitor(date_of_birth=None), horse_count=1, as_of=SHOW_DAY
    )

    assert not any(i["key"] == "parent_guardian" for i in checklist)


def test_eighteen_on_the_show_day_signs_for_themselves():
    """Judged on the day, birthday included -- not YP-075's 1 January age."""
    assert not is_minor(date(2008, 6, 13), SHOW_DAY)
    assert is_minor(date(2008, 6, 14), SHOW_DAY)
    assert age_on(date(2008, 6, 14), SHOW_DAY) == 17


def test_a_date_of_birth_held_as_text_is_still_read():
    assert age_on("2008-06-13", SHOW_DAY) == 18
    assert age_on("not a date", SHOW_DAY) is None
