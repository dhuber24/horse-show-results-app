# Claude.md - GaitDesk

The map for AI-assisted work in this repo. It is loaded on every request, so it holds only what every task needs: what the app is, where things live, the rules that apply everywhere, and which doc to read before touching a subsystem. **Before changing a subsystem, read its file in `docs/design/`** — that is where the rules it keeps, and the reasons behind them, are written down.

## Project Purpose

GaitDesk is a browser-based app for ranch and western pleasure horse shows.

It does:

- Let exhibitors and office staff manage class entries.
- Assign show-level back numbers.
- Let authorized scribes manually enter placings.
- Record a judge's card — maneuver or fence scores and the penalties called — and add it up (migration 122).
- Publish results live.
- Read a show's own printed show bill into a draft show for staff to check and create (migration 141) — a **paid feature**, switched on per show company by a GaitDesk admin (migration 142).
- Track horses, exhibitors, show staff, documents, and association registration data.
- Provide limited association compliance validation where the app stores enough data, including AQHA class-code, registration, membership-number, workshop-date, and age checks.

It does not:

- Judge classes.
- Decide what a maneuver is worth, or which penalty applies.
- Enforce association judging rules or replace official association review.

Placings entered by authorized staff are treated as final published results, with audit history for changes. Every number on a judge's card was called by a judge and written down by a scribe; the app only adds it up, and a human can overrule the sum (`judge_cards.override_score`, audited). Why the card is added up at all: [docs/design/results-and-scoring.md](docs/design/results-and-scoring.md).

## Current Stack

| Layer | Technology | Path |
| --- | --- | --- |
| Frontend | Next.js 15, React 19, TypeScript PWA | `frontend/` |
| Backend | FastAPI, async SQLAlchemy | `backend/` |
| Database | PostgreSQL on Neon | `database/` |
| Runtime | Docker Compose for frontend/backend | `docker-compose.yml` |

There is no local Postgres service. The app uses `DATABASE_URL` for Neon.

## Read Before You Change

Each design doc holds that subsystem's data model notes, its rules, the reasons for them, and its key files.

| Before changing… | Read |
| --- | --- |
| Fees, fee units, bills, payments, club sanction fees, financial reports | [docs/design/billing.md](docs/design/billing.md) |
| Side pots and futurities, and how they reach the bill | [docs/design/side-pots-and-futurities.md](docs/design/side-pots-and-futurities.md) |
| Show sign-up, the registration wizard, an exhibitor's class entry, cancelling, back numbers, My Shows, public show pages | [docs/design/registration.md](docs/design/registration.md) |
| The registration desk, paperwork sign-offs, health flags, waivers, merging records | [docs/design/desk.md](docs/design/desk.md) |
| The `shows` row, setup wizard steps, the Class Builder, class order and numbers, the show bill and its import | [docs/design/show-setup.md](docs/design/show-setup.md) |
| Results, scribe screens, the judge's card, card types, posting, patterns, show-record reports | [docs/design/results-and-scoring.md](docs/design/results-and-scoring.md) |
| Live boards, the marquee, points systems, high-point standings, circuits | [docs/design/live-boards-and-high-point.md](docs/design/live-boards-and-high-point.md) |
| Show companies, office access to a show, paid features | [docs/design/companies.md](docs/design/companies.md) |
| Associations, APHA/AQHA rules, memberships and competition cards, class-code catalogs | [docs/design/associations.md](docs/design/associations.md) |
| Roles, accounts, `/welcome`, the profile, exhibitor/trainer/judge records, horses, horse documents | [docs/design/accounts.md](docs/design/accounts.md) |
| A migration, or a release to production | [docs/design/operations.md](docs/design/operations.md) and the `release` skill |

Background and narrative:

