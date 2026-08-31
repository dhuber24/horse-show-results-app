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

from datetime import date, timedelta
from types import SimpleNamespace

from rules import get_rules
from rules.apha import (
    ATTESTATION_REQUIRED_DIVISIONS,
    INDIVIDUAL_WORK_DISCIPLINES,
    INDIVIDUAL_WORK_ZONES,
    ATTESTATION_STATEMENTS,
    DIVISION_LABELS,
    DIVISIONS,
    APHARules,
    RELATIONSHIP_REQUIRED_DIVISIONS,
    RESULTS_RETENTION_REQUIREMENTS,
    RESULTS_SUBMISSION_REQUIREMENTS,
    THREE_YEAR_OLD_DISCIPLINES,
    application_window,
    results_window,
    category_requirements,
    show_minimums,
    show_name_reservations,
    zone_individual_work_note,
)
from tests.factories import (
    make_class,
    make_entry,
    make_horse,
    make_judges,
    make_show,
    make_show_judge,
)


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


# ── Zones 12-14 change how a class is run ────────────────────────────────────

@pytest.mark.parametrize("zone", sorted(INDIVIDUAL_WORK_ZONES))
@pytest.mark.parametrize("discipline", sorted(INDIVIDUAL_WORK_DISCIPLINES))
def test_the_zone_note_appears_where_the_exception_applies(zone, discipline):
    note = zone_individual_work_note(make_show(apha_zone=zone), discipline)

    assert note is not None
    assert f"Zone {zone}" in note
    assert "no rail work" in note.lower()


@pytest.mark.parametrize("zone", [1, 3, 11, 15, None])
def test_other_zones_get_no_note(zone):
    assert zone_individual_work_note(make_show(apha_zone=zone), "Western Horsemanship") is None


@pytest.mark.parametrize("discipline", ["Western Pleasure", "Trail", "Halter", None])
def test_other_disciplines_get_no_note(discipline):
    """The exception is written into the equitation and horsemanship class
    procedures. Putting it on every class in the zone would be a warning people
    learn to scroll past."""
    assert zone_individual_work_note(make_show(apha_zone=12), discipline) is None


def test_a_show_that_never_stated_its_zone_gets_no_note():
    """NULL means not stated, and nothing guesses from the venue's state — a
    guessed zone is wrong at exactly the shows that sit near a border."""
    assert zone_individual_work_note(make_show(), "Hunt Seat Equitation") is None


def test_a_non_apha_show_does_not_get_apha_rules():
    """The checks used to key off the division field alone, on every show type.
    An OPEN show has no APHA divisions and must not be validated as though it
    did."""
    cls = make_class()
    entry = make_entry(cls=cls, horse=make_horse(is_solid_paint_bred=True), apha_division="OPEN")

    assert get_rules("OPEN").validate_entry(entry, make_show(), cls) == []


# ── SC-090: getting the show approved ────────────────────────────────────────


def _codes(issues):
    return [issue["code"] for issue in issues]


@pytest.mark.parametrize("days_out,band", [
    (365, "standard"),
    (91, "standard"),
    (90, "standard"),      # "at least ninety (90) days" — 90 is still standard
    (89, "late"),
    (60, "late"),
    (59, "late_second"),
    (30, "late_second"),   # "less than thirty (30)" — 30 can still be approved
    (29, "closed"),
    (0, "closed"),
    (-14, "closed"),
])
def test_the_application_ladder_bands_on_the_rules_own_numbers(days_out, band):
    """SC-090.C/D. The boundaries are the whole point: the rule says "at least
    ninety" and "less than sixty", so 90 and 30 fall on the generous side, and an
    off-by-one here is a late fee somebody was told they would not be paying."""
    as_of = date(2026, 1, 1)
    window = application_window(make_show(start_date=as_of + timedelta(days=days_out)), as_of)
    assert window["band"] == band
    assert window["days_remaining"] == days_out


def test_the_window_counts_to_the_entry_deadline_when_that_comes_first():
    """SC-090.C measures against "the show or contest entry deadline or show
    date, whichever comes first", and it is the earlier one that sets the fee."""
    window = application_window(
        make_show(start_date=date(2026, 6, 1), entry_deadline=date(2026, 3, 1)),
        date(2026, 1, 1),
    )
    assert window["basis"] == "entry_deadline"
    assert window["basis_date"] == date(2026, 3, 1)
    assert window["band"] == "late_second"


def test_an_entry_deadline_after_the_show_is_ignored():
    """Whichever comes *first*. A deadline later than the show is a typo, and
    counting from it would hand the office more time than the rule allows."""
    window = application_window(
        make_show(start_date=date(2026, 6, 1), entry_deadline=date(2026, 9, 1)),
        date(2026, 1, 1),
    )
    assert window["basis"] == "start_date"
    assert window["basis_date"] == date(2026, 6, 1)


def test_the_standard_deadline_is_ninety_days_before_the_basis():
    window = application_window(make_show(start_date=date(2026, 6, 1)), date(2026, 1, 1))
    assert window["standard_deadline"] == date(2026, 3, 3)


def test_a_show_with_no_start_date_has_no_window():
    """Not a shape the database allows. It is a shape a half-built object has,
    and the alternative is a TypeError inside a readiness panel."""
    assert application_window(make_show(start_date=None), date(2026, 1, 1)) is None


