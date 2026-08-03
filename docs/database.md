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
| `023_show_requests.sql` | Show request workflow (dropped in 052) |
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
| `035_rings_divisions_setup.sql` | Ring/division `sort_order` columns; `standard_rings` + `standard_divisions` lookup tables |
| `036_class_score_type.sql` | `classes.score_type` enum (`placement` / `pattern` / `time`) and `results.raw_score` numeric column |
| `037_side_pots.sql` | Side pot tables: `side_pots`, `side_pot_classes`, `side_pot_entries`, `side_pot_payouts` |
| `038_exhibitor_document_show_type.sql` | Optional `exhibitor_documents.show_type_id` so membership/amateur/youth cards can be tagged to a specific association |
| `039_user_delete_set_null_fks.sql` | Switch `exhibitors.user_id` and `result_audit.changed_by` to `ON DELETE SET NULL` so deleting a user no longer fails on these FKs |
| `040_exhibitor_user_id_unique.sql` | Dedupe linked exhibitors and add partial unique index `exhibitors_user_id_uniq` on `exhibitors(user_id) WHERE user_id IS NOT NULL`, enforcing 1:1 between users and their exhibitor profile |
| `041_exhibitor_contact_youth.sql` | Add `phone`, `address`, `city`, `state`, `zip`, `emergency_contact_name`, `emergency_contact_phone`, `parent_guardian_name`, `parent_guardian_phone` to `exhibitors` |
| `042_trainer_registry.sql` | Add `trainers` table and `horses.trainer_id` foreign key with free-text fallback `horses.trainer_name` |
| `043_aqha_support.sql` | Add AQHA approval metadata to `shows` and create empty `aqha_standard_classes` lookup table for the official AQHA Class Code List |
| `044_aqha_workshop_tracking.sql` | Add `users.aqha_management_workshop_completed_at` for AQHA show-management workshop validation |
| `045_trainer_accounts.sql` | Add `TRAINER` role and link trainer registry rows to user accounts |
| `046_trainer_private_phone.sql` | Add private phone storage for trainer accounts |
| `047_class_templates.sql` | Original Schedule Builder seed library (templates + OPEN-style age-bracket "divisions"); superseded by 048 |
| `048_consolidate_divisions.sql` | Consolidate Divisions/Sections/Classes: add `divisions.default_score_type`, new `sections` and `standard_sections` tables, `classes.section_id`; migrate 047 brackets into sections; merge `class_templates` into `standard_divisions`; drop `class_templates` |
| `049_trainer_credentials_and_profile.sql` | Add ad-ready public profile fields (business_name, city/state/country, website, bio, socials, is_public), compliance fields (safesport_completed_at, background_check_expires_at), self-attested has_liability_insurance, plus new `trainer_registrations` table (mirrors `exhibitor_registrations` with `status` and `expires_at`) and `trainer_documents` table for headshot uploads |
| `050_first_last_name.sql` | Add required `first_name` and `last_name` columns to `users` and `trainers`, backfilled from `users.full_name` and `trainers.name`; application model events derive legacy display columns from first/last while older response fields remain available |
| `051_trainer_user_delete_cascade.sql` | Change `trainers.user_id` to `ON DELETE CASCADE` so deleting a linked trainer user removes the trainer registry row instead of orphaning it |
| `052_drop_show_requests.sql` | Drop the legacy `show_requests` table and approval flow (Show Managers now create shows directly) |
| `053_venue_creator.sql` | Add `venues.created_by_user_id` so Show Managers can delete venues they created |
| `054_class_entry_fee.sql` | Add `classes.entry_fee_cents` (default 0) to support the exhibitor self-registration fee summary; no payment is collected by the app |
| `055_show_office_charge_and_nsba.sql` | Add `shows.office_charge_cents` (one-time per horse, default 0) and seed the `NSBA` show type so per-class NSBA sanction fees (`max($3, 6% × entry_fee)`) can be auto-computed at registration time from existing `class_associations` rows |
| `056_user_email_case_insensitive.sql` | Make `users.email` case-insensitive at the unique-index level |
| `057_entries_no_duplicates.sql` | Block duplicate (class_id, horse_id) entries via a unique constraint |
| `058_relax_exhibitor_per_class.sql` | Allow the same exhibitor to enter a class on multiple horses where show policy permits |
| `059_optional_association_class_code.sql` | Make `class_associations.association_class_code` optional |
| `060_show_fees.sql` | Add `show_fees` table for non-entry fees (stall, drug, late, etc.) |
| `061_division_sections.sql` | Nest Sections under Divisions via new `division_sections` join table; tighten `classes.{division_id, section_id}` to NOT NULL with a composite FK enforcing `(division_id, section_id)` membership; mirror `standard_division_sections`. Pre-existing classes with a NULL division or section are deleted; existing valid pairs are backfilled into the join. |
| `062_horse_breeds.sql` | Multi-breed support for horses |
| `063_fix_standard_division_score_types.sql` | Backfill `default_score_type` on legacy standard_divisions rows |
| `064_seed_standard_sections.sql` | Seed generic + APHA + AQHA `standard_sections` brackets |
| `065_remove_bracket_divisions.sql` / `065_seed_standard_division_sections.sql` | Drop legacy bracket-named divisions; seed standard_division_sections pairs |
| `068_standard_classes.sql` | New `standard_classes` table — canonical per-show-type class catalog used by the Matrix setup picker. Each row pairs a class to a `(standard_division, standard_section)` cell via a composite FK to `standard_division_sections`. |
| `069_wipe_per_show_setup.sql` | **Destructive** — wipes per-show `rings`, `divisions`, `sections`, `division_sections`, `classes` and cascades (entries, results, side pots, class associations). Dev-only reset to make the Matrix setup picker's apply flow idempotent. |
| `070_seed_aqha_standard_library.sql` | Generated by `scripts/generate_aqha_standard_library_seed.py` — reseeds AQHA's `standard_divisions`, `standard_sections`, `standard_division_sections`, and `standard_classes` (~1589 classes from the 2026 AQHA Class Master Listing) via the discipline and section classifiers. Re-run the generator after `database/seeds/aqha_standard_classes.csv` changes. |
| `071_classes_division_section_cascade.sql` | Switch the composite FK `classes(division_id, section_id) → division_sections` from `ON DELETE RESTRICT` to `ON DELETE CASCADE`. The original RESTRICT broke show deletion because Postgres' non-deterministic cascade order could delete a `division_sections` row before its dependent `classes`. User-action protection (refusing to drop a membership a class still uses) still lives in `routers/sections.py` as an explicit 409. |
| `072_sanctioned_associations.sql` | Add `sanctioned_associations`, `sanctioned_association_requests`, and `show_sanctioning` tables for the show-setup wizard's Step 3. Sanctioning bodies (NSBA, WSCA, ...) are distinct from breed `show_types`; `show_sanctioning` carries a `per_class_fee_cents`. Add `shows.office_charge_basis` (`per_back_number` / `per_horse`) and `shows.shavings_ban_outside` policy bool. Seed NSBA + WSCA. |
| `073_scorekeeper_invites.sql` | Add `user_invites` table backing the Show Staff page's scorekeeper invite flow. Manager / secretary enters first/last/email; backend stores a token + 14-day expiry; invitee accepts at `/invite/{token}` and gets an auto-created SCOREKEEPER account assigned to the issuing show. Email delivery itself is a follow-up — the invite URL is returned to the issuer for manual share. |
| `074_rename_division_to_discipline.sql` | **Vocabulary rename.** `divisions` → `disciplines`, `sections` → `divisions`, `division_sections` → `discipline_divisions`, and the standard-library analogues (`standard_divisions` → `standard_disciplines`, `standard_sections` → `standard_divisions`, `standard_division_sections` → `standard_discipline_divisions`). Column renames on `classes` and `standard_classes`, plus named constraint / index renames so the schema reads consistently end-to-end. The new vocabulary: **Discipline** = riding style (Western Pleasure, Hunter Under Saddle), **Division** = age/skill bracket (Youth 14-18, Novice Amateur), **Class** = the single event (#102 Youth 14-18 Western Pleasure). |
| `075_gate_steward_role.sql` | Add `GATE_STEWARD` to the user-role check, `show_gate_stewards` assignment table (mirrors `show_scorekeepers`), and gate state on `entries`: `gate_order` (1-based order-of-go, NULL = unordered) and `gate_status` (`waiting`/`on_deck`/`in_ring`/`done`). Backs the `/gate` steward screen and the Show Staff page's gate steward assignment + invite flow. |
| `076_gate_class_progression.sql` | Gate progression moves to the class level: `classes.gate_status` (`pending`/`done`; the current and on-deck classes are derived from show order) and `entries.gate_checked_in` bool replace `entries.gate_status` from 075 (dropped, never used in production). |
| `077_gate_ready_in_progress.sql` | Widen `classes.gate_status` to `pending`/`ready`/`in_progress`/`done`. `ready` is set automatically by the check-in endpoint when every exhibitor has checked in (and reverts to `pending` on undo); `in_progress` is set explicitly by the steward when the first exhibitor enters the ring. |
| `078_default_ring_backfill.sql` | Every class gets a ring: creates a "Ring 1" for shows that have ring-less classes and no rings, then assigns every ring-less class its show's first ring. Class-creation endpoints now apply the same default; the gate enforces one in-progress class per ring. `classes.ring_id` stays nullable at the schema level. |
| `079_horse_pedigree.sql` | Add nullable free-text `horses.sire_name` and `horses.dam_name` so the class schedule and admin entry list can carry the owner/sire/dam columns a printed show program prints. |
| `080_associations_registry.sql` | **Concept split: affiliation vs show configuration.** New `associations` registry (`code`, `name`, `association_type` = `breed` or `club`, `is_active`). `show_types` had been doing two unrelated jobs — "what kind of show is this?" and "which body is this horse/person registered with?" — which forced club bodies (NSBA, WSCA) to masquerade as show types, and duplicated them again in `sanctioned_associations`. Every table storing a membership/registration number repoints from `show_types` to `associations`: `horse_registrations`, `exhibitor_registrations`, `trainer_registrations`, `exhibitor_documents`, `show_secretary_certifications` (all `show_type_id` -> `association_id`, unique constraints renamed to match). `sanctioned_associations` is folded in and dropped: `show_sanctioning.sanctioned_association_id` -> `association_id` referencing `associations`, same for `sanctioned_association_requests.approved_association_id`. NSBA/WSCA are deleted from `show_types` — they are clubs, not show types, so an NSBA-approved show is now an OPEN (or breed) show carrying NSBA club sanctioning. There is deliberately no `associations` row for OPEN: "Open" is the absence of a breed association, not a body anyone holds a membership with. |

| `081_horse_barn_name.sql` | Add nullable `horses.barn_name` (stable/call name) and split it from `horses.name`, which is documented via `COMMENT` as the **registered (association) name** and stays required — it is what the horse is entered and published under. Deliberately *not* a rename of `horses.name` to `registered_name`: that column is referenced across entries, results, the public schedule, search and exports, and the rename would buy nothing beyond the label the UI already shows. |

| `082_coggins_override_audit.sql` | New `coggins_override_audit` table recording each show-staff bypass of the Coggins entry gate (`skip_coggins_check`). Only *effective* overrides are written — passing the flag for a horse that already holds a valid Coggins overrides nothing and records nothing, so the table counts real bypasses rather than flag usage. FK behaviour is mixed on purpose: `show_id` CASCADEs (the audit answers a question about a show, so it goes when the show does, keeping the table bounded), while `entry_id` / `class_id` / `horse_id` / `overridden_by` SET NULL with `horse_name` and `overridden_by_name` denormalized alongside — an audit that goes anonymous when a user is deleted is not much of an audit. |

| `083_document_extractions.sql` | New `document_extractions` table recording each AI read of an uploaded horse document. A row is written *before* the document is saved and linked to it on save, in the same transaction — so a stored `expiry_date` can always be traced to whether a human typed it, accepted the model's reading, or corrected it. `document_id` is nullable because an uploader can abandon a read; those rows are kept rather than cleaned up. `extracted` is JSONB holding the model's output whole, so the extraction schema can widen without a migration and old rows stay readable against the schema of their day. |

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

## Recent Schema Updates

### New table: `trainers`

- `id` UUID primary key
- `user_id` UUID nullable FK -> `users.id` (`ON DELETE CASCADE`), unique when present
- `name` TEXT NOT NULL
- `first_name` TEXT NOT NULL (migration 050; editable source of truth)
- `last_name` TEXT NOT NULL (migration 050; editable source of truth)
- `name` TEXT NOT NULL derived display field retained for existing trainer list/profile responses
- `private_phone` TEXT nullable, required by trainer self-service once a trainer account is linked
- `phone` TEXT nullable public phone
- `email` TEXT nullable public email
- Public profile (migration 049): `business_name`, `city`, `state`, `country` (NOT NULL default `'US'`), `website`, `bio`, `social_facebook`, `social_instagram`, `social_tiktok`
- `is_public` BOOLEAN NOT NULL default FALSE — gate for ad-facing exposure
- Compliance (migration 049): `safesport_completed_at` DATE (valid 1 year), `background_check_expires_at` DATE
- `has_liability_insurance` BOOLEAN NOT NULL default FALSE — self-attested
- `created_at` TIMESTAMP WITH TIME ZONE

### New table: `trainer_registrations` (migration 049)

Mirrors `exhibitor_registrations` with extra credential fields:

- `id` UUID primary key
- `trainer_id` UUID NOT NULL FK -> `trainers.id` (`ON DELETE CASCADE`)
- `association_id` UUID NOT NULL FK -> `associations.id` (`ON DELETE CASCADE`) — was `show_type_id` -> `show_types.id` before migration 080
- `member_number` TEXT NOT NULL
- `status` TEXT NOT NULL default `'general'`, CHECK `('professional','non_pro','general')` — captures AQHA Professional Horseman / NRHA Pro / Non Pro distinction
- `expires_at` DATE nullable
- UNIQUE `(trainer_id, association_id)`

### New table: `trainer_documents` (migration 049)

BYTEA storage parallel to `exhibitor_documents`, currently restricted to one `HEADSHOT` per trainer (partial unique index). The CHECK can be extended in a follow-up migration to accept COI, W-9 indicator, etc.

- `id` UUID primary key
- `trainer_id` UUID NOT NULL FK -> `trainers.id` (`ON DELETE CASCADE`)
- `document_type` TEXT NOT NULL CHECK `('HEADSHOT')`
- `original_filename`, `file_data` BYTEA, `mime_type`, `file_size`
- `uploaded_by_user_id` UUID nullable FK -> `users.id` (`ON DELETE SET NULL`)
- `created_at` TIMESTAMPTZ
- Partial unique index `idx_trainer_documents_one_headshot` on `(trainer_id)` where `document_type = 'HEADSHOT'`

### Updated table: `horses`

- `trainer_id` UUID nullable FK -> `trainers.id` (`ON DELETE SET NULL`)
- `trainer_name` TEXT free-text fallback when no trainer registry entry is linked

### Updated table: `shows` (migration 043)

- `aqha_show_number` TEXT nullable
- `aqha_approval_status` TEXT default `NOT_SUBMITTED`
- `aqha_approval_submitted_at` DATE nullable
- `aqha_approval_notes` TEXT nullable

### New table: `aqha_standard_classes`

- `code` TEXT primary key
- `name` TEXT NOT NULL
- `division` TEXT NOT NULL
- `sort_order` INTEGER NOT NULL default `0`
- `source_year` INTEGER nullable
- `notes` TEXT nullable

Load this table from the official AQHA Class Code List using:

```powershell
python scripts/import_aqha_standard_classes.py database/seeds/aqha_standard_classes.csv --replace --source-year 2026
```

The 2026 AQHA Class Master Listing is stored as `database/seeds/aqha_standard_classes.csv` after extraction from the official PDF. Re-run the import command after applying migration `043_aqha_support.sql` to populate or refresh the lookup table.

### Updated table: `users` (migration 044)

- `aqha_management_workshop_completed_at` DATE nullable
- `first_name` TEXT NOT NULL (migration 050; editable source of truth)
- `last_name` TEXT NOT NULL (migration 050; editable source of truth)
- `full_name` TEXT NOT NULL derived display field retained for existing user/session responses

AQHA validation checks assigned show managers and show secretaries for a workshop date within 3 years of the show start date.

### Updated table: `exhibitors` (migration 041)

- `phone` TEXT nullable
- `address` TEXT nullable
- `city` TEXT nullable
- `state` TEXT nullable
- `zip` TEXT nullable
- `emergency_contact_name` TEXT nullable
- `emergency_contact_phone` TEXT nullable
- `parent_guardian_name` TEXT nullable
- `parent_guardian_phone` TEXT nullable

## Core Entities

```mermaid
erDiagram
    users ||--o| exhibitors : "may link to"
    users ||--o{ show_managers : manages
    users ||--o{ show_secretaries : secretaries
    users ||--o{ show_scorekeepers : scores

    venues ||--o{ shows : hosts
    show_types ||--o{ shows : primary_type
    shows ||--o{ show_affiliations : has
    shows ||--o{ classes : schedules
    shows ||--o{ show_entries : assigns_back_numbers

    classes ||--o{ class_associations : has_codes
    classes ||--o{ entries : contains
    classes ||--o{ side_pot_classes : bundled_in
    entries ||--o{ results : placed_as
    results ||--o{ result_audit : records_changes

    shows ||--o{ side_pots : runs
    side_pots ||--o{ side_pot_classes : bundles
    side_pots ||--o{ side_pot_entries : opt_ins
    side_pots ||--o{ side_pot_payouts : settles_to
    show_entries ||--o{ side_pot_entries : opts_into
    show_entries ||--o{ side_pot_payouts : receives

    exhibitors ||--o{ entries : enters
    exhibitors ||--o{ show_entries : receives_back_number
    exhibitors ||--o{ exhibitor_horses : linked_to
    exhibitors ||--o{ exhibitor_registrations : has
    exhibitors ||--o{ exhibitor_documents : uploads
    exhibitors ||--o{ horses : owner_or_creator

    horses ||--o{ entries : competes_in
    horses ||--o{ horse_registrations : has
    horses ||--o{ horse_documents : uploads
    horses ||--o{ exhibitor_horses : extra_riders
```

This diagram is intentionally a domain map, not a full schema dump. Use it to choose the right feature path, then verify exact columns and constraints in `backend/models.py` and `database/migrations/`.

| Entity | Notes |
| --- | --- |
| `associations` | **Affiliation registry** (migration 080) — bodies a horse or person is registered/enrolled with, typed `breed` (AQHA, APHA, ApHC, FQHR) or `club` (NSBA, WSCA). Everything storing a membership/registration number points here, and it is also the source for per-show club sanctioning. No OPEN row: Open means no breed association. |
| `show_types` | **Show configuration** — what kind of show is being put on, which drives eligibility and the standard class catalogs. Currently AQHA, APHA, ApHC, FQHR, OPEN. Distinct from `associations`: an AQHA *show* and an AQHA *registration* are different facts, so the same code legitimately appears in both lists. Clubs are not show types. |
| `venues` | Show locations. `created_by_user_id` (added in migration 053) tracks the creator so Show Managers can delete venues they created. |
| `shows` | Event shell with primary show type, venue, dates, status |
| `show_affiliations` | Secondary associations available for selected classes |
| `rings` | Per-show arenas, each with `sort_order` |
| `divisions` | Per-show **disciplines** (Halter, Western Pleasure, Trail, Barrels). Each carries `default_score_type` (`placement` / `pattern` / `time`) that newly-created classes inherit when score_type is omitted. Legacy rows from before migration 048 are not auto-classified; secretaries may need to clean up names that are really sections. |
| `sections` | Per-show **age/skill brackets** (10 & Under, 11-13, Walk-Trot, Amateur). Each section is linked to one or more divisions via `division_sections` (M2M, migration 061). A section with no division memberships can't be used on classes. |
| `division_sections` | Join table on `(division_id, section_id)`. A composite FK on `classes(division_id, section_id)` references this table — pairing a class with an unregistered (div, sec) returns 422. Removing a section from a division that still has classes pairing them returns 409. |
| `standard_rings`, `standard_divisions`, `standard_sections`, `standard_division_sections` | Curated lookup lists used by the setup picker. `show_type_id NULL` is the generic fallback set. `standard_divisions` carries `default_score_type` for each discipline; `standard_division_sections` mirrors the per-show membership join. |
| `standard_classes` | Canonical per-show-type class catalog used by the Matrix setup picker (migration 068). Each row carries `class_code`, `class_name`, `default_score_type`, `default_entry_fee_cents`, and `sort_order`, anchored to a `(standard_division, standard_section)` cell via composite FK to `standard_division_sections`. AQHA seed comes from `scripts/generate_aqha_standard_library_seed.py` reading the 2026 Class Master Listing CSV. |
| `classes` | Competition classes; ordered by `sort_order`. `division_id` (discipline) and `section_id` (bracket) are **both required** (migration 061). The `(division_id, section_id)` pair must be a registered membership in `division_sections` — enforced by a composite FK. `score_type` is `placement` (judges rank), `pattern` (judges score numerically), or `time` (clocked event); set from `division.default_score_type` at create time when omitted. Bulk imports and section-less schedule-builder picks use the per-show "Unassigned" placeholder pair. |
| `class_associations` | Per-class association codes |
| `aqha_standard_classes` | AQHA class-code lookup used by the AQHA class picker and validation rules; seeded from the official 2026 AQHA Class Master Listing CSV |
| `entries` | Exhibitor + horse in a class |
| `show_entries` | Show-level back number assignment |
| `results` | Manual placings; `raw_score` carries the numeric input for `pattern` (judge score) and `time` (seconds) classes — `place` is derived from `raw_score` for those types |
| `result_audit` | Immutable placing change history |
| `coggins_override_audit` | One row per effective show-staff bypass of the Coggins entry gate: horse, which failure was bypassed (`missing` / `undated` / `expired`), who did it, and when |
| `document_extractions` | One row per AI read of an uploaded horse document: what the model suggested (`extracted`), what the human saved (`accepted`), which suggestions they changed (`overridden_fields`), and what the read cost. `document_id` is NULL for abandoned uploads |
| `side_pots` | Optional money pool spanning multiple classes; carries `entry_fee_cents`, `payback_percent`, `scoring_method` (`sum_placings` / `sum_scores`), `eligibility_rule`, `payout_schedule` (JSONB keyed by entry-count band), and `status` (`open` / `closed` / `settled`) |
| `side_pot_classes` | Many-to-many: which classes feed each pot |
| `side_pot_entries` | Back-number opt-ins (`paid` flag); pool size = `entry_fee_cents × paid count` |
| `side_pot_payouts` | Frozen ranking + cents-per-place written on settle; tied entries split their combined share |
| `users` | Login accounts and roles |
| `exhibitors` | Exhibitor profile/person records |
| `exhibitor_horses` | Horses an exhibitor may ride beyond ownership |
| `exhibitor_registrations` | Exhibitor membership numbers per association |
| `exhibitor_documents` | Exhibitor-uploaded documents (membership cards, amateur cards, youth cards, medical, ID, other). Card-type rows may carry a nullable `show_type_id` so the right card can be matched to the right association. |
| `horses` | Horse profile, owner link, optional trainer registry link with free-text fallback, breed/color/registration/document links |
| `trainers` | Trainer registry used by horse profiles (`trainer_id`) |
| `horse_registrations` | Horse registration numbers per association |
| `horse_documents` | Uploaded documents stored as BYTEA for now |
| `cert_org_users` | Association certification lookup data |

## Integrity Rules

- Shows cascade to rings, divisions, sections, classes, show staff links, show entries, and side pots.
- Classes cascade to entries, results, and side pot bundle rows. Deleting a section returns 409 from `routers/sections.py` if any class still references it (the per-section FK is RESTRICT). The composite FK `classes(division_id, section_id) → division_sections` is `ON DELETE CASCADE` (migration 071) so that show deletion can cascade cleanly; user-driven membership removal is still 409-guarded at the API layer.
- Horse deletion sets `entries.horse_id` to `NULL` to preserve history.
- Results changes should write audit rows for `placement` classes; pattern/time classes recompute `place` from `raw_score` on every save and skip the audit (the score is the editorial decision, not the derived placing).
- For `pattern` and `time` classes, `raw_score` is required on insert and update; the backend recomputes every result's `place` and `is_tie` flags after each change so equal scores share a place.
- A side pot with `scoring_method = 'sum_scores'` requires every bundled class to have `score_type IN ('pattern','time')`; the backend rejects the create/update otherwise.
- Settling a side pot is one-way: status moves to `settled`, payouts are written, and further edits are blocked.
- Horse age is derived from foaling year and current year; it is not stored.
- Horse registration numbers are unique per association across all horses.
- AQHA entry validation requires an official AQHA class code, an AQHA horse registration, an AQHA exhibitor membership number, and enough DOB/foaling-date data to verify supported youth/select/horse-age rules.
