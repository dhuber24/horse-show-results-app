"""One show's copy of an exhibitor's profile (migration 145).

The bug this exists for: taking a horse off one show's registration took it off
the exhibitor's profile, because the registration wizard wrote the profile
directly. Two rules replaced that, and each can fail quietly:

* **The profile is never written by a registration.** Nothing here can check
  an endpoint, but everything the endpoints do is a call into
  `registration_profile`, and the view they read through is read-only.
* **A step follows the profile until something in it changes.** Get that wrong
  in one direction and a correction made on `/profile` never reaches a show the
  exhibitor never edited; wrong in the other and an edit made for one show is
  overwritten by the profile the next time anything is read.
"""
from datetime import date, datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from exhibitor_profile import profile_checklist
from registration_profile import (
    DETAIL_FIELDS,
    ShowExhibitorView,
    details_match,
    exhibitor_views,
    horse_links,
    membership_for,
    owns_details,
    owns_horses,
    owns_memberships,
    take_details,
    take_horses,
    take_memberships,
)
from rules.apha import APHARules
from rules.default import DefaultRules
from tests.factories import make_class, make_entry, make_exhibitor, make_show


def _profile(**overrides):
    defaults = dict(
        full_name="Pat Rider",
        email=None,
        user=None,
        registrations=[],
        date_of_birth=date(1990, 4, 2),
        phone="555-0100",
        address="1 Barn Rd",
        city="Fargo",
        state="ND",
        zip="58102",
        emergency_contact_name="Sam Rider",
        emergency_contact_phone="555-0199",
        parent_guardian_name=None,
        parent_guardian_phone=None,
    )
    defaults.update(overrides)
    return make_exhibitor(**defaults)