def test_a_show_number_on_file_ends_the_deadline_ladder():
    """APHA assigns the number on approval, so it is the approval as far as this
    app can see. Nagging an approved show about its application window is how a
    readiness panel teaches the office to ignore it."""
    show = make_show(start_date=date(2026, 1, 10), apha_show_number="26-1234")
    issues = APHARules().validate_show_schedule(show, [make_class()], {"as_of": date(2026, 1, 1)})
    assert "APHA_APPLICATION_DEADLINE" not in _codes(issues)
    assert "APHA_SHOW_NUMBER_MISSING" not in _codes(issues)


def test_a_show_inside_thirty_days_with_no_number_is_an_error():
    """SC-090.D.3 — APHA will not approve it. That is not advice, which is why it
    is the one thing on this panel that is not a warning."""
    show = make_show(start_date=date(2026, 1, 20), apha_show_number=None)
    issues = APHARules().validate_show_schedule(show, [make_class()], {"as_of": date(2026, 1, 1)})
    deadline = next(i for i in issues if i["code"] == "APHA_APPLICATION_DEADLINE")
    assert deadline["severity"] == "error"
    assert "SC-090.D.3" in deadline["message"]


def test_a_show_with_no_entry_deadline_says_its_count_may_be_optimistic():
    """Counting from the show date is the *later* of SC-090.C's two dates, so the
    app reports more time than the rule may allow. Saying so is the whole
    mitigation — the alternative is a green panel and a rejected application."""
    show = make_show(start_date=date(2026, 6, 1), entry_deadline=None, apha_show_number=None)
    issues = APHARules().validate_show_schedule(show, [make_class()], {"as_of": date(2026, 1, 1)})
    deadline = next(i for i in issues if i["code"] == "APHA_APPLICATION_DEADLINE")
    assert "no entry deadline is set" in deadline["message"]


def test_an_entry_deadline_on_file_drops_the_caveat():
    show = make_show(
        start_date=date(2026, 6, 1), entry_deadline=date(2026, 5, 1), apha_show_number=None
    )
    issues = APHARules().validate_show_schedule(show, [make_class()], {"as_of": date(2026, 1, 1)})
    deadline = next(i for i in issues if i["code"] == "APHA_APPLICATION_DEADLINE")
    assert "no entry deadline is set" not in deadline["message"]
    assert "the entry deadline" in deadline["message"]


@pytest.mark.parametrize("name,word", [
    ("Lone Star Championship Show", "championship"),
    ("Midwest Champions Classic", "champion"),
    ("World of Color Paint Show", "world"),
    ("National Paint Futurity", "national"),
    ("International Paint Spectacular", "international"),
])
def test_reserved_words_in_a_show_name_are_reported(name, word):
    """SC-090.L and SC-090.P."""
    assert word in show_name_reservations(name)


def test_championship_is_reported_as_itself_not_as_champion():
    """The pattern is ordered longest-first. Reporting both would send somebody
    looking for a second problem that is the same word."""
    assert list(show_name_reservations("Paint-O-Rama Championship")) == ["championship"]


def test_international_does_not_also_report_national():
    """The word boundary does this rather than the ordering, and it is the case
    that breaks first if anybody loosens the pattern to a substring match."""
    assert list(show_name_reservations("International Paint Show")) == ["international"]


def test_an_ordinary_show_name_reserves_nothing():
    assert show_name_reservations("MNSPHC Paint-O-Rama") == {}
    assert show_name_reservations(None) == {}


def test_a_judge_with_no_apha_carding_is_reported_by_name():
    """SC-090.B. Reported and never refused: this reads `judge_associations`,
    which is what somebody typed into the registry, not APHA's approved list."""
    show = make_show(apha_show_number="26-1", judges=[make_show_judge(codes=("AQHA",))])
    issues = APHARules().validate_show_schedule(show, [make_class()], {"as_of": date(2026, 1, 1)})
    issue = next(i for i in issues if i["code"] == "APHA_JUDGE_NOT_CARDED")
    assert "Dale Rogers" in issue["message"]
    assert issue["severity"] == "warning"


def test_an_apha_carded_judge_is_not_reported():
    show = make_show(apha_show_number="26-1", judges=[make_show_judge(codes=("APHA", "AQHA"))])
    issues = APHARules().validate_show_schedule(show, [make_class()], {"as_of": date(2026, 1, 1)})
    assert "APHA_JUDGE_NOT_CARDED" not in _codes(issues)


def test_a_panel_with_no_judges_is_reported_once():
    """Once, not once per missing carding — there are no judges to iterate over.
    The application is also priced per judge, so the count is not cosmetic."""
    show = make_show(apha_show_number="26-1", judges=[])
    issues = APHARules().validate_show_schedule(show, [make_class()], {"as_of": date(2026, 1, 1)})
    assert _codes(issues).count("APHA_JUDGES_NOT_ASSIGNED") == 1


def test_a_billing_style_judge_panel_produces_no_carding_noise():
    """`make_judges` builds the assignment rows billing counts, with no registry
    judge behind them. That is also the shape a caller who forgot to eager-load
    `ShowJudge.judge` hands over, and inventing a finding from it would report
    every judge at the show as uncarded."""
    show = make_show(apha_show_number="26-1", judges=make_judges(3))
    issues = APHARules().validate_show_schedule(show, [make_class()], {"as_of": date(2026, 1, 1)})
    assert "APHA_JUDGE_NOT_CARDED" not in _codes(issues)


