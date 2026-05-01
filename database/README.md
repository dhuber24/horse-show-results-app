# Database

PostgreSQL schema for the Horse Show Results App. The database is hosted on **Neon** (cloud PostgreSQL) — there is no local database service. Connect via the `DATABASE_URL` environment variable.

## Migrations

Migrations live in `database/migrations/` and are tracked in the `_migrations` table. Apply them directly via psql (Windows volume-mount bug prevents using the migration runner script):

```bash
PSQL_URL="${DATABASE_URL/postgresql+asyncpg/postgresql}"
docker run --rm postgres:16-alpine psql "$PSQL_URL" -c "<SQL statement>"
docker run --rm postgres:16-alpine psql "$PSQL_URL" -c \
  "INSERT INTO _migrations (name) VALUES ('<filename>.sql') ON CONFLICT DO NOTHING;"
```

Applied migrations (in order):
| File | Description |
|------|-------------|
| `001_show_types.sql` | show_types table; seeds AQHA, APHA, OPEN |
| `002_show_admin_role.sql` | show_secretaries join table |
| `003_venue_admins.sql` | venue_admins join table (applied manually, not tracked in _migrations) |
| `004_user_last_login.sql` | last_login_at column on users |
| `005_rename_show_admins_table.sql` | renamed show_admins → show_secretaries |
| `006_secretary_certifications.sql` | show_secretary_certifications table |
| `007_horse_attributes.sql` | breeds (17), horse_colors (27), foaling_date/sex/breed_id/color_id, horse_registrations |
| `008_horse_owner_exhibitor.sql` | owner_exhibitor_id FK on horses |
| `009_horse_documents.sql` | horse_documents table (BYTEA storage) |
| `010_apha_fields.sql` | APHA fields on shows, horses, classes, entries, exhibitors |
| `011_entries_horse_fk_set_null.sql` | entries.horse_id FK → ON DELETE SET NULL |
| `012_user_approval.sql` | is_approved BOOLEAN on users (defaults true); self-registered Show Secretaries set to false |
| `013_user_approval.sql` | Renumbered duplicate of 012; registered in _migrations for tracking consistency |
| `014_user_role_check_constraint.sql` | CHECK constraint on users.role restricting to valid role values |
| `015_add_fk_indexes.sql` | 32 indexes on FK columns across all major tables |
| `016_add_enum_check_constraints.sql` | CHECK constraints on status/enum columns; shows.created_at NOT NULL |
| `017_drop_legacy_venue_column.sql` | Drops shows.venue TEXT (superseded by venue_id FK) |
| `018_drop_legacy_owner_name_column.sql` | Drops horses.owner_name TEXT (superseded by owner_exhibitor_id FK) |
| `019_result_audit_changed_at_index.sql` | idx_result_audit_changed_at ON result_audit(changed_at DESC) |

Data seeded directly (not via migration file): show_types NSBA, WSCA, ARHA, ApHC, FQHR.

---

## Core Entities

### show_types
Association types supported by the app.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| code | TEXT UNIQUE | AQHA, APHA, WSCA, NSBA, ARHA, ApHC, FQHR, OPEN |
| name | TEXT | Full association name |

---

### shows

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | TEXT | |
| venue_id | UUID FK → venues | |
| show_type_id | UUID FK → show_types | |
| start_date | DATE | |
| end_date | DATE | |
| status | TEXT | DRAFT, PUBLISHED, ACTIVE, COMPLETED — CHECK constraint enforced |
| apha_show_number | TEXT | Required for APHA export |
| created_by_user_id | UUID FK → users | |
| created_at | TIMESTAMPTZ NOT NULL | |

**Status flow:** DRAFT → PUBLISHED → ACTIVE (auto on start_date) → COMPLETED (auto after end_date)

---

