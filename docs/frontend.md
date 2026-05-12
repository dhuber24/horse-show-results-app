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

## UI Patterns

- Admin pages use `frontend/components/Breadcrumbs.tsx`.
- Destructive actions use inline confirmation text, not modal overlays.
- Disabled buttons should include a `title` explaining why they are disabled.
- Keep admin and operational screens dense, scannable, and predictable.
- Avoid adding new uses of `ConfirmDialog`; the current convention is inline confirmation.

## Important Routes

| Route | Purpose |
| --- | --- |
| `/` | Public show list |
| `/shows/[id]` | Public show detail and scorekeeper class links |
| `/shows/[id]/classes/[classId]` | Public class results |
| `/shows/[id]/classes/[classId]/scorekeeper` | Scorekeeper placing form |
| `/scorekeeper` | Scorekeeper assigned shows |
| `/dashboard` | Exhibitor entries dashboard |
| `/profile` | User account, memberships, and horses tabbed view (`?tab=account|memberships|horses`) |
| `/profile/horses/[id]` | Exhibitor horse editing and documents |
| `/api/exhibitors/me` | Resolve exhibitor profile from signed-in user |
| `/api/exhibitors/[id]/registrations` | Exhibitor association registration CRUD proxy |
| `/api/exhibitors/[id]/documents` | Exhibitor document CRUD proxy |
| `/api/exhibitors/[id]/created-horses` | Horses created by exhibitor |
| `/api/exhibitors/[id]/linked-horses` | Non-owner horse links for exhibitor |
| `/api/exhibitors/[id]/my-horses` | Unified exhibitor horse list |
| `/api/trainers` | Trainer list/create proxy |
| `/api/trainers/[id]` | Trainer update/delete proxy |
| `/api/trainers/me` | Current trainer profile proxy |
| `/api/trainers/me/horses` | Horses linked to the current trainer profile |
| `/api/aqha-standard-classes` | AQHA standard class lookup proxy |
| `/api/aqha-standard-classes/divisions` | AQHA standard class division lookup proxy |
| `/admin` | Admin landing |
| `/admin/shows` | Admin/manager/secretary show list |
| `/admin/shows/[id]` | Show management dashboard, including AQHA approval/validation card for AQHA shows |
| `/admin/shows/[id]/setup` | Ring/division setup from standard lists |
| `/admin/shows/[id]/classes` | Class list, reorder, APHA/AQHA standard-class import |
| `/admin/shows/[id]/entries` | Entries by class |
| `/admin/shows/[id]/back-numbers` | Show-level back number assignment |
| `/admin/shows/[id]/side-pots` | Side pot list, create form |
| `/admin/shows/[id]/side-pots/[potId]` | Side pot detail: settings, opt-ins, live standings, settle, frozen payouts |
| `/admin/trainers` | Admin trainer registry management |
| `/admin/users` | User management |
| `/admin/users/[id]` | User profile, role, password, delete controls, and AQHA workshop date tracking |
| `/register/trainer` | Trainer account registration |
| `/admin/venues` | Venue management |
| `/admin/show-requests` | Admin show request review |
| `/show-requests` | Show Manager request list |

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
