# Database

PostgreSQL schema, migrations, and seed templates for GaitDesk.

The database is hosted on Neon. There is no local Postgres service in `docker-compose.yml`.

## Two Branches

Since the migration-133 outage there are **two Neon branches**, and local
development does not touch the one production serves from:

| Branch | Used by |
| --- | --- |
| production | Render (`gaitdesk-api`), i.e. gaitdesk.com |
| dev | local `.env`, `docker-compose`, every migration you run by default |

Point the local `.env` `DATABASE_URL` at the **dev** branch. Production's URL is
set only in Render. See [../docs/deployment.md](../docs/deployment.md), "Keep
development off the production database".

Use Neon's **direct** endpoint, not the `-pooler` one — the app already pools
through SQLAlchemy, so PgBouncer adds a second pool and transaction-mode
restrictions for a problem this app does not have.

## Source Of Truth

- Current database guide: [../docs/database.md](../docs/database.md)
- SQL migrations: [migrations/](migrations/)
- Seed templates: [seeds/](seeds/)
- Full schema snapshot: [schema.sql](schema.sql)
- Production host guard list: [production-hosts.sha256](production-hosts.sha256)
- Ledger reconciliation: [maintenance/reconcile_migrations.sql](maintenance/reconcile_migrations.sql)

## Running Migrations

```powershell
powershell -ExecutionPolicy Bypass -File database/migrate.ps1
```

```bash
./database/migrate.sh
```

Both runners behave identically: they read `DATABASE_URL`, track applied
migrations in `_migrations`, skip anything already recorded, and stop on the
first failing statement.

**The target is chosen in this order, and printed before anything runs:**

1. `-DatabaseUrl <url>` / `--database-url <url>`
2. `DATABASE_URL` in the environment
3. `DATABASE_URL` in `.env`

`.env` never overwrites a variable the environment already has — a value in the
environment is a deliberate act by the caller, a `.env` file is a default. It
used to overwrite unconditionally, which silently redirected an intended
production release to dev.

**Both runners refuse a known production host** unless `-AllowProduction` /
`--allow-production` is passed. Production hosts are matched by SHA-256 from
`production-hosts.sha256`, so the guard travels with the repository and works in
a Codespace, a fresh clone or CI with no `.env` and no configuration. An empty or
unreadable hash file is a hard failure, never an unguarded run.

**Migrating production is a release step, and the order relative to the deploy
is decided by the migration, not by preference.** Read
[.claude/skills/release/](../.claude/skills/release/) before releasing schema.

Direct SQL fallback:

```bash
PSQL_URL="${DATABASE_URL/postgresql+asyncpg/postgresql}"
docker run --rm postgres:16-alpine psql "$PSQL_URL" -v ON_ERROR_STOP=1 -c "<SQL statement>"
```

## Every Migration Records Itself

**End each migration with its own ledger row:**

```sql
INSERT INTO _migrations (name) VALUES ('138_my_migration.sql')
ON CONFLICT DO NOTHING;
```

The runner also records a migration it applied, so this looks redundant. It is
not: **production's schema is frequently applied by hand through Neon's SQL
editor**, which runs the SQL and records nothing. A migration that does not
record itself therefore lands on production with no ledger row, and the next
`migrate.ps1 -AllowProduction` re-executes it. Our migrations are written
idempotently so a replay is usually harmless — but it destroys the one signal
the release procedure tells you to read, because an already-applied migration
then reports `applying:` instead of `skipped:`.

108 of the 140 existing migrations do this. Migrations **123–133 do not**, which
is exactly the gap
[maintenance/reconcile_migrations.sql](maintenance/reconcile_migrations.sql)
closes: it inserts each missing ledger row, gated on `information_schema`
evidence that the migration's effect is actually present. Run Part A first and
read it before running Part B.

Never insert a ledger row for a migration whose effect you have not verified. A
missing row causes a harmless replay; a false row causes the migration to be
skipped forever.

## Hand-Applying A Migration In Neon's SQL Editor

Two things must be flattened first or the console rejects them:

- **Drop the `BEGIN;` / `COMMIT;` wrapper** — the web console manages its own
  transaction.
- **Make every `COMMENT ON` a single string literal.** Postgres concatenates
  adjacent literals only across a newline, and the editor normalises whitespace,
  which collapses `'…' '…'` onto one line into a syntax error. Doubled quotes
  (`show''s`) are the other thing to remove.

Test the flattened version against **dev** first, where the objects already
exist — that checks syntax and idempotency at once.

## Notes

- Do not rename already-applied migration files.
- Keep new migrations append-only.
- Write every statement idempotently (`IF NOT EXISTS`, guarded `DO` blocks,
  `DROP CONSTRAINT IF EXISTS`, `ON CONFLICT DO NOTHING`). Backend startup runs
  `create_all`, which may create a *table* from the models before its migration
  lands — so state server defaults, indexes and CHECKs as their own statements
  rather than relying on a `CREATE TABLE` that will be skipped.
- There are historical duplicate `024_*` migration numbers. Preserve the existing files and ordering behavior.
- `cert_org_users` is certification lookup data and includes a capitalized `Org` column.