### classes

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| show_id | UUID FK → shows | CASCADE delete |
| ring_id | UUID FK → rings | nullable |
| division_id | UUID FK → divisions | nullable |
| class_number | TEXT | Unique within show |
| class_name | TEXT | |
| class_date | DATE | |
| status | TEXT | OPEN, CLOSED — CHECK constraint enforced |
| apha_class_code | TEXT | APHA standard code e.g. WP01 |
| created_at | TIMESTAMPTZ | |

---

### entries

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| class_id | UUID FK → classes | CASCADE delete |
| exhibitor_id | UUID FK → exhibitors | |
| horse_id | UUID FK → horses | SET NULL on horse delete |
| back_number | INTEGER | |
| status | TEXT | ENTERED, WITHDRAWN |
| apha_division | TEXT | OPEN, SOLID_PAINT_BRED, AMATEUR, NOVICE_AMATEUR, YOUTH, NOVICE_YOUTH |
| relationship_to_owner | TEXT | Required for Amateur/Youth APHA divisions |
| is_disqualified | BOOLEAN | DQ'd entries kept in export, no placing |
| created_at | TIMESTAMPTZ | |

**Unique:** `(class_id, exhibitor_id, horse_id)`

---

### results

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| class_id | UUID FK → classes | CASCADE delete |
| entry_id | UUID FK → entries | |
| place | INTEGER | Must be > 0 |
| is_tie | BOOLEAN | |
| notes | TEXT | |
| created_at | TIMESTAMPTZ | |

**Unique:** `(class_id, place, entry_id)`

---

### result_audit
Immutable audit trail for result changes. At least one of `result_id` or `entry_id` must be non-null (CHECK constraint).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| result_id | UUID FK → results | nullable; null when recording a deletion |
| entry_id | UUID FK → entries | nullable; present when a result row was deleted |
| changed_by | UUID FK → users | |
| old_place | INTEGER | |
| new_place | INTEGER | |
| changed_at | TIMESTAMPTZ | Indexed DESC (idx_result_audit_changed_at) |

---

## People & Auth Entities

### users

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| role | TEXT | ADMIN, SHOW_SECRETARY, SCOREKEEPER, EXHIBITOR |
| full_name | TEXT | |
| email | TEXT UNIQUE | |
| hashed_password | TEXT | bcrypt |
| last_login_at | TIMESTAMPTZ | |
| is_approved | BOOLEAN | defaults true; pending approval workflow for self-registered Show Secretaries |
| created_at | TIMESTAMPTZ | |

---

### exhibitors

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | UUID FK → users | nullable; links exhibitor to a login |
| full_name | TEXT | |
| apha_member_number | TEXT | |
| apha_member_expiry | DATE | |
| amateur_card_number | TEXT | |
| amateur_card_expiry | DATE | |
| amateur_novice_codes | TEXT | |
| date_of_birth | DATE | |
| created_at | TIMESTAMPTZ | |

---

### show_entries
Show-level back number assignment (one row per exhibitor per show).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| show_id | UUID FK → shows | |
| exhibitor_id | UUID FK → exhibitors | |
| back_number | INTEGER | Unique within show |
| created_at | TIMESTAMPTZ | |

**Unique:** `(show_id, exhibitor_id)`, `(show_id, back_number)`

---

### show_secretaries
Links users with SHOW_SECRETARY role to the shows they manage.

| Column | Type | Notes |
|--------|------|-------|
| show_id | UUID FK → shows | Composite PK |
| user_id | UUID FK → users | Composite PK |

---

### show_scorekeepers
Links users with SCOREKEEPER role to the shows they score.

| Column | Type | Notes |
|--------|------|-------|
| show_id | UUID FK → shows | Composite PK |
| user_id | UUID FK → users | Composite PK |

---

### show_secretary_certifications
Association certifications per Show Secretary.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | UUID FK → users | |
| show_type_id | UUID FK → show_types | |
| secretary_id_number | TEXT | nullable |

**Unique:** `(user_id, show_type_id)`

---

## Venue Entities

### venues

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | TEXT | |
| address | TEXT | |
| city | TEXT | |
| state | TEXT | |
| created_at | TIMESTAMPTZ | |

