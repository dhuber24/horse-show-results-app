"""APHA entry validation.

These rules were inline in `routers/entries.py` until Phase 0 of the APHA work,
which meant they ran at the show desk and nowhere else. The exhibitor's own
class registration in `routers/show_registration.py` has always validated
through `rules.get_rules`, and `APHARules` was an empty subclass — so somebody
self-registering could put a Solid Paint-Bred horse in an Open class.

The last test here is the one that would catch that regression returning: it
asserts the dispatcher actually hands back APHARules, because every check below
passes vacuously against a stub.
"""
import pytest

from types import SimpleNamespace

from rules import get_rules
from rules.apha import (
    ATTESTATION_REQUIRED_DIVISIONS,
    ATTESTATION_STATEMENTS,
    DIVISION_LABELS,
    DIVISIONS,
    APHARules,
    RELATIONSHIP_REQUIRED_DIVISIONS,
)
from tests.factories import make_class, make_entry, make_horse, make_show


def declaration(kind="novice_eligibility"):
    """One row as `entry.attestations` holds it before the entry is flushed."""
    return SimpleNamespace(kind=kind, statement=ATTESTATION_STATEMENTS.get(kind, ""))


@pytest.fixture
def rules():
    return APHARules()


@pytest.fixture
def show():
    return make_show()


def errors(issues):
    return [i for i in issues if i["severity"] == "error"]


def codes(issues):
    return [i["code"] for i in issues]


# ── SC-325.A.1: Solid Paint-Bred horses and the Open division ────────────────

def test_a_solid_paint_bred_horse_may_not_enter_open(rules, show):
    cls = make_class()
    entry = make_entry(cls=cls, horse=make_horse(is_solid_paint_bred=True), apha_division="OPEN")

    issues = rules.validate_entry(entry, show, cls)

    assert codes(errors(issues)) == ["APHA_SOLID_PAINT_BRED_OPEN"]


def test_a_regular_registry_horse_may_enter_open(rules, show):
    cls = make_class()
    entry = make_entry(cls=cls, apha_division="OPEN")

    assert rules.validate_entry(entry, show, cls) == []


def test_a_solid_paint_bred_horse_may_enter_its_own_division(rules, show):
    """The bar is on Open specifically, not on the horse showing at all."""
    cls = make_class()
    entry = make_entry(
        cls=cls,
        horse=make_horse(is_solid_paint_bred=True),
        apha_division="SOLID_PAINT_BRED",
    )

    assert rules.validate_entry(entry, show, cls) == []


def test_a_solid_paint_bred_horse_may_be_shown_by_an_amateur(rules, show):
    cls = make_class()
    entry = make_entry(
        cls=cls,
        horse=make_horse(is_solid_paint_bred=True),
        apha_division="AMATEUR",
        relationship_to_owner="Self",
    )

    assert rules.validate_entry(entry, show, cls) == []


def test_the_message_names_the_horse(rules, show):
    """A secretary at the desk with forty entries needs to know which one."""
    cls = make_class()
    entry = make_entry(
        cls=cls,
        horse=make_horse(name="Painted Sky", is_solid_paint_bred=True),
        apha_division="OPEN",
    )

    assert "Painted Sky" in errors(rules.validate_entry(entry, show, cls))[0]["message"]


def test_an_entry_with_no_horse_is_not_a_crash(rules, show):
    """Deleting a horse sets `entries.horse_id` to NULL rather than removing the
    entry, so a live entry legitimately has no horse on it."""
    cls = make_class()
    entry = make_entry(cls=cls, horse_name=None, apha_division="OPEN")

    assert rules.validate_entry(entry, show, cls) == []


# ── Relationship to the horse's owner ────────────────────────────────────────

@pytest.mark.parametrize("division", sorted(RELATIONSHIP_REQUIRED_DIVISIONS))
def test_ownership_divisions_require_a_relationship(rules, show, division):
    cls = make_class()
    entry = make_entry(cls=cls, apha_division=division)

    issues = rules.validate_entry(entry, show, cls)

    # `in`, not `==`: a bare Novice entry is short two things, and reporting only
    # the first would send somebody round the loop twice.
    assert "APHA_RELATIONSHIP_REQUIRED" in codes(errors(issues))


def test_every_shortfall_is_reported_at_once(rules, show):
    """A Novice entry with neither the relationship nor the declaration gets both
    back. The routers render every error in the envelope, so fixing one and
    resubmitting to discover the next is avoidable."""
    cls = make_class()
    entry = make_entry(cls=cls, apha_division="NOVICE_AMATEUR")

    assert sorted(codes(errors(rules.validate_entry(entry, show, cls)))) == [
        "APHA_NOVICE_ELIGIBILITY_REQUIRED",
        "APHA_RELATIONSHIP_REQUIRED",
    ]


