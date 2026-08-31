"""How many horses one exhibitor may show, and who else may show a horse.

Three rules, and the third has a different shape from the other two:

  * SC-185.F   — at most five horses across the individual working events.
  * SC-185.F.1 — at most two in Longe Line, and two in In-Hand Trail.
  * AM-300.H   — one horse may not be shown by two Amateur Walk-Trot exhibitors
                 in the same event at the same show.

The first two are per exhibitor. The last is per **horse** and crosses
exhibitors, which is why it cannot be answered by looking at the entry alone —
and why `apha_context.apha_entry_context` reads the whole show rather than one
person's entries.
"""
from types import SimpleNamespace
from uuid import uuid4

import pytest

from rules.apha import (
    INDIVIDUAL_WORKING_EVENTS,
    MAX_INDIVIDUAL_WORKING_HORSES,
    MAX_TWO_HORSE_EVENT_HORSES,
    TWO_HORSE_EVENTS,
    APHARules,
)
from tests.factories import make_class, make_entry, make_horse, make_show


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


class Fixture:
    """A show whose classes have disciplines, and the entries already in it.

    Mirrors what `apha_entry_context` hands the rules: a class_id -> discipline
    map and a flat list of live entries.
    """

    def __init__(self):
        self.disciplines = {}
        self.entries = []
        self.exhibitor_id = uuid4()

    def cls(self, discipline):
        c = make_class(class_name=discipline)
        self.disciplines[c.id] = discipline
        return c

    def existing(self, cls, horse_id, exhibitor_id=None, division=None):
        self.entries.append(SimpleNamespace(
            id=uuid4(),
            exhibitor_id=exhibitor_id or self.exhibitor_id,
            horse_id=horse_id,
            class_id=cls.id,
            apha_division=division,
        ))

    @property
    def context(self):
        return {"apha_disciplines": self.disciplines, "apha_entries": self.entries}

    def entry(self, cls, horse_id=None, exhibitor_id=None, **kw):
        return make_entry(
            cls=cls,
            horse_id=horse_id or uuid4(),
            exhibitor_id=exhibitor_id or self.exhibitor_id,
            **kw,
        )


@pytest.fixture
def fx():
    return Fixture()


# ── SC-185.F: five horses across the individual working events ───────────────

def test_a_fifth_horse_in_working_events_is_fine(rules, show, fx):
    trail = fx.cls("Trail")
    reining = fx.cls("Reining")
    for _ in range(4):
        fx.existing(reining, uuid4())

    entry = fx.entry(trail)

    assert rules.validate_entry(entry, show, trail, fx.context) == []


def test_a_sixth_horse_is_refused(rules, show, fx):
    trail = fx.cls("Trail")
    reining = fx.cls("Reining")
    for _ in range(5):
        fx.existing(reining, uuid4())

    issues = rules.validate_entry(fx.entry(trail), show, trail, fx.context)

    assert codes(errors(issues)) == ["APHA_HORSE_LIMIT_EXCEEDED"]
    assert str(MAX_INDIVIDUAL_WORKING_HORSES) in errors(issues)[0]["message"]


def test_the_cap_counts_horses_not_entries(rules, show, fx):
    """Six classes on one horse is one horse. The rule caps how many horses
    somebody brings, not how hard they work them."""
    horse = uuid4()
    classes = [fx.cls(name) for name in
               ["Trail", "Reining", "Cutting", "Western Riding", "Ranch Riding"]]
    for c in classes:
        fx.existing(c, horse)

    entry = fx.entry(fx.cls("Barrel Racing"), horse_id=horse)

    assert rules.validate_entry(entry, show, entry.class_, fx.context) == []


def test_the_cap_spans_events_rather_than_applying_per_event(rules, show, fx):
    """"A maximum of five horses ... in individual working events" is one
    allowance across the list, not five per class."""
    for name in ["Trail", "Reining", "Cutting", "Cutting", "Barrel Racing"]:
        fx.existing(fx.cls(name), uuid4())

    entry = fx.entry(fx.cls("Pole Bending"))

    assert codes(errors(rules.validate_entry(entry, show, entry.class_, fx.context))) == [
        "APHA_HORSE_LIMIT_EXCEEDED"
    ]


def test_rail_classes_do_not_count_toward_it(rules, show, fx):
    """Western Pleasure and Halter are not individual working events, and
    counting them would cap a rule APHA did not write."""
    for _ in range(6):
        fx.existing(fx.cls("Western Pleasure"), uuid4())

    entry = fx.entry(fx.cls("Trail"))

    assert rules.validate_entry(entry, show, entry.class_, fx.context) == []


def test_another_exhibitors_horses_do_not_count(rules, show, fx):
    someone_else = uuid4()
    for _ in range(6):
        fx.existing(fx.cls("Trail"), uuid4(), exhibitor_id=someone_else)

    entry = fx.entry(fx.cls("Reining"))

    assert rules.validate_entry(entry, show, entry.class_, fx.context) == []


def test_re_validating_an_existing_entry_does_not_count_it_twice(rules, show, fx):
    """On PATCH the entry is already in the show's entries. Counting it against
    its own cap would make the fifth horse un-editable."""
    trail = fx.cls("Trail")
    for _ in range(4):
        fx.existing(fx.cls("Reining"), uuid4())
    horse = uuid4()
    fx.existing(trail, horse)
    existing_id = fx.entries[-1].id

    entry = fx.entry(trail, horse_id=horse, id=existing_id)

    assert rules.validate_entry(entry, show, trail, fx.context) == []


# ── SC-185.F.1: two horses in Longe Line and In-Hand Trail ───────────────────

