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

It does not:

- Judge classes.
- Score maneuvers.
- Calculate penalties.
- Enforce association judging rules.

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

New Show Secretary and Show Manager registrations are currently auto-approved. The `users.is_approved` column remains as an account lock gate. Show Manager approval applies to show requests, not account creation.

## Core Data Concepts

- `shows`: event shell with venue, dates, primary association, status, and optional APHA show number.
- `show_requests`: Show Manager request workflow; approval creates a draft show.
- `classes`: competition classes, sorted by `sort_order`.
- `class_associations`: association-specific codes for a class, useful for dual-sanctioned shows.
- `entries`: class-level exhibitor/horse registrations.
- `show_entries`: show-level exhibitor back numbers.
- `results`: manual placings.
- `result_audit`: placing change history.
- `users`: login accounts and roles.
- `exhibitors`: person/profile records, optionally linked to users.
- `horses`: horse records with owner/trainer text, breed/color, registrations, documents, and APHA SPB flag.
- `exhibitor_registrations`: exhibitor membership numbers per association.

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

## Sharp Edges

- Do not create an `EXHIBITOR` user without also creating the linked `exhibitors` row.
- `cert_org_users.Org` uses a capital `O`.
- `OPEN` is an unaffiliated show type and is excluded from certification and registration-number UI.
- Horse age is derived, not stored.
- Deleting a horse preserves entry history by setting `entries.horse_id` to `NULL`.
- The repo has historical duplicate migration numbering around `024_*`; preserve filenames and ordering behavior.
- `ConfirmDialog` exists but is no longer the preferred delete pattern.

## Current Status

Active development. Core user management, show setup, class/entry management, back numbers, scorekeeper placing entry, exhibitor dashboard/profile, show requests, APHA class import/export, and horse document workflows are present.