@pytest.mark.parametrize("division", sorted(RELATIONSHIP_REQUIRED_DIVISIONS))
def test_a_stated_relationship_satisfies_them(rules, show, division):
    cls = make_class()
    # The Novice divisions need a declaration on top, so they get one here —
    # this test is about the relationship and nothing else.
    attestations = [declaration()] if division in ATTESTATION_REQUIRED_DIVISIONS else []
    entry = make_entry(
        cls=cls,
        apha_division=division,
        relationship_to_owner="Aunt",
        attestations=attestations,
    )

    assert rules.validate_entry(entry, show, cls) == []


def test_whitespace_is_not_a_relationship(rules, show):
    """The field is free text on a form somebody tabs through. A value that
    looks blank and passes the check is worse than no value at all."""
    cls = make_class()
    entry = make_entry(cls=cls, apha_division="YOUTH", relationship_to_owner="   ")

    assert codes(errors(rules.validate_entry(entry, show, cls))) == ["APHA_RELATIONSHIP_REQUIRED"]


@pytest.mark.parametrize("division", ["OPEN", "SOLID_PAINT_BRED"])
def test_registry_divisions_do_not_ask_about_the_owner(rules, show, division):
    """Eligibility in Open and Solid Paint-Bred is a property of the horse's
    registry; who owns it does not change the answer."""
    cls = make_class()
    entry = make_entry(cls=cls, apha_division=division)

    assert rules.validate_entry(entry, show, cls) == []


# ── When the rules decline to say anything ───────────────────────────────────

def test_an_entry_with_no_division_is_not_checked(rules, show):
    """Which division an entry belongs in is not derivable from the class — the
    same class runs for Open, Amateur and Youth — so there is nothing to check
    a Solid Paint-Bred horse against."""
    cls = make_class()
    entry = make_entry(cls=cls, horse=make_horse(is_solid_paint_bred=True))

    assert rules.validate_entry(entry, show, cls) == []


@pytest.mark.parametrize("status", ["WITHDRAWN", "SCRATCHED"])
def test_an_inactive_entry_is_not_checked(rules, show, status):
    cls = make_class()
    entry = make_entry(
        cls=cls,
        horse=make_horse(is_solid_paint_bred=True),
        apha_division="OPEN",
        status=status,
    )

    assert rules.validate_entry(entry, show, cls) == []


def test_an_unflushed_entry_is_checked(rules, show):
    """`status` is applied at flush and both callers validate before flushing, so
    None has to count as ENTERED or every rule silently skips."""
    cls = make_class()
    entry = make_entry(
        cls=cls,
        horse=make_horse(is_solid_paint_bred=True),
        apha_division="OPEN",
        status=None,
    )

    assert codes(errors(rules.validate_entry(entry, show, cls))) == ["APHA_SOLID_PAINT_BRED_OPEN"]


@pytest.mark.parametrize("division", ["open", " Open ", "oPeN"])
def test_the_division_is_read_case_and_whitespace_insensitively(rules, show, division):
    cls = make_class()
    entry = make_entry(cls=cls, horse=make_horse(is_solid_paint_bred=True), apha_division=division)

    assert codes(errors(rules.validate_entry(entry, show, cls))) == ["APHA_SOLID_PAINT_BRED_OPEN"]


# ── The shape both entry doors render ────────────────────────────────────────

def test_an_issue_carries_the_ids_as_strings(rules, show):
    """The dict is serialized straight into an HTTP response, so a UUID in it
    would not survive."""
    cls = make_class()
    horse = make_horse(is_solid_paint_bred=True)
    entry = make_entry(cls=cls, horse=horse, apha_division="OPEN")

    issue = errors(rules.validate_entry(entry, show, cls))[0]

    assert issue["class_id"] == str(cls.id)
    assert issue["horse_id"] == str(horse.id)


def test_the_dispatcher_returns_the_apha_rules(show):
    """Every test above passes against a stub. This is the one that notices if
    APHA loses its wiring in the registry."""
    assert isinstance(get_rules("APHA"), APHARules)
    assert isinstance(get_rules("apha"), APHARules)


# ── The division list itself ─────────────────────────────────────────────────

def test_an_unknown_division_is_named_rather_than_left_to_the_constraint(rules, show):
    """Left to the CHECK on `entries.apha_division`, this surfaces as an
    IntegrityError on commit — a 409 naming nothing, on a request whose other
    entries may have been perfectly valid."""
    cls = make_class()
    entry = make_entry(cls=cls, apha_division="AMATEUR_SELECT")

    issues = rules.validate_entry(entry, show, cls)

    assert codes(errors(issues)) == ["APHA_DIVISION_UNKNOWN"]


# ── AM-205, YP-255.A.1: the Novice eligibility declaration ───────────────────

