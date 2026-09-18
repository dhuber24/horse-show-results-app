"""Keeping a futurity nomination and its class entries in step.

A nomination is what prices a futurity class — the class row carries no fee of
its own — so the two facts are useless apart and were, until now, entirely
independent. This module's rule closes it from both ends: enrolling books the
classes, and scratching the last of them releases the nomination.

The release is the half with edges, and every one of them is a way of clearing
a row somebody meant to keep:

* **only futurities that judged the scratched class** — a nomination in another
  programme is not this deletion's business;
* **only where nothing of that futurity is left** — one nomination covers every
  class it names, so scratching one of four leaves three behind it;
* **per horse, never per exhibitor** — two horses of one person in the same
  futurity are two nominations, and scratching one horse's last class says
  nothing about the other. This is where it differs from a side pot, whose
  membership hangs off the roster row.
"""
from types import SimpleNamespace
from uuid import uuid4

from futurity_enrollment import (
    class_ids_of,
    enrollments_to_release,
    futurities_covering_class,
)

WP_3YO = uuid4()
TRAIL_3YO = uuid4()
HALTER = uuid4()
BELLE = uuid4()
SCOUT = uuid4()


def make_futurity(*, name="North Star Futurity", classes=(), horses=()):
    """A Futurity as this module reads one: its classes and its nominations."""
    return SimpleNamespace(
        id=uuid4(),
        name=name,
        futurity_classes=[SimpleNamespace(class_id=cid) for cid in classes],
        entries=[SimpleNamespace(id=uuid4(), horse_id=h) for h in horses],
    )


# ── Which futurities judge a class ───────────────────────────────────────────

def test_a_class_no_futurity_names_is_covered_by_nothing():
    f = make_futurity(classes=[WP_3YO])
    assert futurities_covering_class([f], HALTER) == []


def test_class_ids_reads_the_programme():
    f = make_futurity(classes=[WP_3YO, TRAIL_3YO])
    assert class_ids_of(f) == {WP_3YO, TRAIL_3YO}


def test_covering_futurities_are_name_sorted_for_stable_messages():
    a = make_futurity(name="Zenith Futurity", classes=[WP_3YO])
    b = make_futurity(name="Apex Futurity", classes=[WP_3YO])
    assert [f.name for f in futurities_covering_class([a, b], WP_3YO)] == [
        "Apex Futurity",
        "Zenith Futurity",
    ]


# ── What a scratch releases ──────────────────────────────────────────────────

def test_the_last_futurity_class_releases_the_nomination():
    f = make_futurity(classes=[WP_3YO], horses=[BELLE])
    released = enrollments_to_release([f], BELLE, WP_3YO, remaining_class_ids=set())
    assert [r[0] for r in released] == [f]


def test_one_of_several_classes_releases_nothing():
    """One nomination covers every class the futurity names, so the other three
    are still behind it."""
    f = make_futurity(classes=[WP_3YO, TRAIL_3YO], horses=[BELLE])
    released = enrollments_to_release([f], BELLE, WP_3YO, remaining_class_ids={TRAIL_3YO})
    assert released == []


def test_a_futurity_that_did_not_judge_the_scratched_class_is_untouched():
    """Including a nomination with no classes entered at all — that predates the
    rule and is the office's to judge, not this deletion's."""
    f = make_futurity(classes=[TRAIL_3YO], horses=[BELLE])
    released = enrollments_to_release([f], BELLE, HALTER, remaining_class_ids=set())
    assert released == []


def test_another_horses_nomination_survives():
    """The difference from a side pot: membership is per horse here, so Scout's
    nomination is untouched by Belle's last class going."""
    f = make_futurity(classes=[WP_3YO], horses=[BELLE, SCOUT])
    released = enrollments_to_release([f], BELLE, WP_3YO, remaining_class_ids=set())
    assert [r[1].horse_id for r in released] == [BELLE]


def test_a_horse_with_no_nomination_releases_nothing():
    f = make_futurity(classes=[WP_3YO], horses=[SCOUT])
    assert enrollments_to_release([f], BELLE, WP_3YO, remaining_class_ids=set()) == []


def test_remaining_classes_outside_the_futurity_do_not_hold_it():
    """The horse is still showing — in halter, which this futurity does not
    judge. The nomination has nothing behind it and goes."""
    f = make_futurity(classes=[WP_3YO], horses=[BELLE])
    released = enrollments_to_release([f], BELLE, WP_3YO, remaining_class_ids={HALTER})
    assert [r[0] for r in released] == [f]


def test_two_futurities_over_the_same_class_both_release():
    a = make_futurity(name="Apex", classes=[WP_3YO], horses=[BELLE])
    b = make_futurity(name="Zenith", classes=[WP_3YO], horses=[BELLE])
    released = enrollments_to_release([a, b], BELLE, WP_3YO, remaining_class_ids=set())
    assert sorted(r[0].name for r in released) == ["Apex", "Zenith"]


def test_one_of_two_futurities_keeps_its_nomination():
    """Apex judges the scratched class and Zenith judges trail, which the horse
    is still in. Only Apex's nomination goes."""
    a = make_futurity(name="Apex", classes=[WP_3YO], horses=[BELLE])
    b = make_futurity(name="Zenith", classes=[WP_3YO, TRAIL_3YO], horses=[BELLE])
    released = enrollments_to_release([a, b], BELLE, WP_3YO, remaining_class_ids={TRAIL_3YO})
    assert [r[0].name for r in released] == ["Apex"]


def test_no_futurities_at_the_show_releases_nothing():
    assert enrollments_to_release([], BELLE, WP_3YO, remaining_class_ids=set()) == []
