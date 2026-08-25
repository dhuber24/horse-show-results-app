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

**This is now enforced, not aspirational.** Every route handler in `frontend/app/api/` goes through
`safeFetchBackend()`, and a CI step fails the build if a new one calls `fetch()` directly. The five
exceptions are allowlisted in `.github/workflows/ci.yml`: they stream a non-JSON body (a CSV export,
a document download, a headshot) and so cannot use a JSON helper, and each guards its own error path.
If you are adding a handler that returns JSON, there is no reason to reach for `fetch()`.

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
| `/shows/[id]/live` | Public active-show hub: buttons for Schedule, Results, Leaderboard, Show Bill, Details |
| `/shows/[id]/schedule` | Public class schedule: day tabs, per-ring grouping, live gate badges, per-class expandable program listing (back #, horse, owner, sire, dam, exhibitor), whole-show search across classes *and* entries (horse, exhibitor, owner, sire, dam, back #), and two filters — **Favorites** (per-device starred classes) and **Registered** (exhibitors only) |
| `/shows/[id]/results` | Public results index (posted vs awaiting) |
| `/shows/[id]/leaderboard` | Public high-point standings (placeholder — scoring model pending) |
| `/shows/[id]/details` | Show details: venue, dates, show type, **club sanctioning**, shavings policy. Below the facts card it renders the **show bill** — judges, class schedule, fee schedule, rules — via the shared `ShowbillDocument` with `embedded` (which drops the masthead and *The show* section, since the card above restates them). Nothing on this page is reader-specific: the balance and the link to your own entries both moved off it, to the **What I Owe** tile and the registration screen |
| `/shows/[id]/showbill` | The **printable** show bill — the same `ShowbillDocument` Show Details renders inline, plus a masthead and a print stylesheet. **Download / print show bill** is `window.print()`, so every browser's Save-as-PDF produces the document; a second button saves the class list as CSV for spreadsheet work. Not a tile on the exhibitor hub: reading the bill happens on Show Details, and printing it is an errand rather than a menu item. Still linked from `/live` and from the foot of Show Details |
| `/shows/[id]/my-bill` | One show's itemized bill for the signed-in exhibitor — class lines with horse names, reservations, office charge, total. Reads `GET /my-shows/` via `loadMyShowBill()` and picks this show out of it, so the number is byte-for-byte the one on My Shows. The headline is the shared `DueAtShow`, the same component Show Details puts above the link down to here |
| `/shows/[id]` | **Signed out:** event details plus two actions — *Register for this show* and *Contact show staff*. No class schedule; someone deciding whether to enter does not need a wall of class numbers. **Signed in and unable to score:** `ExhibitorShowHub` — `ExhibitorStatusBanner` over tiles, ordered about-me first: Sign Up / My Registration, **What I Owe** (only with a standing at this show, and not gated on registration being open — the bill outlives it), then Class Schedule, Show Details (which now carries the show bill inline), Results, and Message the Show Office. **ADMIN / SCRIBE:** the class list, because for them each row is a link into a scribe screen. The "Read-only — results can only be entered when the show is Active" banner is shown **only** to ADMIN / SCRIBE; an exhibitor or spectator reading the class schedule has no scoring screen to be locked out of |
| `/shows/[id]/classes/[classId]` | Public class results |
| `/shows/[id]/classes/[classId]/scribe` | Scribe placing form |
| `/shows/[id]/contact` | Contact form for the show office. No account needed — but a signed-in sender gets their name and email prefilled, is told the office will see who they are, and has the message stamped with their identity server-side |
| `/admin/shows/[id]/messages` | Show staff inbox for those messages (read / archive / reply by mailto) |
| `/shows/[id]/signup` | Exhibitor show sign-up — stalls, shavings, camping, via the shared `ReservationFields`. Required before class registration; forwards on to `/register` when saved. Once signed up, also carries `WaiverSignatures` — the entry blank and releases, read and signed here. The same editor is folded into `/register`, so this route is the door people are pointed at rather than the only way in |
| `/admin/shows/[id]/setup/paperwork` | Redirects to `/desk/paperwork` — paperwork is a registration question, not a setup step |
| `/admin/shows/[id]/desk/paperwork` | **Paperwork Requirements** — which health documents this show requires and the waivers exhibitors sign. Reached from a button on the registration desk, because the desk is what reads it |
| `/shows/[id]/register` | **My Registration** — everything an exhibitor signs up for at one show, in two collapsible `RegistrationSection`s over the running bill. *Classes & back number* holds the back-number request, the entered-class table, the desk's one-class-at-a-time entry form, and the horses needing health records; *Stalls, shavings & camping* holds the shared `ReservationFields`. The classes half is **locked shut** until sign-up is complete (back numbers and entries both 409 without it) and names the section to fill in first. Reads two payloads: `/register/preview` and `/register/signup` |
| `/scribe` | Scribe assigned shows |
| `/dashboard` | Exhibitor entries dashboard ("My Show Entries") — per-show buttons to the show page and full class schedule |
| `/my-shows` | Exhibitor "My Shows": itemized bill per show (classes, NSBA sanction, office charge, stalls/shavings/camping). No roll-up across shows — the office collects per show, against a back number, so the total lives on each show's Details page. This is what the navbar **My Shows** button opens |
| `/horse-requests/[token]` | Approve or decline a horse link / ownership transfer. **A session is required, as the approver** — four branches: 401 offers sign-in carrying `?next=` back here, 403 explains who has to open it, 404 is a bad or withdrawn link, 200 is the decision card. The token names the request; it does not authorize the answer |
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
| `/api/horse-access-requests/by-token/[token]` | Read a request from the emailed link. Forwards the session when there is one; the backend 401s without it |
| `/api/horse-access-requests/by-token/[token]/respond` | Approve or decline from the emailed link, signed in as the approver |
| `/admin/shows/[id]/financials` | Show-office money **summary**: billed / collected / outstanding / settled, plus side pot money (reported separately). Two buttons lead to the working screens — **Exhibitors** (carrying an "N owing" badge) and **Reports**. Registration counts and revenue-by-category are deliberately *not* here — both are reports. Show-office tier only — not `SCRIBE` or `GATE_STEWARD` |
| `/admin/shows/[id]/financials/exhibitors` | Per-exhibitor accounts: itemized bill, payment history, and the record-a-payment form. The list the office scrolls and types into, kept off the summary so the totals stay readable at a glance |
| `/admin/shows/[id]/financials/reports` | Report index, listed from the backend registry rather than hardcoded here |
| `/admin/shows/[id]/financials/reports/[slug]` | One report, rendered generically from the columns/rows the backend returns, with CSV export and print |
| `/api/shows/[showId]/payments` | Record a payment (`POST`) or list the show's payments (`GET`) |
| `/api/shows/[showId]/payments/[paymentId]` | Remove a payment recorded in error (`DELETE`) |
| `/api/shows/[showId]/register/signup` | Show sign-up read (`GET`) and save (`PUT`) |
| `/api/shows/[showId]/contact` | Send a message to the show (`POST`, no session) |
| `/api/shows/[showId]/contact/messages` | Staff inbox list |
| `/api/shows/[showId]/contact/messages/[messageId]` | Mark a message read / archived |
| `/api/my-shows` | Exhibitor's shows with itemized bills |
| (server fetch) `GET /my-shows/{show_id}` | The caller's standing at one show — signed up, back number, classes entered, required waivers still unsigned. Read by `/shows/[id]` via `fetchMyShowStanding()`; deliberately **not** status-scoped, so it still reports on ACTIVE and COMPLETED shows |
| `/api/shows/[showId]/waivers` | List (with the caller's own signature attached) / create |
| `/api/shows/[showId]/waivers/[waiverId]` | Edit wording or required-ness / delete (cascades to signatures) |
| `/api/shows/[showId]/waivers/[waiverId]/signature` | The exhibitor signing for themselves |
| `/api/shows/[showId]/exhibitors/[exhibitorId]/waivers/[waiverId]/signature` | Staff recording a paper blank / undoing one |
| `/api/horses/[id]/documents/[docId]/view` | The document served **inline** for the desk's side-by-side viewer. Same bytes and access rules as `/download`; only the `Content-Disposition` differs, plus `Cache-Control: private, no-store` |
| `/api/associations` | Affiliation registry (breed registries + club bodies); `?type=breed\|club` filters |
| `/api/judges` | Judge registry list/create proxy — the source of judge details for show setup |
| `/api/shows/[showId]/judges` | Assign a registry judge to a show (`{ judge_id, sort_order }`) / list assignments |
| `/api/shows/[showId]/managers` | Show Manager assignments — list / assign a co-manager. `DELETE .../managers/[userId]` unassigns, and **409s on the last one**: a manager reaches a show through `show_managers` and nothing else |
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
| `/admin/shows/[id]/setup` | Setup hub — the six-step checklist, each row linking to its step |
| `/admin/shows/[id]/edit` | **Setup Step 1** — show details plus `ShowStaffPanel`: managers, secretaries, scribes, gate stewards. Who runs the show is set beside its name and dates, not on a screen of its own |
| `/admin/shows/[id]/staff` | Redirects to `/edit` |
| `/admin/shows/[id]/classes` | **Setup Step 6** — class list, reorder, Schedule Builder (division × section matrix), APHA/AQHA standard-class import. Renders inside `StepLayout`; the route is unchanged so per-class deep links still work |
| `/admin/shows/[id]/desk` | **Registration Desk** — one screen, one exhibitor at a time: back number, class entries, side pot buy-ins, paperwork check-in, and their running balance. Second tab is the by-class program listing, where an expanded class can be filled without leaving the screen. Replaces `/entries`, `/check-in`, and `/back-numbers`, which all redirect here |
| `/admin/shows/[id]/entries` | Redirects to `/desk` |
| `/admin/shows/[id]/check-in` | Redirects to `/desk` |
| `/admin/shows/[id]/back-numbers` | Redirects to `/desk` (the per-class sheet at `classes/[classId]/back-numbers` is a different tool and is unchanged) |
| `/admin/shows/[id]/side-pots` | Side pot list, create form — reached from its own **Side Pots** tile on the show dashboard |
| `/admin/shows/[id]/side-pots/[potId]` | Side pot hub: status, pool figures, and buttons to the three working screens |
| `/admin/shows/[id]/side-pots/[potId]/settings` | Buy-in, payback, scoring, eligibility, and the bundled class picker |
| `/admin/shows/[id]/side-pots/[potId]/entries` | Side Pot Entries: add an exhibitor from the show roster, and see who is in |
| `/admin/shows/[id]/side-pots/[potId]/standings` | Live ranking, projected payouts, Settle, and the frozen payout sheet |
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
- **The desk takes an emergency contact over the counter.** A missing contact is a button, not just a warning — staff type a name and number and it goes onto the exhibitor's profile. Save is disabled until both are filled, because one without the other saves successfully and still reads as missing, which looks exactly like the save having failed. An existing contact gets *Change* and a *Clear*.
- **The desk panel states each money figure once.** Billed / paid / owing live on the summary row under the exhibitor's name, alongside the *Record a payment* link. An Account section at the foot of the panel used to repeat all three; both read the same `build_account` payload, so it was never wrong, just a second place to look. Paid stayed when the section went — billed and owing cannot answer "how much have they already given us?", which is the question at a counter.
- **The registration desk shows the document beside the checkbox.** `DocumentViewer` renders a horse's uploaded scan — PDFs in an `<iframe>`, images in an `<img>`, anything else as a download link rather than a broken box — and opening one splits the horse card into two columns so the sign-off and the paper are on screen together. The case it exists for is the exhibitor who uploaded a perfectly good Coggins and left the printout at home: staff could always download the file, but downloading a stranger's veterinary paperwork onto the office laptop to read it is not the same thing. One document open at a time across the panel; there is a queue behind the desk.
- **A pattern class can take two horses on the registration screen.** `RegisterShowForm` keeps `class_id -> horse_id[]` rather than one horse per class: a pattern class is scored run by run, so one exhibitor showing two horses in showmanship is two entries at two fees. One select per horse chosen plus a trailing *add another horse* select while a spare horse remains; non-pattern classes get exactly one. Totals iterate the flattened entry list, never the selected classes — summing per class was correct only while a class could hold one horse, and would have under-charged silently.
- **`HealthCheckRow` shows two pills, not one.** A health line carries what the documents on file say *and* whether anyone has physically looked at the paper, because those can disagree in both directions. The sign-off is never blocked by "nothing on file" — an exhibitor handing over a paper the app has never seen is the ordinary case, and a checkbox that refused it would be useless exactly there.
- **Inspecting a document the file does not cover asks for its expiry date.** *I inspected it* expands one date field: fill it in and the horse stops showing as outstanding, leave it blank and the inspection is recorded with the horse still flagged. That is the only way an inspection can clear a flag honestly — the office having looked at a paper says nothing about whether it has expired. A line cleared this way is labelled *(on paper)* with "Not uploaded — this show is covered by the office having seen it", because the app holds no scan and the next show will ask again.
- **`WaiverRow` lets staff type the name off a paper blank.** Everywhere else a sign-off reads its value off the record so a caller cannot attest to something nobody has on file; a signature has nothing to be read from, so this one is typed. `on_paper` is set by the endpoint rather than the form, so the two routes into `show_waiver_signatures` stay distinguishable.
- `HorseDocuments` takes a **`readOnly`** prop that drops the upload and remove controls, leaving list + download. Use it for show staff: `_assert_can_manage` rejects their writes regardless, so rendering the controls would only produce a 403. It backs the per-row **Papers** toggle on the admin entries list; at the desk, `DocumentViewer` does the same job beside the sign-off it belongs to.
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

## Scribe Form Branching

The scribe page at `/shows/[id]/classes/[classId]/scribe` renders one of two forms based on the class's `score_type`:

- `placement` -> `ScribeForm.tsx` - manual placing entry with tie/gap detection (default for rail and halter classes).
- `pattern` or `time` -> `ScoredScribeForm.tsx` - numeric score/time input with placings derived live (highest score for `pattern`, lowest time for `time`).

Both forms save via the same `PUT /api/results` route handler; the backend recomputes derived placings server-side for pattern/time classes, ranking within each judge's card. Both also carry a per-judge card selector — see [Per-Judge Placings](#per-judge-placings).

### Finished Classes On The Show Page

For a scribe or admin on an `ACTIVE` show, `CLOSED` classes fold into a `<details>` — "13 finished classes — show" — above the classes still to score. `<details>` rather than a client component, because the page is server rendered and the toggle needs no JS.

They are folded, never dropped. Two reasons: a scribe correcting a placing on a class that has already been posted has to be able to reach it, and a list that silently begins at class 14 reads like broken numbering rather than a filter. **Class numbers are never renumbered to suit a filtered view** — they are published in the show program and on entry forms, so `class_number` has to mean the same thing to everyone looking at it.

The list keeps itself current via `components/AutoRefresh.tsx`, mounted only in this case (staff + `ACTIVE`): classes close underneath the scribe as the gate steward works through the day, and a class that has just finished should roll into the folded group without a manual reload. It polls `router.refresh()` on a 20s interval, **stops while the tab is hidden** (a tablet parked at the in-gate would otherwise poll till the battery died) and **refreshes immediately on becoming visible again**, which is the moment the screen most needs to be current. `router.refresh()` reconciles rather than remounting, so an expanded `<details>` stays expanded across a refresh. Do not mount it on a show that is not running — nothing moves there.

### Autosave And The Publish Gate

Neither form has a Save button any more. Both share three pieces in the same directory:

- `useAutosave.ts` — debounced (1.5s settle) commit of the whole class through the existing bulk PUT. **Single-flight**: the bulk save deletes every row for the class and reinserts, so a second request arriving mid-flight is queued rather than raced. Seeded with the server's own state, so opening a class never writes to it. A failed save holds `status: 'error'` on screen with the typed values intact — it must never drop a score silently.
- `PublishBar.tsx` — the save indicator plus **Post Results to Live**. Until posted, results are a draft only show staff can read.
- `TouchScorePad.tsx` — docked finger entry, one layout per score type.

The gate is what makes autosave safe. Results publish straight to the public `/live` and `/results` screens, and a placement card is full of gaps until the last horse is entered — autosaving without a gate would broadcast wrong placings at the rail. This is also why the **gap warning moved from Save to Post**: mid-entry gaps are normal now, so warning on every keystroke would be noise.

`fetchResults(showId, classId, headers?)` takes optional staff headers. Pass them from any staff screen — the backend returns `[]` for an unposted class to anyone else, so a scribe screen that omits them renders a blank card over a draft it is halfway through typing.

### Per-Judge Placings

A class is placed once **per judge** (migration 095). Both scribe forms hold one
card per judge in state and show `JudgeTabs.tsx` above the table; the tab strip
hides itself entirely when there is one card, which is every single-judge show.
`judges.ts` holds the shared card model — cards are keyed by a *card key* rather
than a raw judge id so the unattributed card (`__none__`, a show with no panel
assigned) is a first-class case instead of a `null` threaded through every
lookup.

Three things make this safe, and all three are load-bearing:

- **The bulk PUT replaces one judge's card, not the class.** `judgeId` rides on
  the request envelope and scopes the backend's delete. Without it, each
  scribe's autosave would wipe every other judge's placings 1.5 seconds after
  they were typed.
- **`save` receives the debounced snapshot** rather than reading current state.
  Switching cards inside the 1.5s settle window would otherwise post the newly
  opened card in place of the edit that scheduled the save.
- **Switching cards flushes first**, and `useAutosave`'s `baselineKey` then
  adopts the incoming card as already-committed. Without the flush the outgoing
  card loses an unsettled keystroke; without the baseline, merely reading
  another judge's tab writes it back.

The public class page renders the cards **side by side** — one column per judge
who has filed, back number / exhibitor / horse on the left. Judges who have not
filed are left off rather than shown as a column of dashes. Rows default to mean
placing across the cards purely so the sheet reads top-down; the page says so in
as many words, because the app does not judge and **does not compute an official
combined result**. Cards disagree, and the first row is not a winner.

`PlacingsTable.tsx` is a client component because **every column sorts** — click
a heading, click again to reverse. With a panel the useful question is usually
"read me judge 2's card in order" or "find back number 112", and the default
order answers neither. Two rules in the comparator:

- An entry with no placing in the sorted column is **unplaced, not last**, so it
  stays at the bottom in both directions instead of jumping to the top when the
  sort is reversed.
- Ties fall back to back number, so the order is stable rather than
  implementation-defined.

The rosette's petal coordinates are **rounded** at module scope. Raw
`Math.cos`/`Math.sin` output serializes to a different number of significant
digits on the server than in the browser (`27.2583302491977` vs
`27.258330249197698`), which React reports as a hydration mismatch on every
rosette once the table is a client component. This cost nothing while the table
was server-only, and is easy to reintroduce by computing SVG geometry inline.

The colour legend that used to sit under this table is gone: it named eight
ribbon colours the rosettes already show, and it does not survive multiplication
by a panel of judges.

`GET /shows/{id}/judges/public` backs the column labels — names and running
order only, no auth. Who judged a show is program information printed on the
show bill; email and phone stay on the staff endpoint.

### Touch Entry

Rows are tap-selectable and every input carries `inputMode="none"`, so the OS keyboard never opens over the docked pad. Selecting a row scrolls it to centre — the pad sits over the bottom of the table, and "Next horse" walks down the list behind it otherwise. Targets are ≥44px.

| `score_type` | Pad layout |
| --- | --- |
| `placement` | Grid of 1..N places; places held by other rows render as used. One tap assigns and advances. |
| `pattern` | `−1 / −0.5 / +0.5 / +1` steppers. An empty field steps from **70** — the base score every AQHA/APHA pattern run starts from — so a typical score is one or two taps. Digits fold away behind `123`. |
| `time` | Digit keypad. Stepping to 17.842 in increments is not usable. |

## Side Pot UI

- Side pots live under `/admin/shows/[id]/side-pots`, entered from the **Side Pots** tile on the show dashboard. They are **not** part of the fee schedule: a side pot is money the office takes at the desk and standings it reads between classes, where the fee schedule is what the show publishes in advance. The tile used to live on `/admin/shows/[id]/fees`, which the setup-wizard rebuild left with nothing linking to it — side pots went unreachable and nobody noticed, because the pot pages themselves still worked if you had the URL.
- The class picker in the create/edit form hides ineligible classes when `sum_scores` is selected (only `pattern` and `time` classes qualify).
- **The pot page is a hub, not a stack.** `[potId]` reads — status, pool figures, how it scores — and three buttons lead to **Settings**, **Side Pot Entries**, and **Standings**. It was one scroll of every section, which meant ticking "paid" for the last exhibitor to hand over cash took a trip past the whole class picker. Same split, and the same `NavCard`-over-tiles shape, as Financials.
- **The role is called "Side Pot Entries", not "Opt-ins".** Staff call it entering a pot. `entries` already means class entries in this app, which is why the pot list was hedged as "opt-ins" — the fix is the qualifier, not a second word for the same act. The **entry fee** is the **buy-in** for the same reason: "entry fee" next to "entries" reads as the class fee.
- **You add an exhibitor to a pot by name, not by back number.** The picker lists the show roster from `GET .../side-pots/{potId}/roster` and posts `show_entry_id`, which is what the row points at anyway. Typing a number that had not been assigned returned a 404 that read like the pot was broken, and the desk thinks in people. Whoever is already in is filtered out of the options client-side, from live state — so a removal restores that option instantly, and the backend's duplicate-409 is unreachable from the UI. Roster rows with no back number yet are offered too, labelled as such; standings resolve the number live, so it fills itself in later.
- **There is no "paid" tick.** Buy-ins settle with the exhibitor's bill at the end of the show, so being in the pot *is* owing the buy-in and `SidePotEntryCreate.paid` defaults to true. The panel still counts `paid` rather than `entries.length` when it quotes the pool, so it can never disagree with the backend, and it calls out any pre-change unpaid row instead of leaving it silently missing from the total.
- **Settle lives on Standings**, not on the hub. It is irreversible and it freezes exactly the table rendered above the button, so reviewing the ranking and committing it are one motion. Once settled, the standings table drops its projected-money column — the frozen payout sheet below it is the authority, and a live-recomputed column beside it could quietly disagree after a results correction.
- **Each sub-screen repeats the way back at its foot** (`BackToPot`). The breadcrumb's "← Back to {pot}" is at the top of the page, and standings, payouts, and a full roster of entries all run past a screenful — so it has scrolled away exactly when someone has finished and wants out. Same link, same wording, no history dependence: it points at the pot hub whether the screen was reached from the hub or from a bookmark.
- Types, the status pill, the breadcrumb trail, and `potMoney()` live in [side-pots/pot-shared.tsx](../frontend/app/admin/shows/[id]/side-pots/pot-shared.tsx); the server reads live beside it in [side-pots/loadPot.ts](../frontend/app/admin/shows/[id]/side-pots/loadPot.ts), one loader per slice so the Settings screen does not pull standings it will not draw.
- `potMoney()` mirrors `billing.side_pot_money()`, floor included. It exists for the Entries screen, where the pool has to move as boxes are ticked without a round trip; `GET /standings` returns the same figures server-side and the Standings screen quotes those.

## Financials UI

Types live in [frontend/lib/financials.ts](../frontend/lib/financials.ts), which **imports `Bill` and `formatMoney` from `lib/my-shows`** rather than restating them. The point of computing money in `backend/billing.py` is that the exhibitor's bill and the office's view of it are the same object; a second local copy of the type is how that stops being true.

Three pages, one payload. `loadFinancials()` in [financials/loadFinancials.ts](../frontend/app/admin/shows/[id]/financials/loadFinancials.ts) is shared by the summary and the Exhibitors page rather than duplicated in each — two loaders would be two chances for the summary tiles and the account rows they drill into to disagree.

- **The summary is a summary.** Per-exhibitor accounts live on their own page, reached by the **Exhibitors** button. Sitting them under the totals meant every visit scrolled past every exhibitor at the show to reach the side pot block. The button carries an "N owing" badge, since "who do I still need to chase" is the reason staff open the page — same pattern as the unread badge on the Messages tile.
- **Nothing is duplicated between the summary and the reports.** Registration counts and revenue-by-category were both on the summary and both already reports (`registrations`, `revenue-summary`), where they can also be printed and exported. Two copies meant two places to keep telling the same story, so the summary keeps only the headline money figures.
- **Figures refresh themselves** via `<AutoRefresh />`: `router.refresh()` on window focus / tab visibility, plus a 30s interval **while the tab is visible** (paused when hidden, so a forgotten tab is not polling the whole rollup all afternoon). Recording a payment already refreshes explicitly and navigation already refetches — what this covers is a screen left *open* while money is taken at another desk. `router.refresh()` preserves client state, so a half-typed amount survives; the Exhibitors page still passes `paused` while a row is expanded, because the list is sorted by balance and reordering under someone mid-entry would move the row they are typing into.
- **`AccountsPanel` is colocated with the Exhibitors page**, its only consumer, and has no heading of its own — the page title is the heading. It carries the account/owing count line instead.
- **Accounts open on "Owing".** That is the question the office arrives with. Rows sort by balance descending, then back number, so the largest debt is first and the settled majority reads in the usual order.
- **Amounts are entered as dollars and converted with `Math.round`, not truncation** — a hand-typed `12.345` should not silently become `12.34`.
- **A refund is the same form in a different mode**, not a separate screen. Toggling relabels the heading and the button and negates the amount on submit.
- **Reports are rendered generically.** `formatReportCell` formats any column flagged `is_money` from integer cents, so a report added to the backend registry gets consistent currency formatting with no frontend change. `REPORT_ICONS` is presentation-only and falls back to a default icon for a slug it does not know — an unknown report still renders.
- **CSV is built from the report already on the page**, so the file and the table cannot be two different snapshots. Money is written as plain decimal dollars with no symbol or separator, because `$1,240.00` arrives in a spreadsheet as text and will not sum.
- Wide report tables scroll inside their own `overflow-x-auto` container rather than pushing the page sideways.

## Tests

Jest with `next/jest`, configured in `frontend/jest.config.js`. Run with `npm test` from `frontend/`.

The suite covers **pure helpers in `frontend/lib/`** and deliberately stops there. Component rendering
tests break on every copy change and catch little that `tsc --noEmit` does not already, and the money
and redirect helpers are where a silent bug actually costs something:

- `lib/safe-next.test.ts` — `safeNextPath()`, the open-redirect defence.
- `lib/my-shows.test.ts` — `formatMoney` (including a negative, because a credit balance renders),
  `ordinal` (the 11th/12th/13th boundary), `formatDateRange`, `isPastShow`.
- `lib/financials.test.ts` — `formatReportCell`, including that a **zero in a money column renders as
  `$0.00`, not an em dash**. The source checks `value === ''` rather than falsiness; "simplifying"
  that to `if (!value)` would turn every zero on a financial report into missing data.

Test files import `describe`/`it`/`expect` from `@jest/globals` rather than relying on ambient
globals. `tsconfig.json` includes `**/*.ts`, so these files are type-checked by `npm run type-check`
— the explicit import is what keeps that passing without adding `@types/jest`.
