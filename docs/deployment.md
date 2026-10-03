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
4. To pull a show created on production down to dev, run

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/copy-prod-to-dev.ps1
   ```

   which runs [`scripts/copy_prod_to_dev.sql`](../scripts/copy_prod_to_dev.sql)
   **against dev**, asking for the production connection string without
   echoing it. To stop being asked, set `PROD_DATABASE_URL_OP_REF` in `.env` to
   a 1Password secret reference (`op://Vault/Item/field`) and the wrapper
   resolves it with the 1Password CLI at run time — a reference is not a
   secret, so nothing sensitive lands on disk. `PROD_DATABASE_URL` holding the
   string itself also works. Whichever is used, it is **never** `DATABASE_URL`:
   that is the dev branch, and pointing it at production is the migration-133
   outage. That file's header has the psql command for any other shell, and
   says how to read the report. It reads production through a
   `postgres_fdw` link that lives only inside its own transaction, and inserts
   every row dev lacks by primary key — additive, so dev's test data and edits
   survive. It refuses to run on the production endpoint, matched by the SHA-256
   of `neon.endpoint_id`. To make dev an exact copy instead, use **Reset from
   parent** on the dev branch, then re-run `migrate.ps1` and the MNSPHC seed.

Migrating production then becomes a deliberate release step, and **the order is
decided by the migration, not by preference.**

## Releasing

`scripts/release.ps1` runs the whole sequence in the right order. It releases
what is **committed**, so commit first and let it do the push:

```powershell
# what would this release do? touches nothing
powershell -ExecutionPolicy Bypass -File scripts/release.ps1

# any release, once the three settings below are in .env
powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Run

# release carrying a migration, with nothing configured
$env:PRODUCTION_DATABASE_URL = "<production connection string>"
powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Run -BackedUp
```

A release carrying a migration needs production's URL and a backup, and the
script can get both itself. Put three lines in `.env` — none of them is a
secret:

```
PROD_DATABASE_URL_OP_REF=op://Private/GaitDesk Neon Production/connection string
NEON_API_KEY_OP_REF=op://Private/<item>/credential
NEON_PROJECT_ID=<project id, from the Neon project's Settings>
```

It resolves the two references with the 1Password CLI **only when the release
carries a migration**, both at the start of the run, so the one Windows Hello
prompt comes before anything happens rather than halfway through. It finds
`op.exe` where winget installs it even when the CLI is not on PATH, which it is
not in an editor that was already open when it was installed. `.env` is never
loaded wholesale: only those keys are read, so its `DATABASE_URL` (dev) cannot
be picked up as production, and whatever the reference resolves to still has to
pass the production host guard.

`$env:PRODUCTION_DATABASE_URL` / `$env:NEON_API_KEY` hold the values directly
and win over `.env`. `-DatabaseUrl "<url>"` is accepted too, but a connection
string passed as a command-line argument lands in PSReadLine's on-disk history
in clear text.

The script **refuses a target that is not a known production host** (SHA-256,
same list as `migrate.ps1`) — the inverse of that runner's guard. Without it,
handing the script a dev URL would pass every check downstream and still push,
leaving production with code for a schema it never received.

With `-Run` it refuses a dirty tree or a stale `main`, lists the commits and the
migrations they carry, scans each migration and refuses anything
backward-incompatible, runs `RUN_TESTS.sh`, migrates dev, **branches production
in Neon as a backup**, migrates production, confirms every migration reached
production's `_migrations` ledger, **checks
production is still serving before pushing**, pushes, and samples for five
minutes.

That pre-push check is the migration-133 detector: production is running the old
code against the new schema at exactly that moment, which is the state that broke
the site. On breakage it stops without pushing.

Two things it deliberately does not do. It does not decide whether a migration
is safe — it scans and refuses on suspicion, which is a guard rather than a
judgment, so read the SQL. And it does not read the production URL from `.env`,
only a 1Password reference to it.

### GITHUB_TOKEN

Optional, and only about rate limits. The release script polls GitHub's
check-runs API to confirm CI went green, which is plain REST against a **public**
repo and needs no authentication — a token simply lifts the anonymous ceiling
from 60 requests an hour to 5,000.

Because it is a rate-limit key rather than a credential, create it with **no
scopes at all** (classic token with nothing ticked, or a fine-grained token with
no repository access). It can then read nothing that an anonymous request could
not, which is what makes it safe to leave in a user environment variable:

```powershell
setx GITHUB_TOKEN "<token>"   # then open a NEW shell -- setx does not affect the current one
```

Do not reach for a token as the fix for every unreadable checks API. The poll
retries transient failures on its own now, and the run that prompted this advice
had 59 of its 60 anonymous requests still unspent — the cause was a blip, not the
ceiling. Check `https://api.github.com/rate_limit` before assuming.

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

A Neon **branch** is the backup, and `release.ps1` makes it: through Neon's
API (`POST /projects/{id}/branches`), immediately before production is migrated,
named for the release (`pre-139-d994370` — first migration number, then the
commit) and set to **expire after 14 days** (`-BackupDays`). If it goes wrong,
the branch still holds the pre-release state and can be inspected or restored
from.

Some details that are deliberate:

- **The parent is asked of Neon, not configured.** The script takes the compute
  endpoint id from the production connection host and asks Neon which branch
  owns it, so the backup is always cut from the database about to be migrated,
  and there is no branch id in a config file to go stale.
- **No compute.** A backup needs none until the day somebody restores from it;
  one would bill for every idle hour.
- **A re-run keeps the branch.** The name is the same for every run of one
  release, and a branch an earlier run left behind was cut before this release
  migrated anything — the better backup of the two.
- **The lookup happens before the tests, the branch after them.** A bad key or
  project id fails in seconds; the branch itself is as close to the pre-release
  state as it can be. If Neon refuses the branch, production is not migrated.
- **The expiry replaces deleting them by hand**, which never happened: a drawer
  full of old backups makes the branch list useless and counts against the plan's
  branch limit. Neon's point-in-time restore covers the same ground within the
  history-retention window; the named branch says *why* it exists.

