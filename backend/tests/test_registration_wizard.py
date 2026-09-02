"""What the registration wizard narrows, warns about, and refuses.

Three things moved in migration 128, and each one is a place where being wrong
is quiet rather than loud:

* `divisions_for_bracket` narrows the APHA division picker. Narrowing too far
  refuses an entry the show meant to take; narrowing not at all is the bug it
  was written for, where "56 - Youth WT Showmanship 5-10" could be entered as
  Amateur. Both directions are pinned below.
* `horse_registration_flags` warns about papers. A warning nobody can clear is
  one people learn to scroll past, so the empty cases matter as much as the
  full ones.
* The profile checklist now carries a `step`. A row landing on the wrong step
  puts an item behind a screen that never asks for it.
"""
from types import SimpleNamespace

import pytest

from exhibitor_profile import STEP_DETAILS, STEP_HORSES, missing_blocking, profile_checklist
from horse_eligibility import (
    effective_relationship,
    horse_registration_flags,
    owns_horse,
    registration_codes,
)
from rules.apha import DIVISIONS, divisions_for_bracket


# ── The division picker ──────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "bracket,expected",
    [
        # The bug this exists for: a bracket naming a division has to exclude
        # the others, or the picker offers Amateur on a Youth Walk-Trot class.
        ("Youth WT 5-10", ("YOUTH_WALK_TROT_5_10",)),
        ("Youth W/T Ages 11-18", ("YOUTH_WALK_TROT_11_18",)),
        ("Youth Walk-Trot 13 & Under", ("YOUTH_WALK_TROT_11_18",)),
        ("Amateur Walk-Trot", ("AMATEUR_WALK_TROT",)),
        ("Am W/T", ("AMATEUR_WALK_TROT",)),
        ("Novice Youth", ("NOVICE_YOUTH",)),
        ("Novice Amateur", ("NOVICE_AMATEUR",)),
        ("Solid Paint-Bred", ("SOLID_PAINT_BRED",)),
        ("Open", ("OPEN",)),
    ],
)
def test_a_bracket_that_names_a_division_narrows_to_it(bracket, expected):
    assert divisions_for_bracket(bracket) == expected


def test_plain_youth_and_amateur_are_not_their_novice_variants():
    """A Novice division is not a choice made *inside* an Amateur class.

    A show that offers one runs it as its own class -- MNSPHC's schedule has
    class 59 "Novice Amateur Showmanship" sitting beside class 60 "Amateur
    Showmanship" -- so a bracket reading plainly "Amateur" is the Amateur class.
    An exhibitor holding Novice status at a show that offers no Novice class
    shows in Amateur, and that entry is an Amateur entry.

    This is what lets the entry form drop the picker: no bracket is left that
    resolves to a genuine choice.
    """
    assert divisions_for_bracket("Youth 13 & Under") == ("YOUTH",)
    assert divisions_for_bracket("Amateur") == ("AMATEUR",)
    assert divisions_for_bracket("Novice Amateur Showmanship") == ("NOVICE_AMATEUR",)


@pytest.mark.parametrize(
    "bracket",
    [
        "Youth WT 5-10", "Youth W/T 11-18", "Amateur Walk-Trot", "Novice Youth",
        "Novice Amateur", "Solid Paint-Bred", "Open", "Youth", "Amateur",
    ],
)
def test_every_bracket_that_matches_resolves_to_exactly_one_division(bracket):
    """The entry form has no division picker, so a bracket producing two would
    leave the second unreachable -- silently filing every such entry under the
    first."""
    assert len(divisions_for_bracket(bracket)) == 1


@pytest.mark.parametrize(
    "bracket", ["Unassigned", "Yearling", "Four Year & Older", "", None, "   "]
)
def test_a_bracket_that_says_nothing_files_no_division_at_all(bracket):
    """None is "this class does not say", never a guess.

    "Yearling Stallions" is almost always an Open halter class, and filing it as
    OPEN would be right most of the time and would refuse a Solid Paint-Bred
    horse (SC-325.A.1) the rest of it -- an entry the show meant to take, turned
    away over a division nobody chose. The entry is filed with no division,
    which is what every entry did before the picker existed and what
    `validate_entry` returns early on by design.
    """
    assert divisions_for_bracket(bracket) is None