| Topic | Doc |
| --- | --- |
| System architecture and request flow | `docs/architecture.md` |
| Auth, roles, headers, registration | `docs/auth.md` |
| Current database model and migrations | `docs/database.md` |
| Frontend route and UI conventions | `docs/frontend.md` |
| Show lifecycle and operational workflow | `docs/show-workflow.md` |
| APHA and association-specific behavior | `docs/apha.md` |
| AQHA research, class codes, and validation | `docs/aqha.md` |
| Reading data off uploaded documents | `docs/document-extraction.md` |
| Setting a show up from its printed show bill | `docs/showbill-import.md` |
| Production deployment, environments, readiness | `docs/deployment.md` |
| Capacity ceilings and what hosting costs at scale | `docs/scaling.md` |
| Historical change log | `IMPROVEMENTS.md` |
| Contributor workflow | `CONTRIBUTING.md` |

## Key Source Files

Core files only; each design doc lists the files for its subsystem.

| Area | File |
| --- | --- |
| FastAPI app setup | `backend/main.py` |
| DB session/engine | `backend/database.py` |
| Does the schema still fit the mappers | `backend/schema_drift.py` |
| Auth guards | `backend/dependencies.py` |
| Who works a show from the office (per-show rows or its company) | `backend/show_access.py` |
| ORM models | `backend/models.py` |
| Pydantic schemas | `backend/schemas.py` |
| Backend routers | `backend/routers/` |
| Association rules | `backend/rules/` |
| All money math | `backend/billing.py` |
| NextAuth config | `frontend/auth.ts` |
| Backend proxy helper | `frontend/lib/backend-fetch.ts` |
| Shared frontend API helpers | `frontend/lib/api.ts` |
| App Router pages | `frontend/app/` |
| Next route handlers | `frontend/app/api/` |
| Shared components | `frontend/components/` |
| SQL migrations | `database/migrations/` |

## Roles

- `ADMIN`: everything, including every paid feature; the only role that creates show companies, staffs them and switches their features on.
- `SHOW_MANAGER`: creates and runs shows (the creator gets the `show_managers` row; removing the last manager is a 409). With `SHOW_SECRETARY`, manages their company's people at My Company Staff — every addition is approved by an ADMIN — and the company's self-cancel cut-off.
- `SHOW_SECRETARY`: runs assigned shows — classes, entries, back numbers, results administration — and, with the two roles above, the registration desk at `/admin/shows/[id]/desk`.
- `SCRIBE`: enters placings and scores for assigned shows. Not "Ring Steward" — do not rename it.
- `GATE_STEWARD`: runs the in-gate at `/gate` — order of go, check-in, and each class's gate status.
- `EXHIBITOR`: their own entries, profile and horses; signs up for a `PUBLISHED` show until `shows.entry_deadline`, and enters and scratches their own classes until each class starts — or until the show starts, where `shows.self_entry_closes` says so.
- `TRAINER`: a linked trainer registry profile used on horse records.

New Show Secretary, Show Manager, Trainer and Exhibitor registrations are auto-approved; `users.is_approved` remains as an account lock. Each role in full: [docs/design/accounts.md](docs/design/accounts.md).

## Rules That Apply Everywhere

Each line is the short form; the linked doc has the reason and the history.

