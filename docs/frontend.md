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

**Never call `res.json()` on a backend response without a guard.** A backend 500 is not a JSON error
envelope — it arrives as plain text, so `res.json()` throws. In a route handler that throw becomes a
plain-text `Internal Server Error`, and in a server component it escapes the page entirely, skipping
whatever "couldn't load this" branch the page already has. Either way the real status is replaced by
an opaque `Unexpected token 'I', "Internal S"... is not valid JSON` on a screen that often has
nothing to do with the actual fault, which is a genuinely hard error to trace back to its source.

- Route handlers: use `safeFetchBackend()`, which returns `{ json, status }` and never throws.
- Server components fetching the backend directly: parse with `readJsonBody(res)` from
  `frontend/lib/backend-fetch.ts`. It returns `null` for a non-JSON (or `204`) body, so treat
  `!res.ok || json === null` as the error case and fall back to the page's own message.

Much of the existing code still calls `res.json()` unguarded; fix those as you touch them rather
than in one sweep.

Public spectator screens skip route handlers entirely: they are server components that call the unauthenticated helpers in `frontend/lib/api.ts` directly, so signed-out visitors are never a special case. Where such a page needs client-side interactivity over a lot of rows — searching, filtering, starring — fetch the whole set once on the server with an index endpoint (`fetchResultsIndex`, `fetchProgramIndex`) and hand it to a client component, rather than making the browser fetch per row.

## UI Patterns

- Admin pages use `frontend/components/Breadcrumbs.tsx`.
- Destructive actions use inline confirmation text, not modal overlays.
- Disabled buttons should include a `title` explaining why they are disabled.
- Keep admin and operational screens dense, scannable, and predictable.
- Avoid adding new uses of `ConfirmDialog`; the current convention is inline confirmation.
- Setup steps that are already configured are labelled **Edit**, not "Done" — the row is still a link, so the badge names the action rather than restating the state. Applies to the show setup hub and the class wizard's overview.
- A picker that reads from a registry shows the registry's values read-only. If the values are wrong, the fix belongs in the registry, not in the screen that consumed them — the judges step is the reference implementation.
- Secondary asks stay one line until asked for: "+ Request new sanctioned club", "+ New judge", "+ Add judge" expand their form in place rather than occupying the screen in case someone needs them.
- A long working surface (a matrix, a standard-library list) keeps its save/finish control in a `sticky bottom-0` footer. A save button below hundreds of rows is a save button users report as missing.
- Spectator-only preferences (starred classes on the schedule) persist in `localStorage`, not the database — these screens are used signed-out. Key them per show (`hsr:fav-classes:{showId}`), read them in an effect after mount so SSR and first client render agree, and guard the write-back so the empty pre-hydration state cannot clobber what is stored.
- **Schedule filters** (`ScheduleBoard`): **Favorites** is the per-device starred set above and is offered to everyone; **Registered** narrows to the classes the signed-in exhibitor is entered in and is rendered **only for `EXHIBITOR`s** — a spectator has nothing to be registered in, so the control would be permanently dead. The class ids come from the server (`/dashboard/exhibitor/{userId}`, filtered to this show) and passed in as a prop; the fetch degrades to an empty list on any failure because the schedule is a public page that has to keep working for everyone else. The two filters **intersect** rather than replace each other, and either one makes the view span all show days — your classes and the horse you are tracking do not all run on the same day. The summary line and empty state name whichever combination is active.

## Important Routes