def test_the_class_name_is_read_when_the_bracket_is_silent():
    """A show that files everything under "Unassigned" still names its classes."""
    assert divisions_for_bracket(
        "Unassigned", "Amateur Walk-Trot Horsemanship"
    ) == ("AMATEUR_WALK_TROT",)


def test_the_bracket_wins_over_the_class_name():
    """Where the two disagree, the show's own bracketing is the deliberate one."""
    assert divisions_for_bracket("Open", "Youth Showmanship") == ("OPEN",)


def test_every_division_returned_is_one_an_entry_may_actually_store():
    """A narrowed list that offers a value outside the CHECK constraint would
    hand the exhibitor an option the INSERT rejects."""
    brackets = [
        "Youth WT 5-10", "Youth W/T 11-18", "Amateur Walk-Trot", "Novice Youth",
        "Novice Amateur", "Solid Paint-Bred", "Open", "Youth", "Amateur",
    ]
    for bracket in brackets:
        for division in divisions_for_bracket(bracket) or ():
            assert division in DIVISIONS


# ── The horse's papers ───────────────────────────────────────────────────────

def _horse(**kw):
    return SimpleNamespace(registrations=[], **kw)


def test_no_affiliation_means_no_warning():
    """An Open show with no clubs is not waiting on anybody's papers."""
    assert horse_registration_flags(_horse(), associations=[]) == []


def test_a_horse_with_no_papers_at_all_is_told_which_body_asks():
    flags = horse_registration_flags(_horse(), [("aid-1", "APHA")], set())

    assert len(flags) == 1
    assert flags[0]["code"] == "HORSE_NOT_REGISTERED"
    assert flags[0]["association_code"] == "APHA"
    assert flags[0]["message"] == "No APHA registration number on file."


def test_papers_with_the_wrong_body_read_differently_from_no_papers():
    """A horse carrying an AQHA number at an APHA show is a different
    conversation from one carrying nothing -- its owner knows exactly which
    number is missing."""
    flags = horse_registration_flags(_horse(), [("apha", "APHA")], {"aqha"})

    # The situation differs; the sentence does not. One paragraph per body at a
    # dual-sanctioned show is what the screen collapses into a single line.
    assert flags[0]["code"] == "HORSE_REGISTRATION_MISSING"
    assert flags[0]["message"] == "No APHA registration number on file."


def test_a_registered_horse_raises_nothing():
    assert horse_registration_flags(_horse(), [("apha", "APHA")], {"apha"}) == []


def test_every_body_the_show_runs_under_is_checked_separately():
    """A dual-sanctioned show asks for both, and holding one is not holding
    the other."""
    flags = horse_registration_flags(
        _horse(), [("apha", "APHA"), ("nsba", "NSBA")], {"apha"}
    )

    assert [f["association_code"] for f in flags] == ["NSBA"]


def test_registration_codes_are_sorted_and_deduplicated():
    rows = [
        SimpleNamespace(association=SimpleNamespace(code="NSBA")),
        SimpleNamespace(association=SimpleNamespace(code="APHA")),
        SimpleNamespace(association=SimpleNamespace(code="APHA")),
        SimpleNamespace(association=None),
    ]
    assert registration_codes(rows) == ["APHA", "NSBA"]


# ── How this exhibitor may show this horse ───────────────────────────────────
#
# The relationship to the owner is the question the entry form used to ask on
# every class. Most of the time it does not need asking at all: the exhibitor
# owns the horse, and the horse's own record says so.

def test_owning_the_horse_answers_the_question():
    """The common case, and the whole point: almost every entry ever made is
    somebody showing their own horse."""
    horse = SimpleNamespace(owner_exhibitor_id="ex-1")

    assert owns_horse(horse, "ex-1") is True
    assert effective_relationship(horse, "ex-1") == "Self"


