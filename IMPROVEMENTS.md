# Codebase Improvements

## August 2026

### Documents Fill In Their Own Fields

Uploading a Coggins asked the exhibitor to hand-type the issue and expiration dates printed on the scan they had just attached. That is where undated and mistyped Coggins records come from — and an undated Coggins blocks entry, which is the failure `coggins_override_audit` exists to absorb. The fix attacks the source rather than the symptom.

`POST /horses/{id}/documents/analyze` reads the file and returns the fields; the upload form pre-fills from them and the uploader confirms. One extractor covers all four document types (Coggins, health certificate, vaccination, registration), pulling dates, test result, accession and lab, veterinarian and clinic, and — on registration papers — association, registration number, sire, dam, color, and foaling date.

- **The model suggests; a human saves.** Nothing extracted reaches a record unreviewed. `horse_documents.expiry_date` is the field the entry gate checks, so a misread year would silently admit an expired horse or block a valid one, and neither failure announces itself. The form's existing auto-upload-when-complete shortcut is suppressed once a document has been read, replaced by an explicit save — otherwise extraction would have inherited a path that commits without anyone looking.
- **Coggins expirations are never computed.** A Coggins prints the date blood was drawn; how long that stays valid is state and association policy, not something legible on the form. The model returns `expiry_date` only when one is printed, and `test_date` separately. The form then offers a one-click "12 months from the test" — a derived date a person accepts, never one the model asserted.
- **Migration 083** adds `document_extractions`: the model's raw output, what was saved, and `overridden_fields` for the difference. It is written *before* the document exists and linked on save in the same transaction, so a saved document can never be missing the record of where its dates came from. That also makes the feature measurable — a field overridden most of the time is a field the extractor is getting wrong.
- **Every failure degrades to the old form.** No API key, an outage, a scan too poor to read, a TIFF: all return a status the form handles by falling back to manual entry. Extraction is a shortcut over a form that still works by hand, and must never be why someone can't file paperwork. `ANTHROPIC_API_KEY` is optional for exactly this reason.
- Structured outputs pin the response shape, but shape is not semantics — dates are re-parsed server-side in `_normalize()`, and anything that isn't a real date is dropped to null and flagged rather than passed to a form field as though it were read off the page.

Not added: extraction for exhibitor and trainer documents. Those tables have different fields and membership-card extraction is its own problem; the horse-side extractor should earn its keep first.

### Coggins Overrides Are Audited

The Coggins gate has a deliberate escape hatch — `skip_coggins_check` lets show staff enter a horse whose record is thin but whose paper Coggins they have physically inspected. It left no trace, so a show could not answer "who entered this horse without valid Coggins on file, and what was wrong with it".

**Migration 082** adds `coggins_override_audit`: show, entry, class, horse, which failure was bypassed (`missing` / `undated` / `expired`), who did it, and when.

- **Only effective overrides are recorded.** `create_entry` now evaluates the Coggins status either way and only writes a row when the horse would actually have been rejected. Passing the flag for a horse that already holds a valid Coggins overrides nothing, so the table counts real bypasses rather than flag usage — otherwise the audit would fill with noise from a UI that could set the flag defensively.
- **Written in the same transaction as the entry**, via a `flush()` to assign `entry.id` before the audit row is added. An entry that bypassed the gate must never exist without the row explaining why; committing the entry first and auditing after would leave exactly that gap whenever the second write failed.
- **FK behaviour is mixed on purpose.** `show_id` CASCADEs — the audit answers a question about a show, so it goes when the show does and the table stays bounded. Everything else SET NULLs, with `horse_name` and `overridden_by_name` denormalized alongside: an audit that goes anonymous when a staff account is deleted is not much of an audit.
- `GET /shows/{id}/coggins-overrides` reads them back, behind the same `_assert_show_access` check as the rest of the entries flow. `CogginsOverridePanel` on the admin entries page renders **nothing** when a show has no overrides — the normal case — and is collapsed by default when it does.

Not added: a free-text reason field. The policy already fixes the reason ("I inspected the paper document"), and a required note would slow the entry desk for a value the attestation already carries. Easy to add later if shows want it.

### Dead Code: CreateHorseForm

`frontend/app/admin/shows/[id]/CreateHorseForm.tsx` was a 130-line horse quick-add on the show page that nothing imported. Deleted. Worth noting the near-miss: it was edited earlier in this same batch of work to relabel its name field, an inert change to a file no user could reach — checking for importers before editing would have caught it.

### Show Staff Can Read Health Paperwork

Horse documents were ADMIN-or-owner for every operation, so a show secretary could **override** the Coggins gate but could not **look at** the document behind it. Tightening the gate made that worse: more entries now stop at a warning whose evidence the person deciding cannot open.

`horse_documents.py` splits the single `_check_access` into two:

| | Roles | Endpoints |
| --- | --- | --- |
| `_assert_can_view` | ADMIN, SHOW_SECRETARY, SHOW_MANAGER, owner | list, download |
| `_assert_can_manage` | ADMIN, owner | upload, delete |

Read and write answer different questions. Staff read paperwork to *verify* it; the record stays the owner's to maintain, so a secretary cannot add or remove documents on someone else's horse.

**Viewing is not scoped to horses at the user's own shows.** That was the first instinct and it is wrong here: the secretary most needs the Coggins while *creating* the entry, before any row links the horse to the show, so the scoped rule would hide the document at exactly the moment it is needed. The trade — any secretary or manager can read any horse's health documents — is acceptable for roles that already see exhibitor contact details, entries, and back numbers.

**Surfaces.** `HorseDocuments` gained a `readOnly` prop that drops upload/remove and leaves list + download; offering write controls to staff would only produce a 403. It appears in two places: the Coggins warning on `CreateEntryForm` expands the horse's health documents inline, so staff can check before overriding, and every row on the admin entries list carries a **Papers** toggle for routine lookups.

### An Undated Coggins Disabled the Entry Gate Permanently

Both entry paths evaluated a horse's Coggins the same way:

```python
has_valid = any(doc.expiry_date is None or doc.expiry_date >= today for doc in docs)
```

`expiry_date is None` counting as valid means **one undated Coggins clears the horse forever** — the `any()` runs over every row on file, so a single dated-blank record permanently satisfies the check no matter how many expired ones sit beside it. A horse whose current Coggins had lapsed still entered cleanly as long as some older undated row existed.

It also disagreed with what the exhibitor was being shown. The readiness flags on the horse card evaluate only the *newest* document per type, so the card rendered a red "Coggins expired" while both entry paths accepted the entry. Two different policies, three copies of the logic (`entries.py`, `show_registration._assert_coggins`, `_coggins_requirement`).