| Route | Purpose |
| --- | --- |
| `/` | Public home: Active Shows entry button + upcoming show list |
| `/shows/active` | Public list of `ACTIVE`-status shows |
| `/shows/[id]/live` | Public active-show hub: buttons for Schedule, Results, Leaderboard, Details |
| `/shows/[id]/schedule` | Public class schedule: day tabs, per-ring grouping, live gate badges, per-class expandable program listing (back #, horse, owner, sire, dam, exhibitor), whole-show search across classes *and* entries (horse, exhibitor, owner, sire, dam, back #), and two filters — **Favorites** (per-device starred classes) and **Registered** (exhibitors only) |
| `/shows/[id]/results` | Public results index (posted vs awaiting) |
| `/shows/[id]/leaderboard` | Public high-point standings (placeholder — scoring model pending) |
| `/shows/[id]/details` | Public show details: venue, dates, associations, policies |
| `/shows/[id]` | **Signed out:** event details plus two actions — *Register for this show* and *Contact show staff*. No class schedule; someone deciding whether to enter does not need a wall of class numbers. **Signed in:** the class list as before. Exhibitors get `ExhibitorStatusBanner` reporting their own standing (see below). Public show detail and scorekeeper class links. The "Read-only — results can only be entered when the show is Active" banner is shown **only** to ADMIN / SCOREKEEPER; an exhibitor or spectator reading the class schedule has no scoring screen to be locked out of |
| `/shows/[id]/classes/[classId]` | Public class results |
| `/shows/[id]/classes/[classId]/scorekeeper` | Scorekeeper placing form |
| `/shows/[id]/contact` | Public contact form for the show office. No account needed |
| `/admin/shows/[id]/messages` | Show staff inbox for those messages (read / archive / reply by mailto) |
| `/shows/[id]/signup` | Exhibitor show sign-up — stalls, shavings, camping. Required before class registration; forwards on if already signed up |
| `/shows/[id]/register` | Exhibitor class registration. Renders a "sign up first" card until `/signup` is done |
| `/scorekeeper` | Scorekeeper assigned shows |
| `/dashboard` | Exhibitor entries dashboard ("My Show Entries") — per-show buttons to the show page and full class schedule |
| `/my-shows` | Exhibitor "My Shows": itemized bill per show (classes, NSBA sanction, office charge, stalls/shavings/camping) plus outstanding total. This is what the navbar **My Shows** button opens |
| `/horse-requests/[token]` | Approve or decline a horse link / ownership transfer. No session required — the token is the authorization |
| `/profile` | User account, memberships, horses, and show history tabbed view (`?tab=account|memberships|horses|history`) |
| `/profile/horses/new` | Add-a-horse wizard (static segment, wins over `[id]`); seeds from `?name=` / `?association_id=&registration_number=` |
| `/profile/horses/[id]` | Exhibitor horse record in four tabs — Details, People (owner/trainer/riders), Health & Documentation, Associations (`?section=details\|people\|health\|associations` selects a tab, plus the legacy `documents` alias for `health`) |
| `/api/exhibitors/me` | Resolve exhibitor profile from signed-in user |
| `/api/exhibitors/[id]/registrations` | Exhibitor association registration CRUD proxy |
| `/api/exhibitors/[id]/documents` | Exhibitor document CRUD proxy |
| `/api/exhibitors/[id]/created-horses` | Horses created by exhibitor |
| `/api/exhibitors/[id]/linked-horses` | Non-owner horse links for exhibitor |
| `/api/exhibitors/[id]/my-horses` | Unified exhibitor horse list |
| `/api/horse-access-requests` | List / create horse link + ownership-transfer requests |
| `/api/horse-access-requests/[requestId]` | Cancel a request you sent |
| `/api/horse-access-requests/[requestId]/respond` | Approve or decline while signed in as the approver |
| `/api/horse-access-requests/by-token/[token]` | Read a request from the emailed link (no session) |
| `/api/horse-access-requests/by-token/[token]/respond` | Approve or decline from the emailed link (no session) |
| `/api/shows/[showId]/register/signup` | Show sign-up read (`GET`) and save (`PUT`) |
| `/api/shows/[showId]/contact` | Send a message to the show (`POST`, no session) |
| `/api/shows/[showId]/contact/messages` | Staff inbox list |
| `/api/shows/[showId]/contact/messages/[messageId]` | Mark a message read / archived |
| `/api/my-shows` | Exhibitor's shows with itemized bills |
| (server fetch) `GET /my-shows/{show_id}` | The caller's standing at one show — signed up, back number, classes entered. Read by `/shows/[id]` via `fetchMyShowStanding()`; deliberately **not** status-scoped, so it still reports on ACTIVE and COMPLETED shows |
| `/api/associations` | Affiliation registry (breed registries + club bodies); `?type=breed\|club` filters |
| `/api/judges` | Judge registry list/create proxy — the source of judge details for show setup |
| `/api/shows/[showId]/judges` | Assign a registry judge to a show (`{ judge_id, sort_order }`) / list assignments |
| `/api/horses/search` | Horse name / registration-number search used to link an existing horse |
| `/api/horses/registrations/lookup` | Exact association + registration-number horse lookup |
| `/api/shows/[showId]/health-flags` | Entered horses whose health paperwork will not carry them through the show, worst first |
| `/api/shows/[showId]/coggins-overrides` | Historical Coggins bypasses from when health records blocked entry; empty for any show since |
| `/api/shows/[showId]/verifications/checklist` | The show's paperwork sweep, by exhibitor, with per-check status and each horse's derived health line |
| `/api/shows/[showId]/verifications` | Record a sign-off (`POST`) — subject only; the backend reads the value off the record |
| `/api/shows/[showId]/verifications/[verificationId]` | Undo a sign-off (`DELETE`) |
| `/api/shows/[showId]/exhibitors/[exhibitorId]/horses` | Show staff creating a horse for a roster exhibitor at the desk |
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
| `/admin/shows/[id]/entries` | Entries by class, plus the show's health flags — horses needing current paperwork before the show |
| `/admin/shows/[id]/check-in` | Paperwork check-in: sign off on horse age, registration papers, and membership cards physically inspected; each horse's health standing shown read-only; add a horse for a roster exhibitor |
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

- `/profile` separates `Account`, `Memberships`, `My Horses`, and `Show History` into tabs via `ProfileTabs`. The Show History tab (`ShowHistoryPanel`) reads the same `/my-shows` payload the My Shows page does, so "which shows was I part of" has one answer; each row links back to the show, its results, and its schedule.
- **`ExhibitorStatusBanner` on `/shows/[id]` reports the exhibitor's own standing before it invites them to do anything.** The page previously showed every exhibitor "Registration is open — Sign up", including someone who had just signed up and come back to it; telling a person to do a thing they have already done reads as the thing not having worked. Four states in order: **signed up** (back number, class count, links to change classes / stalls / bill — shown at any show status, since after registration closes it becomes the record of where they stand); **entered by the office but never signed up** (a `show_entries` shell row with no `registered_at` — they have classes but the office has no stall numbers, so the sign-up form is still offered); **nothing yet, registration open** (the original invitation); **nothing yet, closed**. Fed by `fetchMyShowStanding()` → `GET /my-shows/{show_id}`, which is fetched `no-store` on purpose: serving that from the data cache would put the sign-up prompt back in front of someone who just signed up, which is the bug it exists to fix.
- **Adding a horse someone else owns takes the owner's approval.** `MyHorsesPanel` handles the `409 OWNER_APPROVAL_REQUIRED` from `/linked-horses` by offering "Ask {owner} for approval" rather than dead-ending, then renders `ApprovalLinkCallout` with the link to send. Owned horses get a `HorseTransferControl` ("Transfer ownership") that offers only exhibitors with accounts — accepting a transfer requires signing in. `HorseAccessRequestsPanel` sits at the top of the tab with both directions: requests waiting on you (approve/decline in place) and requests you sent (cancel).
- `ApprovalLinkCallout` always shows the approval URL for copy and paste, whether or not the email sent. SMTP is optional in this deployment and mail lands in spam often enough that "we emailed them" is not a plan — the link on screen is the reliable path.
- **The add-a-horse wizard's ride mode drops both `ownerOnly` steps — Health *and* Trainer.** Neither answer would survive the backend: documents take the owner's permission, and so does naming a trainer. Steps that collect a value the server will discard are worse than absent, so `handleOwnerMode` also clears anything already staged under them when the mode flips. In ride mode the Review step omits the Trainer row for the same reason. When the create comes back `pending_owner_approval`, the wizard stops instead of calling `onCreated` — the horse exists but isn't on this profile yet — and shows the same `ApprovalLinkCallout` the link flow uses.
- `EditAccountForm` manages user identity plus exhibitor contact/emergency/youth fields.
- `MyHorsesPanel` supports created horses, linked horses, and owner-visible horses through dedicated `/api/exhibitors/...` routes.
- `MyHorsesPanel` renders one card per horse showing sex/SPB/role badges, breed · color · age, sire/dam pedigree, owner and trainer, association registration chips, and **readiness flags**. Flags call out what the horse still needs before it competes: no association registration, a Coggins problem, and other documents that are expired or expiring within 45 days. For the non-Coggins types only the newest document of each type is evaluated, so a superseded vaccination record does not raise a false alarm. Actions sit in their own footer row so cards stay aligned regardless of flag count.
- `HealthFlagPanel` on the admin entries page lists horses whose paperwork will not carry them through the show, worst first, with who to call and how many classes each is in. Unlike most panels it **shows a green all-clear line rather than disappearing** when there is nothing to report: "no flags" and "nobody has entered yet" would otherwise be indistinguishable, and staff need to be able to tell that the check ran.
- `CogginsOverridePanel` on the admin entries page lists **historical** Coggins bypasses from when health records blocked entry. Nothing writes those rows now, so it is empty for any show run since; it **renders nothing when the show has none**, which is the normal case. Kept so shows run under the old rule keep their audit trail.
- `HorseDocuments` takes a **`readOnly`** prop that drops the upload and remove controls, leaving list + download. Use it for show staff: `_assert_can_manage` rejects their writes regardless, so rendering the controls would only produce a 403. It is used by the "View health documents on file" toggle on `CreateEntryForm` and the per-row **Papers** toggle on the admin entries list, which are how a secretary reads a horse's health paperwork.
- **`HorseDocuments` asks for the document type once.** The list filter is a row of chips, not a select, and it seeds the upload form's type. The two used to be identical-looking dropdowns stacked in the Health section, so narrowing the list to "Coggins" and then choosing "Coggins" again to upload one read as the app asking the same question twice. The chips are hidden until there is a list to narrow, and uploading a type the list is filtered away from clears the filter — otherwise the document saves into a view that hides it, which reads as the upload failing.
- The add-a-horse wizard's Health step reads documents too, via the unattached `/api/documents/analyze` route — it stages paperwork before the horse exists, so it has no `horse_id` to analyze against. It needs no auto-upload suppression because "Add Document" is already a deliberate click. Shared labels, helpers, and the `analyzeDocument()` fetch live in [frontend/lib/document-extraction.ts](../frontend/lib/document-extraction.ts) so the two surfaces cannot drift.
- `HorseDocuments` reads the file when it is chosen and pre-fills the type and dates from the document — see [docs/document-extraction.md](document-extraction.md). Two things about the form change once a read succeeds: field labels gain a *read from document* / *check this* / *not on the document* marker, and the **auto-upload-when-complete** shortcut is suppressed in favour of an explicit **Looks right — save** button. Auto-upload stays on for values the uploader typed, and for every path where extraction did not run (unreadable scan, no API key, TIFF) — the form must keep working exactly as before whenever the shortcut is unavailable.
- **Coggins is the document every show asks after**, so `cogginsCheck()` handles it separately from the other document types and flags it `danger`. It mirrors `coggins_status()` in [backend/routers/horse_documents.py](../backend/routers/horse_documents.py) — **keep the two in step**: the card and the show office's health flags are meant to be the same verdict on the same paperwork. A horse clears only on a Coggins carrying an expiration date that has not passed; `missing`, `undated`, and `expired` each get their own message so the exhibitor knows whether to upload, add a date, or get a new test. The wording says what a show *will ask for*, not what is refused — **nothing is refused**, health paperwork does not gate entry (see [show-workflow.md](show-workflow.md#health-records--a-flag-not-a-gate)). The card is also the one place that evaluates against **today** rather than a show's last day, because it has no show in hand.
- Readiness flags are driven by `registrations` and `documents` on `MyHorseOut` (backed by `GET /exhibitors/{id}/my-horses`). The backend only populates `documents` for horses the caller owns, matching the owner-only access rule on the horse-documents endpoints, so linked horses show registration flags only.
- Adding a registration number checks `/api/horses/registrations/lookup` first, which answers **200 = already on file, 404 = clear**. Branch on that explicitly: treating any non-200 as "clear" fails open and lets a number that already belongs to another horse through when the check merely errored or the network dropped.
- "Find an existing horse" searches **by registered name, barn name, or registration number** (`/api/horses/search`) or by exact association + number (`/api/horses/registrations/lookup`). Results the exhibitor already has are labeled instead of offering a duplicate link. Either search falls back to "Create new profile", carrying the typed name or registration number into the add form.
- **Add a Horse is a wizard on its own page**, `/profile/horses/new` (`AddHorseWizard.tsx`): `Owner` → `Horse` → `Trainer` → `Health` → `Registrations` → `Review`, mirroring the tab order on the horse's own page. Only the first two gate creation — a horse needs a name and an owner and nothing else — so the middle steps show a **Skip** button and Review lists every omitted field as *Skipped*. The step indicator jumps back to any cleared step, and `handleCreate` re-validates every step (not just the walk-forward) because an earlier answer may have been revised.
- The **Health** step is owner-mode only and is dropped in ride mode, because `/horses/{id}/documents` only accepts uploads from the registered owner. Since documents need a horse id that doesn't exist yet, the step queues files in component state and `handleCreate` uploads them after the horse row is created. The step list is therefore derived from `owner.mode` and all indexes into it are clamped.
- If the horse is created but a queued upload fails, the wizard sets `createdHorseId`, swaps **Create Horse** for a link to that horse's Health tab, and names the failed files. Never re-offer creation after the row exists — a retry would duplicate the horse.
- Finishing or cancelling the wizard pushes back to `/profile?tab=horses`. Do **not** add `router.refresh()` next to that push — it cancels the navigation and strands the wizard on screen after the horse has already been created; `/profile` is `cache: 'no-store'` so the push alone is enough.
- The "Create new profile" fallback from the search passes its context as query params (`?name=`, or `?association_id=&registration_number=`) for the wizard page to seed itself from.
- The **Horse** step asks for a required **Registered name** (`horses.name` — what the horse is entered and published under) and an optional **Barn name** (`horses.barn_name`, migration 081). Both the horse card and the horse page render them as `Registered Name "Barn Name"`, and the My Horses filter matches on either.
- **Registered name is the identifier everywhere the horse is competing**; barn name is a lookup aid only. It is searchable and shown alongside the registered name, but it never replaces it and is deliberately absent from the public class schedule, published results, and the gate screen (`GateEntryOut.horse_name`) — exhibitors, judges, and show staff reference the association name during a show. When both render together, the barn name is quoted and de-emphasised so the registered name stays the primary read.
- The same registered/barn split is wired through the admin surfaces: `admin/horses/new/NewHorseForm.tsx` and `admin/horses/[id]/EditHorseForm.tsx` both take the pair, the `/admin/horses` list (`HorseList.tsx`) matches barn name in its search haystack and renders it after the registered name, and the `/admin/horses/[id]` heading does the same. Horses are created from `/admin/horses/new` or the exhibitor wizard — there is no quick-add on the show page.
- Step 1 asks the two-way ownership question — **"I own this horse"** or **"I ride this horse, but do not own it"**. Riding requires searching the app for the horse and its owner first; the wizard refuses to advance until the exhibitor either selects a match (which links it via `/linked-horses` and ends the wizard) or explicitly says the horse isn't in the app, which then requires owner first/last/email. Search-first is what keeps riders from creating duplicate records for horses that are already on file.
- Types plus the shared `RegChips` / `SearchResultList` live in `app/profile/horse-shared.tsx` so `MyHorsesPanel` and `AddHorseWizard` can share them without importing each other.
- Owner details entered in ride mode go to `POST /exhibitors/{id}/created-horses` as `owner_first_name` / `owner_last_name` / `owner_email` with `claim_ownership: false`. The backend links to an existing exhibitor when the email matches a user and otherwise creates a standalone owner record, so the removed "owner is already in the system" picker is still covered. The horse lands on the rider's profile via `created_by_exhibitor_id` and shows the `Created` badge, not `Owner`.
- A filter box and Name/Recently-added sort appear once the exhibitor has 4+ horses, **or whenever a filter is currently set**. The second condition matters: removing horses can drop the list back under the threshold, and hiding the input then would strand the list filtered with no way to clear it. The empty-result message also carries a "Clear filter" button.

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
