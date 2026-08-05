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
| Reading data off uploaded documents | `docs/document-extraction.md` |
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
| Document extraction | `backend/extraction/` |
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
- `SHOW_SECRETARY`: manages assigned shows, classes, entries, back numbers, and results administration. With `SHOW_MANAGER` and `ADMIN`, also works the desk at `/admin/shows/[id]/check-in` — signing off on registration papers and membership cards physically inspected, and creating horses for exhibitors on that show's roster.
- `SCOREKEEPER`: enters placings for assigned shows.
- `GATE_STEWARD`: runs the warm-up side of the in-gate for assigned shows via `/gate` — per-class order-of-go (`entries.gate_order`), exhibitor check-in (`entries.gate_checked_in`), and class gate progression (`classes.gate_status`: pending/ready/in_progress/done; ready is auto-set when everyone is checked in, in_progress is set by the steward when the first exhibitor enters the ring, and on-deck is derived per ring: each ring's first not-yet-started class of the day; exhibitor check-in is only open for on-deck classes, enforced server-side). The gate screen is scoped to one show day and is also accessible to ADMIN / SHOW_MANAGER / SHOW_SECRETARY. Only one class per ring may be in progress; starting a class while another runs in the same ring returns 409 and the UI asks whether the previous class finished (yes marks it done). Classes without a ring default to the show's first ring (a "Ring 1" is auto-created when the show has none). Mistake recovery: per-entry check-in undo, undo-start (in_progress → ready), reopen (done → in_progress), and a full class reset endpoint that clears all check-ins. Assigned/invited from the Show Staff page like scorekeepers.
- `EXHIBITOR`: views own entries/results, manages profile/horses, and self-registers for any `PUBLISHED` show (picks classes + horses; secretary handles back numbers and any late-add entries after the show goes `ACTIVE`).
- `TRAINER`: manages a linked trainer registry profile used on horse records.

New Show Secretary, Show Manager, Trainer, and Exhibitor registrations are currently auto-approved. The `users.is_approved` column remains as an account lock gate. Show Managers create shows directly via `/admin/shows/new`; there is no per-show approval gate.

## Core Data Concepts

- `shows`: event shell with venue, dates, primary association, status, optional APHA show number, AQHA approval metadata, `office_charge_cents` + `office_charge_basis` (`per_back_number` default, or `per_horse`), and `shavings_ban_outside` policy bool. Office charge and the policy bool surface on the exhibitor self-registration screen.
- `associations`: **the registry of bodies a horse or person is affiliated with**, typed `breed` (AQHA, APHA, ApHC, FQHR) or `club` (NSBA, WSCA) — migration 080. Everything that stores a registration or membership number points here: `horse_registrations`, `exhibitor_registrations`, `trainer_registrations`, `exhibitor_documents`, `show_secretary_certifications`. This is **not** the same concept as `show_types`: a show type is show configuration ("what kind of show is this?"), while an association is a property of the horse or person ("this horse is registered with AQHA"). The same code appears in both lists on purpose. There is no `associations` row for OPEN — Open means *no* breed association.
- `show_sanctioning`: per-show club sanctioning overlay set in setup Step 3 — `show_sanctioning(show_id, association_id, per_class_fee_cents)` referencing club rows in `associations`. Admins manage the registry; non-admin wizard users may submit `sanctioned_association_requests` for admin review. Show setup asks for a breed association (or Open) as the show type, then optional club sanctioning.
- `disciplines`: per-show **riding styles** (Halter, Western Pleasure, Trail, Barrels). Each carries `default_score_type` (`placement` / `pattern` / `time`) that new classes inherit when score_type is omitted. Renamed from `divisions` in migration 074.
- `divisions`: per-show **age/skill brackets** (10 & Under, Walk-Trot, Amateur, Youth 14-18). Each division belongs to one or more disciplines via `discipline_divisions` (M2M). A division with no discipline memberships is unusable on classes. Renamed from `sections` in migration 074.
- `discipline_divisions`: join table on `(discipline_id, division_id)`. A `(discipline_id, division_id)` pair on a class must exist as a row here — enforced by a Postgres composite FK on `classes`. The single-class create endpoint (`POST /shows/{id}/classes`) upserts the membership on demand, so any valid in-show pair is accepted; the update path still 422s on an unregistered pair.
- `standard_disciplines` / `standard_divisions` / `standard_discipline_divisions`: curated lookup lists for the setup picker; `show_type_id NULL` is the generic fallback. The OPEN class wizard fetches the AQHA + APHA shared universe and merges by name for its standard library.
- `standard_classes`: canonical per-show-type class catalog (migration 068) backing the Matrix setup picker on `/admin/shows/[id]/setup`. Each row pairs a class to a `(standard_division, standard_section)` cell via composite FK to `standard_division_sections`. AQHA is fully seeded (~1589 classes from the 2026 Class Master Listing) via `scripts/generate_aqha_standard_library_seed.py` — re-run after `database/seeds/aqha_standard_classes.csv` changes. APHA/NSBA/WSCA/ApHC seeding is upcoming Phase 2/3 work.
- `classes`: competition classes, sorted by `sort_order`. **Both** `division_id` (discipline) and `section_id` (bracket) are required (migration 061). `score_type` is `placement` (judges rank — rail/halter), `pattern` (judges score numerically — showmanship/horsemanship/etc.), or `time` (clocked event); derived from `division.default_score_type` at create time when omitted. `entry_fee_cents` is informational and surfaced on the exhibitor self-registration screen — the app does not collect payment. APHA/AQHA catalog imports auto-route class names through `backend/rules/disciplines.py`, create any missing divisions/sections, and register the (div, sec) membership. The Standard Library picker (any show type) lets the secretary check `(discipline × bracket)` cells from `standard_divisions` / `standard_sections` and commit them in one click via `POST /shows/{id}/classes/from-library`. Schedule-builder picks with no section use the per-show "Unassigned" section placeholder.
- `judges` / `judge_associations` / `show_judges`: the judge registry (migration 085). `judges` is the person — name, email, phone, identified by name + email; `judge_associations` is what they are carded with, pointing at `associations` (not `show_types`); `show_judges` is only the assignment of a registry judge to a show plus `sort_order`. Show setup **picks** a judge and displays their details read-only; corrections are made on the registry (admin-only `PATCH /judges/{id}`) so one fix reaches every show that judge works.
- `class_associations`: association-specific codes for a class, useful for dual-sanctioned shows.
- `aqha_standard_classes`: official AQHA class-code lookup used by the AQHA picker and validation.
- `entries`: class-level exhibitor/horse registrations.
- `show_entries`: show-level exhibitor record — back number, plus show sign-up (migration 088). `registered_at` set means the exhibitor completed sign-up; NULL means it is a shell row a secretary created while adding a late entry by hand. **Class self-registration requires a completed sign-up** and returns `409 SHOW_SIGNUP_REQUIRED` otherwise.
- `show_entry_reservations`: how many of each `show_fees` row an exhibitor booked at sign-up (stalls, bags of shavings, camping nights). Points at the fee catalog rather than restating those as columns; which fees are reservable is derived from the fee's `unit` (`per_stall` / `per_bag` / `per_night`), so a show's own custom per-stall fee is offered with no code change.
- `horse_access_requests`: consent, pending, for a horse changing hands (migration 087). `kind='link'` is someone asking the owner to put their horse on that person's profile; `kind='transfer'` is the owner handing ownership over, which the recipient must accept. `approver_exhibitor_id` is always whoever must press the button, so approve/decline is one code path. The token is emailed **and** shown for copy/paste — see the mailer note in Sharp Edges.
- `results`: placings. For `pattern`/`time` classes, `raw_score` is the source of truth and `place` is recomputed server-side on every change.
- `result_audit`: placing change history (placement classes only — derived placings are not audited).
- `coggins_override_audit`: one row per effective show-staff bypass of the Coggins entry gate (migration 082) — horse, which failure was bypassed, who did it, when. Written in the same transaction as the entry it describes.
- `show_verifications`: what the show office **physically inspected** at the desk (migration 090). One table, three `kind`s — `horse_age` (foaling date on the papers), `horse_registration` (a registration number, per association), `exhibitor_membership` (a membership card, per association) — because the actor, the question, and the staleness rule are identical. Per show on purpose: this is a show attesting its own office saw the paper, not a permanent property of the horse or person. `verified_value` snapshots what was on file at sign-off, so a later edit flips the check to stale instead of leaving it green. Records only; nothing here gates entry.
- `document_extractions`: one row per AI read of an uploaded horse document (migration 083) — what the model suggested (`extracted`), what the human saved (`accepted`), and which suggestions they changed (`overridden_fields`). Written *before* the document is saved and linked to it on save, in the same transaction. `horse_id` is nullable (migration 084) because the add-a-horse wizard reads documents before the horse exists; it is attached on save. See `docs/document-extraction.md`.
- `side_pots` / `side_pot_classes` / `side_pot_entries` / `side_pot_payouts`: optional money pool spanning multiple classes; opt-ins per back number, payouts written on settle.
- `users`: login accounts and roles. First/last name are the editable source of truth; `full_name` is a derived display compatibility field.
- `exhibitors`: person/profile records, optionally linked to users.
- `horses`: horse records with owner/trainer text, free-text `sire_name`/`dam_name` pedigree (migration 079), breed/color, registrations, documents, and APHA SPB flag. `name` is the **registered (association) name** and is required — it is what the horse is entered and published under; `barn_name` is the optional stable/call name (migration 081). Owner + sire + dam are the program columns shown on the public class schedule and the admin entry list.
- `exhibitor_registrations`: exhibitor membership numbers per association.
- `backend/rules`: association-specific validation hooks; AQHA currently enforces the first practical validation slice.
- `users.aqha_management_workshop_completed_at`: AQHA show-management workshop date used to validate assigned managers/secretaries.
- `trainers`: trainer registry; first/last name mirror the linked user when present, and derived `name` remains for trainer-list display. Carries private contact, public ad-ready profile (`business_name`, location, `website`, `bio`, socials, `is_public`), compliance dates (`safesport_completed_at`, `background_check_expires_at`), and a self-attested `has_liability_insurance` flag.
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

- Document extraction only ever *suggests*. Nothing read off a scan reaches `horse_documents` without a human pressing save — `horse_documents.expiry_date` is what the Coggins entry gate checks, so a misread date would silently admit or block a horse. The upload form's auto-upload-when-complete shortcut is deliberately suppressed once a document has been read.
- `ANTHROPIC_API_KEY` is optional. Unset (or an API outage, or an unreadable scan) degrades the upload form to manual entry, which is how it worked before extraction existed. Extraction must never be the reason someone can't file paperwork.
- Money is computed in one place: `build_bill()` / `office_charge_total_cents()` in `backend/billing.py`. The class-registration screen, the sign-up screen, and the My Shows bill all read it, and `shows.office_charge_basis` is honoured there (`per_back_number` = one charge for the exhibitor, `per_horse` = × distinct horses). Do not re-derive a total in a router or a component.
- Email is best-effort and optional. `backend/mailer.py` returns `None` when `SMTP_HOST` is unset and never raises. Every flow that mails a link must also return that link for copy/paste — an undelivered email must never be the reason a horse can't change hands or a request can't be answered.
- A paperwork verification is never taken from the client. `POST /shows/{id}/verifications` accepts the *subject* only; the backend reads the current value off the record and stores that. A caller able to name the value it "verified" could attest to a number nobody has on file. For the same reason `verified_value` is a snapshot, not a live join — that is the whole staleness mechanism.
- Show staff creating a horse for an exhibitor is scoped to that show's roster, not to staff rank. `POST /shows/{id}/exhibitors/{exhibitor_id}/horses` 403s unless the exhibitor has a `show_entries` row or a class entry at that show. The horse is owned by the exhibitor and linked via `exhibitor_horses` — ownership alone does not put it on their profile list, which reads `created_by_exhibitor_id` **or** a link row.
- Linking a horse someone else owns is not a one-click action. `POST /exhibitors/{id}/linked-horses` only links outright when `horses.owner_exhibitor_id IS NULL`; otherwise it returns `409 OWNER_APPROVAL_REQUIRED` and the caller goes through `horse_access_requests`.
- Judge details are not per-show data. `show_judges` carries no name or contact columns since migration 085 — read them through `judge`, and resist re-adding a per-show copy "just for this screen".
- Do not create an `EXHIBITOR` user without also creating the linked `exhibitors` row.
- Do not create a `TRAINER` user without also creating or linking the matching `trainers` row.
- `cert_org_users.Org` uses a capital `O`.
- `OPEN` is an unaffiliated **show type** only. Since migration 080 it has no `associations` row at all, so it can no longer leak into certification or registration-number pickers — the old `UNCERTIFIED_CODES = ['OPEN']` guards were removed as dead code. Do not re-add OPEN to `associations`.
- Do not reach for `show_types` when you mean an affiliation. Registration/membership numbers belong to `associations` (breed or club); `show_types` is show configuration. Clubs (NSBA, WSCA) are deliberately **not** show types — an NSBA-approved show is an OPEN or breed show carrying NSBA sanctioning via `show_sanctioning`.
- Horse age is derived, not stored.
- Deleting a horse preserves entry history by setting `entries.horse_id` to `NULL`.
- The repo has historical duplicate migration numbering around `024_*`; preserve filenames and ordering behavior.
- `ConfirmDialog` exists but is no longer the preferred delete pattern.
- `classes.score_type` is derived from `division.default_score_type` at create time when not explicitly set. APHA/AQHA bulk imports and the free-text class-list importer are **auto-routed** via [backend/rules/disciplines.py](backend/rules/disciplines.py): the class name is classified by ordered keyword match into a discipline (Division) with a default `score_type`. For APHA/AQHA catalog imports the std-class `division` column is used as the section (bracket); for pasted class lists the secretary can provide a default bracket or per-line bracket using `Class Name | Bracket`. Divisions/sections are created on the fly and the (div, sec) membership is registered. Anything the classifier can't match (currently 0% of AQHA/APHA std classes) falls back to "Unassigned". Side pots with `sum_scores` only see `pattern`/`time` classes.
- Migration 061 made `classes.division_id` and `classes.section_id` NOT NULL and enforces `(division_id, section_id)` membership in `division_sections` via a composite FK. Code that creates a class must either provide a valid pair or call `_get_or_create_unassigned()` from `routers/classes.py`. Removing a section from a division it still has classes in returns 409.
- Migration 048 dropped `class_templates` and the `category` concept; "Division = discipline" and "Section = bracket" are the canonical vocabulary. Per-show `divisions` rows that pre-date 048 may still contain bracket-named entries — secretaries clean those up in the Setup UI.
- For `pattern`/`time` classes the scorekeeper enters `raw_score` and the backend recomputes `place` and `is_tie` for every result in the class on insert/update/delete. Audit rows are only written for `placement` classes.
- Settling a side pot is irreversible — `status` flips to `settled`, payouts are written, and edits/deletes are blocked.

## Current Status

Active development. Core user management, show setup, class/entry management, back numbers, scorekeeper placing entry, exhibitor dashboard/profile, APHA class import/export, AQHA class-code import/picker/validation, horse document workflows, score-driven placings (pattern/time classes), and side pot management (divisional jackpots) are present.
