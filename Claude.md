# Claude.md - Horse Show Results App

This is the short orientation guide for AI-assisted development in this repo. Use it as the map, then open the focused docs linked below when a task touches that subsystem.

## Project Purpose

Horse Show Results is a browser-based app for ranch and western pleasure horse shows.

It does:

- Let exhibitors and office staff manage class entries.
- Assign show-level back numbers.
- Let authorized scorekeepers manually enter placings.
- Publish results live.
- Track horses, exhibitors, show staff, documents, and association registration data.
- Provide limited association compliance validation where the app stores enough data, including AQHA class-code, registration, membership-number, workshop-date, and age checks.

It does not:

- Judge classes.
- Score maneuvers.
- Calculate penalties.
- Enforce association judging rules or replace official association review.

Placings entered by authorized staff are treated as final published results, with audit history for changes.

## Current Stack

| Layer | Technology | Path |
| --- | --- | --- |
| Frontend | Next.js 15, React 19, TypeScript PWA | `frontend/` |
| Backend | FastAPI, async SQLAlchemy | `backend/` |
| Database | PostgreSQL on Neon | `database/` |
| Runtime | Docker Compose for frontend/backend | `docker-compose.yml` |

There is no local Postgres service. The app uses `DATABASE_URL` for Neon.

## Read Next

| Topic | Doc |
| --- | --- |
| System architecture and request flow | `docs/architecture.md` |
| Auth, roles, headers, registration | `docs/auth.md` |
| Current database model and migrations | `docs/database.md` |
| Frontend route and UI conventions | `docs/frontend.md` |
| Show lifecycle and operational workflow | `docs/show-workflow.md` |
| APHA and association-specific behavior | `docs/apha.md` |
| AQHA research, class codes, and validation | `docs/aqha.md` |
| Historical change log | `IMPROVEMENTS.md` |
| Contributor workflow | `CONTRIBUTING.md` |

## Key Source Files

| Area | File |
| --- | --- |
| FastAPI app setup | `backend/main.py` |
| DB session/engine | `backend/database.py` |
| Auth guards | `backend/dependencies.py` |
| ORM models | `backend/models.py` |
| Pydantic schemas | `backend/schemas.py` |
| Backend routers | `backend/routers/` |
| Association rules | `backend/rules/` |
| NextAuth config | `frontend/auth.ts` |
| Backend proxy helper | `frontend/lib/backend-fetch.ts` |
| Shared frontend API helpers | `frontend/lib/api.ts` |
| App Router pages | `frontend/app/` |
| Next route handlers | `frontend/app/api/` |
| Shared components | `frontend/components/` |
| SQL migrations | `database/migrations/` |

## Roles

- `ADMIN`: full access.
- `SHOW_MANAGER`: requests and manages hosted shows; can assign staff for their shows.
- `SHOW_SECRETARY`: manages assigned shows, classes, entries, back numbers, and results administration.
- `SCOREKEEPER`: enters placings for assigned shows.
- `EXHIBITOR`: views own entries/results and manages profile/horses.
- `TRAINER`: manages a linked trainer registry profile used on horse records.

New Show Secretary, Show Manager, Trainer, and Exhibitor registrations are currently auto-approved. The `users.is_approved` column remains as an account lock gate. Show Manager approval applies to show requests, not account creation.

## Core Data Concepts

- `shows`: event shell with venue, dates, primary association, status, optional APHA show number, and AQHA approval metadata.
- `show_requests`: Show Manager request workflow; approval creates a draft show.
- `divisions`: per-show **disciplines** (Halter, Western Pleasure, Trail, Barrels). Each carries `default_score_type` (`placement` / `pattern` / `time`) that new classes inherit when score_type is omitted.
- `sections`: per-show **age/skill brackets** within a discipline (10 & Under, Walk-Trot, Amateur). Optional. New in migration 048.
- `standard_divisions` / `standard_sections`: curated lookup lists for the setup picker; `show_type_id NULL` is the generic fallback.
- `classes`: competition classes, sorted by `sort_order`. Nullable `division_id` (discipline) and `section_id` (bracket). `score_type` is `placement` (judges rank — rail/halter), `pattern` (judges score numerically — showmanship/horsemanship/etc.), or `time` (clocked event); derived from `division.default_score_type` at create time when omitted.
- `class_associations`: association-specific codes for a class, useful for dual-sanctioned shows.
- `aqha_standard_classes`: official AQHA class-code lookup used by the AQHA picker and validation.
- `entries`: class-level exhibitor/horse registrations.
- `show_entries`: show-level exhibitor back numbers.
- `results`: placings. For `pattern`/`time` classes, `raw_score` is the source of truth and `place` is recomputed server-side on every change.
- `result_audit`: placing change history (placement classes only — derived placings are not audited).
- `side_pots` / `side_pot_classes` / `side_pot_entries` / `side_pot_payouts`: optional money pool spanning multiple classes; opt-ins per back number, payouts written on settle.
- `users`: login accounts and roles.
- `exhibitors`: person/profile records, optionally linked to users.
- `horses`: horse records with owner/trainer text, breed/color, registrations, documents, and APHA SPB flag.
- `exhibitor_registrations`: exhibitor membership numbers per association.
- `backend/rules`: association-specific validation hooks; AQHA currently enforces the first practical validation slice.
- `users.aqha_management_workshop_completed_at`: AQHA show-management workshop date used to validate assigned managers/secretaries.
- `trainers`: trainer registry; carries private contact, public ad-ready profile (`business_name`, location, `website`, `bio`, socials, `is_public`), compliance dates (`safesport_completed_at`, `background_check_expires_at`), and a self-attested `has_liability_insurance` flag.
- `trainer_registrations`: per-association trainer membership with `status` (`professional`/`non_pro`/`general`) and optional `expires_at`. Mirrors `exhibitor_registrations`.
- `trainer_documents`: trainer-uploaded images stored as BYTEA. Currently restricted to one `HEADSHOT` per trainer.

