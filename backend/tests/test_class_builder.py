"""The two rules the Class Builder's screens are only the affordance for.

Both exist because the builder now offers gestures that produce them by
accident. *Add a Grand & Reserve class* suggests the same name every time it is
opened on the same cell, so pressing it twice is one press away from two
identically named classes on one day — which the show bill cannot print and the
gate cannot call. And the class list grew a multi-select, so "delete" went from
one named row to forty ticks, over rows that cascade to their entries and
placings.

The screens grey out a taken grid cell and disable the Add button, but a lock on
a screen is an affordance and never the enforcement — the rules are on the
endpoint, and these are the parts of them that can be read without a database.
"""
from datetime import date
from types import SimpleNamespace

from routers.classes import bulk_delete_blocker, normalized_class_name


def make_class(
    number: str,
    name: str,
    *,
    entries: int = 0,
    results: int = 0,
    day: date = date(2026, 6, 13),
    sort_order: int = 1,
) -> SimpleNamespace:
    return SimpleNamespace(
        class_number=number,
        class_name=name,
        class_date=day,
        sort_order=sort_order,
        entries=[object()] * entries,
        results=[object()] * results,
    )


# ── One class of a name per day ──────────────────────────────────────────────

def test_the_duplicate_key_is_what_sql_compares():
    """`lower(btrim(...))`, and nothing cleverer.

    The comparison happens in the database. A normalisation that folded more
    than SQL's does — collapsing inner runs of spaces, say — would report a
    clash the query then failed to find, refusing on a screen and accepting at
    the endpoint.
    """
    assert normalized_class_name("  Grand & Reserve Amateur Mares ") == (
        "grand & reserve amateur mares"
    )
    assert normalized_class_name("AMATEUR HALTER") == normalized_class_name("amateur halter")


def test_two_championship_classes_in_one_cell_are_not_duplicates():
    """Why the rule is keyed on the name rather than on the grid cell.

    Both of these are Halter × Amateur on the same day, both entered by
    qualifying, and both are real classes on a real show bill. A cell-keyed
    rule would refuse the second one — which is the case that decided this.
    """
    assert normalized_class_name("Grand & Reserve Amateur Mares") != normalized_class_name(
        "Grand & Reserve Amateur Geldings"
    )


# ── The sweep refuses a class somebody has entered ───────────────────────────

def test_a_schedule_nobody_has_entered_sweeps_clean():
    assert bulk_delete_blocker([make_class("1", "Amateur Halter"), make_class("2", "Youth Trail")]) is None


def test_an_entered_class_stops_the_whole_sweep():
    """All or nothing, and the message names what to untick.

    Deleting the other thirty-nine and reporting the one that survived would
    leave the secretary working out which — and the ones that went took their
    entries with them.
    """
    refusal = bulk_delete_blocker(
        [make_class("1", "Amateur Halter"), make_class("2", "Youth Trail", entries=3)]
    )
    assert refusal is not None
    assert "#2 Youth Trail" in refusal
    assert "Nothing was deleted" in refusal
    # The class nobody entered is not named: it is not the problem, and listing
    # it would read as though it had been deleted.
    assert "Amateur Halter" not in refusal


def test_a_placing_blocks_it_as_surely_as_an_entry():
    """A judged class whose entries were later withdrawn still holds results.

    `results` is loaded beside `entries` on the delete path for this reason —
    checking entries alone would let a sweep take a card off the record.
    """
    refusal = bulk_delete_blocker([make_class("7", "Open Western Pleasure", results=8)])
    assert refusal is not None and "#7 Open Western Pleasure" in refusal


def test_a_long_refusal_names_three_and_counts_the_rest():
    """The message is read at a desk, not parsed. Forty class names is not a
    message, so it names enough to find them by and says how many more."""
    blocked = [make_class(str(i), f"Class {i}", entries=1, sort_order=i) for i in range(1, 6)]
    refusal = bulk_delete_blocker(blocked)
    assert refusal is not None
    assert "#1 Class 1" in refusal and "#3 Class 3" in refusal
    assert "#4 Class 4" not in refusal
    assert "and 2 more" in refusal


def test_blocked_classes_are_named_in_running_order():
    """Day then position — the order they appear in the list being ticked."""
    refusal = bulk_delete_blocker(
        [
            make_class("9", "Sunday Trail", entries=1, day=date(2026, 6, 14), sort_order=9),
            make_class("2", "Saturday Halter", entries=1, day=date(2026, 6, 13), sort_order=2),
        ]
    )
    assert refusal is not None
    assert refusal.index("#2 Saturday Halter") < refusal.index("#9 Sunday Trail")