- **A migration's compatibility decides the release order.** Backward-compatible (new table, nullable or defaulted column, index): production database first, then the code. Backward-incompatible (`RENAME`, `DROP`, `SET NOT NULL`, a narrowed type): split it into expand / contract releases — there is no safe single step. Development runs on its own Neon branch, and `database/migrate.ps1` refuses production without `-AllowProduction`. Use the `release` skill. → [operations](docs/design/operations.md)
- **Write migrations to survive `create_all`.** Startup runs `Base.metadata.create_all`, which may create a new table before its migration does: use `IF NOT EXISTS`, and state server defaults and SQL-only CHECKs in their own statements. Keep migrations append-only once applied. → [associations](docs/design/associations.md) (migration 114)
- **Money is computed in one place: `backend/billing.py`** (`build_bill`, `charge_lines`, `fee_rate_cents`, `build_account`, `summarize_accounts`). No router, component or SQL `SUM` re-derives a total; every screen quotes it. → [billing](docs/design/billing.md)
- **An aggregate screen quotes; it does not compute.** The desk, My Shows and similar one-screen views read the builders above and post to the endpoint that already owns each job. → [desk](docs/design/desk.md)
- **A back number lives on `show_entries.back_number`, or on `show_horse_numbers` at a show that numbers horses** (`shows.back_number_per`, migration 161). Read it through `backend/backnumbers.back_numbers_for_show` — never `entries.back_number`, a legacy column nothing writes, and never `ShowEntry.back_number` directly. → [registration](docs/design/registration.md)
- **"On the roster" is `cancellations.is_on_roster`, not `registered_at`.** A cancelled registration keeps its `registered_at`. → [registration](docs/design/registration.md)
- **A show reads the exhibitor through `ShowExhibitorView`, and a registration never writes the profile.** Show data goes to that show's own copy. → [registration](docs/design/registration.md)
- **The exhibitor permission is an `exhibitors` row, not `users.role`.** Read it with `loadExhibitor()` / `canActAsExhibitor()` (`frontend/lib/exhibitor-access.ts`). → [accounts](docs/design/accounts.md)
- **Every office access check goes through `backend/show_access.py`**: a per-show row or membership of the show's company. → [companies](docs/design/companies.md)
- **A paid feature is enforced on every endpoint it gates** with `Depends(require_feature(KEY))`; a page only decides whether to offer the door. → [companies](docs/design/companies.md)
- **Flag what the desk can sort out; refuse only what nobody at the counter can produce.** Health paperwork, memberships and a horse's papers are flags, never entry gates. What refuses is the exhibitor's own missing date of birth, or a placing in a class not yet judged. → [desk](docs/design/desk.md), [registration](docs/design/registration.md)
- **A verified or attested value is never taken from the client.** The backend reads it off the record (paperwork sign-offs, attestation wording). A typed signature is the one exception. → [desk](docs/design/desk.md)
- **Results land in a draft; `classes.results_published_at` makes them public.** Scribe screens autosave into the draft, the bulk save is the only writer of `results`, and the judge's card never writes it. → [results-and-scoring](docs/design/results-and-scoring.md)
- **`classes.class_number` is published identity.** Never renumber to match a view, and never sort a schedule by discipline and division. → [show-setup](docs/design/show-setup.md)
- **`_serialize` in `routers/shows.py` builds the show payload by hand.** A new `shows` column goes into both `ShowOut` and `_serialize`, or it reads back as the default and the next save wipes it. → [show-setup](docs/design/show-setup.md)
- **Affiliations live in `associations`; `show_types` is show configuration.** OPEN is a show type with no `associations` row, and clubs (NSBA, WSCA) are not show types. → [associations](docs/design/associations.md)
- **Never invent an association's rules.** No points chart, penalty label, card division or year-end the association has not published goes into the app under its name. → [associations](docs/design/associations.md)
- **AI reading only ever suggests.** Nothing read off a document or a show bill reaches a record until a human saves it, and an unset `ANTHROPIC_API_KEY` must never stop anybody filing paperwork. → [accounts](docs/design/accounts.md), [show-setup](docs/design/show-setup.md)
- **Email is best-effort** (`backend/mailer.py` does nothing without SMTP). Every flow that mails a link also returns it for copy/paste, and nothing depends on delivery. → [accounts](docs/design/accounts.md)
- **An `EXHIBITOR` or `TRAINER` user is created together with its `exhibitors` or `trainers` row.** → [accounts](docs/design/accounts.md)
- **Horse age is derived, not stored**, and deleting a horse sets `entries.horse_id` to NULL so entry history survives.

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
npm test
npm run build
```

Run backend tests. **These must run in Docker** — the host interpreter is Python 3.9 and the backend
needs 3.10+, so `import`ing it on the host fails. `py -m compileall backend` passes anyway because it
byte-compiles without executing, which is why the compile check alone never caught this:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd)/backend:/app" -w /app \
  horse-show-results-app-backend:latest python -m pytest
```