## Common Feature Recipe

Most data-backed enhancements follow this path:

1. Add a SQL migration in `database/migrations/`.
2. Update `backend/models.py`.
3. Update `backend/schemas.py`.
4. Update or add a FastAPI router in `backend/routers/`.
5. Update or add a Next route handler in `frontend/app/api/`.
6. Update the relevant page/form/component in `frontend/app/` or `frontend/components/`.
7. Run focused validation.

## Commands

Start the app:

```bash
docker-compose up
```

Run frontend checks from `frontend/`:

```bash
npm run type-check
npm run lint
npm run build
```

Run backend compile check from repo root:

```bash
py -m compileall backend
```

Run the project test helper from repo root:

```bash
bash RUN_TESTS.sh
```

Apply migrations on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File database/migrate.ps1
```

Run the documentation guard manually:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-docs-updated.ps1
```

## Project Conventions

- Prefer existing router, schema, and component patterns over new abstractions.
- Keep migrations append-only once applied.
- Use `safe_uuid()` for untrusted UUID strings in backend code.
- Use `selectinload` for relationships needed by Pydantic serialization; avoid lazy-load surprises in async routes.
- Authenticated frontend mutations should usually go through `frontend/app/api/` route handlers.
- Route handlers should preserve backend status codes and use `safeFetchBackend()` when `204` responses are possible.
- Admin pages use `Breadcrumbs`.
- Destructive UI actions use inline confirmation, not modal overlays.
- Disabled buttons should include a `title` explaining why they are disabled.
- The pre-commit documentation guard blocks staged implementation changes unless related docs are staged too. Bypass once with `DOCS_CHECK_BYPASS=1` only for changes with no documentation impact.

## Sharp Edges

- Do not create an `EXHIBITOR` user without also creating the linked `exhibitors` row.
- Do not create a `TRAINER` user without also creating or linking the matching `trainers` row.
- `cert_org_users.Org` uses a capital `O`.
- `OPEN` is an unaffiliated show type and is excluded from certification and registration-number UI.
- Horse age is derived, not stored.
- Deleting a horse preserves entry history by setting `entries.horse_id` to `NULL`.
- The repo has historical duplicate migration numbering around `024_*`; preserve filenames and ordering behavior.
- `ConfirmDialog` exists but is no longer the preferred delete pattern.
- `classes.score_type` is derived from `division.default_score_type` at create time when not explicitly set. APHA/AQHA bulk-imported classes still default to `placement` (no division attached) and need to be flipped to `pattern` per class today. Side pots with `sum_scores` only see `pattern`/`time` classes.
- Migration 048 dropped `class_templates` and the `category` concept; "Division = discipline" and "Section = bracket" are the canonical vocabulary. Per-show `divisions` rows that pre-date 048 may still contain bracket-named entries — secretaries clean those up in the Setup UI.
- For `pattern`/`time` classes the scorekeeper enters `raw_score` and the backend recomputes `place` and `is_tie` for every result in the class on insert/update/delete. Audit rows are only written for `placement` classes.
- Settling a side pot is irreversible — `status` flips to `settled`, payouts are written, and edits/deletes are blocked.

## Current Status

Active development. Core user management, show setup, class/entry management, back numbers, scorekeeper placing entry, exhibitor dashboard/profile, show requests, APHA class import/export, AQHA class-code import/picker/validation, horse document workflows, score-driven placings (pattern/time classes), and side pot management (divisional jackpots) are present.