The API key needs to be able to create branches in the GaitDesk project; a key
scoped to that one project is the narrowest that works, where the plan offers
one. With no key configured, branch production by hand — **Branches > New
branch**, from `production` — and pass `-BackedUp`.

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
- **`INTERNAL_API_KEY` is one value on both services, but only the Blueprint
  keeps it that way.** It is generated on `gaitdesk-api` and the web service
  reads it through `fromService`, which Render copies across **on a Blueprint
  sync, not when the value changes**. Change it on the API in the dashboard and
  the web service goes on sending the old key, so every data read fails until
  the next sync. Change it on both by hand — see
  [Rotating a secret](#rotating-a-secret). `AUTH_SECRET` is deliberately a
  different value; regenerating it invalidates every session.
- **SMTP is optional and silent.** `mailer.py` returns `None` when `SMTP_HOST`
  is unset and never raises, and every flow that mails a link also returns the
  link. The variables it reads are `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS`.
- **`GA_MEASUREMENT_ID` turns Google Analytics on, and only on the web
  service.** Unset — every environment but production — loads no tag at all.
  It is read by the root layout on the server at request time, not baked into
  the bundle, so it is not a `NEXT_PUBLIC_*` variable and changing it takes a
  restart, not a rebuild. A value that is not a GA4 ID (`G-` then letters and
  digits) is ignored rather than rendered into the page. See
  [Google Analytics](#google-analytics) below.

## Rotating a secret

The web service holds two secrets, and they are the ones to rotate if it was
ever exposed: `INTERNAL_API_KEY` and `AUTH_SECRET`. First done on 3 Oct 2026,
after production had run the Next.js release React2Shell could take over (see
`IMPROVEMENTS.md`, October 2026).

- **`INTERNAL_API_KEY` first, because it is ADMIN on the API.** `dependencies.py`
  takes the role from the `X-User-Role` header once the key matches, and
  `api.gaitdesk.com` is public, so whoever holds the key needs no login.
  `AUTH_SECRET` forges a session on the web service; rotating it signs everybody
  out once.
- **Rotate only once the hole is closed.** A secret rotated while the leak is
  still open leaks again.
- **Not on a show day.** The two services restart a few seconds apart, so data
  reads fail for about a minute, and scribes and the desk are signed out by the
  new `AUTH_SECRET`.

The steps:

1. **Make a value per secret.** In PowerShell (`openssl rand -hex 32` in Git
   Bash):
   ```powershell
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
   ```
   Keep a copy of the current `INTERNAL_API_KEY` for step 4.
2. **Edit both services before saving either.** `gaitdesk-api` →
   Environment → `INTERNAL_API_KEY`. `gaitdesk-web` → Environment → the **same**
   `INTERNAL_API_KEY`, and the new `AUTH_SECRET`. Two keys that differ by a
   trailing space is the one way this goes wrong. If the web service will not
   let you edit the linked value, save the API's and run the Blueprint's
   **Manual Sync** to copy it across.
3. **Save and deploy on the API, then straight away on the web service.** Not
   *Save, rebuild, and deploy*: the existing build is restarted with the new
   values, so both are back in a minute or two rather than after a Docker build.
   *Save only* changes nothing until the next deploy.
4. **Prove the old key is dead.** This prompts for the key without echoing it or
   writing it to history; the old key must get `401`, the new one `200`:
   ```powershell
   $s = Read-Host 'Key' -AsSecureString
   $k = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
   try { (Invoke-WebRequest -UseBasicParsing -Uri 'https://api.gaitdesk.com/judging-systems/symbol-system' -Headers @{ 'X-API-Key' = $k }).StatusCode } catch { [int]$_.Exception.Response.StatusCode }
   Remove-Variable s, k
   ```
   Then prove the two services agree: a public class page with entries lists
   horse names, and `fetchHorse` sends the key, so a mismatch is an error page
   rather than a page without names. Health and `/shows/` stay green either
   way — they never send the key.
5. **Look for anything the old key made.** An account created through the API
   with it keeps working after the rotation: check Admin → Users for names and
   ADMIN or Show Manager roles nobody on the team gave out. Then update any
   saved copy (1Password) and destroy the old one.

Nothing in `render.yaml` changes. `generateValue` only fills in a value that is
missing, so a later sync does not overwrite a rotated one, and the sync's
`fromService` copy is by then the same new key.

## Google Analytics

Web traffic is measured with a GA4 property through the standard gtag.js tag
(`frontend/app/components/GoogleAnalytics.tsx`).

1. In [analytics.google.com](https://analytics.google.com), create a property
   and a **Web** data stream for the production domain. Leave **Enhanced
   measurement** on: its *Page changes based on browser history events* option
   is what counts App Router navigations as page views, and the app sends no
   page_view of its own, so turning it off leaves only full page loads counted.
2. Copy the stream's **Measurement ID** (`G-…`) into `GA_MEASUREMENT_ID` on
   `gaitdesk-web` in Render and restart the service.
3. Register the role dimension: **Admin → Custom definitions → Create custom
   dimension**, scope **User**, user property `user_role`, named *User role*.
   GA reports a custom dimension only from the day it is registered, so do it
   with step 2.
4. Open the site and check **Reports → Realtime** in GA for the visit.

**Every visit carries the signed-in role** as the `user_role` user property:
the account's `users.role` (`ADMIN`, `SHOW_SECRETARY`, `EXHIBITOR`, …),
`VISITOR` when signed out, `OTHER` for a role the frontend does not know
(`gaUserRole` in `frontend/lib/analytics.ts`, whose list follows `VALID_ROLES`
in `backend/routers/people.py`). Add *User role* as a comparison or secondary
dimension to tell spectators and exhibitors from the show office. It is the
role only; a name, email or id must never be sent, which Google's terms forbid.
The role is the account's, not every hat it wears: a secretary who also enters
classes is `SHOW_SECRETARY`. Signing in changes it without a page load, so the
page view of that first navigation still says `VISITOR`.

Two routes never load the tag, because their URL carries a token GA would store
in full: `/invite/[token]` and `/horse-requests/[token]`
(`UNTRACKED_PREFIXES` in `frontend/lib/analytics.ts`). **Neither does a page
whose query string names one of them** (`isTrackedPage`): "Sign in" on a horse
request goes to `/login?next=%2Fhorse-requests%2F<token>`, and the sign-in and
register pages pass `next` on to each other. A new page that puts a secret in
its path or query string belongs on that list. Staff screens are tracked like
any other page; their URLs carry only record ids.

**One path still reaches GA:** once the tag has loaded in a tab, its history
listener reports every client-side navigation, so pressing Back from a tracked
page to a token page visited earlier in the same tab sends that URL. The token
has usually been used by then (an accepted invite, an answered request), and a
horse request still needs its owner signed in. Closing it means turning the
history option off and sending page views from the app with the URL scrubbed.

## Operations

- Use an always-on paid Render plan for both services. Free spins down after
  fifteen minutes and wakes in about a minute, which the two-hop
  browser → web → API architecture turns into a timeout rather than a slow page;
  free also blocks the SMTP ports the mailer is configured for. What the paid
  plans cost as traffic grows, and where the current ones run out, is
  [`scaling.md`](scaling.md).
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
