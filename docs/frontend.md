# Frontend

The frontend is a Next.js 15 App Router PWA in `frontend/`.

## Key Conventions

- Pages and layouts live under `frontend/app/`.
- Route handlers live under `frontend/app/api/`.
- Shared non-route components live in `frontend/components/`.
- Shared frontend helpers live in `frontend/lib/`.
- Authentication is configured in `frontend/auth.ts`.
- Type augmentation for NextAuth lives in `frontend/types/next-auth.d.ts`.

## Backend Access

Authenticated browser actions should call a Next route handler. The route handler should:

1. Call `getAuthHeaders()` from `frontend/lib/backend-fetch.ts`.
2. Return `401` if there is no session.
3. Forward the request to FastAPI with auth headers.
4. Preserve backend status codes in the response.

Prefer `safeFetchBackend()` when the backend may return `204 No Content` or a non-JSON error.

Public spectator screens skip route handlers entirely: they are server components that call the unauthenticated helpers in `frontend/lib/api.ts` directly, so signed-out visitors are never a special case. Where such a page needs client-side interactivity over a lot of rows — searching, filtering, starring — fetch the whole set once on the server with an index endpoint (`fetchResultsIndex`, `fetchProgramIndex`) and hand it to a client component, rather than making the browser fetch per row.

## UI Patterns

- Admin pages use `frontend/components/Breadcrumbs.tsx`.
- Destructive actions use inline confirmation text, not modal overlays.
- Disabled buttons should include a `title` explaining why they are disabled.
- Keep admin and operational screens dense, scannable, and predictable.
- Avoid adding new uses of `ConfirmDialog`; the current convention is inline confirmation.
- Spectator-only preferences (starred classes on the schedule) persist in `localStorage`, not the database — these screens are used signed-out. Key them per show (`hsr:fav-classes:{showId}`), read them in an effect after mount so SSR and first client render agree, and guard the write-back so the empty pre-hydration state cannot clobber what is stored.

## Important Routes

