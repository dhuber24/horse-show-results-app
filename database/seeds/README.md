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

## AQHA Standard Classes

AQHA class codes should be loaded from the official AQHA Class Code List, not typed from memory. If AQHA provides the list as a PDF, extract it to CSV first:

```powershell
python scripts/extract_aqha_standard_classes_from_pdf.py "<path-to-AQHA-Class-Master-Listing.pdf>" database/seeds/aqha_standard_classes.csv --source-year 2026
```

If AQHA provides an Excel/CSV export instead, use the CSV template as the expected shape:

```powershell
Copy-Item database/seeds/aqha_standard_classes.template.csv database/seeds/aqha_standard_classes.csv
```

Fill `aqha_standard_classes.csv` from the official AQHA list, then import it:

```powershell
python scripts/import_aqha_standard_classes.py database/seeds/aqha_standard_classes.csv --replace --source-year 2026
```

Use `--dry-run` first to validate the file without writing:

```powershell
python scripts/import_aqha_standard_classes.py database/seeds/aqha_standard_classes.csv --dry-run --source-year 2026
```

Current checked-in AQHA seed:

- `database/seeds/aqha_standard_classes.csv`
- Source year: `2026`
- Extracted rows: `1589`
- Divisions: `Open`, `Amateur`, `Youth`, `Equestrians With Disabilities`
- Codes are stored as text so AQHA 7-digit codes are preserved exactly.