@pytest.mark.parametrize("division", sorted(ATTESTATION_REQUIRED_DIVISIONS))
def test_novice_divisions_need_a_declaration(rules, show, division):
    cls = make_class()
    entry = make_entry(cls=cls, apha_division=division, relationship_to_owner="Self")

    issues = rules.validate_entry(entry, show, cls)

    assert codes(errors(issues)) == ["APHA_NOVICE_ELIGIBILITY_REQUIRED"]


@pytest.mark.parametrize("division", sorted(ATTESTATION_REQUIRED_DIVISIONS))
def test_a_declaration_satisfies_them(rules, show, division):
    cls = make_class()
    entry = make_entry(
        cls=cls,
        apha_division=division,
        relationship_to_owner="Self",
        attestations=[declaration()],
    )

    assert rules.validate_entry(entry, show, cls) == []


def test_the_declaration_is_read_off_the_unflushed_entry(rules, show):
    """The rows are assigned to `entry.attestations` before the entry is written,
    so validation has to see them in memory — a check that queried the database
    would reject every new Novice entry."""
    cls = make_class()
    entry = make_entry(
        cls=cls,
        apha_division="NOVICE_YOUTH",
        relationship_to_owner="Mother",
        attestations=[declaration()],
        id=None,
    )

    assert rules.validate_entry(entry, show, cls) == []


def test_a_declaration_of_the_wrong_kind_does_not_count(rules, show):
    cls = make_class()
    entry = make_entry(
        cls=cls,
        apha_division="NOVICE_AMATEUR",
        relationship_to_owner="Self",
        attestations=[declaration("something_else")],
    )

    assert codes(errors(rules.validate_entry(entry, show, cls))) == [
        "APHA_NOVICE_ELIGIBILITY_REQUIRED"
    ]


@pytest.mark.parametrize("division", ["AMATEUR", "YOUTH", "OPEN", "AMATEUR_WALK_TROT"])
def test_only_the_novice_divisions_ask_for_one(rules, show, division):
    """Amateur and Youth are not point-limited; asking everyone to tick a box
    about limits that do not apply to them teaches people to tick boxes."""
    cls = make_class()
    entry = make_entry(cls=cls, apha_division=division, relationship_to_owner="Self")

    assert rules.validate_entry(entry, show, cls) == []


def test_the_statement_is_not_the_callers_to_write():
    """The backend owns the wording. A caller that could compose the sentence it
    is attesting to could attest to anything at all."""
    assert set(ATTESTATION_STATEMENTS) == {"novice_eligibility"}
    assert "AM-205" in ATTESTATION_STATEMENTS["novice_eligibility"]


def test_every_attestation_required_division_is_a_real_division():
    assert ATTESTATION_REQUIRED_DIVISIONS <= set(DIVISIONS)


@pytest.mark.parametrize("division", [
    "AMATEUR_WALK_TROT",
    "YOUTH_WALK_TROT_11_18",
    "YOUTH_WALK_TROT_5_10",
])
def test_the_walk_trot_divisions_are_real_divisions(rules, show, division):
    """AM-300, YP-109 and YP-110. Missing from the CHECK constraint until
    migration 115, so a show running Walk-Trot — most of them — could not record
    those entries at all."""
    cls = make_class()
    entry = make_entry(cls=cls, apha_division=division, relationship_to_owner="Mother")

    assert rules.validate_entry(entry, show, cls) == []


def test_every_division_has_a_label():
    """The label is what an exhibitor reads in an error. `.title()` on the
    stored value gives "Youth Walk Trot 11 18", which is nothing's name."""
    assert set(DIVISION_LABELS) == set(DIVISIONS)


def test_every_relationship_required_division_is_a_real_division():
    assert RELATIONSHIP_REQUIRED_DIVISIONS <= set(DIVISIONS)


def test_the_schema_and_the_rules_agree_on_the_division_list():
    """These drifted once already: `EntryCreate` and `EntryUpdate` each spelled
    the list out, and both were missing the Walk-Trot divisions."""
    from typing import get_args

    from schemas import APHADivision

    assert set(get_args(APHADivision)) == set(DIVISIONS)


def test_the_message_uses_the_divisions_own_name(rules, show):
    cls = make_class()
    entry = make_entry(cls=cls, apha_division="YOUTH_WALK_TROT_11_18")

    message = errors(rules.validate_entry(entry, show, cls))[0]["message"]

    assert message.startswith("Youth Walk-Trot 11-18 division entries")


def test_a_non_apha_show_does_not_get_apha_rules():
    """The checks used to key off the division field alone, on every show type.
    An OPEN show has no APHA divisions and must not be validated as though it
    did."""
    cls = make_class()
    entry = make_entry(cls=cls, horse=make_horse(is_solid_paint_bred=True), apha_division="OPEN")

    assert get_rules("OPEN").validate_entry(entry, make_show(), cls) == []