Run everything (backend tests in Docker, then the frontend checks) from repo root:

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
- **`db.get(Model, id, options=[...])` drops the options when the row is already in the session**, and the next relationship read raises `MissingGreenlet` — a 500 with an empty body after the write committed. Re-read with `select(...).options(...).execution_options(populate_existing=True)`. **But a second `populate_existing` in the same request erases the first one's eager loads**, so where two reads share a row, put `lazy="selectin"` on the relationship instead (as `Show.show_type` is). Full story: [docs/design/conventions.md](docs/design/conventions.md).
- Authenticated frontend mutations should usually go through `frontend/app/api/` route handlers.
- Route handlers should preserve backend status codes and use `safeFetchBackend()` when `204` responses are possible.
- Never call `res.json()` on a backend response unguarded — a 500 comes back as plain text and the throw hides the real error behind an opaque parse error. Route handlers use `safeFetchBackend()`; server components use `readJsonBody()`. See `docs/frontend.md`.
- **Never set `detail` straight into a form's error state** — read it through `errorMessage(body, fallback)` (`frontend/lib/api-error.ts`). `detail` is a string from an `HTTPException` and a **list of objects** from a Pydantic 422, and rendering the second threw "Objects are not valid as a React child", taking the page down on the one response whose whole job is to be read. Step 1's date-range 422 is how a manager hit it: moving a show means typing the new start date before the new end date. See `docs/frontend.md`.
- **Never write a hex colour in a component.** Every colour is a CSS custom property in `frontend/app/globals.css`, used through the inline `style` prop (`style={{ color: 'var(--muted)' }}`). The only literals are `viewport.themeColor` in `app/layout.tsx` and `theme_color` in `public/manifest.json`, which must stay in step. See "Colour And Brand" in `docs/frontend.md`.
- **Desktop-only layout goes on the `desktop:` Tailwind variant**, which reads `<html data-layout>` — never a user-agent check, a screen-size test or a `matchMedia` branch. ADMIN, SHOW_MANAGER and SHOW_SECRETARY start on the desktop layout on every device and switch with the Mobile view button; every other role is mobile, always (`lib/layout-mode.ts`). The staff sidebar and the full-width office pages are built on it: "The Desktop Layout And The Staff Sidebar" in `docs/frontend.md`.
- **Print a time of day through `components/LocalTime.tsx`.** A server component formats in the container's zone, which is UTC, so "2:14 PM" is hours out for everybody at the show; `suppressHydrationWarning` only silences the mismatch and keeps the server's wrong text. `LocalTime` prints nothing until the browser has hydrated and then formats in the reader's own zone.
- Admin pages use `Breadcrumbs`.
- Destructive UI actions use inline confirmation, not modal overlays.
- `ConfirmDialog` exists but is no longer the preferred delete pattern.
- Disabled buttons should include a `title` explaining why they are disabled.
- The pre-commit documentation guard blocks staged implementation changes unless related docs are staged too. Bypass once with `DOCS_CHECK_BYPASS=1` only for changes with no documentation impact.

## Keeping This File Small

- **Add a line here only for a rule that applies across subsystems.** A note about one subsystem — a data model detail, a rule and its reason, a gotcha found the hard way — goes under the right heading in that subsystem's `docs/design/` file, one claim per bullet with the claim first. Workflow narrative goes in `docs/show-workflow.md`, `docs/frontend.md` and the other narrative docs.
- **Older comments say "see Claude.md" or "the Sharp Edge in Claude.md".** Those entries now live in `docs/design/`, word for word; search there for the phrase.

## Current Status

Active development. Core user management, show setup, class/entry management, the consolidated registration desk, back numbers, scribe placing entry, exhibitor dashboard/profile, APHA class import/export, AQHA class-code import/picker/validation, horse document workflows, score-driven placings (pattern/time classes), side pot management (divisional jackpots), and show financials (payment recording, balances, and the report registry) are present.
