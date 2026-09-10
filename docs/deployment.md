# Production deployment

GaitDesk runs as two public web services and a Neon PostgreSQL database:

- `gaitdesk-web`: Next.js application at the main website domain.
- `gaitdesk-api`: FastAPI API at an `api` subdomain.
- Neon: managed PostgreSQL; it is not created by `render.yaml`.

The root [render.yaml](../render.yaml) deploys the two Render services from this
repository. It deliberately contains names and non-secret defaults only.

## First deployment

1. Rotate the production Neon password, internal API key, and Auth.js secret.
   Do not reuse values from a local `.env` file.
2. Back up or branch the Neon database, then run every unapplied SQL migration:

   ```powershell
   powershell -ExecutionPolicy Bypass -File database/migrate.ps1
   ```

3. In Render, choose **New > Blueprint**, connect this GitHub repository, and
   use `render.yaml`.
4. Fill the prompted variables. On the first deploy, use Render's generated
   service URLs:

   | Variable | Initial value |
   | --- | --- |
   | `API_URL` | `https://gaitdesk-api.onrender.com` |
   | `CORS_ORIGINS` | `https://gaitdesk-web.onrender.com` |
   | `AUTH_URL`, `PUBLIC_APP_URL` | `https://gaitdesk-web.onrender.com` |

   `AUTH_URL` is not optional: Auth.js v5 infers `trustHost` from its presence,
   so leaving it unset breaks every sign-in.

   Use the actual URLs displayed by Render if it assigns a different hostname.
   Set `DATABASE_URL` to Neon’s connection string. The backend accepts both
   Neon’s standard `postgresql://...` URL (including its `sslmode` and
   `channel_binding` options) and an async `postgresql+asyncpg://...` URL.

5. Confirm `https://<api-host>/health/ready` returns a success response, then
   open the web service and test sign-in, registration, an authenticated write,
   and a document upload.

   If sign-in returns Auth.js's generic `CredentialsSignin` message, check the
   `gaitdesk-web` service logs. They safely record either the API response
   status or the URL/connectivity error, without recording the submitted email
   address or password.

## Custom domain

Add these custom domains from each Render service's **Settings > Custom Domains**
page, then copy the requested DNS records into the domain registrar:

- Main web service: apex domain and `www`.
- API service: `api` subdomain.

When DNS has verified, update the variables and redeploy both services:

| Variable | Production value |
| --- | --- |
| `API_URL` | `https://api.yourdomain.com` |
| `CORS_ORIGINS` | `https://yourdomain.com,https://www.yourdomain.com` |
| `AUTH_URL`, `PUBLIC_APP_URL` | `https://yourdomain.com` |

Choose one of the apex or `www` names as canonical and redirect the other to it.
Render provides TLS certificates after verification.

## Keep development off the production database

`render.yaml` does not create the database, so nothing stops `DATABASE_URL` in a
local `.env` from naming the same Neon branch the API serves from. That is how
the migration-133 outage happened: the rename of
`show_sanctioning.per_class_fee_cents` was applied from a developer machine
while the deployed release still mapped the old name. Every class load returned
500 — `Class.sanctioning` is `lazy="selectin"`, so this is *every* class load —
and `/health/ready` reported `{"status":"ok"}` throughout, because `SELECT 1`
touches no mapped column.

Use a Neon branch per environment:

1. In the Neon console, branch the production database (**Branches > New
   branch**) and name it `dev`. A branch is copy-on-write, so it costs little
   and starts with production's schema and data.
2. Point the local `.env` `DATABASE_URL` at the `dev` branch's connection
   string. Production keeps the parent branch, set only in Render.
3. Nothing to configure: **both** `database/migrate.ps1` and
   `database/migrate.sh` print their target before doing anything and refuse a
   production host without `-AllowProduction` / `--allow-production`. They match
   known production hosts by **SHA-256** from
   [`database/production-hosts.sha256`](../database/production-hosts.sha256),
   shared between the two so they cannot disagree and so adding a host is one
   edit. The guard travels with the repository — a Codespace, a fresh clone or CI
   is protected without a `.env`. The hostname itself is not committed because
   this repository is public. `PRODUCTION_DATABASE_HOST` still works for an
   *additional* production database and is added to that list, never replacing
   it, so a misconfigured value cannot switch the guard off. An empty or missing
   hash file is a hard failure rather than an unguarded run.

   `migrate.sh` had none of this until recently — no guard at all, which mattered
   because it is the natural runner in a Codespace or WSL, exactly the
   environments the hash guard was introduced to protect. It also lacked
   `ON_ERROR_STOP`, so a migration whose statements failed still got an
   `_migrations` row claiming it had been applied.

