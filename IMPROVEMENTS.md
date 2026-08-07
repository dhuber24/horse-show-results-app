# Codebase Improvements

## August 2026

### Shows Can Reward Reserving Early

Show bills price stalls, shavings and camping two ways — one number if you reserve by a date, a higher one after — because the office has to know how much of the barn to hold before it can plan the grounds. `show_fees` stored one number, so a show running early pricing collected stall reservations off-app and retyped them. **Migration 092** gives a reservable fee a second price and a deadline.

- **It's a pair, or it's nothing.** `early_amount_cents` without `early_deadline` (or the reverse) is a half-finished edit in the fee editor, not a price. Both editors and the API reject it rather than storing it, because a secretary who filled in a discount and no date believes the discount is live while the exhibitor screen says otherwise. `amount_cents` stays the standard rate, so every existing fee bills exactly as it did before.
- **The rate is decided by when you booked, never by today.** `show_entry_reservations.reserved_at` is what `fee_rate_cents()` compares against the deadline. Pricing off the current date would have silently repriced a reservation the moment the deadline passed — the one thing an early rate promises not to do.
- **Which is why sign-up stopped replacing reservations wholesale.** `PUT /register/signup` kept the same semantics (the body is the complete booking) but now updates surviving lines in place. Recreating the rows re-dates them, so an exhibitor who reserved stalls in April would have lost their early rate by coming back in July to change their arrival date. The deliberate consequence: raising a quantity on a line booked before the deadline keeps the rate on the whole line, which is how a show office behaves anyway.
- **The quote and the bill read the same number.** `GET /register/signup` returns a per-exhibitor `rate_cents` next to the standard `amount_cents`, and that is the only figure the sign-up screen multiplies by a quantity. Quoting `amount_cents` while `build_bill()` charged the early rate is exactly the disagreement `billing.py` was created to prevent.
- **Only reservations can carry one.** An early rate on a `per_entry` row would be inert — class entry fees live on `classes.entry_fee_cents` and are never reserved — so the API rejects it instead of storing a discount with nothing to apply to.

### The Visitor Show Page Stops Talking About Shavings

Someone browsing shows is deciding whether to enter. Whether outside shavings are allowed matters when they're packing the trailer, and it already appears on the sign-up screen next to the bags they order there — so it was one more line of operational detail between a stranger and the two things they can act on.

### Riders And Trainers Are The Owner's Call, Including At Creation Time

`_check_horse_access` already limited the horse's own endpoints to ADMIN or the registered owner — the rider endpoints and `PATCH /horses/{id}` both 403 for anyone else. But `POST /exhibitors/{id}/created-horses` reached the same outcomes by a different door, and a permission rule with a way around it is not a rule.

In ride mode a caller could file a horse naming somebody else as owner, and in the same request pick that horse's trainer and put it on their own profile. Reproduced before the fix: one exhibitor created a horse owned by another, with a trainer of their choosing, without the owner involved at all.

- **The trainer is dropped unless the caller claims the horse.** Not cosmetic: naming a trainer who isn't on file *creates* a `trainers` registry row, so an open trainer field on someone else's horse is a way to mint people. That `DELETE /trainers/me/horses/{id}` already exists — "lets a trainer remove a horse that an exhibitor wrongly linked to them" — says this was happening.
- **Self-attachment goes through the consent flow that already exists.** When the owner named has an account, `created_by_exhibitor_id` stays NULL and a pending `link` request is opened in the same transaction, so the horse and the question land together or not at all. Approving writes the `exhibitor_horses` row through the same `_apply_decision` the link flow uses.
- **When there is nobody to ask, nothing changes.** A brand-new standalone owner record has no user account and could never approve, so asking would only strand the horse. The rule is consent from people who can actually give it — the same test `create_request` applies.
- **The wizard stops collecting what the server discards.** Ride mode already dropped the Health step; Trainer joins it, and both clear anything staged under them when the mode flips. On a pending create the wizard doesn't call `onCreated` — the horse exists but isn't on this profile yet — and shows the same `ApprovalLinkCallout` as every other approval path, because SMTP is optional and the link has to be on screen.

### The Show Office Can Say What It Actually Looked At

The app stored registration numbers, membership numbers, and foaling dates, but kept no record that anyone had ever picked up the document behind them. "Did we verify this horse's age?" was answerable only by asking whoever worked the desk that morning. **Migration 090** gives the office somewhere to put the answer.