@pytest.mark.parametrize("event", sorted(TWO_HORSE_EVENTS))
def test_two_horses_is_the_limit_in_these_events(rules, show, event):
    fx = Fixture()
    cls = fx.cls(event)
    for _ in range(MAX_TWO_HORSE_EVENT_HORSES):
        fx.existing(cls, uuid4())

    issues = rules.validate_entry(fx.entry(cls), show, cls, fx.context)

    assert codes(errors(issues)) == ["APHA_HORSE_LIMIT_EXCEEDED"]
    assert event in errors(issues)[0]["message"]


@pytest.mark.parametrize("event", sorted(TWO_HORSE_EVENTS))
def test_a_second_horse_is_allowed(rules, show, event):
    fx = Fixture()
    cls = fx.cls(event)
    fx.existing(cls, uuid4())

    assert rules.validate_entry(fx.entry(cls), show, cls, fx.context) == []


def test_the_two_events_are_counted_separately(rules, show, fx):
    """The rule names them separately and they run as separate classes, so two
    in one does not spend the allowance in the other."""
    longe = fx.cls("Longe Line")
    in_hand = fx.cls("In-Hand Trail")
    for _ in range(2):
        fx.existing(longe, uuid4())

    assert rules.validate_entry(fx.entry(in_hand), show, in_hand, fx.context) == []


def test_longe_line_does_not_spend_the_working_event_allowance(rules, show, fx):
    """Longe Line is not on the SC-185.F list; it has its own cap."""
    longe = fx.cls("Longe Line")
    fx.existing(longe, uuid4())
    for _ in range(4):
        fx.existing(fx.cls("Trail"), uuid4())

    entry = fx.entry(fx.cls("Reining"))

    assert rules.validate_entry(entry, show, entry.class_, fx.context) == []


# ── AM-300.H: one horse, one Walk-Trot exhibitor, per event ──────────────────

def test_two_walk_trot_exhibitors_may_not_share_a_horse_in_one_event(rules, show, fx):
    trail = fx.cls("Trail")
    horse = uuid4()
    fx.existing(trail, horse, exhibitor_id=uuid4(), division="AMATEUR_WALK_TROT")

    entry = fx.entry(
        trail, horse_id=horse,
        apha_division="AMATEUR_WALK_TROT", relationship_to_owner="Self",
    )

    assert codes(errors(rules.validate_entry(entry, show, trail, fx.context))) == [
        "APHA_WALK_TROT_HORSE_SHARED"
    ]


def test_it_is_scoped_to_the_event(rules, show, fx):
    """The example in the rule: a horse in Walk-Trot Trail may not be shown in
    Walk-Trot Trail by somebody else — but Western Pleasure is a different
    event."""
    trail = fx.cls("Trail")
    pleasure = fx.cls("Western Pleasure")
    horse = uuid4()
    fx.existing(trail, horse, exhibitor_id=uuid4(), division="AMATEUR_WALK_TROT")

    entry = fx.entry(
        pleasure, horse_id=horse,
        apha_division="AMATEUR_WALK_TROT", relationship_to_owner="Self",
    )

    assert rules.validate_entry(entry, show, pleasure, fx.context) == []


def test_the_same_exhibitor_may_ride_their_own_horse_twice(rules, show, fx):
    """The rule is about two *different* exhibitors."""
    trail = fx.cls("Trail")
    horse = uuid4()
    fx.existing(trail, horse, division="AMATEUR_WALK_TROT")

    entry = fx.entry(
        trail, horse_id=horse,
        apha_division="AMATEUR_WALK_TROT", relationship_to_owner="Self",
    )

    assert rules.validate_entry(entry, show, trail, fx.context) == []


def test_a_non_walk_trot_entry_on_the_same_horse_is_fine(rules, show, fx):
    """The restriction is written into the Amateur Walk-Trot division. A horse
    carrying a Walk-Trot rider and a Youth rider is ordinary."""
    trail = fx.cls("Trail")
    horse = uuid4()
    fx.existing(trail, horse, exhibitor_id=uuid4(), division="YOUTH")

    entry = fx.entry(
        trail, horse_id=horse,
        apha_division="AMATEUR_WALK_TROT", relationship_to_owner="Self",
    )

    assert rules.validate_entry(entry, show, trail, fx.context) == []


# ── When the rules decline to say anything ───────────────────────────────────

def test_no_context_means_no_cap(rules, show):
    """A non-APHA show builds no discipline map, and a caller that has not built
    one must not have entries refused on a guessed discipline."""
    cls = make_class()
    entry = make_entry(cls=cls, apha_division="OPEN")

    assert rules.validate_entry(entry, show, cls, {}) == []


def test_a_class_with_no_discipline_is_not_capped(rules, show, fx):
    """A class routed to the per-show "Unassigned" placeholder has no event, so
    there is no allowance to spend."""
    cls = make_class()
    fx.disciplines[cls.id] = None
    for _ in range(6):
        fx.existing(fx.cls("Trail"), uuid4())

    assert rules.validate_entry(fx.entry(cls), show, cls, fx.context) == []


def test_an_entry_with_no_horse_is_not_a_crash(rules, show, fx):
    cls = fx.cls("Trail")
    entry = fx.entry(cls, horse_id=None, horse_name=None)

    assert rules.validate_entry(entry, show, cls, fx.context) == []


def test_the_working_event_list_and_the_two_horse_list_do_not_overlap():
    """A discipline in both would take whichever branch happened to be first."""
    assert not (INDIVIDUAL_WORKING_EVENTS & TWO_HORSE_EVENTS)