---

## Horse Entities

### horses

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | TEXT | |
| owner_exhibitor_id | UUID FK → exhibitors | nullable |
| foaling_date | DATE | nullable; age calculated, never stored |
| sex | TEXT | Mare, Gelding, Stallion (nullable) |
| breed_id | UUID FK → breeds | nullable |
| color_id | UUID FK → horse_colors | nullable |
| is_solid_paint_bred | BOOLEAN | defaults false; SPB horses cannot enter APHA Open classes |
| created_at | TIMESTAMPTZ | |

---

### breeds
Admin-managed lookup table (17 seeded, alphabetically sorted).

| Column | Type |
|--------|------|
| id | UUID PK |
| name | TEXT UNIQUE |

---

### horse_colors
Admin-managed lookup table (27 seeded, alphabetically sorted).

| Column | Type |
|--------|------|
| id | UUID PK |
| name | TEXT UNIQUE |

---

### exhibitor_horses
Junction table — which horses an exhibitor can ride (beyond direct ownership).

| Column | Type |
|--------|------|
| exhibitor_id | UUID FK → exhibitors |
| horse_id | UUID FK → horses |

**Unique:** `(exhibitor_id, horse_id)`

---

### horse_registrations
Association registration numbers per horse (one per association).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| horse_id | UUID FK → horses | |
| show_type_id | UUID FK → show_types | |
| registration_number | TEXT | |

**Unique:** `(horse_id, show_type_id)`

---

### horse_documents
Documents attached to a horse (Coggins, vaccination, health cert, registration papers). Files stored as BYTEA in Neon; migrate to S3 later by adding `storage_key TEXT` and dropping `file_data`.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| horse_id | UUID FK → horses | |
| document_type | TEXT | COGGINS, VACCINATION, HEALTH_CERTIFICATE, REGISTRATION |
| original_filename | TEXT | |
| file_data | BYTEA | Max 10 MB |
| mime_type | TEXT | |
| file_size | INTEGER | bytes |
| issue_date | DATE | nullable |
| expiry_date | DATE | nullable |
| uploaded_by_user_id | UUID FK → users | |
| created_at | TIMESTAMPTZ | |

---

## Supporting Entities

### rings
Performance areas/rings within a show.

| Column | Type |
|--------|------|
| id | UUID PK |
| show_id | UUID FK → shows (CASCADE) |
| name | TEXT |

### divisions
Competition divisions within a show (e.g., Youth, Amateur, Open).

| Column | Type |
|--------|------|
| id | UUID PK |
| show_id | UUID FK → shows (CASCADE) |
| name | TEXT |

---

## Data Integrity

### Cascading Deletes
- Show → rings, divisions, classes, show_entries, show_secretaries, show_scorekeepers
- Class → entries, results
- Entry → results → result_audit
- Horse deleted → entries.horse_id set to NULL (history preserved)

### Common Queries

```sql
-- All entries for a class with current placements
SELECT e.id, e.back_number, ex.full_name, h.name AS horse_name,
       r.place, r.is_tie, e.is_disqualified
FROM entries e
JOIN exhibitors ex ON e.exhibitor_id = ex.id
LEFT JOIN horses h ON e.horse_id = h.id
LEFT JOIN results r ON e.id = r.entry_id
WHERE e.class_id = $class_id
ORDER BY COALESCE(r.place, 999), e.created_at;

-- Show-level back number roster
SELECT se.back_number, ex.full_name
FROM show_entries se
JOIN exhibitors ex ON se.exhibitor_id = ex.id
WHERE se.show_id = $show_id
ORDER BY se.back_number;

-- Result audit trail
SELECT ra.changed_at, u.full_name, ra.old_place, ra.new_place
FROM result_audit ra
LEFT JOIN users u ON ra.changed_by = u.id
WHERE ra.result_id = $result_id
ORDER BY ra.changed_at DESC;
```
