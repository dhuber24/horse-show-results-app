"""Whether this process still fits the database it is talking to.

The incident these pin: migration 133 renamed
`show_sanctioning.per_class_fee_cents` to `fee_amount_cents` while the previous
release was still serving. That release went on selecting the old name, every
class load 500'd, and `/health/ready` reported `{"status":"ok"}` throughout —
because `SELECT 1` touches no mapped column. The probe was green for the entire
outage.
"""
import pytest

from schema_drift import (
    SCHEMA_CHECK_INTERVAL_SECONDS,
    expected_columns,
    is_stale,
    missing_columns,
)


# ── What counts as drift ──────────────────────────────────────────────────────


def test_a_renamed_column_is_drift():
    """Migration 133, exactly. The database has the new name, this build maps
    the old one, and every read of the table is already broken."""
    expected = {"show_sanctioning": {"show_id", "per_class_fee_cents"}}
    actual = {"show_sanctioning": {"show_id", "fee_amount_cents"}}

    assert missing_columns(expected, actual) == ["show_sanctioning.per_class_fee_cents"]


def test_a_matching_schema_is_not_drift():
    columns = {"shows": {"id", "name"}, "entries": {"id"}}
    assert missing_columns(columns, dict(columns)) == []


def test_a_column_the_database_has_and_the_build_does_not_map_is_not_drift():
    """A migration landed ahead of its deploy. That is the safe direction and
    the one every rollout passes through — the old build simply ignores it."""
    expected = {"shows": {"id"}}
    actual = {"shows": {"id", "apha_zone"}}

    assert missing_columns(expected, actual) == []


def test_an_absent_table_is_not_reported():
    """`create_all` makes it moments later, so reporting it would fire on an
    ordinary first boot against an empty database."""
    assert missing_columns({"brand_new": {"id"}}, {}) == []


def test_every_missing_column_is_named_and_sorted():
    expected = {"b": {"y", "x"}, "a": {"z"}}
    actual = {"b": set(), "a": set()}

    assert missing_columns(expected, actual) == ["a.z", "b.x", "b.y"]


# ── The throttle ──────────────────────────────────────────────────────────────


def test_a_first_check_is_always_stale():
    assert is_stale(None, now=0.0, interval=60.0) is True


def test_an_answer_inside_the_interval_is_reused():
    assert is_stale(100.0, now=159.9, interval=60.0) is False


def test_an_answer_at_the_interval_boundary_is_recomputed():
    """Reused strictly *inside* the window. A check that never expired at its
    own boundary would be a startup-only check with extra steps — and the
    migration that breaks a process is applied while it is running."""
    assert is_stale(100.0, now=160.0, interval=60.0) is True


def test_a_clock_going_backwards_counts_as_stale():
    """Rather than pinning a stale answer until the clock catches up."""
    assert is_stale(100.0, now=5.0, interval=60.0) is True


def test_the_interval_is_short_enough_to_catch_a_live_migration():
    """The whole point is noticing an out-of-band migration without a restart.
    An interval measured in minutes would report health through most of an
    outage."""
    assert SCHEMA_CHECK_INTERVAL_SECONDS <= 60.0


# ── Against the real mappers ──────────────────────────────────────────────────


def test_expected_columns_reads_the_real_metadata():
    import models  # noqa: F401 — registers the mappers

    expected = expected_columns()

    assert "shows" in expected
    assert "fee_amount_cents" in expected["show_sanctioning"], "post-133 name"
    assert "per_class_fee_cents" not in expected["show_sanctioning"]


def test_the_view_is_not_checked():
    """`association_standard_classes` is a VIEW, dropped from the metadata so
    `create_all` cannot make a table under its name. It follows that drift does
    not look at it either."""
    import models  # noqa: F401

    assert "association_standard_classes" not in expected_columns()
