---
name: release
description: Release a change to production (gaitdesk.com) in the right order relative to its database migration, then verify it. Use when asked to deploy, release, ship, push to production, or when a change includes a migration that production needs. Also use to classify whether a migration is safe to release in one step at all.
---

Production is `gaitdesk.com` (Render service `gaitdesk-web`) and
`api.gaitdesk.com` (`gaitdesk-api`), both on `autoDeployTrigger: commit` — so
**`git push` is the deploy**. The database is a Neon branch the local `.env`
does *not* point at any more; `migrate.ps1` refuses it without
`-AllowProduction`.

That makes a release two independent events — code and schema — and **the order
is decided by the migration, not by preference.** Getting it wrong once already
took the site down: migration 133 renamed `show_sanctioning.per_class_fee_cents`
against the database the deployed release was reading from, every class load
500'd (`Class.sanctioning` is `lazy="selectin"`, so that is *every* class load),
and `/health/ready` stayed green because `SELECT 1` touches no mapped column.

## Step 1: classify the migration — this decides everything

Read the actual SQL in `database/migrations/`. Do not skip this; the rest of the
procedure branches on the answer.

**Backward-compatible** — the *currently deployed* code keeps working after it
runs:

- `CREATE TABLE`
- `ADD COLUMN` that is nullable, or has a `DEFAULT`
- `CREATE INDEX`, `COMMENT ON`, adding a value to a `CHECK` list
- backfills that only write

**Backward-incompatible** — the deployed code breaks the moment it runs:

- `RENAME COLUMN` / `RENAME TABLE`
- `DROP COLUMN` / `DROP TABLE`
- `SET NOT NULL`, or `ADD COLUMN ... NOT NULL` with no default
- narrowing a type, or removing a value from a `CHECK` list

If you are unsure, it is backward-incompatible. Guessing wrong in that direction
costs a wasted release; guessing wrong in the other direction costs an outage.

## Step 2a: backward-compatible — migrate production, then deploy

```powershell
# 1. dev first, always — this is free and reversible
powershell -ExecutionPolicy Bypass -File database/migrate.ps1
```

Run the tests (`bash RUN_TESTS.sh`), then:

```powershell
# 2. production schema, ahead of the code that needs it
powershell -ExecutionPolicy Bypass -File database/migrate.ps1 -AllowProduction
```

This is safe *because* `schema_drift.py` treats a column the database has and
the build does not map as **not** drift — the running release ignores it. Verify
production is still healthy before going further (Step 3), then commit and push
via the **git-commit-push** skill.

Deploying first instead is *safe but unsuccessful*: the new code maps a column
that does not exist, readiness returns 503, and Render declines to promote it.
Nothing breaks — the old version keeps serving — but you are stuck until you
migrate anyway. Prefer migrate-first; it has no failed-deploy step.

## Step 2b: backward-incompatible — do NOT release it in one step

There is no ordering that works. Migrating first breaks the running release;
deploying first fails readiness and never promotes. Split it into releases that
are each backward-compatible (expand / contract). For a rename:

1. **Expand.** Migration adds the new column. Code writes **both** and reads the
   old one. Release by Step 2a.
2. **Move.** Migration backfills the new column from the old. Code reads the new
   one, still writes both. Release by Step 2a.
3. **Contract.** Code stops referencing the old column — **deploy this first**,
   so nothing maps it any more. Then the migration drops it.

Only step 3 inverts the order, and only because dropping a column nothing maps
is itself backward-compatible by then.

If the user insists on a single-step rename, say plainly that it means a
deliberate outage window, get that confirmed, and do it at a quiet time:
migrate, then push, then watch readiness recover. Do not present it as routine.

## Step 3: verify production

Both of these, every time. Neither alone is sufficient.

```bash
# Reached Render at all? (an rndr-id header means yes; Cloudflare errors have none)
curl -sD- https://api.gaitdesk.com/health/ready | head -5

# The app's own read path, which is what actually broke last time
curl -s -o /dev/null -w '%{http_code}\n' https://api.gaitdesk.com/shows/
curl -s -o /dev/null -w '%{http_code}\n' https://gaitdesk.com/
```

Want: `{"status":"ok","database":"ok","schema":"ok"}` and `200` from both reads.

**`"schema":"drifted"` names the offending columns in `missing_columns`** — that
is the whole diagnosis, and it means code and schema are out of step in the
direction where the code is ahead.

**Allow up to 60s for readiness to catch up.** `schema_drift` caches its answer
for `SCHEMA_CHECK_INTERVAL_SECONDS` (60), so immediately after migrating
production the probe may still report the previous state. A stale green is the
reason to check the read paths too, not just the probe.

## Step 4: watch, don't assume

Render does zero-downtime swaps, so a successful deploy usually shows no
disruption at all. To confirm that rather than hope for it, sample for a few
minutes and count failures — watch for *breakage*, not for success, because a
response shape that does not change between builds gives you nothing to wait on:

```bash
for i in $(seq 1 18); do
  r=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 https://api.gaitdesk.com/health/ready)
  s=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 https://api.gaitdesk.com/shows/)
  w=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 https://gaitdesk.com/)
  [ "$r$s$w" != "200200200" ] && echo "FAIL at $((i*20))s: ready=$r shows=$s web=$w"
  sleep 20
done; echo done
```

Run it with Bash `run_in_background: true` so the user is not blocked.

## Gotchas

- **`git push` deploys.** There is no separate release button, and no staging
  environment. A push with an unrelated WIP commit ships that too.
- **The local `.env` has no production credentials** since the dev-branch split,
  which is deliberate. Production is reached through `migrate.ps1
  -AllowProduction` (it reads `DATABASE_URL`, so this only works from a machine
  pointed at production) or through the public API. Do not "temporarily" repoint
  `DATABASE_URL` at production to run something — that is the configuration the
  split exists to prevent.
- **`PRODUCTION_DATABASE_HOST` in `.env` is what arms the guard.** If
  `migrate.ps1` runs against production without being asked, that line is
  missing or stale.
- **Migrations are append-only and idempotent here.** Re-running is the check:
  every migration must report `applying:` or `skipped:`, ending in `Migrations
  complete.`
- **`create_all` runs on every backend boot** and will create a missing *table*
  from the models — so a migration that adds a table may report as already
  applied. It never adds a missing *column*, which is the gap the drift probe
  covers.
- **Never `-AllowProduction` without being asked for this specific release.**
  It is the one irreversible step in the procedure.
