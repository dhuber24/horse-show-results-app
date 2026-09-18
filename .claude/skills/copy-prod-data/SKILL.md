---
name: copy-prod-data
description: Copy production data down into the dev branch so a show created on gaitdesk.com can be opened and tested locally. Use when asked to pull a production show down, get prod data locally, refresh dev from production, or when a bug only reproduces on a real show that dev does not have.
---

Production and dev are separate Neon branches, so plain SQL on one cannot read
the other and a show created on gaitdesk.com does not exist locally. The copy
is `scripts/copy_prod_to_dev.sql`, driven on Windows by
`scripts/copy-prod-to-dev.ps1`. Both are committed; this skill is about running
them, and about the one thing that stops Claude running them unaided.

It reads production through a `postgres_fdw` link that is created and dropped
inside its own transaction, and inserts every row dev lacks **by primary key**.
Additive only: dev's test data survives, and a row both branches have keeps
dev's version. One transaction, so a failure writes nothing.

## The credential is the whole problem

The wrapper's prompt is masked (`Read-Host -AsSecureString`), and tool calls
here run non-interactively with stdin on the null device — **Claude cannot
answer that prompt.** So there are exactly two ways this gets run, and which
one applies is the first thing to establish.

**Never ask the user to paste the production connection string into chat.** It
would land in the transcript, and it is the credential to the live database.
Reading it out of an environment the user already set up is fine; asking for it
is not.

### Path A — 1Password, if the CLI is there

Preferred, because it is the only path that keeps the credential off disk.

```powershell
if (Get-Command op -ErrorAction SilentlyContinue) { "op present" } else { "no op CLI" }
```

```bash
grep -q '^PROD_DATABASE_URL_OP_REF=' .env && echo "ref in .env" || echo "no ref"
```

With both, run it — the wrapper resolves the reference itself:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/copy-prod-to-dev.ps1
```

**Warn the user before starting it.** The first `op read` of a session pops a
desktop unlock dialog (Windows Hello). Nothing here can dismiss it, so the run
blocks until they approve it at the machine — say so first rather than leaving
a command apparently hanging. Later runs reuse the unlocked session.

A `op://...` reference is not a secret and is fine in `.env`, or passed as
`-OpRef "op://Vault/Item/field"`.

### Path B — `PROD_DATABASE_URL` is already set

```powershell
if ($env:PROD_DATABASE_URL) { "set" } else { "not set" }
```

```bash
grep -q '^PROD_DATABASE_URL=' .env && echo "in .env" || echo "not in .env"
```

The wrapper loads `.env` the way `migrate.ps1` does, so either place works. If
it is set, run it — no prompt appears:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/copy-prod-to-dev.ps1
```

### Path C — neither is set

Hand the user the command and let them paste at the masked prompt themselves:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/copy-prod-to-dev.ps1
```

The string is Neon console → project `restless-surf-41401656` → Branches →
**production** → Connect. Direct or `-pooler`, either works.

If they would rather not be prompted every time, there are two ways to stop
being asked, and they are not equally good:

- **`PROD_DATABASE_URL_OP_REF=op://Vault/Item/field` in `.env`** plus the
  1Password CLI. A reference is not a secret, so nothing sensitive lands on
  disk. Prefer this.
- **`PROD_DATABASE_URL=postgresql://...` in `.env`**, which is gitignored but
  does put a production credential on disk. It does not reach the running app
  — `docker-compose.yml` lists its variables explicitly and does not pass this
  one through — and only these two scripts read it.

Either way it must never be put in `DATABASE_URL`, which is the mistake that
caused the migration-133 outage.

## Reading the result

The run ends with a table of each table that received rows, plus `left_behind`
and any `note`. Report the total and anything notable rather than the whole
table.

- **`left_behind` on `exhibitor_competition_cards` is expected.** Migration 134
  backfilled those rows with random ids on each branch separately, so the same
  card has two ids. Harmless.
- **Other `left_behind`** means dev already holds that thing under a different
  id (a unique key other than the primary key matched), or its parent row was
  left behind. Worth naming, not usually worth fixing.
- **A `note` starting `error:`** is a table that failed and was skipped.

Then confirm the show is actually there before saying it worked:

```bash
DEV=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/+asyncpg//')
MSYS_NO_PATHCONV=1 docker run --rm postgres:17-alpine psql "$DEV" -X -c \
  "SELECT name, status, start_date FROM shows ORDER BY created_at DESC LIMIT 5"
```

If the user then cannot see it in the running app, the usual cause is the
service worker serving stale UI — hard refresh before investigating anything
else.

## Guards, and what to do when one fires

Both ends refuse, because the direction that would hurt is copying dev's test
data **up** into production.

- *"Refusing to copy: … is a known production database"* — the target is
  production. `DATABASE_URL` is pointing somewhere it should not; do not work
  around this, fix the `.env`.
- *"PROD_DATABASE_URL points at this same endpoint"* — source and target are
  one database. Both guards normalise a `-pooler` host, so this is a real
  match, not a naming difference.
- *"that is not a known production host. Continuing."* — a note, not a refusal.
  Legitimate when copying from a Neon backup branch.
- Docker not running: the wrapper runs psql in a container, like `migrate.ps1`.

## When this is the wrong tool

To make dev an **exact** copy of production rather than a merge, use **Reset
from parent** on the dev branch in the Neon console, then re-run
`database/migrate.ps1` and `scripts/seed_mnsphc_paint_o_rama.py`. That discards
dev-only data, which is the difference: this script never does.

Re-running the copy is safe and cheap — it only adds what is missing, so a
second run copies nothing.