- **Three checks, one table.** `horse_age` (the foaling date on the papers), `horse_registration` (a registration number, per association), `exhibitor_membership` (a membership card, per association). They share `show_verifications` because the actor, the question, and the staleness rule are identical for all three; `kind` fixes which subject columns are populated, and a CHECK constraint stops a row describing a shape nobody handles.
- **A sign-off is against a value, not a row.** `verified_value` snapshots what was on file at the moment staff signed. Edit the number afterwards and the check reads back as **stale** — with both values shown — instead of quietly staying green. A live join would have made every sign-off permanent no matter what changed underneath it.
- **The client never names the value.** The endpoint takes the subject only and reads the current value off the record itself. A caller that could say what it "verified" could attest to a number nobody has on file, which is the one thing a verification record must not allow.
- **Scoped to the show, not to the horse.** This is a show attesting that *its* office saw the paper. Making it permanent would have meant one bad sign-off following a horse to every future show, and would have quietly relieved the next show of a duty that is actually theirs. Same reasoning as `coggins_override_audit`.
- **It records; it does not gate.** The Coggins gate stays the only hard stop on entry. An office halfway through its sweep still has a show to run, and a second blocking gate would have been overridden into meaninglessness by lunchtime.
- **Uniqueness is three partial indexes.** The subject columns are nullable per kind and Postgres treats NULLs as distinct, so a plain composite UNIQUE would not have stopped the same horse's age being signed off twice. The constraints and indexes are declared in `models.py` as well as the SQL — and that turned out to matter: `create_all` created this table before the migration ran, so the SQL's `CREATE TABLE IF NOT EXISTS` was a no-op and everything the live table has came from the model.

### Show Staff Can Add A Horse For Someone Standing At The Desk

An exhibitor arriving with a horse that was never added to their profile had no path forward — staff could see the problem and not fix it.

- **Scoped by roster, not by rank.** `POST /shows/{id}/exhibitors/{exhibitor_id}/horses` 403s unless that exhibitor has a `show_entries` row or a class entry at that show. Staff get this reach because the person is in front of them at *their* show, which is a much narrower claim than "secretaries may write to profiles".
- **The exhibitor owns it, and can see it.** Ownership alone does not put a horse on someone's profile list — that reads `created_by_exhibitor_id` or an `exhibitor_horses` link — so the staff path writes the link, and the horse appears in their own list and the Add Entry picker straight away.
- **The trail is honest.** `created_by_exhibitor_id` stays NULL, because they did not add it, and a new `horses.created_by_user_id` records the staff member who did. A horse appearing on a profile with nothing saying where it came from is exactly the surprise worth spending a column on.
- **The request body has no owner field to abuse.** The staff schema declares none of the owner-selection fields, and the shared builder drops the inherited `owner_exhibitor_id`, so no body shape can point the horse at a third party. That builder and the registration pre-check are now shared with the exhibitor's own add-a-horse wizard rather than duplicated.

### The Read-Only Banner Only Warns People Who Could Have Been Scoring

Every visitor to a non-`ACTIVE` show read "Read-only — results can only be entered when the show is Active." Exhibitors and spectators can never enter results at all, so it announced a restriction that was not about them and read like something had gone wrong with the show. It is now shown only to the roles with a scoring screen to be locked out of.

### A Show Page That Works For People Who Aren't Members Yet

A visitor who found a show got the same screen as an entered exhibitor: a class schedule. It answered a question they hadn't asked and left out the two they had — can I enter, and how do I reach these people?

- **Signed out, `/shows/[id]` is now event details plus two actions**: *Register for this show* and *Contact show staff*. The classes fetch is skipped entirely for them rather than fetched and hidden.
- **The gate is on the browsing path only.** `/live`, `/schedule` and `/results` stay open, because they are the at-the-rail screens people reach by QR code mid-show — favorites live in `localStorage` precisely because those readers have no account. Closing them would have broken a deliberate design to satisfy a different one; since the show page no longer links to the schedule for visitors, the funnel works without that.
- **Register keeps its destination.** `?next=` was already being passed by several `redirect('/login?next=...')` call sites and silently ignored — both forms pushed to `/`. They now honour it, carry it across the login ↔ register cross-links, and sanitize it through `safeNextPath()`: same-origin absolute paths only. A redirect target from a URL a stranger composes is an open redirect waiting to happen, and `//evil.com` looks like a path until a browser reads it.

### The Contact Form Is An Inbox, Not A Relay

The obvious build is "email the secretary and manager". This deployment has no SMTP configured, so `mailer.py` returns None and logs — every message would have been accepted, reported as sent, and lost. A contact form that loses messages is worse than no contact form.

