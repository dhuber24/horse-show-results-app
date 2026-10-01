# Migrations And Releases

Read before writing a migration or releasing to production. The procedure itself is the `release` skill (`.claude/skills/release/`); environments and readiness are in [deployment.md](../deployment.md); migration policy is in [database.md](../database.md).

These are the rules this part of the app keeps and the reasons behind them, moved here from `Claude.md` so they load when the work needs them rather than on every request. One claim per bullet, the claim first. Add new ones under the heading they belong to.

## Key Files

| Area | File |
| --- | --- |
| Does the schema still fit the mappers | `backend/schema_drift.py` |

## Migrations and the release that expects them

- **Which comes first, the migration or the deploy, is decided by the migration.** A *backward-compatible* one — a new table, a nullable or defaulted column, an index — goes to production **before** the code, because `schema_drift` deliberately does not count a column the database has and the build does not map as drift, so the running release ignores it. Deploying first instead is safe but never promotes: the new code maps a column that does not exist, readiness 503s, and Render declines it. A *backward-incompatible* one — `RENAME`, `DROP`, `SET NOT NULL`, a narrowed type — has **no working order**, and must be split into releases that are each backward-compatible (expand / contract: add and write both, backfill and switch reads, then stop mapping the old column and drop it). Migration 133 was a rename done in one step, which is why the site went down. The `release` skill (`.claude/skills/release/`) holds the procedure and the classification test.
- **A migration and the deploy that expects it are one release, and the app is live now.** Local `.env` and Render pointed at the same Neon branch, so applying migration 133's rename of `show_sanctioning.per_class_fee_cents` from a developer machine broke the *running* release instantly: `Class.sanctioning` is `lazy="selectin"`, so every class load selected a column that no longer existed and returned 500. Nothing said so. `/health/ready` answered `{"status":"ok"}` for the entire outage because `SELECT 1` touches no mapped column, and Render's health check is that endpoint — so the platform reported the service healthy while most of it was down. Three things came out of it, and none of them is optional on its own. `backend/schema_drift.py` diffs `Base.metadata` against `information_schema.columns` on readiness, at most once a minute — **throttled rather than checked at boot**, because the migration that breaks a process is normally applied while that process is running, which is exactly what a startup check cannot see. `database/migrate.ps1` prints its target and refuses `PRODUCTION_DATABASE_HOST` without `-AllowProduction`. And development belongs on its own Neon branch (`docs/deployment.md`). **`create_all` is not a safety net here**: it creates a missing *table* and never adds a missing *column*, which is precisely the shape a rename leaves behind.
- The repo has historical duplicate migration numbering around `024_*`; preserve filenames and ordering behavior.