def test_an_empty_class_list_blocks_approval_and_says_so():
    """SC-090.E — approval is not granted until the show bill reaches APHA."""
    show = make_show(apha_show_number="26-1")
    issues = APHARules().validate_show_schedule(show, [], {"as_of": date(2026, 1, 1)})
    assert "APHA_CLASS_LIST_EMPTY" in _codes(issues)


def test_class_changes_inside_thirty_days_need_written_notice():
    """SC-090.E. Nothing in the app sends that notice, which is exactly why the
    panel says so rather than letting the edit go through quietly."""
    show = make_show(start_date=date(2026, 1, 20), apha_show_number="26-1")
    issues = APHARules().validate_show_schedule(show, [make_class()], {"as_of": date(2026, 1, 1)})
    notice = next(i for i in issues if i["code"] == "APHA_CLASS_LIST_NOTICE")
    assert "written notification" in notice["message"]


def test_the_class_list_notice_stops_once_the_show_has_started():
    """A show in progress is past amending, and a countdown that keeps running on
    every finished show is noise across the whole historical record."""
    show = make_show(start_date=date(2026, 1, 20), apha_show_number="26-1")
    issues = APHARules().validate_show_schedule(show, [make_class()], {"as_of": date(2026, 2, 1)})
    assert "APHA_CLASS_LIST_NOTICE" not in _codes(issues)


def test_only_a_closed_application_window_is_an_error():
    """Everything else here is something the office can still act on, and an
    error nobody can clear is one they learn to scroll past."""
    show = make_show(
        name="World Championship Show",
        start_date=date(2026, 6, 1),
        apha_show_number=None,
        judges=[make_show_judge(codes=("AQHA",))],
    )
    issues = APHARules().validate_show_schedule(show, [], {"as_of": date(2026, 1, 1)})
    assert issues, "expected this deliberately messy show to report something"
    assert {i["severity"] for i in issues} == {"warning"}


def test_the_schedule_check_is_reached_through_the_dispatcher():
    """The same guard the entry rules carry: `get_rules` handing back the base
    class would make every assertion above pass vacuously against an empty list."""
    show = make_show(apha_show_number=None, start_date=date(2026, 1, 20))
    assert get_rules("APHA").validate_show_schedule(show, [], {"as_of": date(2026, 1, 1)})
    assert get_rules("OPEN").validate_show_schedule(show, [], {"as_of": date(2026, 1, 1)}) == []


# ── SC-095: the minimum a show must offer ────────────────────────────────────


def _cls(name, bracket=None, discipline="Halter"):
    """A class as SC-095.A has to read it: a name, a bracket, and the discipline
    the classifier assigned. All three, because "Open halter, 2 and under" is not
    a column and lives half in the name and half in the bracket."""
    return make_class(
        class_name=name,
        discipline=SimpleNamespace(name=discipline) if discipline else None,
        division=SimpleNamespace(name=bracket) if bracket else None,
    )


def _minimums(judge_count=3, classes=()):
    return show_minimums(make_show(judges=make_judges(judge_count)), list(classes))


def test_sc095_does_not_apply_under_three_judges():
    """"For shows with 3 or more judges." A two-judge show is not held to it, and
    a show still being built has no panel at all — neither is a finding."""
    assert _minimums(2, [])["applies"] is False
    assert _minimums(0, [])["applies"] is False
    assert _minimums(3, [])["applies"] is True


@pytest.mark.parametrize("name,bracket", [
    ("Yearling Stallions", "Yearling"),
    ("Two Year Old Mares", "Two Year Old"),
    ("Weanling Geldings", "Open"),
    ("2 Year Old Fillies", "Open"),
])
def test_junior_halter_is_recognised_from_the_name_or_the_bracket(name, bracket):
    """SC-095.A.1.a, "Junior, 2 and Under"."""
    assert _minimums(3, [_cls(name, bracket)])["open_junior_halter"] == [name]


@pytest.mark.parametrize("name,bracket", [
    ("Three Year Old Stallions", "Three Year Old"),
    ("Four Year & Older Mares", "Four Year & Older"),
    ("Aged Geldings", "Open"),
])
def test_senior_halter_is_recognised_from_the_name_or_the_bracket(name, bracket):
    """SC-095.A.1.b, "Senior, 3 and Over"."""
    assert _minimums(3, [_cls(name, bracket)])["open_senior_halter"] == [name]


@pytest.mark.parametrize("name,bracket", [
    ("Amateur Stallions All Ages", "Amateur"),
    ("Youth Geldings All Ages", "Youth"),
    ("Novice Amateur Mares", "Novice Amateur"),
    ("All Breed Yearling Halter, All Sexes (Futurity Class)", "Futurity"),
    ("Solid Paint-Bred Yearling Mares", "Open"),
    ("Halter", "Walk-Trot All Ages"),
])
def test_another_divisions_halter_is_not_open_halter(name, bracket):
    """SC-095.A asks for the **Open** division. Open is not a column, so it is
    read as the absence of another division's name — in the class name or in the
    bracket, since a real schedule puts it in either."""
    minimums = _minimums(3, [_cls(name, bracket)])
    assert minimums["open_junior_halter"] == []
    assert minimums["open_senior_halter"] == []
    assert minimums["open_halter_unclassified"] == []