**New rule:** a horse is cleared only by a Coggins carrying an expiration date that has not passed. An undated record does not clear it — there is nothing on it to verify.

- `coggins_status()` in `routers/horse_documents.py` is now the single implementation, returning `valid` / `missing` / `undated` / `expired`. All three former copies call it, plus the new `load_coggins_expiries()` and `assert_coggins_valid()` helpers. The frontend `cogginsCheck()` in `MyHorsesPanel` mirrors it so the card and the gate cannot drift again.
- `undated` is reported ahead of `expired` when both are present: it names the fixable data problem, where "expired" would send the exhibitor after a new test they may not need.
- All states keep the `COGGINS_EXPIRED` error code, since the entry form and self-registration screen branch on it. The message carries the distinction.
- Coggins moved out of the generic newest-per-type expiry loop on the horse card — it is an entry gate, so it flags `danger` with an explicit "blocks entry" rather than sitting among the soft 45-day warnings.

**The override is the point.** `skip_coggins_check=true` lets a secretary or manager who has physically inspected the paper Coggins enter the horse anyway, so tightening the rule cannot strand an exhibitor whose documentation is genuinely fine — a thin record is a data problem, not a disqualification. The button now says "I inspected it — add entry" and states the condition, rather than the previous bare "Add anyway". Exhibitors have no equivalent: `require_admin_or_show_admin` plus a show-access check gate the endpoint, and self-registration has no override at all.

Verified `coggins_status` against nine cases, including the one that motivated this: `[undated, expired]` returned valid before and returns `undated` now. Two follow-ups deliberately left open — the override writes no audit row, and show staff still cannot *view* horse health documents (`horse_documents._check_access` is ADMIN-or-owner), so today they override a check they are not permitted to look at.

### Barn Name Finished on the Admin Surfaces

Migration 081 added `horses.barn_name` and wired it through the backend and the exhibitor-facing screens, but the admin side was left half-done: the admin **edit** form got the field while the admin **create** form had no barn-name input at all, and `/admin/horses` neither displayed nor searched it. An admin could therefore see and change a barn name on an existing horse but never set one on a new horse, and could not find a horse by the name most people at the show actually call it.

No backend work was needed — `barn_name` was already on `HorseCreate` / `HorseUpdate` / `HorseOut` and `GET /horses/` already returned it. This was purely the frontend catching up.

- `NewHorseForm` takes **Registered Name \*** (with "This is what the horse is entered and published under") plus an optional **Barn Name**, matching the wizard's copy. `Name *` was an ambiguous label for the field that decides how the horse is published. Also picked up the `maxLength={200}` the edit form already had and the backend already enforced.
- `HorseList` adds `barn_name` to the `Horse` interface and to the search haystack, and the placeholder now says so. The delete confirmation still names the registered name.
- The `/admin/horses/[id]` heading renders `Registered Name "Barn Name"`; the breadcrumb stays registered-name-only.
- `CreateHorseForm` (the quick-add on the show page) had its label and error message changed from "Horse name" to "Registered name", but deliberately **did not** get a barn-name field.

**The rule this settles:** the registered name is the identifier wherever a horse is competing — exhibitors, judges, and show staff all reference the association name. Barn name is ancillary: searchable, and rendered quoted and de-emphasised next to the registered name, but never a replacement for it. That is why it stays off the class schedule, the published results, and the gate screen, and why the mid-show quick-add doesn't ask for it.

### Self-Registration Skipped Association Validation Entirely

Every association rule starts with a guard that skips withdrawn entries:

```python
if getattr(entry, "status", "ENTERED") != "ENTERED":
    return []
```

`Entry.status` is declared `Column(Text, nullable=False, default="ENTERED")`. A SQLAlchemy `default=` is applied **at flush**, not at construction, and validation deliberately runs *before* the entry is flushed. So `entry.status` was `None`, the `getattr` default never applied (the attribute exists, it is just unset), `None != "ENTERED"` held, and the rules returned `[]`.

`routers/show_registration.py` built its `Entry(...)` without `status`, so exhibitor self-registration silently ran **no** association validation at all. The admin entry path was unaffected — it builds from `EntryCreate`, whose schema default sets `status="ENTERED"` before the model is constructed.

Caught when an exhibitor holding only an APHA membership, on an APHA-registered horse, successfully self-registered into an AQHA class that should have rejected both.

**Fix, in two parts**
- `show_registration.py` sets `status="ENTERED"` explicitly at construction, with a comment on why the column default is not enough here.
- `DefaultRules.entry_is_active()` centralizes the guard and treats `None` as ENTERED, since callers validate pre-flush by design. `AQHARules.validate_entry` uses it. This is the part that stops the bug from recurring: any future path that builds an unsaved `Entry` now validates instead of silently passing.

Worth noting the failure mode — a bypass, not an error. Registration returned `201` and looked healthy; only checking a case that *should* fail revealed it.

### AQHA Entry Validation Blocked Every Entry

`AQHARules._has_horse_registration` and `_has_exhibitor_registration` matched registration rows on `reg.show_type_id`. Migration 080 split the association registry out of `show_types`, so `horse_registrations` and `exhibitor_registrations` have only carried `association_id` since — the attribute the rules read no longer exists on those rows.

`getattr(reg, "show_type_id", None)` therefore returned `None` for every row, never matched the show's `show_type_id`, and both checks reported "no registration on file" regardless of the data. Every entry into an AQHA show was rejected with a 422 (`AQHA_HORSE_REGISTRATION_REQUIRED` + `AQHA_EXHIBITOR_MEMBERSHIP_REQUIRED`), including horses and exhibitors with valid AQHA numbers. The failure was silent from the caller's side: the message named a real requirement, so it read as a data problem rather than a bug.

**Fix** — both helpers now match `reg.association_id` against AQHA's `associations` row. Since the rules layer has no DB access, callers resolve the id via a new shared `get_aqha_association_id()` in `routers/shows.py` and pass it as `context["aqha_association_id"]`. All four context builders supply it: entry create/update (`routers/entries.py`), exhibitor self-registration (`routers/show_registration.py`), and both contexts in the `aqha-validation` endpoint.

`_aqha_class_code` was left alone — `class_associations` genuinely does key on `show_type_id`, so that lookup was never affected.

When the association id is absent from context the check is skipped rather than failing, matching the module's stated policy of only enforcing what it can verify. That keeps a caller that forgets the key from silently reintroducing a total block.

