# Database

PostgreSQL schema, migrations, and seed templates for Horse Show Results.

The active database is hosted on Neon. There is no local Postgres service in `docker-compose.yml`.

## Source Of Truth

- Current database guide: [../docs/database.md](../docs/database.md)
- SQL migrations: [migrations/](migrations/)
- Seed templates: [seeds/](seeds/)
- Full schema snapshot: [schema.sql](schema.sql)

## Running Migrations

Preferred local command on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File database/migrate.ps1
```

The migration runner reads `DATABASE_URL`, tracks applied migrations in `_migrations`, and avoids running the same migration twice.

Direct SQL fallback:

```bash
PSQL_URL="${DATABASE_URL/postgresql+asyncpg/postgresql}"
docker run --rm postgres:16-alpine psql "$PSQL_URL" -v ON_ERROR_STOP=1 -c "<SQL statement>"
```

If you apply a migration manually, also record the filename in `_migrations`.

## Notes

- Do not rename already-applied migration files.
- Keep new migrations append-only.
- There are historical duplicate `024_*` migration numbers. Preserve the existing files and ordering behavior.
- `cert_org_users` is certification lookup data and includes a capitalized `Org` column.