def test_a_grand_and_reserve_class_is_open_halter_with_no_age():
    """The case the `unclassified` list exists for. Reporting "no Junior halter
    found" over a schedule that plainly has one is how an office learns to stop
    reading the panel."""
    minimums = _minimums(3, [_cls("Grand & Reserve Stallions", "Open")])
    assert minimums["open_halter_unclassified"] == ["Grand & Reserve Stallions"]


def test_junior_horse_performance_classes_are_not_junior_halter():
    """A trap worth its own test. APHA's *performance* Junior/Senior split is
    5-and-under against 6-and-over and has nothing to do with halter's 2 and 3, so
    matching on the word "Junior" would read a Junior Western Pleasure as a halter
    class — and satisfy SC-095.A.1.a with a class that cannot."""
    minimums = _minimums(3, [
        _cls("Junior Western Pleasure", "Junior Horse (5 & Younger)",
             discipline="Western Pleasure"),
    ])
    assert minimums["open_junior_halter"] == []
    assert minimums["performance_upper_bound"] == 1


def test_every_halter_discipline_counts_as_halter_not_performance():
    """Performance Halter and Halter — Group are not the classes SC-095.A.1 asks
    for, but they are halter. Counting them as performance contests would inflate
    the one number here that can produce a finding."""
    minimums = _minimums(3, [
        _cls("Performance Halter Stallions", "Open", discipline="Performance Halter"),
        _cls("Get of Sire", "Open", discipline="Halter — Group"),
    ])
    assert minimums["performance_upper_bound"] == 0


def test_a_two_judge_show_is_not_held_to_the_minimums():
    show = make_show(apha_show_number="26-1", judges=make_judges(2))
    issues = APHARules().validate_show_schedule(show, [], {"as_of": date(2026, 1, 1)})
    assert [code for code in _codes(issues) if code.startswith("APHA_MINIMUM")] == []


def test_no_open_halter_at_all_is_reported():
    show = make_show(apha_show_number="26-1", judges=make_judges(3))
    classes = [_cls(f"Western Pleasure {i}", "Open", discipline="Western Pleasure")
               for i in range(6)]
    issues = APHARules().validate_show_schedule(show, classes, {"as_of": date(2026, 1, 1)})
    assert "APHA_MINIMUM_HALTER_MISSING" in _codes(issues)


def test_a_missing_age_split_is_reported_only_when_every_class_was_understood():
    """An Open halter class the app could not place is exactly the case where it
    must not claim a gap — the answer may be sitting in the one it did not read."""
    show = make_show(apha_show_number="26-1", judges=make_judges(3))
    senior_only = [_cls("Aged Stallions", "Open")] + [
        _cls(f"Trail {i}", "Open", discipline="Trail") for i in range(4)
    ]

    issues = APHARules().validate_show_schedule(show, senior_only, {"as_of": date(2026, 1, 1)})
    gap = next(i for i in issues if i["code"] == "APHA_MINIMUM_HALTER_AGE_GAP")
    assert "Junior (2 and under)" in gap["message"]

    with_unknown = senior_only + [_cls("Grand & Reserve Stallions", "Open")]
    issues = APHARules().validate_show_schedule(show, with_unknown, {"as_of": date(2026, 1, 1)})
    assert "APHA_MINIMUM_HALTER_AGE_GAP" not in _codes(issues)


def test_a_show_short_of_four_performance_classes_is_reported():
    show = make_show(apha_show_number="26-1", judges=make_judges(3))
    classes = [
        _cls("Yearling Stallions", "Yearling"),
        _cls("Aged Stallions", "Open"),
        _cls("Western Pleasure", "Open", discipline="Western Pleasure"),
    ]
    issues = APHARules().validate_show_schedule(show, classes, {"as_of": date(2026, 1, 1)})
    short = next(i for i in issues if i["code"] == "APHA_MINIMUM_PERFORMANCE_SHORT")
    assert "SC-190.A" in short["message"]
    # One Western Pleasure is an event SC-190.A names; the two halter classes are
    # not counted at all, so there is nothing unmatched to mention.
    assert "1 class is an event" in short["message"]
    assert "neither halter nor named there" not in short["message"]


def test_four_non_halter_classes_clears_the_performance_minimum():
    """The count is an upper bound, so it can only be trusted downward. At four or
    more the app says nothing rather than guessing at SC-190.A's definition — one
    that has not been supplied."""
    show = make_show(apha_show_number="26-1", judges=make_judges(3))
    classes = [
        _cls("Yearling Stallions", "Yearling"),
        _cls("Aged Stallions", "Open"),
    ] + [_cls(f"Class {i}", "Open", discipline="Trail") for i in range(4)]
    issues = APHARules().validate_show_schedule(show, classes, {"as_of": date(2026, 1, 1)})
    assert "APHA_MINIMUM_PERFORMANCE_SHORT" not in _codes(issues)


def test_a_complete_schedule_reports_no_minimums_finding():
    """The shape of a real Paint show: halter split by age and sex, and plenty of
    performance. Nothing here is a finding, and the checklist still reports it."""
    show = make_show(apha_show_number="26-1", judges=make_judges(4))
    classes = [
        _cls("Yearling Stallions", "Yearling"),
        _cls("Two Year Old Mares", "Two Year Old"),
        _cls("Three Year Old Geldings", "Three Year Old"),
        _cls("Four Year & Older Mares", "Four Year & Older"),
        _cls("Grand & Reserve Stallions", "Open"),
        _cls("Amateur Stallions All Ages", "Amateur"),
    ] + [_cls(f"Class {i}", "Open", discipline="Trail") for i in range(8)]

    issues = APHARules().validate_show_schedule(show, classes, {"as_of": date(2026, 1, 1)})
    assert [code for code in _codes(issues) if code.startswith("APHA_MINIMUM")] == []

    minimums = show_minimums(show, classes)
    assert len(minimums["open_junior_halter"]) == 2
    assert len(minimums["open_senior_halter"]) == 2
    assert minimums["open_halter_unclassified"] == ["Grand & Reserve Stallions"]
    assert minimums["performance_upper_bound"] == 8


