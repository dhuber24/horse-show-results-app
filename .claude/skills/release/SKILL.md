---
name: release
description: Release a change to production (gaitdesk.com) in the right order relative to its database migration, then verify it. Use when asked to deploy, release, ship, push to production, or when a change includes a migration that production needs. Also use to classify whether a migration is safe to release in one step at all.
---

Production is `gaitdesk.com` (Render service `gaitdesk-web`) and
`api.gaitdesk.com` (`gaitdesk-api`), both on `autoDeployTrigger: checksPass` —
so **`git push` is the deploy**, once CI goes green. There is no release button
and no staging environment. A red CI now holds the deploy rather than arriving
too late to matter, but nothing else about the push changes: an unrelated WIP
commit still ships with it.

The database is a Neon branch the local `.env` does *not* point at; both
migration runners refuse it without `-AllowProduction`.

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

**`CREATE TABLE` is the dangerous member of the safe list.** It is genuinely
backward-compatible, but it is the one case where **readiness will not catch you
getting the order wrong** — see Step 3. `create_all` builds the table from the
models at boot, so a deploy that lands ahead of its migration comes up green with
a table that has no server defaults, no unique indexes and no CHECK constraints.
Treat a `CREATE TABLE` migration as migrate-first with no safety net.

## Step 2a: backward-compatible — migrate production, then deploy

```powershell
# 1. dev first, always — this is free and reversible
powershell -ExecutionPolicy Bypass -File database/migrate.ps1
```

Run the tests (`bash RUN_TESTS.sh`). Then branch production in the Neon console
(**Branches > New branch**, named for the release) — it is instant, costs
nothing, and is the only backup step there is. Then:

```powershell
# 2. production schema, ahead of the code that needs it
powershell -ExecutionPolicy Bypass -File database/migrate.ps1 `
    -AllowProduction -DatabaseUrl "<production connection string>"
```

`-DatabaseUrl` is how production is reached: `.env` points at dev and is not
edited. Setting `$env:DATABASE_URL` works too — the environment now beats `.env`
— but the flag is one line and leaves nothing behind in the shell. The runner
prints the target host **and where the URL came from** before doing anything;
read that line. If it names the dev host, stop, because nothing you are about to
do is the release you think it is.

Neon's SQL editor against the production branch is the other supported route and
is often easier for one migration — see `database/README.md`, which lists the two
things to flatten first. If you use it, make sure the migration carries its own
`INSERT INTO _migrations`, or the ledger row is never written.

This is safe *because* `schema_drift.py` treats a column the database has and
the build does not map as **not** drift — the running release ignores it. Verify
production is still healthy before going further (Step 3), then commit and push
via the **git-commit-push** skill.

Deploying first instead is *usually safe but unsuccessful*: the new code maps a
column that does not exist, readiness returns 503, and Render declines to promote
it. Nothing breaks — the old version keeps serving — but you are stuck until you
migrate anyway.

**That protection only covers `ADD COLUMN`.** Deploy a `CREATE TABLE` migration's
code first and readiness stays green over a table `create_all` improvised from
the models, missing its defaults, indexes and constraints (Step 1). Migrate-first
is therefore not merely preferable, it is the only ordering with a safety net at
all — and for `CREATE TABLE` even that net is absent, so check the ledger
afterwards rather than trusting the probe.

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

**`schema: ok` does not prove the migration ran.** Drift compares mapped
**columns** only, and deliberately ignores an absent table because `create_all`
creates one moments later. So it catches a missing `ADD COLUMN` and is blind to a
missing `CREATE TABLE`: every column is present, readiness is green, and the
table is missing its defaults, indexes and constraints. After releasing a
`CREATE TABLE` migration, confirm it landed by checking the ledger
(`SELECT name FROM _migrations ORDER BY name DESC LIMIT 5`) or the index list —
not by reading `schema: ok`.

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

- **`git push` deploys, once CI is green.** There is no separate release button
  and no staging environment. A push with an unrelated WIP commit ships that too.
- **Reach production with `-DatabaseUrl`, never by editing `.env`.** The local
  `.env` points at dev and has no production credentials, which is deliberate.
  Do not "temporarily" repoint it — that is the exact configuration the branch
  split exists to prevent, and it is how migration 133 took the site down.
- **Read the two lines the runner prints.** It reports the target host *and*
  whether the URL came from `-DatabaseUrl`, the environment or `.env`. That
  second line exists because `.env` used to overwrite the environment
  unconditionally, so `-AllowProduction` silently migrated dev while reporting
  nothing wrong.
- **The guard needs no configuration.** Both runners match known production
  hosts by SHA-256 from `database/production-hosts.sha256`, so a Codespace, a
  fresh clone and CI are protected equally, and `migrate.sh` is no longer the
  unguarded back door it was. `PRODUCTION_DATABASE_HOST` adds a host; it cannot
  remove one. If a runner ever reaches production unasked, the hash list is out
  of date — add the new host's hash rather than relying on an env var.
- **Migrations are append-only and idempotent here.** Re-running is the check:
  every migration must report `applying:` or `skipped:`, ending in `Migrations
  complete.`
- **`create_all` runs on every backend boot** and will create a missing *table*
  from the models — so a migration that adds a table may report as already
  applied, and readiness stays green whether or not it ran. It never adds a
  missing *column*, which is the gap the drift probe covers. This is why every
  migration states its defaults, indexes and CHECKs as separate statements
  rather than inside the `CREATE TABLE`.
- **A migration must record itself.** Production schema is often applied by hand
  in Neon's SQL editor, which writes no ledger row, so each migration ends with
  `INSERT INTO _migrations (name) VALUES ('NNN_name.sql') ON CONFLICT DO
  NOTHING`. Migrations 123–133 predate this rule;
  `database/maintenance/reconcile_migrations.sql` backfills their rows, gated on
  schema evidence. Without it the next `-AllowProduction` run replays them and
  every line reads `applying:` instead of `skipped:`.
- **Never `-AllowProduction` without being asked for this specific release.**
  It is the one irreversible step in the procedure.
