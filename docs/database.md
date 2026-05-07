# Database

The database is PostgreSQL hosted on Neon. There is no local `db` service in `docker-compose.yml`.

## Migration Policy

Migrations live in `database/migrations/` and are tracked by the `_migrations` table. Treat migrations as append-only once applied to Neon.

Current migration files:

| File | Summary |
| --- | --- |
| `001_show_types.sql` | Initial show types |
| `002_show_admin_role.sql` | Original show admin join table |
| `003_venue_admins.sql` | Venue admin join table |
| `004_user_last_login.sql` | User last login timestamp |
| `005_rename_show_admins_table.sql` | Rename show admins to show secretaries |
| `006_secretary_certifications.sql` | Show secretary certifications |
| `007_horse_attributes.sql` | Breeds, colors, horse attributes, registrations |
| `008_horse_owner_exhibitor.sql` | Horse owner exhibitor FK |
| `009_horse_documents.sql` | Horse document storage |
| `010_apha_fields.sql` | APHA show, horse, entry, exhibitor fields |
| `011_entries_horse_fk_set_null.sql` | Preserve entries when horses are deleted |
| `012_result_audit_entry_fk.sql` | Result audit entry FK support |
| `013_user_approval.sql` | User approval flag |
| `014_user_role_check_constraint.sql` | Role check constraint |
| `015_add_fk_indexes.sql` | Foreign key indexes |
| `016_add_enum_check_constraints.sql` | Status and enum check constraints |
| `017_drop_legacy_venue_column.sql` | Drop legacy show venue text |
| `018_drop_legacy_owner_name_column.sql` | Drop legacy horse owner text |
| `019_result_audit_changed_at_index.sql` | Result audit timestamp index |
| `020_class_associations.sql` | Per-association class codes |
| `021_drop_apha_class_code.sql` | Drop legacy APHA class code |
| `022_show_manager_role.sql` | Show Manager role and join table |
| `023_show_requests.sql` | Show request workflow |
| `024_apha_standard_classes.sql` | APHA reference class list |
| `024_cert_org_users.sql` | Certification lookup table |
| `024_unique_class_number.sql` | Historical class number uniqueness |
| `025_class_sort_order.sql` | Class sort order |
| `026_show_affiliations.sql` | Secondary show affiliations |
| `027_new_show_types.sql` | Added NRHA, NCHA, NRCHA |
| `028_drop_class_number_unique.sql` | Drop class number unique constraint |
| `029_remove_show_types.sql` | Remove ARHA, NRHA, NCHA, NRCHA |
| `030_horse_owner_trainer.sql` | Horse owner and trainer free-text fields |
| `031_exhibitor_registrations.sql` | Exhibitor association registrations |
| `032_exhibitor_documents.sql` | Exhibitor document storage (BYTEA) |
| `033_horse_created_by.sql` | Track horse creator exhibitor linkage |
| `034_horse_registration_unique.sql` | Unique registration number per association |

There are duplicate `024_*` migration numbers. Preserve the existing filenames and ordering behavior; do not rename already-applied migrations casually.

## Running Migrations

Preferred local command on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File database/migrate.ps1
```

Fallback for direct SQL through Docker:

```bash
PSQL_URL="${DATABASE_URL/postgresql+asyncpg/postgresql}"
docker run --rm postgres:16-alpine psql "$PSQL_URL" -v ON_ERROR_STOP=1 -c "<SQL statement>"
```

If a manual migration file is applied outside the runner, also insert its filename into `_migrations`.

## Core Entities

| Entity | Notes |
| --- | --- |
| `show_types` | Association catalog, currently AQHA, APHA, WSCA, NSBA, ApHC, FQHR, OPEN |
| `venues` | Show locations |
| `shows` | Event shell with primary show type, venue, dates, status |
| `show_affiliations` | Secondary associations available for selected classes |
| `show_requests` | Show Manager request/approval workflow |
| `rings` and `divisions` | Optional per-show organization |
| `classes` | Competition classes; ordered by `sort_order` |
| `class_associations` | Per-class association codes |
| `entries` | Exhibitor + horse in a class |
| `show_entries` | Show-level back number assignment |
| `results` | Manual placings |
| `result_audit` | Immutable placing change history |
| `users` | Login accounts and roles |
| `exhibitors` | Exhibitor profile/person records |
| `exhibitor_horses` | Horses an exhibitor may ride beyond ownership |
| `exhibitor_registrations` | Exhibitor membership numbers per association |
| `exhibitor_documents` | Exhibitor-uploaded documents (membership cards, amateur cards, youth cards, medical, ID, other) |
| `horses` | Horse profile, owner/trainer text, breed/color/registration/document links |
| `horse_registrations` | Horse registration numbers per association |
| `horse_documents` | Uploaded documents stored as BYTEA for now |
| `cert_org_users` | Association certification lookup data |

## Integrity Rules

- Shows cascade to rings, divisions, classes, show staff links, and show entries.
- Classes cascade to entries and results.
- Horse deletion sets `entries.horse_id` to `NULL` to preserve history.
- Results changes should write audit rows.
- Horse age is derived from foaling year and current year; it is not stored.
- Horse registration numbers are unique per association across all horses.