def test_the_checklist_and_the_findings_read_one_schedule():
    """`validate_show_schedule` takes the precomputed minimums off the context, so
    the checklist the panel prints and the findings printed beside it are the same
    pass over the same classes rather than two."""
    show = make_show(apha_show_number="26-1", judges=make_judges(3))
    empty = show_minimums(show, [])
    issues = APHARules().validate_show_schedule(
        show,
        [_cls("Yearling Stallions", "Yearling")],
        {"as_of": date(2026, 1, 1), "minimums": empty},
    )
    assert "APHA_MINIMUM_HALTER_MISSING" in _codes(issues)


# ── SC-100 and SC-105: what kind of show, and how many judges ────────────────


def _category(code, name, min_judges, max_judges, basis, min_days=None, rule="SC-105"):
    return SimpleNamespace(
        code=code,
        name=name,
        min_judges=min_judges,
        max_judges=max_judges,
        judge_limit_basis=basis,
        min_days=min_days,
        rule_reference=rule,
    )


SINGLE_JUDGE = _category("single_judge", "Single-Judge Show", 1, 1, "in_arena", None, "SC-100.A")
TWO_JUDGE = _category("two_judge", "Two-Judge Show", 2, 2, "in_arena", None, "SC-105.C")
PAINT_O_RAMA = _category("paint_o_rama", "Paint-O-Rama", 3, 4, "total", None, "SC-105.D")
ZONE_SHOW = _category("zone_show", "Zone Show", 2, 6, "total", 2, "SC-105.E")


def _categorised(category, judge_count, **overrides):
    """An approved show with a category and a panel, and nothing else wrong."""
    return make_show(
        apha_show_number="26-1",
        show_category=category,
        judges=make_judges(judge_count),
        **overrides,
    )


def _schedule_issues(show, classes=None):
    if classes is None:
        classes = [
            _cls("Yearling Stallions", "Yearling"),
            _cls("Aged Stallions", "Open"),
        ] + [_cls(f"Class {i}", "Open", discipline="Trail") for i in range(4)]
    return APHARules().validate_show_schedule(show, classes, {"as_of": date(2026, 1, 1)})


def test_a_show_that_does_not_say_what_kind_it_is_is_reported():
    """The category decides the judge panel and, through SC-095, the class
    schedule. APHA's application asks for it, so a blank is a real gap."""
    show = make_show(apha_show_number="26-1", judges=make_judges(2))
    assert "APHA_SHOW_CATEGORY_NOT_SET" in _codes(_schedule_issues(show))


def test_a_category_within_its_limits_reports_nothing():
    assert [c for c in _codes(_schedule_issues(_categorised(PAINT_O_RAMA, 4)))
            if c.startswith("APHA_CATEGORY") or c.startswith("APHA_SHOW_CATEGORY")] == []


def test_a_paint_o_rama_over_four_judges_breaks_the_rule_outright():
    """SC-105.D.2 bounds the judges a Paint-O-Rama may *have* — "limited to three
    (3) or four (4) judges" — so the assignment count answers it directly."""
    issues = _schedule_issues(_categorised(PAINT_O_RAMA, 5))
    exceeded = next(i for i in issues if i["code"] == "APHA_CATEGORY_JUDGE_LIMIT_EXCEEDED")
    assert "SC-105.D" in exceeded["message"]
    assert "5 are assigned" in exceeded["message"]


def test_a_zone_show_over_six_judges_breaks_the_rule_outright():
    issues = _schedule_issues(_categorised(ZONE_SHOW, 7, end_date=date(2026, 6, 3)))
    assert "APHA_CATEGORY_JUDGE_LIMIT_EXCEEDED" in _codes(issues)


def test_a_two_judge_show_with_extra_judges_is_a_hint_not_a_violation():
    """SC-105.C.1 limits a two-judge show to two judges **in the arena at any
    given time**. The app records assignments and knows nothing about who is in
    the arena when, so three assigned judges may be a perfectly legal rotation —
    the finding has to say it is asking about the category, not the rule."""
    issues = _schedule_issues(_categorised(TWO_JUDGE, 3))
    hint = next(i for i in issues if i["code"] == "APHA_CATEGORY_JUDGE_COUNT_UNEXPECTED")
    assert "in the arena at any given time" in hint["message"]
    assert "not a rule it can tell you was broken" in hint["message"]
    assert "APHA_CATEGORY_JUDGE_LIMIT_EXCEEDED" not in _codes(issues)


def test_a_single_judge_show_with_two_judges_is_the_same_kind_of_hint():
    issues = _schedule_issues(_categorised(SINGLE_JUDGE, 2))
    hint = next(i for i in issues if i["code"] == "APHA_CATEGORY_JUDGE_COUNT_UNEXPECTED")
    assert "1 judge in the arena" in hint["message"]