- **`show_contact_messages` (migration 091)** stores them; staff read the show's inbox at `/admin/shows/[id]/messages`, with an unread badge on the dashboard tile and a `mailto:` reply link. A notification layer on top is additive and changes none of this.
- **The one endpoint strangers can write to is treated as such**: rate limited to 5/minute per IP, message length capped, and shows that aren't publicly visible return 404 — identically to shows that don't exist, so probing ids reveals no drafts. Reading and triage are staff-only via `_assert_show_access`.
- Every sender field is self-reported and joined to nothing. The people this serves have no account by definition, so `sender_email` is a string to reply to, never an identity.
- One bug worth recording: `from __future__ import annotations` plus slowapi's `@limit` decorator produces a `PydanticUserError` at *request* time, not import time — the rewrapped signature loses the module globals FastAPI needs to resolve `UUID`. `auth.py` omits the future import for the same reason.

### Back Numbers Were Being Read From The Wrong Column

Assigning a back number wrote it to `show_entries.back_number` — correctly — and then four screens read `entries.back_number`, a legacy per-entry column that nothing has written since assignment moved to the show level. It is NULL on every recent entry, so the screens rendered a dash. No error, no warning, no log line: the exact shape of bug that survives review, because the code reads like it works.

Reported against the class schedule; it was also live on the scorekeeper form, the admin entry list, and the gate screen — where the steward calls exhibitors by the number that wasn't there.

- **`backend/backnumbers.py` is now the one resolver**: prefer the show-level number, fall back to the legacy column. `GET /classes/{id}/entries/` and the gate endpoints resolve server-side, so every consumer is fixed without touching the pages. Ordering moved with it — the entry list had been `ORDER BY entries.back_number`, which is not an ordering when the column is uniformly NULL.
- **A second, separate bug on the public class page**: it overlaid back numbers from `/shows/{id}/back-numbers/`, a staff-only endpoint, called with no auth headers. Every request 422'd, `fetchShowBackNumbers` swallowed it with `if (!res.ok) return []`, and the page silently fell back to the NULL column. The helper is deleted rather than fixed — a public page has no business calling an access-gated endpoint, and a fetch helper that turns an auth failure into an empty list will hide the next one too.
- The public schedule's program listing was already correct: `program-index` resolved `show_entries` properly. One read path getting it right while four got it wrong is the argument for the shared resolver.

### The Schedule Tells An Exhibitor Which Classes Are Theirs

The class schedule had one filter, **My classes**, which was per-device starred classes — nothing to do with what the exhibitor had entered. An exhibitor standing at the rail wanting "just my classes" got the ones they had happened to tap a star on.

- **My classes → Favorites.** The name now says what the button does, which frees the honest name for the thing people were looking for.
- **Registered** filters to the classes the signed-in exhibitor is actually entered in, sourced server-side from their own entry list and passed in as a prop. It is rendered **only for exhibitors** — a spectator has nothing to be registered in, so the control would be permanently dead — and the fetch degrades to an empty list on failure, because the schedule is a public screen that has to keep working signed-out.
- The two **intersect** rather than replace each other ("starred *and* entered" is a real question on a long day), and either one spans all show days, since neither your classes nor the horse you are tracking run on just one.

### Nobody Else's Horse, And Nobody's Horse Without Being Asked

Anyone could put anyone else's horse on their profile with one click, which also put it in their show-registration picker. The owner was never told. And there was no way to hand a horse to its new owner at all, so a sale meant the seller kept the record and the buyer built a duplicate. **Migration 087** makes both a request that only takes effect when a specific person says yes.

- **One table, two directions.** `kind='link'` is someone asking the owner for access; `kind='transfer'` is the owner offering ownership, which the recipient accepts. `approver_exhibitor_id` is always "whoever must press the button", so `_apply_decision` is a single code path rather than two implementations of what approval means.
- **`POST /linked-horses` still links outright when nobody owns the horse.** That is the honest case — there is no one to ask, and requiring approval from a free-text `owner_name` would just block the flow. When there *is* an owner it returns `409 OWNER_APPROVAL_REQUIRED` carrying their name, and the profile screen turns that into "Ask {owner} for approval" instead of dead-ending on an error.
- **Transfers need the recipient's yes.** Ownership carries the Coggins and registration obligations that gate entries; nobody should acquire those because someone else clicked a button. Only exhibitors with accounts are offered as targets, since accepting means signing in. The former owner keeps whatever profile access they already had — a sale should not erase the horse from the seller's record mid-show.
- **The link is always on screen.** `backend/mailer.py` sends over stdlib SMTP when `SMTP_HOST` is set and returns `None` (logged, non-fatal) when it isn't, so the create response also carries `approval_url` and the UI always renders it to copy. "We emailed them" is not a plan when mail is optional and spam folders exist; `email_sent` records which actually happened.
- **Two ways to answer, one effect.** The emailed token page needs no session, because the recipient of a transfer may never have used the app. Signed-in approvers answer in place from the My Horses tab instead, since being logged in as the approver is at least as strong a claim as holding the token — the alternative was telling someone to go find an email that may not have arrived.