def test_somebody_elses_horse_still_has_to_be_asked():
    """No record anywhere says whether the owner is your mother, your aunt or
    your neighbour -- `exhibitors` holds contact details and a guardian's name,
    not a family tree. None means "ask", never "no relationship"."""
    horse = SimpleNamespace(owner_exhibitor_id="ex-2")

    assert owns_horse(horse, "ex-1") is False
    assert effective_relationship(horse, "ex-1") is None
    assert effective_relationship(horse, "ex-1", "Mother") == "Mother"


def test_an_unowned_horse_is_nobodys():
    """`owner_exhibitor_id` NULL is a horse with only a free-text owner name.
    That is not the caller's horse, and guessing from the text would put a
    statement of eligibility on an entry APHA reads."""
    horse = SimpleNamespace(owner_exhibitor_id=None)

    assert owns_horse(horse, "ex-1") is False
    assert effective_relationship(horse, "ex-1") is None


def test_a_recorded_answer_beats_the_derivation():
    """A co-owner who wrote down something more precise than "Self" should not
    have it quietly overwritten. The derivation only fills a blank."""
    horse = SimpleNamespace(owner_exhibitor_id="ex-1")

    assert effective_relationship(horse, "ex-1", "Family-owned farm or ranch") == (
        "Family-owned farm or ranch"
    )


def test_whitespace_is_not_a_recorded_answer():
    horse = SimpleNamespace(owner_exhibitor_id="ex-1")

    assert effective_relationship(horse, "ex-1", "   ") == "Self"


def test_every_derived_value_is_one_the_picker_offers():
    """A derived relationship goes onto an entry beside hand-picked ones and is
    reported to APHA in the same column; a value outside the list would be a
    local invention."""
    from rules.apha import RELATIONSHIP_OPTIONS

    assert effective_relationship(SimpleNamespace(owner_exhibitor_id="ex-1"), "ex-1") in (
        RELATIONSHIP_OPTIONS
    )


# ── Which step asks for what ─────────────────────────────────────────────────

def _exhibitor(**kw):
    base = dict(
        full_name="Pat Rider",
        date_of_birth=None,
        phone=None,
        address=None,
        city=None,
        state=None,
        zip=None,
        emergency_contact_name=None,
        emergency_contact_phone=None,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_the_horse_row_is_the_only_thing_on_the_horses_step():
    """Everything else is the person, and the person is step one.

    A row on the wrong step is an item behind a screen that never asks for it,
    which reads to the exhibitor as a step that refuses to go green for no
    stated reason.
    """
    checklist = profile_checklist(_exhibitor(), horse_count=0)

    by_step: dict[str, list[str]] = {}
    for item in checklist:
        by_step.setdefault(item["step"], []).append(item["key"])

    assert by_step[STEP_HORSES] == ["horses"]
    assert "horses" not in by_step[STEP_DETAILS]


def test_the_membership_prompt_sits_with_the_person():
    """It is the exhibitor's own card. A *horse's* registration with the same
    association is a different fact and is checked on the horses step."""
    checklist = profile_checklist(
        _exhibitor(), horse_count=1, associations=[("apha", "APHA")]
    )
    membership = next(i for i in checklist if i["key"] == "memberships")

    assert membership["step"] == STEP_DETAILS
    assert membership["blocking"] is False


def test_narrowing_to_a_step_hides_what_the_other_step_owes():
    """Step one must not complain about a horse two steps away -- and finishing
    step one must not be mistaken for finishing the profile, which is what
    `PUT /signup` refuses on."""
    checklist = profile_checklist(_exhibitor(), horse_count=0)

    assert missing_blocking(checklist, STEP_HORSES) == ["At least one horse"]
    assert "At least one horse" not in missing_blocking(checklist, STEP_DETAILS)
    assert "At least one horse" in missing_blocking(checklist)


def test_a_finished_person_still_owes_a_horse():
    checklist = profile_checklist(
        _exhibitor(
            date_of_birth="1988-04-02",
            phone="555-0100",
            address="1 Barn Lane",
            city="Anoka",
            state="MN",
            zip="55303",
            emergency_contact_name="Sam",
            emergency_contact_phone="555-0101",
        ),
        horse_count=0,
    )

    assert missing_blocking(checklist, STEP_DETAILS) == []
    assert missing_blocking(checklist) == ["At least one horse"]