def test_a_category_short_of_its_minimum_is_reported():
    issues = _schedule_issues(_categorised(PAINT_O_RAMA, 2))
    short = next(i for i in issues if i["code"] == "APHA_CATEGORY_JUDGE_COUNT_SHORT")
    assert "at least 3 judges" in short["message"]


def test_a_show_with_no_judges_yet_gets_no_category_count_finding():
    """A show still being built has no panel, and `APHA_JUDGES_NOT_ASSIGNED`
    already says so once. Saying it twice in different words is noise."""
    codes = _codes(_schedule_issues(_categorised(PAINT_O_RAMA, 0)))
    assert "APHA_CATEGORY_JUDGE_COUNT_SHORT" not in codes
    assert "APHA_JUDGES_NOT_ASSIGNED" in codes


def test_a_one_day_zone_show_is_reported():
    """SC-105.E.2 — "on two or more consecutive days"."""
    show = _categorised(ZONE_SHOW, 6, start_date=date(2026, 6, 1), end_date=date(2026, 6, 1))
    short = next(i for i in _schedule_issues(show) if i["code"] == "APHA_CATEGORY_TOO_SHORT")
    assert "2 or more consecutive days" in short["message"]
    assert "This show runs 1." in short["message"]


def test_a_two_day_zone_show_clears_the_length_rule():
    show = _categorised(ZONE_SHOW, 6, start_date=date(2026, 6, 1), end_date=date(2026, 6, 2))
    assert "APHA_CATEGORY_TOO_SHORT" not in _codes(_schedule_issues(show))


def test_a_two_judge_show_with_a_clinic_is_exempt_from_the_sc095_minimums():
    """SC-105.C.3. It can genuinely fire despite SC-095 only biting at three or
    more judges, because a two-judge show is limited to two **in the arena** — a
    show rotating three judges is categorised two_judge and counts three."""
    show = _categorised(TWO_JUDGE, 3, offers_clinic=True)
    minimums = show_minimums(show, [])
    assert minimums["applies"] is False
    assert "SC-105.C.3" in minimums["exempt_reason"]
    assert [c for c in _codes(_schedule_issues(show, [])) if c.startswith("APHA_MINIMUM")] == []


def test_the_same_show_without_the_clinic_is_not_exempt():
    show = _categorised(TWO_JUDGE, 3, offers_clinic=False)
    minimums = show_minimums(show, [])
    assert minimums["applies"] is True
    assert minimums["exempt_reason"] is None
    assert "APHA_MINIMUM_HALTER_MISSING" in _codes(_schedule_issues(show, []))


def test_the_clinic_exemption_belongs_to_two_judge_shows_only():
    """A Paint-O-Rama offering a clinic is still held to SC-095. SC-105.C.3 sits
    under Two-Judge Shows and names no other category."""
    show = _categorised(PAINT_O_RAMA, 3, offers_clinic=True)
    assert show_minimums(show, [])["applies"] is True


def test_the_unverifiable_requirements_are_text_against_the_category():
    """Regional club sponsorship, the per-year caps, clinician approval — all
    facts about APHA's calendar or its club registry. Reported as text because a
    finding the office can never clear is one they learn to scroll past."""
    notes = category_requirements(_categorised(PAINT_O_RAMA, 4))
    assert any("Regional Club" in note for note in notes)
    assert any("two Paint-O-Ramas a year" in note for note in notes)


def test_a_multiple_judge_category_also_carries_the_independence_notes():
    """SC-105.B.4 and B.3 apply to every multiple-judge show. Both are already
    how the app works — one card per judge, one entry under all of them — and
    saying so is how the office can see it is not quietly doing something else."""
    notes = category_requirements(_categorised(ZONE_SHOW, 6))
    assert any("no consultation during judging" in note for note in notes)
    assert any("an entry under every judge" in note.lower() for note in notes)


def test_a_single_judge_show_does_not_carry_the_multiple_judge_notes():
    notes = category_requirements(_categorised(SINGLE_JUDGE, 1))
    assert notes
    assert not any("consultation" in note for note in notes)


def test_a_show_with_no_category_has_no_requirements_to_report():
    assert category_requirements(make_show()) == []


# ── SC-190: what a performance contest actually is ───────────────────────────


def test_the_performance_count_is_now_against_sc190s_own_list():
    """Before SC-190.A arrived the only number available was "classes that are
    not halter" — an upper bound that could notice a show short of four and never
    confirm one that met it. Four named events now confirm it outright."""
    minimums = _minimums(3, [
        _cls("Western Pleasure", "Open", discipline="Western Pleasure"),
        _cls("Trail", "Open", discipline="Trail"),
        _cls("Reining", "Open", discipline="Reining"),
        _cls("Hunter Under Saddle", "Open", discipline="Hunter Under Saddle"),
    ])
    assert minimums["performance_confirmed"] == 4
    assert minimums["performance_upper_bound"] == 4


@pytest.mark.parametrize("discipline", [
    "Showmanship",
    "Longe Line",
    "In-Hand Trail",
    "Barrel Racing",
    "Hunt Seat Equitation",
    "Western Horsemanship",
    "Color Class",
    "Lead Line",
])
def test_classes_sc190_does_not_name_are_not_confirmed_performance(discipline):
    """What is absent from SC-190.A's enumeration is as informative as what is
    in it. Showmanship, Longe Line and In-Hand Trail appear in SC-190.A.1 and
    A.2 as classes a young horse may be offered, but not in the list itself; the
    speed events and the equitation classes are not there at all."""
    minimums = _minimums(3, [_cls("A class", "Open", discipline=discipline)])
    assert minimums["performance_confirmed"] == 0
    # Still counted as not-halter, so the older upper bound is unchanged.
    assert minimums["performance_upper_bound"] == 1