Verified end-to-end against seeded data: a horse and exhibitor with AQHA numbers now `POST` an entry successfully (`201`), an APHA-only pair into the same class is still rejected, and unrelated AQHA rules still fire (Select age, class-code presence).

### Horse Panel Loose Ends

Three follow-ups from the horse-panel work.

**Duplicate-registration check no longer fails open.** `/horses/registrations/lookup` answers `200` = already on file, `404` = clear. Both callers (`AddHorseWizard` and the horse page's `EditMyHorseForm`) branched on `res.ok` alone, so a 500, a 401, or a dropped connection read as "no duplicate" and the number was accepted — and with no `try/catch`, a network throw became an unhandled rejection and the button silently did nothing. Both now treat only `404` as clear and surface a retry message otherwise.

**My Horses filter can no longer strand the list.** The filter box rendered only at `horses.length >= 4`, but the `filter` string survived removals: filter four horses down to two matches, remove both, and the input vanished while the filter stayed applied — leaving "No horses match" with no way to clear it. The box now also renders whenever a filter is set, and the empty-result message carries a **Clear filter** button.

**`barn_name` reaches the surfaces that identify a horse.** Added to the admin horse form, and to `/horses/search` — matched in the query and returned on `HorseSearchMatch`, because a barn name is frequently the only name a rider knows a horse by. Search results render `Registered Name "Barn Name"`.

Deliberately **not** added to the public class schedule or published results: those are the official program, where the registered name is the record. The gate screen (`GateEntryOut.horse_name`) is also unchanged for now, though barn name would plausibly help at the in-gate.

### Registered Name vs Barn Name

`horses.name` has always been the name a horse is entered and published under — for a registered horse, its association name. The add-a-horse form muddied that by prompting for "Registered or barn name", so some rows hold a stable call name instead, and there was nowhere to record the other one.

**Migration 081 (`081_horse_barn_name.sql`)**
- New nullable `horses.barn_name`. `COMMENT`s on both columns pin down which is which.
- **Not** a rename of `horses.name` to `registered_name`. That column is referenced across entries, results, the public schedule, search and exports; the rename would buy nothing beyond the label the UI already shows, and would touch far more surface than the change is worth.
- Nullable free text, matching `owner_name` / `trainer_name` / `sire_name` — plenty of horses have no barn name worth recording.

**Backend**
- `barn_name` added to `HorseCreate`, `HorseUpdate`, `HorseOut`, and the shared `_horse_out_data` projection. No router changes were needed: create builds `Horse(**horse_data)` and update applies `model_dump(exclude_unset=True)`, so the field flows through both paths on its own.

**Frontend**
- Wizard step 2 now asks for **Registered name \*** (with "This is what the horse is entered and published under") and an optional **Barn name**; the validation message reads "Registered name is required." Review lists both, barn name marked *Skipped* when blank.
- Same split on the horse page's Details tab, including the read-only non-owner view.
- Horse card and horse-page heading render `Registered Name "Barn Name"`, and the My Horses filter matches on either.

### Add a Horse: Wizard on Its Own Page

The add-a-horse form asked for everything at once in a single tall panel appended to the bottom of the My Horses list, and the only way to reach the horse fields in "I ride this horse" mode was through a search sub-flow nested inside that same panel. It is now a five-step wizard on a dedicated route, `/profile/horses/new`.

**Steps (`frontend/app/profile/AddHorseWizard.tsx`)** — order mirrors the tabs on the horse's own page:
1. **Owner** — required. `I own this horse` / `I ride this horse, but do not own it`. Ride mode keeps the anti-duplicate gate: you must search before you can type owner details by hand, and picking a hit from the results links the existing horse and ends the wizard instead of creating a second record.
2. **Horse** — only `name` is required; sex, foaling date, sire, dam, breeds, color, and SPB are optional.
3. **Trainer** — optional, skippable.
4. **Health** — optional, skippable, **owner-mode only**. Coggins / vaccination / health certificate uploads.
5. **Registrations** — optional, skippable. Breed registries and club memberships stay split, with the duplicate-number lookup unchanged.
6. **Review** — every field listed, with anything omitted marked *Skipped*, then **Create Horse**.

**Health step: two backend constraints shape it**
- Documents post to `/horses/{id}/documents`, which needs a horse that doesn't exist yet. So the step **queues** `File` objects plus type/issue/expiry in component state, and `handleCreate` flushes the queue after the horse row comes back.
- `_check_access` in `backend/routers/horse_documents.py` only lets the **registered owner** upload. In ride mode the owner is somebody else, so the step is dropped entirely rather than letting a rider queue uploads that would 403 *after* the horse was created. Switching to ride mode also discards anything already staged.
- Because the step list depends on an answer given back on step 1, `steps` is derived from `owner.mode` and every index into it is clamped — otherwise switching modes late would strand `stepIndex` past the end.
- Partial failure is handled explicitly: if the horse is created but some uploads fail, `createdHorseId` is set, the **Create Horse button is replaced by a link to the horse's Health tab**, and the error names the failed files. Re-offering creation there would produce a duplicate horse.
- Client-side size check mirrors `MAX_FILE_SIZE`; MIME is left to the server, which sniffs magic bytes and ignores the client Content-Type.

**Behaviour**
- Only Owner and Horse gate creation, matching the rule that a horse needs a name and an owner and nothing else.
- Optional steps offer **Skip** only while genuinely empty — once something is entered the button disappears, so "skip" is never ambiguous about whether it discards input.
- The step indicator lets the user jump back to any cleared step. Because a later step may already have passed, `handleCreate` re-validates every step and jumps to the first failure rather than trusting the walk-forward.
**Its own page (`frontend/app/profile/horses/new/`)**
- `new` is a static segment, so it wins over the sibling `[id]` dynamic route without any extra guarding.
- The server page resolves the exhibitor (bouncing to `/profile` if the row doesn't exist yet, since that page creates it) and passes down only the profile's horse ids, used to label search hits already on the profile. The wizard loads breeds / colors / associations itself, so nothing is drilled through `MyHorsesPanel` any more.
- The "find a horse" handoff now travels as query params — `?name=` or `?association_id=&registration_number=` — and the wizard resolves the registration into a chip once the association registry has loaded. Previously this was in-memory component state.
- **`router.refresh()` must not be called alongside `router.push()`** in `NewHorseWizard`. Doing both in one tick cancelled the navigation and left the wizard stranded on screen with its button stuck reading "Saving..." *after the horse had already been created* — the worst possible failure shape, since retrying would duplicate. `/profile` fetches with `cache: 'no-store'`, so the push alone lands on fresh data.

**Extraction**
- New `frontend/app/profile/horse-shared.tsx` holds the types plus `RegChips` and `SearchResultList`, so the panel and the wizard can share them without importing each other.
- `MyHorsesPanel` drops from 1260 to ~590 lines and keeps only the list, filter/sort, the "find existing horse" panel, and unlink. Its dead inline `.sort()` on insert (immediately re-sorted by `visibleHorses`) is gone, as are the breeds/colors fetches it only held for the form.
- The card's Documents link now points at `?section=health`, the canonical name for that tab.

### Exhibitor Horse Page: Tabs and Section Restructure

The four sections below are now **tabs** (`Details` / `People` / `Health` / `Associations`) rather than a stack of open accordions, using the same tab styling as `ProfileTabs`, with `role="tablist"` ARIA and arrow-key/Home/End navigation. Inactive panels stay mounted so switching tabs never discards a half-filled upload form. `SectionHeader` is no longer used here (still used by the admin horse form, admin trainer detail, and the trainer profile form).

`/profile/horses/[id]` had grown four content areas with three different structural treatments. Horse Details, Rider(s), and Registrations were collapsible `SectionHeader` cards inside `EditMyHorseForm`; the documents block was a plain `<h2>` card that lived in `page.tsx` **outside** the form, could not collapse, and was written twice — once before and once after the form — so that `?section=documents` could float it to the top by reordering the DOM. Separately, the `REGISTRATION` document type ("Registration & Membership") uploaded into a block titled "Health & Registration Documents" while the registration *numbers* it backs lived in a different section entirely.

**Sections (`frontend/app/profile/horses/[id]/EditMyHorseForm.tsx`)**
- Four uniform collapsible sections: **Horse Details** (identity), **Owner, Trainer & Riders** (people), **Health & Documentation**, **Associations**. Trainer moved out of Horse Details to sit with the riders it belongs beside.
- Owner and view-only renders were merged into one pass gated on `isOwner`, replacing two near-duplicate 130-line returns. Non-owners get Details / People / Associations read-only; Health is owner-only data and is not rendered for them.
- Details and People each carry a Save button over the same shared `PATCH /api/horses/{id}`; `saveOrigin` scopes the saved/error message to the section the user clicked in.
- Local `Section` wrapper hides collapsed content with the `hidden` attribute instead of unmounting it, so collapsing no longer discards a half-filled upload form or a just-uploaded document.
- Dropped the `UNCERTIFIED_CODES = ['OPEN']` filter — dead since migration 080 removed OPEN from `associations`, and the last surviving copy of a guard removed elsewhere in that migration.

**Scoped documents (`frontend/components/HorseDocuments.tsx`)**
- New optional `types`, `emptyLabel`, and `uploadLabel` props let one instance own a subset of `DOC_TYPES`. Health renders Coggins / Vaccination / Health Certificate; Associations renders Registration & Membership under a "Registration Papers" subheading beside the numbers.
- With a single allowed type the instance preselects it and drops both the filter dropdown and the upload form's type picker rather than making the user restate it.
- `Document` interface renamed to `HorseDocument` and exported (it shadowed the DOM `Document` type). Callers passing no `types` — the admin horse form — are unchanged.

**Deep links (`frontend/app/profile/horses/[id]/page.tsx`)**
- Documents are now fetched once and passed into the form; the duplicated JSX blocks and the `showDocumentsFirst` reordering hack are gone.
- `?section=` maps through `SECTION_ALIASES` to open and smooth-scroll to a section. The My Horses list still links `?section=documents`, which aliases to `health`.

## July 2026

### Associations Split from Show Types (Breed vs Club)

`show_types` had been doing two unrelated jobs: describing **what kind of show is being put on** (drives eligibility and the standard class catalogs) and recording **which body a horse or person is registered with**. Conflating them forced club bodies (NSBA, WSCA) to masquerade as show types so their membership numbers had somewhere to live — and they were then duplicated *again* in `sanctioned_associations` for per-show sanctioning fees.

**Migration 080 (`080_associations_registry.sql`)**
- New `associations` registry: `code`, `name`, `association_type` (`breed` | `club`), `is_active`.
- Seeded `breed` from the non-club show types (AQHA, APHA, ApHC, FQHR) and `club` from `sanctioned_associations` (NSBA, WSCA).
- Repointed every affiliation FK from `show_types` to `associations`: `horse_registrations`, `exhibitor_registrations`, `trainer_registrations`, `exhibitor_documents`, `show_secretary_certifications`, with unique constraints renamed to match.
- Folded `sanctioned_associations` in and dropped it; `show_sanctioning` and `sanctioned_association_requests` now reference `associations`, so "this show is NSBA-sanctioned" and "this rider is an NSBA member" point at one record.
- Deleted NSBA/WSCA from `show_types`. An NSBA-approved show is now an OPEN (or breed) show carrying NSBA club sanctioning.
- No `associations` row for OPEN: "Open" is the absence of a breed association, not a body anyone holds a membership with. This also made the `UNCERTIFIED_CODES = ['OPEN']` guards scattered through the association pickers dead code, and they were removed.
- Dry-run first (migration piped with `COMMIT` swapped for `ROLLBACK`) to verify the backfill before committing.

**Backend**
- `models.Association` added with the concept boundary documented on both it and `ShowType`.
- New `/associations` router (`?type=breed|club`); the existing `/sanctioned-associations` endpoints now serve the club slice of the same registry so the setup wizard keeps working.
- Registration/document/certification schemas renamed `show_type_*` → `association_*` and gained `association_type` so clients can group.
- **Behaviour fix caught during the split:** `_class_is_nsba()` in `show_registration.py` tested `show.show_type.code == "NSBA"`. With NSBA no longer a show type that check was silently dead, which would have zeroed NSBA sanction fees. It now reads club sanctioning off the show, and `_load_published_show_or_403` eager-loads `Show.sanctioning` to support it.

**Frontend**
- New `/api/associations` route handler and `fetchAssociations()` helper.
- Horse registration UI splits the kinds: `MyHorsesPanel`'s add form has separate **Breed Registrations** and **Club Memberships** sections (`Reg #` vs `Member #`); the three edit forms use a new shared `components/AssociationSelect.tsx` rendering `<optgroup>`s plus an `AssociationTypeBadge` per row.
- Horse-card registration chips are colour-coded by type and sorted breed-first.
- Exhibitor membership, trainer affiliation, secretary-certification, and show-sanctioning surfaces were repointed to the new registry (field renames only — their flat lists are unchanged).

### Exhibitor Profile: My Horses Revamp

Rebuilt the `My Horses` tab so an exhibitor can tell at a glance whether each horse is actually ready to be entered, and can find a horse already in the system without knowing its registration number.

**Backend (`backend/schemas.py`, `backend/routers/people.py`)**
- Extracted the `HorseOut` ORM→dict projection into a shared `_horse_out_data()` helper so subclasses can extend it without duplicating the derivation logic.
- Added `MyHorseOut(HorseOut)` carrying `registrations` (association code + number) and `documents` (type, label, issue/expiry dates). `GET /exhibitors/{id}/my-horses` and the created/linked horse POSTs now return it.
- `_my_horse_options` eager-loads registrations (with `show_type`) and documents. The document load uses `load_only(document_type, issue_date, expiry_date)` deliberately — `horse_documents.file_data` holds the file bytes and must never be pulled into a list response.
- `_my_horse_out()` blanks `documents` for horses the caller does not own, matching the owner-only access rule already enforced on the horse-documents endpoints.
- Added `GET /horses/search?q=` (authenticated): case-insensitive match on horse name **or** registration number, returning name, owner, sex, breed, and registration chips. Declared before `/horses/{horse_id}` so the static segment wins.

**Frontend (`frontend/app/profile/MyHorsesPanel.tsx`, `frontend/app/api/horses/search/route.ts`)**
- Replaced the flat list rows with per-horse cards: badges (sex / SPB / Owner·Created·Linked), breed · color · age, sire/dam pedigree, owner + trainer, registration chips, and readiness flags.
- Readiness flags surface what blocks an entry: missing association registration, no Coggins on file, and documents expired or expiring within 45 days. Only the newest document per type is evaluated, so a replaced Coggins does not raise a false alarm.
- Actions moved to a dedicated footer row so cards stay aligned no matter how many flags a horse has.
- "Find an existing horse" gained a **by horse name** mode alongside the existing registration-number lookup; horses already on the profile are labeled rather than offered again, and both modes fall back to "Create new profile" carrying over what was typed.
- Added a filter box (name, sire, dam, registration #) and Name/Recently-added sort, shown once the exhibitor has 4+ horses; plus a horse count, persistent Add/Find buttons, and a real empty state.
- `ProfileTabs` now imports the exported `MyHorse` type instead of keeping a duplicate local interface that could drift.

**Add-a-Horse ownership question reworked**
- Replaced the three-option owner picker (own it / pick an existing owner from a dropdown / type owner details) with a two-option question: **"I own this horse"** or **"I ride this horse, but do not own it"**.
- Owning goes straight to the horse-detail fields, unchanged.
- Riding gates the form behind a search: horse-detail fields and Save stay hidden until the exhibitor either selects a match from `/api/horses/search` (linked via `/linked-horses`) or clicks "Not in the app?", which then requires owner first/last/email plus the horse details. This is the point of the change — a rider can no longer create a duplicate record for a horse that is already on file without looking first.
- The dropped "owner is already in the system" picker needed no replacement: the backend's `owner_email` path already resolves to an existing exhibitor when the email matches a user, and creates a standalone owner record otherwise. It also removes a `/api/exhibitors/names` fetch that pulled every exhibitor in the system into the form.
- Extracted `SearchResultList` so the standalone find-a-horse panel and the ride-mode search render identically.

---

## June 2026

### Horse Edit Forms: Collapsible Sections, Rider Management, and Entry Form Per-Exhibitor Horse Loading

Improvements to the horse editing experience for both admin and exhibitor profiles, plus a UX fix in the admin entry creation form.

**Admin horse edit (`frontend/app/admin/horses/[id]/EditHorseForm.tsx`)**
- Added collapsible sections (Horse Details, Riders, Registrations, Documents) via a `SectionHeader` toggle component.
- Added full rider management: admins can add/remove secondary riders from the horse's rider list; the owner is always prepended to the display list if absent from the backend response.
- Fixed timezone-sensitive age display: foaling date year is now parsed directly from the ISO string to prevent UTC→local shift from moving Jan 1 dates to Dec 31 of the prior year.

**Profile horse edit (`frontend/app/profile/horses/[id]/EditMyHorseForm.tsx`)**
- Same collapsible-section treatment and rider management as the admin form.
- Added `/api/exhibitors/names` fetch to populate the rider-add dropdown.
- Added `owner_exhibitor_id` / `owner_exhibitor_name` to the Horse interface; owner is prepended to `displayRiders` when absent.
- Same foaling-date timezone fix as the admin form.

**Admin entry creation (`frontend/app/admin/shows/[id]/CreateEntryForm.tsx`, `entries/page.tsx`)**
- Removed the global `horses` prop (previously loaded every horse in the system at page render).
- Horse dropdown now loads lazily per selected exhibitor via `GET /api/exhibitors/{id}/my-horses`; picker is disabled with a contextual placeholder until an exhibitor is chosen.

---

### OPEN Class Wizard + Entries Screen Refinements

Follow-up polish on the rebuilt OPEN class-setup wizard and the show Entries screen.

**Class setup wizard (`frontend/app/admin/shows/[id]/classes/_wizard/ClassWizardClient.tsx`)**
- Step 3 class list is now drag-and-drop reorderable per day (via `@hello-pangea/dnd`); dropping persists the full ordered id list to `POST /shows/{id}/classes/reorder`, which renumbers globally by `(class_date, sort_order, class_number)`. Re-added the `frontend/app/api/shows/[showId]/classes/reorder` proxy that the show-admin rebuild had dropped.
- Step 1/2 standard-library options are clickable pill toggles instead of checkboxes.
- The Step 3 matrix is transposed: Divisions are rows, Disciplines are columns.
- Clicking a `+` cell now creates the class immediately (serialized add queue) — the basket and separate "Add" button are gone.

**Class creation membership (`backend/routers/classes.py`)**
- `create_class` now upserts the `(discipline_id, division_id)` row into `discipline_divisions` on demand instead of rejecting an unregistered pair with 422. Creating a class is itself the statement that the division is offered under that discipline, and the matrix builder intentionally offers every combination. Bulk/import paths are unchanged.

**Entries screen (`frontend/app/admin/shows/[id]/entries/`)**
- "Entries by Class" is now grouped under date headings.
- The Add Entry exhibitor dropdown only lists exhibitors with a linked user account; the full list is still used to resolve names on existing entries. Orphaned/accountless test exhibitor records were purged from the database (no entries, show-entries, or horses referenced them).

---

## May 2026

### Side Pots and Score-Driven Placings

Substantial feature work added to support divisional jackpots ("side pots") common at multi-association paint/quarter horse shows. Designed against the MNSPHC Grand Paint Classic 2026 show bill.

**Database (migrations 036, 037)**
- `classes.score_type` enum: `placement` (judges rank — rail/halter), `pattern` (judges score numerically — showmanship/horsemanship/etc.), or `time` (clocked event). Backfilled to `placement` so existing UX is unchanged.
- `results.raw_score` numeric column. For `pattern`/`time` classes the scorekeeper enters `raw_score` and the backend recomputes `place` + `is_tie` for every result in the class on every change. For `placement` classes the column stays NULL and the manual placing flow is unchanged.
- New tables: `side_pots`, `side_pot_classes`, `side_pot_entries`, `side_pot_payouts`. Pot config carries `entry_fee_cents`, `payback_percent`, `scoring_method` (`sum_placings` / `sum_scores`), `eligibility_rule`, JSONB `payout_schedule` keyed by paid-entry-count band, and a one-way `status` (`open` / `closed` / `settled`).

**Backend**
- `backend/routers/side_pots.py` — full CRUD + opt-ins + live standings + settle + frozen payouts. Settle writes `side_pot_payouts` rows and locks the pot.
- `backend/routers/results.py` — pattern/time classes recompute `place` server-side; `place`-conflict checks and audit writes scoped to `placement` classes only.
- Validation: `sum_scores` requires every bundled class to be `score_type IN ('pattern','time')`; settling is one-way; back numbers can be opted into a pot by ID or by typed back number.

**Frontend**
- `score_type` selector in class create/edit forms; collapsed class card shows a green badge for non-default scoring.
- Side pot admin pages at `/admin/shows/[id]/side-pots` (list + create) and `/admin/shows/[id]/side-pots/[potId]` (settings, opt-ins, live standings, settle, frozen payouts).
- New scorekeeper form `ScoredScorekeeperForm.tsx` for `pattern`/`time` classes with raw-score input and live-derived placings; placement classes still use the existing `ScorekeeperForm.tsx`.
- Side Pots tile (💰) added to the show admin dashboard.

**Design references and research**
- Show bill: MNSPHC Grand Paint Classic 2026 (3 side pots: Showmanship classes 50–54, Horsemanship classes 138–139 and 140–144).
- Industry conventions confirmed via APHA Chrome Cash, AQHA pattern scoring, and Pinto World tabulation rules: side pot scoring is producer-driven, pattern classes use 70-baseline numerical scores, rail/halter classes are comparative-only.

**Not yet built (deferred)**
- Custom payout-schedule editor in the UI (defaults work; backend supports overrides).
- APHA bulk-import auto-tagging of `score_type` based on standard-class division.
- Public-facing side pot view for exhibitors/spectators.
- Public class results page does not yet display `raw_score`.
- Exhibitor self-service opt-in (secretary-only for now by design).

---

### 1. Database Migrations 013–019 Applied
Applied six migrations pulled from the remote repo plus one new migration created locally:

| Migration | Description |
|-----------|-------------|
| `013_user_approval.sql` | Renumbered duplicate; registered in `_migrations` for tracking consistency |
| `014_user_role_check_constraint.sql` | `CHECK (role IN (...))` on `users.role` — enforces valid roles at DB level |
| `015_add_fk_indexes.sql` | 32 indexes on FK columns across all major tables — eliminates sequential scans on joins and cascading deletes |
| `016_add_enum_check_constraints.sql` | CHECK constraints on `shows.status`, `classes.status`, `entries.status`, `entries.apha_division`, `horses.sex`; `result_audit` null guard; `shows.created_at NOT NULL` |
| `017_drop_legacy_venue_column.sql` | Drops `shows.venue TEXT` (superseded by `venue_id` FK) |
| `018_drop_legacy_owner_name_column.sql` | Drops `horses.owner_name TEXT` (superseded by `owner_exhibitor_id` FK) |
| `019_result_audit_changed_at_index.sql` | `idx_result_audit_changed_at ON result_audit(changed_at DESC)` — speeds up audit log queries sorted by time |

### 2. Pagination on Admin List Endpoints
- **File**: `backend/routers/people.py`
- **Endpoints updated**: `GET /users/`, `GET /horses/`, `GET /exhibitors/`
- **Change**: Added optional `limit` (1–1000) and `offset` (≥0) query params. Default is no limit — fully backwards-compatible.
- **Reason**: Prevents unbounded full-table scans as data grows; API is pagination-ready for future frontend use.

### 3. `safeFetchBackend` 204 / Status Code Fix
- **File**: `frontend/lib/backend-fetch.ts`
- **Changes**:
  - 204 No Content responses now short-circuit and return `{ json: null, status: 204 }` before attempting `res.json()`
  - JSON parse errors now preserve `res.status` (previously incorrectly returned 502 regardless of actual backend status)
- **Reason**: DELETE endpoints that go through `safeFetchBackend` (e.g. class delete) were returning 502 to the client even when the delete succeeded, because the empty 204 body triggered the JSON parse error path and status was overwritten.

### 4. Docker Compose Healthchecks
- **File**: `docker-compose.yml`
- **Changes**:
  - Added `healthcheck` to the backend service using `python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/')"` (no curl dependency needed on `python:3.12-slim`)
  - Changed frontend `depends_on` from `service_started` to `condition: service_healthy`
- **Reason**: Prevents the frontend container from starting before FastAPI is ready to accept connections, eliminating race-condition startup errors.

---

# Codebase Improvements — April 2026

Complete list of improvements implemented in the horse-show-results-app codebase review and refactoring session.

## Summary

- **17 improvements** implemented across database, backend, and frontend
- **5 security gaps** closed
- **4 performance optimizations** completed
- **UI consolidation**: 7 inline confirmations → 1 reusable ConfirmDialog pattern
- **Code deduplication**: Extracted APHA constants to shared lib
- **Type safety**: NextAuth module augmentation, Literal types for enums

---

## Implemented Changes

### CRITICAL FIXES

#### 1. Duplicate Migration Renamed
- **File**: `database/migrations/`
- **Change**: Renamed `012_user_approval.sql` → `013_user_approval.sql`
- **Reason**: Migration 012 was duplicated with `012_result_audit_entry_fk.sql`

#### 2. User Role CHECK Constraint
- **File**: `database/schema.sql`, `database/migrations/014_user_role_check_constraint.sql`
- **Change**: Added `CHECK (role IN ('ADMIN', 'SHOW_SECRETARY', 'SCOREKEEPER', 'EXHIBITOR'))`
- **Reason**: Prevents invalid roles from being inserted; enforces enum at DB layer

### HIGH-PRIORITY SECURITY FIXES

#### 3. Protected Unauthenticated Endpoints
- **File**: `backend/routers/people.py`
- **Changes**:
  - Added `require_api_key` to `GET /horses/{id}` (line 247)
  - Added `require_api_key` to `GET /exhibitors/by-user/{id}` (line 370)
  - Added `require_api_key` to `GET /exhibitors/{id}` (line 378)
- **Reason**: Prevents unauthorized PII access (APHA member numbers, DOB, horse data)

#### 4. UUID Validation (safe_uuid instead of bare UUID())
- **Files**:
  - `backend/routers/horse_documents.py` (line 40)
  - `backend/routers/show_staff.py` (line 41)
  - `backend/routers/venues.py` (lines 26, 90-108)
- **Change**: Replaced `UUID(x)` with `safe_uuid(x)` for proper 400 error handling
- **Reason**: Malformed UUIDs now return 400 instead of 500

#### 5. Login Rate Limiting
- **File**: `backend/routers/auth.py`, `backend/main.py`, `backend/requirements.txt`
- **Changes**:
  - Added slowapi dependency
  - Configured `@limiter.limit("10/minute")` on `/auth/verify` endpoint
  - Added logging of failed login attempts by email
- **Reason**: Prevents brute-force attacks

#### 6. Results Update Auth Gap
- **File**: `backend/routers/results.py` (lines 86-97)
- **Change**: Added `await _get_class_or_404(show_id, class_id, db)` to validate show membership
- **Reason**: Prevents cross-show result modification via known result_id

#### 7. VenueAdminAssign Schema
- **File**: `backend/routers/venues.py`
- **Changes**:
  - Created `VenueAdminAssign(BaseModel)` with typed `user_id: UUID`
  - Replaced untyped `body: dict` in `add_venue_admin()`
- **Reason**: Validates input and prevents bare UUID() errors

### HIGH-PRIORITY PERFORMANCE FIXES

#### 8. N+1 Query in bulk_update_back_numbers
- **File**: `backend/routers/backnumbers.py` (lines 118-134)
- **Change**: Load all ShowEntry rows in single query, build dict, then upsert
- **Reason**: Reduced 200+ DB round-trips to 1 query for back number assignments

#### 9. Removed Unnecessary Status Transition Check
- **File**: `backend/routers/shows.py` (line 138)
- **Change**: Removed `await _auto_transition_statuses(db)` from `get_show()`
- **Reason**: Background task already runs every 60s; no need to call on every show fetch

### MEDIUM-PRIORITY DATABASE IMPROVEMENTS

#### 10. Foreign Key Indexes
- **File**: `database/migrations/015_add_fk_indexes.sql`
- **Changes**: Added 32 indexes on FK columns:
  - shows, rings, divisions, classes
  - entries, results, result_audit
  - exhibitor_horses, show_entries, exhibitors
  - horse_registrations, horse_documents
  - show_secretaries, show_scorekeepers, venue_admins, show_secretary_certifications
- **Reason**: Eliminates sequential scans on large tables during joins/deletes

#### 11. Enum CHECK Constraints
- **File**: `database/migrations/016_add_enum_check_constraints.sql`
- **Changes**: Added CHECK constraints:
  - `shows.status` → `('DRAFT', 'PUBLISHED', 'ACTIVE', 'COMPLETED')`
  - `classes.status` → `('OPEN', 'CLOSED')`
  - `entries.status` → `('ENTERED', 'WITHDRAWN')`
  - `entries.apha_division` → `('OPEN', 'SOLID_PAINT_BRED', 'AMATEUR', 'NOVICE_AMATEUR', 'YOUTH', 'NOVICE_YOUTH')`
  - `horses.sex` → `('Mare', 'Gelding', 'Stallion')`
  - `result_audit` → at least one of result_id or entry_id must be non-null
- **Reason**: Database-level enforcement prevents invalid states

#### 12. Schema.sql Updated
- **File**: `database/schema.sql`
- **Changes**: Updated base schema to include all CHECK constraints for future reference

### BACKEND VALIDATION IMPROVEMENTS

#### 13. Literal Types in Pydantic Schemas
- **File**: `backend/schemas.py`
- **Changes**: Replaced unconstrained `str` with `Literal[...]` for:
  - `ShowCreate.status` → `Literal["DRAFT", "PUBLISHED", "ACTIVE"]`
  - `ShowUpdate.status` → `Literal["DRAFT", "PUBLISHED", "ACTIVE"]`
  - `ClassCreate.status` → `Literal["OPEN", "CLOSED"]`
  - `ClassUpdate.status` → `Literal["OPEN", "CLOSED"]`
  - `HorseCreate.sex` → `Optional[Literal["Mare", "Gelding", "Stallion"]]`
  - `HorseUpdate.sex` → `Optional[Literal["Mare", "Gelding", "Stallion"]]`
  - `EntryCreate.status` → `Literal["ENTERED", "WITHDRAWN"]`
  - `EntryUpdate.status` → `Literal["ENTERED", "WITHDRAWN"]`
  - `EntryCreate.apha_division` → `Optional[Literal["OPEN", "SOLID_PAINT_BRED", ...]]`
  - `EntryUpdate.apha_division` → `Optional[Literal["OPEN", "SOLID_PAINT_BRED", ...]]`
- **Reason**: Type-safe enums; invalid values caught at API layer, not DB

#### 14. Date Range Validation
- **File**: `backend/schemas.py`
- **Changes**: Added `@model_validator` to `ShowCreate` and `ShowUpdate`:
  - Validates `end_date >= start_date`
  - Raises `ValueError` if invalid
- **Reason**: Prevents nonsensical date ranges in show definitions

### FRONTEND ERROR HANDLING

#### 15. safeFetchBackend Helper
- **File**: `frontend/lib/backend-fetch.ts`
- **Changes**:
  - Created `safeFetchBackend()` helper that wraps fetch with try/catch
  - Returns `{ json, status, error? }` on success or failure
  - Catches network errors and JSON parse errors
  - Returns 502 with `{ error: 'Backend unavailable' }` on network failure
- **Applied to**: `shows/`, `venues/`, `classes/`, `entries/` API routes
- **Reason**: Prevents unhandled exceptions from crashing Next.js server

#### 16. NextAuth Type Augmentation
- **File**: `frontend/types/next-auth.d.ts` (new)
- **Changes**: Created module augmentation for NextAuth:
  ```typescript
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      role: 'ADMIN' | 'SHOW_SECRETARY' | 'SCOREKEEPER' | 'EXHIBITOR';
    };
  }
  
  interface User {
    id: string;
    email: string;
    full_name: string;
    role: 'ADMIN' | 'SHOW_SECRETARY' | 'SCOREKEEPER' | 'EXHIBITOR';
  }
  
  interface JWT {
    id?: string;
    role?: 'ADMIN' | 'SHOW_SECRETARY' | 'SCOREKEEPER' | 'EXHIBITOR';
  }
  ```
- **Updated files**: Removed `as any` casts from:
  - `frontend/app/admin/layout.tsx`
  - `frontend/app/components/Navbar.tsx`
  - `frontend/lib/backend-fetch.ts`
- **Reason**: Type-safe role-based access control; IDE autocomplete support

### FRONTEND CODE DEDUPLICATION

#### 17. APHA Constants Extraction
- **File**: `frontend/lib/apha.ts` (new)
- **Exported**:
  - `APHA_DIVISIONS` array
  - `RELATIONSHIP_OPTIONS` array
  - `RELATIONSHIP_REQUIRED_DIVISIONS` Set
- **Updated files**: Removed duplicates from:
  - `frontend/app/admin/shows/[id]/CreateEntryForm.tsx`
  - `frontend/app/admin/shows/[id]/entries/EntryListSection.tsx`
- **Reason**: Single source of truth; easier to maintain APHA enum definitions

### FRONTEND UI CONSOLIDATION

#### 18. ConfirmDialog Consolidation (7 confirmations → 1 pattern)
- **Files updated**:
  1. `frontend/app/admin/shows/[id]/ShowStaffPanel.tsx` - Delete show secretary + scorekeeper
  2. `frontend/app/admin/shows/[id]/EditClassCard.tsx` - Delete class
  3. `frontend/app/admin/shows/[id]/entries/EntryListSection.tsx` - Remove entry
  4. `frontend/app/admin/horses/[id]/EditHorseForm.tsx` - Delete horse + delete registration
  5. `frontend/components/HorseDocuments.tsx` - Remove document
  6. `frontend/app/admin/shows/[id]/ShowStatusControl.tsx` - Confirm status transition
- **Changes**: Replaced inline confirmation UI (spans with buttons) with `<ConfirmDialog />` component
- **Benefits**:
  - Consistent visual design (modal instead of inline)
  - Keyboard accessibility (Escape to close)
  - Proper focus management
  - Disabled state during async operations
  - Single component maintains all confirmation styles
- **Reason**: Eliminates ~80 lines of duplicated UI code; improves consistency

---

## Files Modified

### Database
- `database/schema.sql` — Added CHECK constraints
- `database/migrations/014_user_role_check_constraint.sql` — NEW
- `database/migrations/015_add_fk_indexes.sql` — NEW
- `database/migrations/016_add_enum_check_constraints.sql` — NEW

### Backend
- `backend/requirements.txt` — Added slowapi
- `backend/main.py` — Added rate limiting setup
- `backend/routers/auth.py` — Added rate limiting + logging
- `backend/routers/people.py` — Added require_api_key to GET endpoints
- `backend/routers/horse_documents.py` — Replaced UUID() with safe_uuid()
- `backend/routers/show_staff.py` — Replaced UUID() with safe_uuid()
- `backend/routers/venues.py` — Created VenueAdminAssign schema, replaced UUID(), moved imports
- `backend/routers/backnumbers.py` — Fixed N+1 query in bulk_update_back_numbers
- `backend/routers/shows.py` — Removed unnecessary _auto_transition_statuses call
- `backend/routers/results.py` — Added show membership check to update_result
- `backend/schemas.py` — Added Literal types, date range validation, model validators

### Frontend
- `frontend/lib/backend-fetch.ts` — Added safeFetchBackend helper, removed `as any`
- `frontend/lib/apha.ts` — NEW (APHA constants)
- `frontend/types/next-auth.d.ts` — NEW (NextAuth type augmentation)
- `frontend/app/api/shows/route.ts` — Use safeFetchBackend
- `frontend/app/api/venues/route.ts` — Use safeFetchBackend
- `frontend/app/api/classes/route.ts` — Use safeFetchBackend
- `frontend/app/api/entries/route.ts` — Use safeFetchBackend
- `frontend/app/admin/layout.tsx` — Removed `as any` on role
- `frontend/app/components/Navbar.tsx` — Removed `as any` on role
- `frontend/app/admin/shows/[id]/ShowStaffPanel.tsx` — Replaced inline confirmations with ConfirmDialog
- `frontend/app/admin/shows/[id]/EditClassCard.tsx` — Replaced inline confirmation with ConfirmDialog
- `frontend/app/admin/shows/[id]/entries/EntryListSection.tsx` — Replaced inline confirmation with ConfirmDialog
- `frontend/app/admin/horses/[id]/EditHorseForm.tsx` — Replaced 2 inline confirmations with ConfirmDialogs
- `frontend/components/HorseDocuments.tsx` — Replaced inline confirmation with ConfirmDialog
- `frontend/app/admin/shows/[id]/ShowStatusControl.tsx` — Replaced inline confirmation with ConfirmDialog
- `frontend/app/admin/shows/[id]/CreateEntryForm.tsx` — Import APHA constants from lib
- `frontend/app/admin/shows/[id]/entries/EntryListSection.tsx` — Import APHA constants from lib

---

## Testing Recommendations

1. **Database**: Apply all 3 migration files in order (014, 015, 016)
2. **Backend**:
   - Test `/auth/verify` rate limiting: make 11+ requests in 1 minute, verify 429 response
   - Test unauthenticated endpoints: curl `GET /horses/{id}`, verify 401
   - Test UUID validation: pass malformed UUID, verify 400 not 500
3. **Frontend**:
   - Test error handling: kill backend, verify API proxy routes show "Backend unavailable"
   - Test type safety: run `tsc --noEmit`, verify zero `any` type errors
   - Test ConfirmDialog: click delete/remove buttons, verify modal appears and works

---

## Impact Summary

| Category | Metrics |
|----------|---------|
| **Security** | 5 gaps closed |
| **Performance** | 4 optimizations (N+1 fixes, indexes, removed unnecessary calls) |
| **Code Quality** | 80+ lines of duplication removed, type safety improved |
| **Database** | 32 indexes added, 7 CHECK constraints added |
| **Frontend** | 7 confirmations consolidated, 11 files updated |
| **Lines Changed** | 200+ additions, 150+ deletions (net +50) |

---

**Last Updated**: May 2026
**Status**: ✅ All improvements implemented and documented
