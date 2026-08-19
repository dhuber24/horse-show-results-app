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

## Demo People (trainers, exhibitors, horses)

`scripts/seed_demo_people.py` creates 5 trainers, 10 exhibitors, and 10 horses with full login accounts. It uses the app's own ORM models rather than raw SQL so the `User` + `Exhibitor` / `Trainer` pairing and the name-sync event listeners are honored. Each exhibitor owns one horse (`owner_exhibitor_id` + an `exhibitor_horses` link), and horses get a trainer assigned from a fixed RNG seed so runs are reproducible. One exhibitor — Sofia Delgado — keeps a **second** horse, from the `SECOND_HORSES` list: a `pattern` class is judged run by run, so one exhibitor may show two horses in it, and with every seeded exhibitor owning exactly one there was no way to walk that path.

Run it inside the backend container, which already has the dependencies and `DATABASE_URL`:

```powershell
docker cp scripts/seed_demo_people.py horse-show-results-app-backend-1:/tmp/seed_demo_people.py
docker exec -w /app -e PYTHONPATH=/app horse-show-results-app-backend-1 python /tmp/seed_demo_people.py
```

All seeded accounts share the password defined in `SEED_PASSWORD` (`12345678`), and every email is on the reserved `@example.com` domain. Changing `SEED_PASSWORD` only affects accounts created by a later run — it does not re-hash accounts already in the database. Re-running skips people by email and horses by (registered name, owner), so it is safe to repeat. It exits without writing if the expected `associations` / `breeds` / `horse_colors` lookup rows are missing.

## Demo Horse Documents (Coggins)

`scripts/seed_demo_horse_documents.py` gives every demo horse a current Coggins (EIA) document. This no longer gates anything — health paperwork became a flag rather than a block — but without it every seeded horse turns up on the show office's health flags, which buries any real shortfall you were trying to look at.

```powershell
docker cp scripts/seed_demo_horse_documents.py horse-show-results-app-backend-1:/tmp/seed_demo_horse_documents.py
docker exec -w /app -e PYTHONPATH=/app horse-show-results-app-backend-1 python /tmp/seed_demo_horse_documents.py
```

`horse_documents.file_data` is a NOT NULL BYTEA and the upload endpoint sniffs MIME from magic bytes, so the script writes a genuinely valid one-page PDF rather than a placeholder blob — the document opens in the viewer. Dates are relative to the run date (issued 90 days ago, valid 365 days). Horses are matched through their owner's `@example.com` address, so no non-demo horse is touched, and any horse that already has a COGGINS row is skipped.

## Scribe Accounts (score entry)

`scripts/seed_scribes.py` creates the `SCRIBE` login accounts and assigns them to every existing show. Migration 093 renamed `SCOREKEEPER` to `SCRIBE`, and no account held the old role, so without this there is nobody to walk the score-entry path with. `seed_test_shows.py` reuses staff accounts by email but never creates them — this is what creates them.

```powershell
docker cp scripts/seed_scribes.py horse-show-results-app-backend-1:/tmp/seed_scribes.py
docker exec -w /app -e PYTHONPATH=/app horse-show-results-app-backend-1 python /tmp/seed_scribes.py
```

Two accounts, both on `SEED_PASSWORD` (`12345678`):

- `user@scribe.com` — assigned to every show. This is the one to log in as. Scribes do not see DRAFT shows, so the `/scribe` list shows the ACTIVE and PUBLISHED ones.
- `scribe2@test.com` — deliberately assigned to nothing, so the "you haven't been assigned to any shows yet" empty state can be checked without unpicking the first account.

Show assignment controls **visibility, not permission**: `require_admin_or_scribe` checks the role alone, so an assigned show is what a scribe can find, not the limit of what they could score. Non-destructive and idempotent — accounts are keyed by email and assignments by (show, user), and an account left on the pre-093 role is repointed rather than skipped.

## Demo Shows (venues, shows, classes)

`scripts/seed_demo_shows.py` creates 3 venues and 3 shows — one AQHA, one APHA, one OPEN — each built out far enough to be usable: rings, disciplines, divisions, the `discipline_divisions` memberships the composite FK on `classes` requires, a numbered class schedule, judges, lodging/class fees, staff assignments, and club sanctioning dealt randomly from NSBA / WSCA.

```powershell
docker cp scripts/seed_demo_shows.py horse-show-results-app-backend-1:/tmp/seed_demo_shows.py
docker exec -w /app -e PYTHONPATH=/app horse-show-results-app-backend-1 python /tmp/seed_demo_shows.py
```

Notes:

- AQHA and APHA classes get a `class_associations` row whose code is verified against `aqha_standard_classes` / `apha_standard_classes` before anything is written — the script aborts rather than inventing a code. AQHA entry validation hard-requires that code, so an AQHA show without one cannot take entries at all.
- Dates are relative to the run date, so the ACTIVE show always spans today. `PUBLISHED -> ACTIVE` is guarded on the show's date range in `backend/routers/shows.py`.
- Sanctioning options are shuffled and dealt one per show rather than drawn independently, so a single run can't hand all three shows the same club pair.
- Re-running skips shows by name and venues by (name, city).

Note that `shows.sql` in this directory is stale: it inserts a `venue` text column that no longer exists on `shows` (venue is `venue_id` only). Use the script above instead.

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