def test_a_schedule_of_speed_events_alone_is_short_of_four():
    """The consequence of the list above, stated as a test because it is the
    behaviour change somebody would be surprised by."""
    show = make_show(apha_show_number="26-1", judges=make_judges(3))
    classes = [_cls("Yearling Stallions", "Yearling")] + [
        _cls(f"Barrels {i}", "Open", discipline="Barrel Racing") for i in range(6)
    ]
    issues = APHARules().validate_show_schedule(show, classes, {"as_of": date(2026, 1, 1)})
    short = next(i for i in issues if i["code"] == "APHA_MINIMUM_PERFORMANCE_SHORT")
    assert "0 classes are an event SC-190.A names" in short["message"]
    assert "6 more are neither halter nor named there" in short["message"]


def test_green_variants_count_as_their_parent_event():
    """SC-190.A lists Green Trail and Green Reining separately, and the
    classifier routes both to their parents — so the discipline set here is
    twenty names for the rule's twenty-eight entries."""
    minimums = _minimums(3, [
        _cls("Green Trail", "Green Horse", discipline="Trail"),
        _cls("Green Reining", "Green Horse", discipline="Reining"),
    ])
    assert minimums["performance_confirmed"] == 2


# ── SC-190.A.3.a: three years old for the versatility and ranch events ───────


def _aged_entry(cls, foaled, division="OPEN"):
    return make_entry(
        cls=cls,
        horse=make_horse(foaling_date=foaled),
        apha_division=division,
    )


def _age_context(cls, discipline):
    return {"apha_disciplines": {cls.id: discipline}, "apha_entries": []}


@pytest.mark.parametrize("discipline", sorted(THREE_YEAR_OLD_DISCIPLINES))
def test_a_two_year_old_may_not_be_shown_in_the_three_year_old_events(discipline):
    """SC-190.A.3.a. An error rather than a warning: a missing Coggins can be
    produced and a membership bought at the desk, but a two-year-old cannot
    become three, so nothing at the show can make the entry eligible."""
    cls = make_class()
    show = make_show(start_date=date(2026, 6, 1))
    entry = _aged_entry(cls, date(2024, 4, 1))  # two years old in 2026

    issues = APHARules().validate_entry(entry, show, cls, _age_context(cls, discipline))
    too_young = next(i for i in issues if i["code"] == "APHA_HORSE_TOO_YOUNG")
    assert too_young["severity"] == "error"
    assert discipline in too_young["message"]
    assert "SC-190.A.3.a" in too_young["message"]


def test_a_three_year_old_is_old_enough():
    cls = make_class()
    show = make_show(start_date=date(2026, 6, 1))
    entry = _aged_entry(cls, date(2023, 5, 1))

    issues = APHARules().validate_entry(entry, show, cls, _age_context(cls, "Ranch Riding"))
    assert "APHA_HORSE_TOO_YOUNG" not in _codes(issues)


def test_age_is_counted_in_show_years_not_birthdays():
    """Every horse has a January 1 birthday. A horse foaled in December 2023 is
    three for the whole of 2026, months before the anniversary — which is why
    this mirrors AQHA's `_calendar_year_age` rather than subtracting dates."""
    cls = make_class()
    show = make_show(start_date=date(2026, 1, 5))
    entry = _aged_entry(cls, date(2023, 12, 20))

    issues = APHARules().validate_entry(entry, show, cls, _age_context(cls, "Ranch Pleasure"))
    assert "APHA_HORSE_TOO_YOUNG" not in _codes(issues)


def test_a_horse_with_no_foaling_date_is_not_refused():
    """The check declines rather than guessing. Refusing an entry over an age
    nobody recorded would block the horse instead of producing the paperwork —
    the same reasoning that took the block off health documents."""
    cls = make_class()
    show = make_show(start_date=date(2026, 6, 1))
    entry = _aged_entry(cls, None)

    issues = APHARules().validate_entry(entry, show, cls, _age_context(cls, "Ranch Riding"))
    assert "APHA_HORSE_TOO_YOUNG" not in _codes(issues)


def test_a_show_with_no_discipline_map_runs_no_age_check():
    """Every non-APHA show, and any caller that has not built a context. A cap or
    an age limit applied to a guessed discipline refuses entries for the wrong
    reason — the rule `_check_horse_caps` already follows."""
    cls = make_class()
    show = make_show(start_date=date(2026, 6, 1))
    entry = _aged_entry(cls, date(2025, 4, 1))

    assert "APHA_HORSE_TOO_YOUNG" not in _codes(APHARules().validate_entry(entry, show, cls, {}))


@pytest.mark.parametrize("discipline", [
    "Ranch Trail",
    "Ranch Reining",
    "Ranch Conformation",
    "Timed Ranch Trail",
    "Ranch Cow Work",
])
def test_ranch_classes_sc190_does_not_name_are_not_age_checked(discipline):
    """"Ranch classes" is read as the ranch events SC-190.A enumerates and no
    wider. The classifier knows a dozen disciplines starting with the word, and
    Ranch Conformation is a halter class — a rule applied to every one of them
    would refuse entries in classes the rule never listed."""
    cls = make_class()
    show = make_show(start_date=date(2026, 6, 1))
    entry = _aged_entry(cls, date(2025, 4, 1))  # a yearling

    issues = APHARules().validate_entry(entry, show, cls, _age_context(cls, discipline))
    assert "APHA_HORSE_TOO_YOUNG" not in _codes(issues)


