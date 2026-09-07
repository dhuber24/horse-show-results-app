"""Mapped columns the database does not have.

`Base.metadata.create_all` runs at startup and creates a *table* that is
missing. It never adds a *column* to a table that already exists — and that is
exactly the hole a rename leaves. Migration 133 renamed
`show_sanctioning.per_class_fee_cents` to `fee_amount_cents` while the previous
release was still running: that process went on selecting the old name, every
read through `Class.sanctioning` (`lazy="selectin"`, so *every* class load)
returned 500, and `/health/ready` stayed green the whole time because `SELECT 1`
touches no mapped column. Render reported the service healthy for as long as it
was broken.

So readiness asks the second question too — does the schema this process was
built against still exist? Two decisions worth keeping:

**Throttled, not cached at boot.** The migration that breaks a process is
normally applied *while* that process is running, which is precisely the case a
startup-only check cannot see. Recomputing at most once a minute costs one
`information_schema` query per minute and catches an out-of-band migration
within one.

**Columns only, and an absent table is not drift.** A missing table is created
by `create_all` moments later, so reporting it would fire on an ordinary first
boot against a fresh database. A missing *column* is never repaired by anything
the process can do, which is what makes it worth refusing traffic over.
"""
from __future__ import annotations

from typing import Mapping

from sqlalchemy import text

from database import Base

# How long a drift answer is reused before the database is asked again.
SCHEMA_CHECK_INTERVAL_SECONDS = 60.0

_cache: dict = {"at": None, "missing": []}


def expected_columns() -> dict[str, set[str]]:
    """`{table: {column, ...}}` for everything the ORM maps.

    Reads `Base.metadata`, so a model this process never imports is not checked
    — which is the right scope: an unmapped table cannot break a query it has
    no mapper for. `main.py` imports `models` before anything reads this.
    """
    return {
        table.name: {column.name for column in table.columns}
        for table in Base.metadata.tables.values()
    }


def missing_columns(
    expected: Mapping[str, set[str]], actual: Mapping[str, set[str]]
) -> list[str]:
    """`table.column`, sorted, for every mapped column the database lacks.

    A table absent from `actual` is skipped rather than reported — see the
    module docstring. Extra columns in the database are not drift either: a
    column this build does not map is a migration that has landed ahead of its
    deploy, which is the safe direction and the one every rollout passes
    through.
    """
    missing: list[str] = []
    for table, columns in expected.items():
        present = actual.get(table)
        if present is None:
            continue
        missing.extend(f"{table}.{column}" for column in columns - present)
    return sorted(missing)


async def actual_columns(conn) -> dict[str, set[str]]:
    """`{table: {column, ...}}` as the database currently has it."""
    rows = await conn.execute(
        text(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema = current_schema()"
        )
    )
    actual: dict[str, set[str]] = {}
    for table, column in rows:
        actual.setdefault(table, set()).add(column)
    return actual


def is_stale(checked_at: float | None, now: float, interval: float) -> bool:
    """Whether the cached answer is old enough to ask again.

    `now` is passed rather than read here for the reason every other date in
    this codebase is passed in: a caller has to be able to test the boundary.
    A clock that goes backwards (`now < checked_at`) counts as stale — the
    alternative is pinning a stale answer until the clock catches up.
    """
    if checked_at is None:
        return True
    return not (checked_at <= now < checked_at + interval)


async def schema_drift(
    engine,
    now: float,
    *,
    interval_seconds: float = SCHEMA_CHECK_INTERVAL_SECONDS,
) -> list[str]:
    """Mapped columns the database is missing, recomputed at most once per interval."""
    if not is_stale(_cache["at"], now, interval_seconds):
        return _cache["missing"]

    async with engine.connect() as conn:
        missing = missing_columns(expected_columns(), await actual_columns(conn))

    _cache["at"] = now
    _cache["missing"] = missing
    return missing


def reset_cache() -> None:
    """Forget the cached answer. For tests, and for a caller that has just
    applied a migration and wants the next probe to tell the truth."""
    _cache["at"] = None
    _cache["missing"] = []