Migrating production then becomes a deliberate release step, and **the order is
decided by the migration, not by preference.**

## Releasing

`scripts/release.ps1` runs the whole sequence in the right order. It releases
what is **committed**, so commit first and let it do the push:

```powershell
# what would this release do? touches nothing
powershell -ExecutionPolicy Bypass -File scripts/release.ps1

# code-only release
powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Run

# release carrying a migration
$env:PRODUCTION_DATABASE_URL = "<production connection string>"
powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Run -BackedUp
```

`-DatabaseUrl "<url>"` is accepted too, but the environment variable is
preferable: a connection string passed as a command-line argument lands in
PSReadLine's on-disk history in clear text. Neither is read from `.env`.

The script **refuses a target that is not a known production host** (SHA-256,
same list as `migrate.ps1`) — the inverse of that runner's guard. Without it,
handing the script a dev URL would pass every check downstream and still push,
leaving production with code for a schema it never received.

With `-Run` it refuses a dirty tree or a stale `main`, lists the commits and the
migrations they carry, scans each migration and refuses anything
backward-incompatible, runs `RUN_TESTS.sh`, migrates dev, migrates production,
confirms every migration reached production's `_migrations` ledger, **checks
production is still serving before pushing**, pushes, and samples for five
minutes.

That pre-push check is the migration-133 detector: production is running the old
code against the new schema at exactly that moment, which is the state that broke
the site. On breakage it stops without pushing.

Four things it deliberately does not do. It does not decide whether a migration
is safe — it scans and refuses on suspicion, which is a guard rather than a
judgment, so read the SQL. It does not read the production URL from `.env`. It
cannot make the Neon backup branch, so `-BackedUp` is your word that you did. And
it cannot tell whether CI passed or whether the new build is live — see "What no
amount of this tells you" in `.claude/skills/release/SKILL.md`.

To classify a migration without releasing anything:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/release.ps1 `
    -Classify database/migrations/138_my_migration.sql
```

The `release` skill (`.claude/skills/release/`) holds the reasoning; the short
version:

A **backward-compatible** migration — a new table, a nullable or defaulted
column, an index — goes to production *before* the code:

```powershell
# dev first, always
powershell -ExecutionPolicy Bypass -File database/migrate.ps1

# then production, ahead of the code that needs it
powershell -ExecutionPolicy Bypass -File database/migrate.ps1 `
    -AllowProduction -DatabaseUrl "<production connection string>"