### Sign Up For The Show Before You Enter Its Classes

Class entry was the first and only thing an exhibitor told a show. Stalls, shavings, and camping were collected off-app and retyped, and the exhibitor's bill was only ever class fees. **Migration 088** makes the show-level record the deliberate first step.

- **`show_entries` gained `registered_at` rather than a sibling table.** It already *was* the show-level record — it is what carries the back number. A row with a timestamp is a completed sign-up; a row without one is the shell a secretary created adding a late entry by hand. Class self-registration now returns `409 SHOW_SIGNUP_REQUIRED` instead of quietly creating that shell itself.
- **Reservations point at `show_fees`, not at new columns.** The secretary already configures stall / tack stall / shavings / RV / dry camping rows with real prices. Fixed columns would have been a second place to configure them and would have silently dropped whatever tier a given show offers. What is reservable is derived from the fee's *unit* — `per_stall`, `per_bag`, `per_night` — so a show's own custom per-stall fee appears in the picker with no schema change.
- **The backfill sets `registered_at` from `created_at` on every existing row.** People already registered are signed up; a gate that locks out the exhibitors it was built for is not a gate.
- **`build_bill()` in `backend/billing.py` is now the only thing that computes money.** Three screens quote the same total, and they were on their way to three implementations of it. It also fixed a real disagreement: the registration screen multiplied the office charge by distinct horses regardless of `shows.office_charge_basis`, so a `per_back_number` show over-quoted every exhibitor bringing more than one horse.
- **My Shows** (`/my-shows`, the renamed navbar button) shows the itemized bill per show; **Show History** on the profile and **My Show Entries** read the same endpoint, so the three cannot drift.

### Taking A Class Off Is As Ordinary As Adding One

Withdrawing an entry existed, as a small text link tucked inside the green "entered" badge next to the class. Exhibitors reported not being able to remove classes they had picked by mistake — which is what an affordance that can't be found amounts to. Entered classes now list in a panel at the top of the registration screen, each with a labelled **Remove** button and an inline confirm, and the same control repeats beside the class itself.

### A Judge Is A Person, Not A Line On A Show

Show setup asked the secretary to type a judge's name, email, phone, and affiliations into every show that hired them, then offered a "pick a previously-entered judge" dropdown that pre-filled those fields and let them be edited again. The same judge ended up spelled three ways across three shows, with whichever affiliations were ticked that day. **Migration 085** makes the judge the record.

- **`judges` + `judge_associations`.** The person, and what they are carded with. The cards point at `associations` — the registry of bodies a horse or person is affiliated with — not at `show_types`, which is show configuration. The old affiliations were carried across by matching codes; OPEN affiliations were dropped, because OPEN has had no `associations` row since migration 080 and never meant an affiliation in the first place.
- **`show_judges` is now only an assignment**: show, judge, running order. Its `first_name` / `last_name` / `email` / `phone` columns were dropped rather than kept "for display" — a second copy of a fact is a second chance to be wrong, and the reason a pick-then-edit form drifts in the first place.
- **Identity is name + email**, enforced by a unique index, which is the same rule the old dropdown applied in Python. The migration deduplicates existing judges by it before the drop, collapsing case and whitespace variants into one row.
- **`judge_id` is `ON DELETE RESTRICT`.** A judge who has officiated a show cannot be deleted out from under that history; unassigning them from a show leaves the registry record alone.
- **Setup picks; it cannot edit.** The step shows the picked judge's cards and contact details read-only, with a line saying corrections are made in the registry. `PATCH /judges/{id}` is admin-only, because that record is shared by every show the judge has ever worked and a typo fix in one show's setup should not silently rewrite the others. A judge who isn't in the registry yet is added to it and assigned in one step, so the flow still ends where it did.
- Verified against a throwaway Postgres in both directions: an upgrade from messy data (same judge under three spellings, a duplicate on one show) and a fresh `create_all`-shaped database, which the startup race makes a real case. Re-running is a no-op.