def test_the_age_check_runs_whatever_division_the_entry_names():
    """SC-190.A.3.a is about the horse, so it runs before the division is looked
    at — the same place the SC-185.F horse caps run, and for the same reason."""
    cls = make_class()
    show = make_show(start_date=date(2026, 6, 1))
    entry = _aged_entry(cls, date(2025, 4, 1), division="")

    issues = APHARules().validate_entry(entry, show, cls, _age_context(cls, "Ranch Riding"))
    assert "APHA_HORSE_TOO_YOUNG" in _codes(issues)


def test_a_withdrawn_entry_is_not_age_checked():
    """`entry_is_active` gates the whole rule set. A scratched horse is not one
    somebody is showing."""
    cls = make_class()
    show = make_show(start_date=date(2026, 6, 1))
    entry = _aged_entry(cls, date(2025, 4, 1))
    entry.status = "WITHDRAWN"

    assert APHARules().validate_entry(entry, show, cls, _age_context(cls, "Ranch Riding")) == []


# ── SC-125: filing the results ───────────────────────────────────────────────


def _ended(end=date(2026, 6, 3), **overrides):
    return make_show(
        apha_show_number="26-1",
        start_date=date(2026, 6, 1),
        end_date=end,
        judges=make_judges(1),
        show_category=SINGLE_JUDGE,
        **overrides,
    )


def test_there_is_no_results_window_before_the_show_ends():
    """Nothing to file yet, and a countdown running for eleven months is noise
    on every screen it reaches — the same reason the SC-090 class-list notice
    stops once a show has started."""
    assert results_window(_ended(), date(2026, 5, 20)) is None
    assert results_window(_ended(), date(2026, 6, 2)) is None


def test_the_window_opens_on_the_last_day_of_the_show():
    """SC-125.A counts ten calendar days "from the last scheduled day"."""
    window = results_window(_ended(), date(2026, 6, 3))
    assert window["due"] == date(2026, 6, 13)
    assert window["days_remaining"] == 10
    assert window["band"] == "open"


@pytest.mark.parametrize("as_of,band", [
    (date(2026, 6, 13), "open"),         # the tenth day is still inside it
    (date(2026, 6, 14), "late"),
    (date(2026, 7, 3), "late"),          # thirty days exactly
    (date(2026, 7, 4), "delinquent"),
])
def test_the_results_bands_follow_the_rules_own_days(as_of, band):
    assert results_window(_ended(), as_of)["band"] == band


def test_an_overdue_filing_is_reported_with_the_late_fee():
    issues = APHARules().validate_show_schedule(
        _ended(), [make_class()], {"as_of": date(2026, 6, 20)}
    )
    overdue = next(i for i in issues if i["code"] == "APHA_RESULTS_OVERDUE")
    assert overdue["severity"] == "warning"
    assert "2026-06-13" in overdue["message"]
    assert "7 days ago" in overdue["message"]


def test_a_delinquent_filing_names_the_paint_horse_journal():
    """SC-125.A: shows more than thirty days delinquent are listed in it."""
    issues = APHARules().validate_show_schedule(
        _ended(), [make_class()], {"as_of": date(2026, 8, 1)}
    )
    late = next(i for i in issues if i["code"] == "APHA_RESULTS_DELINQUENT")
    assert "Paint Horse Journal" in late["message"]
    assert "cannot see a postmark" in late["message"]


def test_a_show_inside_the_window_reports_no_results_finding():
    codes = _codes(APHARules().validate_show_schedule(
        _ended(), [make_class()], {"as_of": date(2026, 6, 8)}
    ))
    assert "APHA_RESULTS_OVERDUE" not in codes
    assert "APHA_RESULTS_DELINQUENT" not in codes


def test_a_show_that_has_not_run_reports_no_results_finding():
    codes = _codes(APHARules().validate_show_schedule(
        _ended(), [make_class()], {"as_of": date(2026, 1, 1)}
    ))
    assert not [c for c in codes if c.startswith("APHA_RESULTS")]


def test_the_submission_requirements_say_the_format_is_delegated():
    """SC-125.A specifies the electronic results are "in the format specified by
    the APHA Performance Department" — the rule book points elsewhere rather than
    defining a layout, so nothing generated here can claim to match it. That is a
    different statement from "the rule has not been supplied", and the app has to
    make it rather than quietly implying the format is settled."""
    text = " ".join(RESULTS_SUBMISSION_REQUIREMENTS)
    assert "Performance Department" in text
    assert "original, signed, final judge's card" in text
    assert "evaluation forms" in text
    assert "per entry per judge" in text


def test_the_retention_requirements_name_apha_s_own_document():
    """SC-125.D asks for something SC-110.J does not: a copy of the results **as
    received from APHA**. That is produced after submission and the app can never
    hold it, so a bundle listing only its own output would look complete while
    missing one of the three documents the rule names."""
    text = " ".join(RESULTS_RETENTION_REQUIREMENTS)
    assert "as received from APHA" in text
    assert "one year" in text
