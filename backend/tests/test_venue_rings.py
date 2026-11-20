"""How a show's rings follow its venue (migration 204).

The venue's list is what every later show at that venue starts with, so the
rules here decide what a show office sees offered the next time. The database
half (`adopt_venue_rings`, the routers) only carries these decisions out.
"""
from uuid import uuid4

from venue_rings import (
    ShowRingRef,
    VenueRingRef,
    name_taken,
    plan_rename,
    plan_venue_change,
    ring_key,
)


def test_names_compare_the_way_the_unique_index_does():
    """`lower(btrim(name))`: a clash found here is the one the database refuses."""
    assert ring_key("  Main Arena ") == ring_key("main arena")
    assert ring_key("Arena 2") != ring_key("Arena  2")


def test_a_name_already_at_the_show_is_taken_whatever_its_case():
    assert name_taken("main arena", ["Main Arena", "Warm-Up Pen"])
    assert not name_taken("Covered Arena", ["Main Arena"])


# ── Picking a venue ──────────────────────────────────────────────────────────

def test_a_show_with_no_rings_takes_the_venues_list():
    plan = plan_venue_change([], [VenueRingRef(uuid4(), "Main Arena")], venue_set=True)
    assert plan.adopt


def test_a_venue_with_no_rings_gives_nothing_to_take():
    """The first class then makes the "Ring 1" default, as before."""
    plan = plan_venue_change([], [], venue_set=True)
    assert not plan.adopt


def test_a_show_that_already_has_rings_keeps_them_and_matches_by_name():
    """Nothing is moved or deleted: classes point at these rings."""
    main, pen = VenueRingRef(uuid4(), "Main Arena"), VenueRingRef(uuid4(), "Warm-Up Pen")
    ring_main = ShowRingRef(uuid4(), "main arena", None)
    ring_one = ShowRingRef(uuid4(), "Ring 1", None)
    plan = plan_venue_change([ring_main, ring_one], [main, pen], venue_set=True)
    assert not plan.adopt
    assert plan.links == {ring_main.id: main.id, ring_one.id: None}


def test_a_ring_from_the_old_venue_does_not_point_at_it_after_a_move():
    """A link to another fairground's ring would offer its list at this one."""
    old_venue_ring = uuid4()
    ring = ShowRingRef(uuid4(), "Coliseum", old_venue_ring)
    plan = plan_venue_change([ring], [VenueRingRef(uuid4(), "Main Arena")], venue_set=True)
    assert plan.links == {ring.id: None}


def test_a_ring_already_on_this_venues_list_keeps_its_link_even_renamed():
    venue_ring = VenueRingRef(uuid4(), "Main Arena")
    ring = ShowRingRef(uuid4(), "Main", venue_ring.id)
    plan = plan_venue_change([ring], [venue_ring], venue_set=True)
    assert plan.links == {ring.id: venue_ring.id}


def test_clearing_the_venue_makes_every_ring_the_shows_own():
    rings = [ShowRingRef(uuid4(), "Main Arena", uuid4()), ShowRingRef(uuid4(), "Ring 1", None)]
    plan = plan_venue_change(rings, [], venue_set=False)
    assert not plan.adopt
    assert plan.links == {r.id: None for r in rings}


# ── Renaming a ring that is on the venue's list ──────────────────────────────

def test_a_ring_only_this_show_runs_is_renamed_at_the_venue_too():
    """The typo case: "Main Arean" fixed once, fixed for the next show."""
    current = uuid4()
    action = plan_rename("Main Arena", current, [VenueRingRef(current, "Main Arean")], 0)
    assert action.kind == "rename"


def test_another_show_running_it_keeps_its_name_and_the_venue_gains_one():
    """Another show's ring is its record of where its classes ran."""
    current = uuid4()
    action = plan_rename("Coliseum", current, [VenueRingRef(current, "Main Arena")], 1)
    assert action.kind == "create"


def test_a_name_the_venue_already_has_points_at_that_ring():
    """Rather than a second ring of the same name, which the index refuses."""
    current, covered = uuid4(), uuid4()
    action = plan_rename(
        "covered arena",
        current,
        [VenueRingRef(current, "Arena 2"), VenueRingRef(covered, "Covered Arena")],
        0,
    )
    assert action.kind == "relink"
    assert action.venue_ring_id == covered


def test_changing_only_the_case_of_a_name_renames_in_place():
    """Its own row is not "a ring the venue already has"."""
    current = uuid4()
    action = plan_rename("MAIN ARENA", current, [VenueRingRef(current, "Main Arena")], 0)
    assert action.kind == "rename"