# then push; CI must go green before Render deploys
```

`-DatabaseUrl` is how production is reached. **Do not edit `.env` to point at
production** — that is the configuration this split exists to prevent. Setting
`$env:DATABASE_URL` also works, because the environment now takes precedence
over `.env`; it did not always, and that is worth knowing about, because
`-AllowProduction` used to be silently ignored. `.env` was loaded *over* the
environment, so the target reverted to dev, the host never matched a production
hash, the guard never fired, and the run reported success having migrated the
wrong database. Both runners now print the target host **and** where the URL came
from. Read that line before letting it proceed.

That is safe because `schema_drift` treats a column the database has and the
build does not map as **not** drift: the running release simply ignores it.
Deploying first instead is safe but unsuccessful — the new code maps a column
that does not exist, readiness 503s, and Render declines to promote it. Nothing
breaks, but nothing ships either until the migration runs.

A **backward-incompatible** migration — `RENAME`, `DROP`, `SET NOT NULL`, a
narrowed type — has **no working order at all**, and migration 133 was one.
Migrating first breaks the running release; deploying first never promotes. Split
it into releases that are each backward-compatible (expand / contract): add the
new column and write both, backfill and switch reads, then stop referencing the
old column and drop it. Only that last step deploys before it migrates, because
by then nothing maps the column being dropped.

A single-step rename means a deliberate outage window. That is a decision to take
knowingly and at a quiet time, not a routine release.

## Backing up before a release

A Neon **branch** is the backup, and it is instant and free:

1. Neon console → **Branches > New branch**, from `production`.
2. Name it for the release, e.g. `pre-138`.
3. Release. If it goes wrong, the branch still holds the pre-release state and
   can be inspected or restored from.

Delete these when a release has settled — they are cheap, not free, and a drawer
full of them makes the branch list useless. Neon's point-in-time restore covers
the same ground within the history-retention window; the named branch is
preferable because it says *why* it exists.

Never set auto-delete or branch expiry on the **dev** branch. It is the branch
every release must migrate first, so one that can vanish makes the procedure fail
at exactly the moment you reach for it. Auto-*suspend* is the cost lever and
destroys nothing.

## Rolling back

Code and schema roll back separately, and only one of them is easy.

**Code.** Render keeps previous deploys: service → **Deploys** → *Rollback* on
the last good one. Both services roll back independently, so roll back both
unless you are certain the change was confined to one.

**Schema.** There are no down-migrations, deliberately — a down-migration is
written when the change is fresh and run when it is not, and it is the least
tested SQL in any repository. Recovery is a forward migration that undoes the
change, released like any other. Migration 131 undoing migration 130 is the
worked example.

This is why the ordering rule matters more than the rollback plan: **rolling code
back onto a schema that has moved forward is the migration-133 failure in
reverse.** A rollback to a build that predates an `ADD COLUMN` is safe — the old
build simply ignores the new column. A rollback across a `RENAME` or a `DROP` is
not, and the answer there is to roll *forward*, not back.

Before rolling back, check what the running build expects:

```bash
curl -s https://api.gaitdesk.com/health/ready
```

`schema: drifted` after a rollback means you have gone back past a migration and
the old build is missing columns — go forward again.

## What readiness actually checks

`/health/ready` answers two questions, and the second exists because the first
was green for the whole of the outage above:

- **Can this process reach the database?** `SELECT 1`, bounded at
  `READINESS_TIMEOUT_SECONDS`.
- **Does the database still have every column this build maps?**
  `backend/schema_drift.py` diffs `Base.metadata` against
  `information_schema.columns`, at most once a minute. Drift returns 503 with
  the offending columns named in `missing_columns`.

Drift is worth a 503 because there is no harmless case: SQLAlchemy selects every
mapped column, so a column the database lacks breaks every read of that table,
and no amount of restarting repairs it. `Base.metadata.create_all` at startup
creates a missing *table* but never adds a missing *column* — which is exactly
the gap a rename leaves.

**Know what this does not cover.** It compares mapped *columns*, so it catches a
deploy that arrives ahead of an `ADD COLUMN` migration and is blind to one that
arrives ahead of a `CREATE TABLE` migration: `create_all` builds that table from
the models at boot, every mapped column is then present, and readiness reports
`schema: ok` over a table with no server defaults, no unique indexes and no CHECK
constraints. It is also blind to a migration that only adds an index, a CHECK
value or a comment, and to any backfill. So `schema: ok` means "the columns this
build reads exist" — it is not a statement that the migration ran. For anything
other than `ADD COLUMN`, confirm the ledger instead:

```sql
SELECT name, applied_at FROM _migrations ORDER BY name DESC LIMIT 5;
```

A 503 here means Render will not promote the deploy. That is the intent: a
release that arrives before its migration should fail rather than replace a
working one.

## Which variables actually do something

Worth knowing before debugging a symptom against the wrong setting.

- **`API_URL` is the only API address the deployed app reads.** Every backend
  request is made server-side — from an `app/api/` route handler or a server
  component — so there is no `NEXT_PUBLIC_API_URL` in the Blueprint and no
  public copy in the bundle. `lib/api.ts` keeps it as a fallback purely for a
  standalone `npm run dev`.
- **`CORS_ORIGINS` is a guard, not a live setting.** It follows from the point
  above: no browser calls the API directly, so CORS is never exercised in normal
  operation. A failure here will not present as a CORS error, because there are
  no cross-origin browser requests to fail. Keep the value correct anyway.
- **`INTERNAL_API_KEY` is shared by both services** via `fromService`, so it
  cannot drift. `AUTH_SECRET` is deliberately a different value; regenerating it
  invalidates every session.
- **SMTP is optional and silent.** `mailer.py` returns `None` when `SMTP_HOST`
  is unset and never raises, and every flow that mails a link also returns the
  link. The variables it reads are `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS`.

## Operations

- Use an always-on paid Render plan for both services.
- Keep the services in the same region as practical; the Blueprint uses Ohio,
  near a US East Neon database.
- Run migrations as a deliberate pre-release step, after branching the database
  (see "Backing up before a release"). The app's startup schema creation does not
  replace the migration runner.
- Both services are on `autoDeployTrigger: checksPass`, so a push deploys only
  after `ci.yml` and `docs-guard.yml` pass. A check that never reports blocks the
  deploy rather than releasing without it; Render's dashboard can still deploy a
  commit manually if that is ever needed.
- Enable SMTP before relying on email notifications or email-based workflows.
