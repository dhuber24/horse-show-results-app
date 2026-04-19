# Seed templates

Templates for bulk-loading data. Fill in rows, then apply with:

```bash
docker compose exec -T db psql -U postgres -d horseshow < database/seeds/<file>.sql
```

Order matters — run in this sequence if starting from an empty DB:

1. `venues.sql` (optional — shows can reference venues)
2. `shows.sql` (requires `show_types` rows, which are seeded by the schema/migration)
3. `horses.sql`
4. `exhibitors.sql`
5. `classes.sql` (requires shows)

Each file uses `ON CONFLICT DO NOTHING` where a natural key exists, so re-running
is safe for idempotent additions.