### Setup Steps Say What Clicking Them Does

Completed setup steps were badged "Done" — an accurate word that told the secretary nothing, since the row was still a link. They now read **Edit**, matching the class wizard's overview, which already did.

Three related fixes in the same pass, all of the same shape — the screen should be mostly the thing you are doing:

- **The class picker comes first and the schedule folds underneath it.** Step 3 of the class wizard listed every class added so far *above* the matrix, so on a built-out show the picker started below the fold. The list moved below the picker and collapsed behind a "Classes added (N)" disclosure; the live count and the ✓ on the cell are the feedback that a click landed, and the list still opens for drag-to-reorder and delete.
- **Save buttons that stick.** Steps 1-3 now end in a shared `StepFooter` fixed to the bottom of the viewport. The previous footers were real buttons at the bottom of a very long standard-library list or class matrix, which is indistinguishable from having no save button — that is how it was reported. Step 3 also gained a finish control in hub-edit mode, where it previously had none, and it is disabled while class creates are still draining.
- **"+ Request new sanctioned club"** is a one-line link on the sanctioning step instead of a permanently expanded name-and-notes form. Requesting a club is the rare path; picking one is the common one.

### The Coggins Extractor Reads The Whole Form

The first extraction schema covered the fields the app stores plus a few for verification. Against a real VS 10-11 layout it was missing most of the form: owner and stable, clinic licence number, microchip, markings, breed, age, the lab's received and reported dates, test type and reason, and the signing technician. The schema now follows the form's five sections, because the section a value sits under is what identifies it.

- **Three dates, easily transposed.** Blood drawn, received by lab, reported by lab. Validity runs from the **draw**, so the derived-expiry offer uses `test_date`; using `date_reported` would quietly hand the horse the days between the draw and the report. The prompt calls the distinction out explicitly and tells the model to flag a bare "Date" its section cannot resolve.
- **A positive result is extraordinary, and treated that way.** A non-negative sample is escalated to federal authorities rather than issued as a routine certificate, so a finalized form reading POSITIVE is either a serious finding or a misread. The model returns it only when unmistakably marked, and `reviewWarnings()` surfaces it as a red banner rather than a quiet row in a detail list — the same for a form with no identity photos or diagram.
- **Identity images are reported present/absent only.** The model is told not to describe them: the reviewer has the document open, so a generated description adds nothing and risks inventing detail. Microchip numbers get the opposite treatment — transcribe every digit, flag any uncertainty, because one wrong digit identifies a different horse.
- **`twelveMonthsAfter()` clamps Feb 29 to Feb 28** instead of rolling into March. This date gates eligibility, so an ambiguous calendar should round against extra eligibility.
- No migration was needed. `extracted` is JSONB stored whole precisely so the schema can widen without one, and nothing new is persisted onto `horse_documents` — the added fields are for the human verifying that the right document is attached to the right horse.

### Extraction Reaches The Add-A-Horse Wizard

Extraction shipped against `HorseDocuments`, which needs a horse that already exists. The wizard's Health step stages documents in the browser and saves them only after creation, so it was the one upload path extraction could not reach — and it is where an exhibitor files their first Coggins, which made it the surface that mattered most.

- **Migration 084** drops NOT NULL from `document_extractions.horse_id`. A read genuinely can precede its horse; the column is filled in when the queued document is saved, in the same transaction that links the document. The upload endpoint treats a NULL `horse_id` as claimable rather than as a mismatch.
- **`POST /documents/analyze`** serves the wizard. Its gate is weaker than the horse-scoped endpoint by necessity — with no horse there is nothing to check ownership against, so authentication is all that is left. A signed-in user can read any file they already hold; they learn nothing about anyone else's data, but it spends tokens, so it is rate limited to 20/minute.
- **The limit is keyed on the user id, not the client address.** Every request arrives from the Next.js server, so an IP-keyed limit would be a single global bucket and one busy user would lock out the rest. Verified: user A exhausted its budget while user B's next request went straight through.
- **Shared UI moved to `frontend/lib/document-extraction.ts`** — labels, `asText`, `twelveMonthsAfter`, and an `analyzeDocument()` helper that picks the right endpoint. Both surfaces render the same review panel, and copies in two components would have drifted.
- The wizard needs no auto-upload suppression: "Add Document" is already a deliberate click, so the human-confirms rule holds by construction.

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