| Route | Purpose |
| --- | --- |
| `/` | Public home: Active Shows entry button + upcoming show list |
| `/shows/active` | Public list of `ACTIVE`-status shows |
| `/shows/[id]/live` | Public active-show hub: buttons for Schedule, Results, Leaderboard, Details |
| `/shows/[id]/schedule` | Public class schedule: day tabs, per-ring grouping, live gate badges, per-class expandable program listing (back #, horse, owner, sire, dam, exhibitor), whole-show search across classes *and* entries (horse, exhibitor, owner, sire, dam, back #), and per-device starred classes |
| `/shows/[id]/results` | Public results index (posted vs awaiting) |
| `/shows/[id]/leaderboard` | Public high-point standings (placeholder — scoring model pending) |
| `/shows/[id]/details` | Public show details: venue, dates, associations, policies |
| `/shows/[id]` | Public show detail and scorekeeper class links |
| `/shows/[id]/classes/[classId]` | Public class results |
| `/shows/[id]/classes/[classId]/scorekeeper` | Scorekeeper placing form |
| `/scorekeeper` | Scorekeeper assigned shows |
| `/dashboard` | Exhibitor entries dashboard |
| `/profile` | User account, memberships, and horses tabbed view (`?tab=account|memberships|horses`) |
| `/profile/horses/new` | Add-a-horse wizard (static segment, wins over `[id]`); seeds from `?name=` / `?association_id=&registration_number=` |
| `/profile/horses/[id]` | Exhibitor horse record in four tabs — Details, People (owner/trainer/riders), Health & Documentation, Associations (`?section=details\|people\|health\|associations` selects a tab, plus the legacy `documents` alias for `health`) |
| `/api/exhibitors/me` | Resolve exhibitor profile from signed-in user |
| `/api/exhibitors/[id]/registrations` | Exhibitor association registration CRUD proxy |
| `/api/exhibitors/[id]/documents` | Exhibitor document CRUD proxy |
| `/api/exhibitors/[id]/created-horses` | Horses created by exhibitor |
| `/api/exhibitors/[id]/linked-horses` | Non-owner horse links for exhibitor |
| `/api/exhibitors/[id]/my-horses` | Unified exhibitor horse list |
| `/api/associations` | Affiliation registry (breed registries + club bodies); `?type=breed\|club` filters |
| `/api/horses/search` | Horse name / registration-number search used to link an existing horse |
| `/api/horses/registrations/lookup` | Exact association + registration-number horse lookup |
| `/api/trainers` | Trainer list/create proxy |
| `/api/trainers/[id]` | Trainer update/delete proxy |
| `/api/trainers/me` | Current trainer profile proxy |
| `/api/trainers/me/horses` | Horses linked to the current trainer profile |
| `/api/aqha-standard-classes` | AQHA standard class lookup proxy |
| `/api/aqha-standard-classes/divisions` | AQHA standard class division lookup proxy |
| `/admin` | Admin landing |
| `/admin/shows` | Admin/manager/secretary show list |
| `/admin/shows/[id]` | Show management dashboard, including AQHA approval/validation card for AQHA shows |
| `/admin/shows/[id]/setup` | Ring, division (discipline), and section (bracket) setup from standard lists |
| `/admin/shows/[id]/classes` | Class list, reorder, Schedule Builder (division × section matrix), APHA/AQHA standard-class import |
| `/admin/shows/[id]/entries` | Entries by class |
| `/admin/shows/[id]/back-numbers` | Show-level back number assignment |
| `/admin/shows/[id]/side-pots` | Side pot list, create form |
| `/admin/shows/[id]/side-pots/[potId]` | Side pot detail: settings, opt-ins, live standings, settle, frozen payouts |
| `/admin/trainers` | Admin trainer registry management |
| `/admin/users` | User management |
| `/admin/users/[id]` | User profile, role, password, delete controls, and AQHA workshop date tracking |
| `/register/trainer` | Trainer account registration |
| `/admin/venues` | Venue management |

## Validation

Run from `frontend/`:

```bash
npm run type-check
npm run lint
npm run build
```

`npm run lint` may need adjustment if the Next.js lint command changes; verify against the installed Next.js version before assuming older APIs.

## Exhibitor Profile Enhancements

- `/profile` now separates `Account`, `Memberships`, and `My Horses` into tabs via `ProfileTabs`.
- `EditAccountForm` manages user identity plus exhibitor contact/emergency/youth fields.
- `MyHorsesPanel` supports created horses, linked horses, and owner-visible horses through dedicated `/api/exhibitors/...` routes.
- `MyHorsesPanel` renders one card per horse showing sex/SPB/role badges, breed · color · age, sire/dam pedigree, owner and trainer, association registration chips, and **readiness flags**. Flags call out what would block an entry: no association registration, no Coggins on file, and documents that are expired or expiring within 45 days. Only the newest document of each type is evaluated, so a superseded Coggins does not raise a false alarm. Actions sit in their own footer row so cards stay aligned regardless of flag count.
- Readiness flags are driven by `registrations` and `documents` on `MyHorseOut` (backed by `GET /exhibitors/{id}/my-horses`). The backend only populates `documents` for horses the caller owns, matching the owner-only access rule on the horse-documents endpoints, so linked horses show registration flags only.
- "Find an existing horse" searches **by horse name or registration number** (`/api/horses/search`) or by exact association + number (`/api/horses/registrations/lookup`). Results the exhibitor already has are labeled instead of offering a duplicate link. Either search falls back to "Create new profile", carrying the typed name or registration number into the add form.
- **Add a Horse is a wizard on its own page**, `/profile/horses/new` (`AddHorseWizard.tsx`): `Owner` → `Horse` → `Trainer` → `Health` → `Registrations` → `Review`, mirroring the tab order on the horse's own page. Only the first two gate creation — a horse needs a name and an owner and nothing else — so the middle steps show a **Skip** button and Review lists every omitted field as *Skipped*. The step indicator jumps back to any cleared step, and `handleCreate` re-validates every step (not just the walk-forward) because an earlier answer may have been revised.
- The **Health** step is owner-mode only and is dropped in ride mode, because `/horses/{id}/documents` only accepts uploads from the registered owner. Since documents need a horse id that doesn't exist yet, the step queues files in component state and `handleCreate` uploads them after the horse row is created. The step list is therefore derived from `owner.mode` and all indexes into it are clamped.
- If the horse is created but a queued upload fails, the wizard sets `createdHorseId`, swaps **Create Horse** for a link to that horse's Health tab, and names the failed files. Never re-offer creation after the row exists — a retry would duplicate the horse.
- Finishing or cancelling the wizard pushes back to `/profile?tab=horses`. Do **not** add `router.refresh()` next to that push — it cancels the navigation and strands the wizard on screen after the horse has already been created; `/profile` is `cache: 'no-store'` so the push alone is enough.
- The "Create new profile" fallback from the search passes its context as query params (`?name=`, or `?association_id=&registration_number=`) for the wizard page to seed itself from.
- Step 1 asks the two-way ownership question — **"I own this horse"** or **"I ride this horse, but do not own it"**. Riding requires searching the app for the horse and its owner first; the wizard refuses to advance until the exhibitor either selects a match (which links it via `/linked-horses` and ends the wizard) or explicitly says the horse isn't in the app, which then requires owner first/last/email. Search-first is what keeps riders from creating duplicate records for horses that are already on file.
- Types plus the shared `RegChips` / `SearchResultList` live in `app/profile/horse-shared.tsx` so `MyHorsesPanel` and `AddHorseWizard` can share them without importing each other.
- Owner details entered in ride mode go to `POST /exhibitors/{id}/created-horses` as `owner_first_name` / `owner_last_name` / `owner_email` with `claim_ownership: false`. The backend links to an existing exhibitor when the email matches a user and otherwise creates a standalone owner record, so the removed "owner is already in the system" picker is still covered. The horse lands on the rider's profile via `created_by_exhibitor_id` and shows the `Created` badge, not `Owner`.
- A filter box and Name/Recently-added sort appear once the exhibitor has 4+ horses.

## Associations vs Show Types

Two different lists that are easy to confuse (see migration 080):

- **`/api/associations`** — bodies a horse or person is affiliated with, typed `breed` (AQHA, APHA, ApHC, FQHR) or `club` (NSBA, WSCA). Use this for anything storing a registration or membership number: horse registrations, exhibitor memberships, trainer affiliations, secretary certifications, association-tagged documents.
- **`/api/show-types`** — show configuration (which kind of show, which standard class catalog). Use this for show creation/setup, the class matrix, and class codes. Clubs are not show types; a club attaches to a show as *sanctioning*.

The same code can appear in both (an AQHA show and an AQHA registration are different facts). `OPEN` exists only as a show type — it means "no breed association", so it is never in the associations list, and the old `UNCERTIFIED_CODES = ['OPEN']` filters that guarded association pickers were removed as dead code.

Horse registration UI splits the two kinds:
- `MyHorsesPanel`'s add form renders two labelled sections, **Breed Registrations** and **Club Memberships**, each with its own picker and number field (`Reg #` vs `Member #`).
- The edit forms (`EditMyHorseForm`, admin `EditHorseForm` / `NewHorseForm`) use the shared `components/AssociationSelect.tsx`, which renders `<optgroup>`s for Breed Registries / Clubs, plus `AssociationTypeBadge` on each saved row.
- Registration chips on horse cards are colour-coded by type and sorted breed-first, since the breed number is the horse's primary identity at a show.
- `ExhibitorMembershipPanel` composes registrations and document-certificate management in one surface.
- `ExhibitorDocuments` supports association-tagged membership cards via nullable `show_type_id`.
- `ExhibitorRegistrations` remains the association membership number editor.

## Association Class Pickers

- APHA shows can bulk-add official APHA reference classes from `APHAClassPicker`.
- AQHA shows can bulk-add official AQHA classes from `AQHAClassPicker`, backed by `aqha_standard_classes`.
- AQHA show dashboards display validation counts from `/api/shows/[showId]/aqha-validation`; the card shows missing class-code, registration, membership, age, and approval-status issues that the backend can currently verify.
- Admin user profiles include an AQHA show-management workshop date. AQHA validation uses this date for assigned show managers and show secretaries.
- Entry create/edit forms surface association validation messages returned by FastAPI instead of a generic save failure.

## Scorekeeper Form Branching

The scorekeeper page at `/shows/[id]/classes/[classId]/scorekeeper` renders one of two forms based on the class's `score_type`:

- `placement` -> `ScorekeeperForm.tsx` - manual placing entry with tie/gap detection (default for rail and halter classes).
- `pattern` or `time` -> `ScoredScorekeeperForm.tsx` - numeric score/time input with placings derived live (highest score for `pattern`, lowest time for `time`).

Both forms save via the same `PUT /api/results` route handler; the backend recomputes derived placings server-side for pattern/time classes.

## Side Pot UI

- Side pots live under `/admin/shows/[id]/side-pots`.
- The class picker in the create/edit form hides ineligible classes when `sum_scores` is selected (only `pattern` and `time` classes qualify).
- The detail page composes purpose-built sections (Settings, Opt-ins, Standings, Settle, Payouts, Delete) from a single client component for shared state.
