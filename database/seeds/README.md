# Seed Templates

Templates for bulk-loading sample or starter data into the Neon database.

There is no local `db` service in `docker-compose.yml`, so apply seeds through `psql` against `DATABASE_URL`.

Example:

```bash
PSQL_URL="${DATABASE_URL/postgresql+asyncpg/postgresql}"
docker run --rm -v "$PWD/database/seeds:/seeds" postgres:16-alpine \
  psql "$PSQL_URL" -v ON_ERROR_STOP=1 -f /seeds/<file>.sql
```

Recommended order for an empty database:

1. `venues.sql`
2. `shows.sql`
3. `horses.sql`
4. `exhibitors.sql`
5. `classes.sql`

Each file uses `ON CONFLICT DO NOTHING` where a natural key exists, so re-running is intended to be safe for idempotent additions.