def _copy(**overrides):
    """A `show_registration_profiles` row with every step still following the
    profile -- which is the state a new one is created in."""
    defaults = dict(
        id=uuid4(),
        details_saved_at=None,
        memberships_saved_at=None,
        horses_saved_at=None,
        horses=[],
        memberships=[],
        **{field: None for field in DETAIL_FIELDS},
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _membership(code="APHA", number="A-1", expires=date(2026, 12, 31)):
    association = SimpleNamespace(id=uuid4(), code=code, name=code, association_type="breed")
    return SimpleNamespace(
        id=uuid4(),
        association_id=association.id,
        association=association,
        member_number=number,
        expires_at=expires,
    )


_SAVED = datetime(2026, 5, 1, tzinfo=timezone.utc)


# ── The view a show reads through ─────────────────────────────────────────────


def test_with_no_copy_the_show_reads_the_profile():
    profile = _profile()
    view = ShowExhibitorView(profile, None)
    assert view.phone == "555-0100"
    assert view.date_of_birth == date(1990, 4, 2)
    assert view.registrations is profile.registrations


def test_a_copy_that_never_saved_its_details_still_follows_the_profile():
    """The copy row exists as soon as *any* step is changed -- removing a horse
    creates it -- and that must not freeze the details, which nobody touched."""
    profile = _profile()
    view = ShowExhibitorView(profile, _copy(horses_saved_at=_SAVED, phone="stale"))
    assert view.phone == "555-0100"


def test_saved_details_are_the_shows_answer_and_the_profile_is_untouched():
    profile = _profile()
    copy = _copy()
    take_details(copy, profile)
    copy.phone = "555-0222"

    view = ShowExhibitorView(profile, copy)
    assert view.phone == "555-0222"
    # The rest of the details came across with the edit, so the show still
    # holds the address it had rather than a blank.
    assert view.address == "1 Barn Rd"
    assert profile.phone == "555-0100"


def test_saved_memberships_are_the_shows_answer_even_when_empty():
    """An exhibitor who removed their only membership for this show has none
    here -- not the profile's, which is what a falsy check would fall back to."""
    profile = _profile(registrations=[_membership()])
    copy = _copy(memberships_saved_at=_SAVED, memberships=[])
    assert ShowExhibitorView(profile, copy).registrations == []


def test_everything_that_is_not_a_detail_comes_from_the_profile():
    profile = _profile(email="office@example.com")
    copy = _copy(details_saved_at=_SAVED)
    view = ShowExhibitorView(profile, copy)
    assert view.full_name == "Pat Rider"
    assert view.email == "office@example.com"
    assert view.id == profile.id


def test_the_view_cannot_write_either_record():
    """Assigning through the view is how a caller would write the profile by
    accident, so it is refused outright."""
    view = ShowExhibitorView(_profile(), _copy())
    with pytest.raises(AttributeError):
        view.phone = "555-0333"


def test_the_checklist_judges_what_the_show_holds():
    """A date of birth supplied on one show's registration completes that
    show's checklist, with the profile still missing one."""
    profile = _profile(date_of_birth=None)
    copy = _copy()
    take_details(copy, profile)
    copy.date_of_birth = date(2010, 3, 1)

    rows = {
        row["key"]: row
        for row in profile_checklist(ShowExhibitorView(profile, copy), horse_count=1)
    }
    assert rows["date_of_birth"]["complete"] is True
    assert {
        row["key"]: row for row in profile_checklist(profile, horse_count=1)
    }["date_of_birth"]["complete"] is False


# ── Details: what counts as a change ──────────────────────────────────────────


def test_a_prefilled_form_saved_unchanged_is_not_a_change():
    """*Save & continue* over boxes that were only prefilled keeps the step
    following the profile, so a correction made on /profile next week still
    reaches this show."""
    profile = _profile()
    values = {field: getattr(profile, field) for field in DETAIL_FIELDS}
    assert details_match(values, profile)


def test_a_blank_and_a_missing_value_are_the_same_answer():
    profile = _profile(parent_guardian_name=None, phone="555-0100")
    values = {field: getattr(profile, field) for field in DETAIL_FIELDS}
    values["parent_guardian_name"] = "   "
    values["phone"] = " 555-0100 "
    assert details_match(values, profile)


def test_one_changed_box_is_a_change():
    profile = _profile()
    values = {field: getattr(profile, field) for field in DETAIL_FIELDS}
    values["emergency_contact_phone"] = "555-0999"
    assert not details_match(values, profile)


def test_details_are_copied_once():
    """The second edit must not re-copy the profile over the first."""
    profile = _profile()
    copy = _copy()
    take_details(copy, profile)
    copy.phone = "555-0222"
    profile.phone = "555-0444"

    take_details(copy, profile)
    assert copy.phone == "555-0222"
    assert owns_details(copy)


# ── Horses ────────────────────────────────────────────────────────────────────


def test_the_horse_list_follows_the_profile_until_it_is_changed():
    horse_a, horse_b = uuid4(), uuid4()
    profile_links = {horse_a: None, horse_b: "Parent"}

    assert horse_links(None, profile_links) == profile_links
    assert horse_links(_copy(details_saved_at=_SAVED), profile_links) == profile_links


def test_removing_a_horse_from_the_show_leaves_the_profile_list_alone():
    """The bug. Taking the profile's horses and dropping one from the copy is
    what the remove endpoint does; the profile's own list is not touched."""
    horse_a, horse_b = uuid4(), uuid4()
    profile_links = {horse_a: None, horse_b: "Parent"}
    copy = _copy()

    take_horses(copy, profile_links)
    copy.horses = [row for row in copy.horses if row.horse_id != horse_b]

    assert horse_links(copy, profile_links) == {horse_a: None}
    assert profile_links == {horse_a: None, horse_b: "Parent"}
    assert owns_horses(copy)


def test_the_relationships_answered_on_the_profile_come_across():
    horse = uuid4()
    copy = _copy()
    take_horses(copy, {horse: "Parent"})
    assert horse_links(copy, {}) == {horse: "Parent"}


def test_a_registration_with_every_horse_removed_has_none():
    """Not the profile's -- a copy that stopped following it answers even when
    the answer is empty."""
    copy = _copy(horses_saved_at=_SAVED, horses=[])
    assert horse_links(copy, {uuid4(): None}) == {}


def test_horses_are_copied_once():
    horse_a, horse_b = uuid4(), uuid4()
    copy = _copy()
    take_horses(copy, {horse_a: None})
    take_horses(copy, {horse_a: None, horse_b: None})
    assert set(horse_links(copy, {})) == {horse_a}


# ── Memberships ───────────────────────────────────────────────────────────────


def test_memberships_are_copied_with_their_association():
    """Carried across so the row serializes before the next read: a row that
    has not been flushed has nothing to load its association from."""
    reg = _membership(number="A-7")
    copy = _copy()
    take_memberships(copy, [reg])

    assert owns_memberships(copy)
    [row] = copy.memberships
    assert (row.association_id, row.member_number, row.expires_at) == (
        reg.association_id, "A-7", reg.expires_at,
    )
    assert row.association is reg.association


def test_membership_for_reads_the_shows_answer():
    profile_reg = _membership(number="A-1")
    profile = _profile(registrations=[profile_reg])
    copy = _copy()
    take_memberships(copy, profile.registrations)
    copy.memberships[0].member_number = "A-2"

    view = ShowExhibitorView(profile, copy)
    assert membership_for(view, profile_reg.association_id).member_number == "A-2"
    assert membership_for(ShowExhibitorView(profile, None), profile_reg.association_id) is profile_reg
    assert membership_for(view, uuid4()) is None


# ── The association rules ─────────────────────────────────────────────────────


def test_rules_read_the_entrys_exhibitor_when_no_view_is_given():
    entry = make_entry()
    assert DefaultRules.exhibitor_of(entry, {}) is entry.exhibitor
    assert DefaultRules.exhibitor_of(entry, None) is entry.exhibitor


def test_rules_read_the_view_this_show_passes():
    entry = make_entry()
    view = ShowExhibitorView(entry.exhibitor, _copy())
    assert DefaultRules.exhibitor_of(entry, {"exhibitor_views": {entry.exhibitor_id: view}}) is view


def test_a_date_of_birth_corrected_for_this_show_decides_the_youth_age_check():
    """The profile says nineteen; the registration was corrected to seventeen.
    The show judges the entry on what it holds."""
    cls = make_class()
    show = make_show(start_date=date(2026, 6, 1))
    exhibitor = make_exhibitor(date_of_birth=date(2006, 5, 1))
    entry = make_entry(
        cls=cls, exhibitor=exhibitor, apha_division="YOUTH", relationship_to_owner="Self"
    )
    context = {"apha_brackets": {cls.id: None}, "apha_entries": []}

    codes = {i["code"] for i in APHARules().validate_entry(entry, show, cls, context)}
    assert "APHA_YOUTH_TOO_OLD" in codes

    copy = _copy(details_saved_at=_SAVED, date_of_birth=date(2008, 6, 15))
    context["exhibitor_views"] = {exhibitor.id: ShowExhibitorView(exhibitor, copy)}
    codes = {i["code"] for i in APHARules().validate_entry(entry, show, cls, context)}
    assert "APHA_YOUTH_TOO_OLD" not in codes


def test_exhibitor_views_skips_anybody_without_a_copy():
    """Their answer is the row the entry already carries, so a view would be
    one more object saying the same thing."""
    with_copy, without = make_exhibitor(), make_exhibitor()
    views = exhibitor_views([with_copy, without, None], {with_copy.id: _copy()})
    assert set(views) == {with_copy.id}
