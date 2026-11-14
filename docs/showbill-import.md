# Setting A Show Up From Its Show Bill

Upload the club's own printed show bill, let the model read it, confirm the
show's name, breed association and dates, press **Create draft show and start
setup**. The show, its judges, club sanctioning, the class schedule with its
prices, and the fee catalogue are made in one transaction as a **DRAFT**, and the
PDF is put on file as the show's uploaded bill. Then the office walks the
ordinary setup steps: every doubt about what was read is a **check** on its step,
highlighted on the field it is about, and the show cannot be published until
each one is answered (migration 187).

## Why

A real show is a lot of keying. The MNSPHC Paint-O-Rama is 172 classes over two
days, four judges, two sanctioning clubs and fourteen fee lines — and the club
had already laid every one of those out once, in the bill it sent to the
printer. `scripts/seed_mnsphc_paint_o_rama.py` is a day's hand transcription of
exactly that document. This feature is that transcription, done by the model and
checked by a person.

## The rule

**The model suggests. A person decides before an exhibitor sees it.** A show
bill decides what every exhibitor at the show is charged. So:

- The upload creates **nothing** but a `show_bill_imports` row.
- Create needs a person's press, with the four values a show row cannot exist
  without — name, breed association, first and last day — confirmed on the page.
- The show is created as a **DRAFT**, and **cannot leave DRAFT while a check is
  open** (`routers/shows.py::update_show`, mirrored in `ShowStatusControl`). That
  is the one door between the read and the exhibitors, and it is enforced, not
  advised.
- **Nothing shared is written from the read alone.** Judges, venues and clubs
  are rows every show uses, so only a confident match is attached — one
  registry judge of exactly the bill's name, one venue of exactly its name —
  and that match is itself a check. A judge or venue the app cannot match is a
  check carrying what the bill printed, added with the step's own form at a
  press; a club the registry lacks is a check, never a new club.

**Why the show is created first** (2026-11-13). The review used to be one long
screen with the whole show on it before anything was created. It was a second
copy of every setup step's form — the Judges step, the Fees step, the Class
Builder, each drawn again and drifting from the real one — and the reader's
doubts were a list of sentences at the top, tied to nothing. Leaving the page
lost every edit made on it. Now the setup steps are the review: each doubt sits
on the field it is about, in the screen that edits it, and is saved with the
show so a review survives being left.

## A paid feature

Starting a show from its show bill is the first thing in this app a customer
pays for: every read spends model tokens on a document tens of pages long. It
is sold to the **show company** — the club or firm that runs the shows — as
part of **GaitDesk Pro and Pro+** (migrations 168–170, `backend/show_companies.py`),
and reaches every account in the company. It is not sold on its own: the
per-feature switch it started with was retired in migration 170, and a company
gets it by moving to Pro, which it does itself on My Company. An `ADMIN` always
has it.

- **Every door but `/availability` is gated**, by
  `Depends(require_feature(SHOWBILL_IMPORT))`: the upload, the list of recent
  reads, polling a read, and the Create. Gating only the upload would let a
  company that stopped paying go on creating shows from reads already taken.
  Turning the feature off keeps the rows; turning it back on picks a review up
  where it was left.
- **`GET /show-bill-imports/availability`** answers `available` (is a key
  configured) and `enabled` (has the caller's company paid) separately, because
  they are different messages: one is the server's, the other is the customer's.
- **The feature is sold where a show starts.** `AutomateShowCard` sits on
  `/admin/shows` and `/admin/shows/new` for every role that can create a show:
  a one-row strip with the same pitch for everybody, and on its right an
  **Upload show bill** button for a company on the plan, or for one that is
  not an **Upgrade** link (to the plan chooser on My Company) beside a lock line naming whose company it
  is (*"You must upgrade to GaitDesk Pro to enable this feature"* is the
  line's hover and screen-reader text). The plan's name is `plan` on the feature in
  `show_companies.FEATURES`, reaching the page through `GET /users/me/features`
  (`catalog`), so the button, the show-bill pages and the 403 all name the same
  subscription and renaming it is one edit.
- **The locked door leads to the plan** (migration 170). On the strip
  (*Upgrade*) and on both show-bill pages' upgrade message (**Upgrade to GaitDesk
  Pro**), one link (`UpgradeToProLink`) goes to the plan chooser on My Company,
  where the company picks Pro and is billed after each show. It replaced a
  *Request upgrade* button (migration 144) that asked GaitDesk to turn the
  feature on, from before companies chose their own plan.
- **The screens only decide what to offer.** Both show-bill pages print the same
  upgrade message instead of a form. The endpoint is the enforcement — a stale
  page costs an offer, never a read.

## Scope

| Read and created | Read, listed, **not** created |
| --- | --- |
| Show name, dates, entry deadline, breed association (show type), APHA/AQHA show numbers, APHA zone | Show officials (managers, secretaries) — the app does not create logins from a bill |
| Venue, when one on file has exactly its name (else a check to pick or add it on Step 1) | Side pots and jackpots |
| Judges the registry holds exactly one of (the rest are checks to add on Step 2) | A futurity's categories, fees, deadline and Hi-Point awards |
| Club sanctioning and each club's separate fee | Awards, sponsors, refund policies |
| Every class: day, name, discipline, division, class code, price, which clubs sanction it, whether it is a Grand & Reserve call-back | |
| Health paperwork required, the outside-shavings ban | |
| Stalls, shavings, camping and the show's own charges, with units | |

Futurity money is often not on the printed bill at all (MNSPHC takes it on a
Cognito form), and a futurity is a programme — categories, tiers, divisions —
that a review table would squash. The bill's futurity classes *are* created,
flagged and priced at $0 (a futurity class must carry `entry_fee_cents = 0`);
the futurity itself is set up in Step 6 and the classes added to it there.

## Flow

1. `/admin/shows/new` links to `/admin/shows/new/from-showbill` when the
   caller's show company has the feature (see above).
2. The upload (`POST /show-bill-imports/`) checks the file the way
   `show_documents` does — magic bytes, 10 MB — writes a `pending` row and
   answers **202** at once.
3. The read runs in the background (`showbill_import.start_read`), in its own
   database session, and writes the result onto the row.
4. `/admin/shows/new/from-showbill/[importId]` polls
   `GET /show-bill-imports/{id}` every few seconds. Once the read has
   succeeded the response carries `extracted` (what the bill said) and
   `resolved` (what the app matched it to), and the page summarises what
   Create will make and asks for the name, breed association and dates — each
   prefilled, with the reader's doubt beside the box it is about.
5. `POST /show-bill-imports/{id}/create-show` (`ShowBillImportStart`) builds
   the payload from the read (`showbill_checks.draft_from_read`), creates the
   show through `apply_import`, and records its checks — one transaction. The
   browser lands on Step 1.
6. The office walks the steps. Each lists its own checks at the top and
   highlights the field each is about; the tab bar, the sidebar, the hub and
   the show dashboard count what is left.

### Why the read runs in the background

A horse document is one page and comes back while the uploader waits. A show
bill is ten or twenty pages and a structured transcription of every class on
it, which takes minutes — longer than anybody should hold a request open
through the Next.js proxy. The row is written `pending` before the read starts,
and **a pending row older than twenty minutes is reported as failed by the
reader** (`effective_status`), because the process that owned it is gone (a
deploy, a restart). No sweeper job exists to be forgotten.

The upload page lists the caller's recent reads, so somebody who wandered off
while one ran has a way back to their review.

## What the model is asked

`backend/extraction/showbill.py` — structured outputs, streaming,
`effort: high`, and `max_tokens` of 100k because thinking and a 172-class
answer share the budget. It carries the server-side refusal fallback
(`server-side-fallback-2026-06-01`), so a policy decline re-runs the request on
the fallback model rather than losing the read.

**The bill is read in two passes**, each held to its own schema: `HEADER_SCHEMA`
(the show, judges, clubs, class rates, fees, what was not imported) and then
`CLASSES_SCHEMA` (the class list). The second pass is told the rate keys the
first chose, so every class's `rate_key` still points at a rate. The split is
forced by two API limits on a structured-output schema, both of which refused
every upload as `BadRequestError` until 2026-11-12:

- **At most 16 union-typed properties** (a `["string", "null"]` type or an
  `anyOf`). The schema had 34. Optional *text* is now a plain string the model
  leaves empty, which `_clean_str` reads as `None`, so everything downstream sees
  exactly what it did; numbers, booleans and enums keep `null`.
- **"The compiled grammar is too large."** The whole bill in one schema is
  refused even though each half compiles, so the class list has its own pass.

`test_showbill_import.py` pins the union count per schema. The grammar limit
has no local check — the API compiles the grammar — so a field added to either
schema should be tried against the API once before it ships.

No prompt caching: the output schema sits ahead of the bill in the prompt
prefix, so the two passes share no prefix — measured, the second pass read
nothing from the cache and both paid the 1.25× cache write. Both read the bill
at the plain input rate.

**Doubts are tagged, not fields.** The reader puts a doubt about one class on
that class's `note`; anything else goes in `warnings`, starting with a tag that
says what it is about — `[start_date]`, `[venue]`, `[requires_coggins]` for a
show detail, `[judge: Jane Smith]`, `[club: WSCA]`, `[rate: apha_open]`,
`[fee: Stall]` for one item. A line of `not_imported` about a futurity, a side
pot or a hi-point award starts `[futurity]`, `[side_pot]` or `[high_point]`, so
it shows on the step that sets it up. `normalize_showbill` (`route_warnings`)
reads the tags back into `show_checks` and each item's `check`; an untagged
line, an unknown tag, or an item it cannot find stays a warning about the
whole bill, with the item's name kept. **Tags rather than schema fields because
the header schema is at the API's grammar limit**: on 2026-11-13 adding even
one `check` string to each of four item types was refused as "The compiled
grammar is too large", while the committed schema still compiled.
`test_doubts_cost_the_header_schema_nothing` pins it.

Two instructions matter more than the rest:

- **Class prices go in `class_rates`, never in `fees`.** A class price stored as
  a `per_entry` fee row bills every entry *on top of* the class's own price —
  a $36 class came to $552 on a real bill (see [design/billing.md](design/billing.md)).
  Classes point at a rate by key, so the reviewer checks five prices rather than
  a hundred and seventy.
- **Transcribe, never multiply.** A bill quotes "$9 per judge"; the app stores
  the multiplied figure on the class. The model reports the per-judge amount and
  says it is per judge; `showbill_checks` multiplies it by the judges the bill
  names and says so in a check on the Fees step — because the panel is one of
  the things the office may change.

When unsure whether a fee applies to everyone, the model is told to use `flat`:
a flat fee is printed and bills nobody, so the reviewer can promote it, while a
wrongly automatic fee bills everybody who enters.

## What the app matches

`showbill_import.prepare_draft`. Every match is a suggestion the reviewer can
overrule, and the screen says what each was matched on.

| Thing on the bill | Matched to | Rule |
| --- | --- | --- |
| Breed association | `show_types` | By code |
| Venue | `venues` | Normalised name; where two venues share a name, the city too |
| Judge | `judges` | First and last name, normalised. **One** exact match is suggested; several people of one name are all offered and none picked; a same-surname judge is a candidate, never a suggestion |
| Judge's cards | `associations` | By code; used only for a judge being **created** |
| Club | `associations` (club rows) | Code, then name. The breed body listed among the clubs is flagged and left out — it is the show type named twice |
| Class discipline | the classifier (`rules/disciplines.py`) | See below |

**A registry judge's cards are not edited from here.** The registry is shared
by every show that judge ever worked, and editing it is admin-only. The bill's
"APHA/WSCA" beside a judge is used when the judge is created, and nowhere else.

### Routing a class to a discipline

Two pieces of evidence, each right where the other is wrong:

- The **heading** the bill printed the class under, when it names one of the
  app's disciplines in any case. It rescues "Yearling Fillies" (nothing of
  halter in the name; and bare "HALTER" is not a classifier keyword), and keeps
  "Ranch WT Trail" in Ranch Trail and "Lead Line Trail Ages 3-8" in Lead Line —
  both of which the name alone routes to plain Trail.
- The **class name**, through the ordered classifier — which wins over a known
  heading only where it names a more specific form of it: "In-Hand Trail" under
  TRAIL, "Performance Halter" under HALTER.

A heading the app has never heard of is kept as a discipline of its own rather
than dumped in "Unassigned". Against the hand transcription of the MNSPHC bill
this agrees on all 172 classes.

## Checking it, step by step

`backend/showbill_checks.py` makes the checks; `frontend/components/BillChecks.tsx`
shows them, inside `StepLayout`, from the list `fetchStepCounts` reads. The
confirm page before Create is `StartClient.tsx`, its state in
`frontend/lib/showbill-import.ts`.

| Step | What is checked |
| --- | --- |
| 1. Basics & Staff | The reader's doubts about the show's own fields; a venue matched in another city, or not on file (*Add …* creates it from the bill and picks it — a manager or admin); the show officials the bill names; lines not imported; doubts about the whole bill |
| 2. Judges | Each judge attached on the name alone; each judge not attached (*Add …* fills the new-judge form from the bill, or opens the list when people of that surname are on file — adding them accepts the check) |
| 3. Lodging | The stall, shavings and camping lines; another booked line, with a link to Boarding Fees; the outside-shavings rule |
| 4. Class Builder | A class's note; a class whose day could not be read or fell off the show's dates (put on the first day); a class the bill prints twice on a day (only the first is created) |
| 5. Sanctioning | A club's fee as read; a club the registry lacks, with the classes the bill marked for it |
| 6. Futurities & Side Pots | The futurity classes, created at $0; futurity and side-pot lines not imported |
| 7. Fees | **One check per class rate**: how many classes it priced, and the arithmetic — `$5.00 × 2 WSCA judges named on the bill = $10.00` — with a link to Entry Fees; classes the bill left unpriced; every fee that bills everybody who enters, `per_entry` said to be on top of the class price |
| 8. Scoring | Hi-point lines not imported |
| 9. Paperwork | Each health paper the bill never mentions, and what that left it at |

- **A check closes when it is accepted, or when what it is about changes.** A
  check about a field stores the value the show was created with
  (`show_bill_checks.value`); changing the field closes it (`changed`),
  deleting its row closes it (`removed`), and changing it back reopens it — all
  decided on read (`check_state`), never stored. A check about no field closes
  only on Accept. An Accept can be undone.
- **A per-judge class price is multiplied by the judges the bill names**, by the
  carded-judge rule billing uses (`per_judge_count`): the judges carded with the
  rate's association, or the whole panel. The class prices are worked out
  before anybody has picked a judge, so they do not follow the panel
  afterwards — which is why every rate is a check that says what it was
  multiplied by.
- **Not a paid feature.** The import is, but a company that moves off Pro must
  still be able to answer its checks, or its show could never be published.

## Creating the show

`showbill_import.create_show_from_read` builds the payload with
`showbill_checks.draft_from_read` — pure, and what `test_showbill_checks.py`
exercises — and hands it to `apply_import`. **The payload is always creatable**:
a value the create would refuse is left off or moved and becomes a check (a
deadline after the show starts, a class off the show's dates, a second class of
a name on a day, an early rate the fee editors would refuse). A first day moved
on the confirm page moves the schedule with it, day for day.

`showbill_import.apply_import`, one transaction:

- The import row is locked `FOR UPDATE`; a second press gets 409 with the
  `show_id` the first one made.
- The show is created as `POST /shows` creates one, with the caller's
  `show_managers` / `show_secretaries` row.
- No venue or judge is created from a read (`create_show_from_read` sends only
  registry rows). `apply_import` can still create both from a payload that asks,
  under the rules `POST /venues` and `POST /judges` keep.
- **Classes** go through `routers/classes._create_classes_auto_routed` — the
  Class Builder's own importer — a day at a time in program order, so the
  running number it assigns is already the schedule's 1..N. The bill's printed
  numbers ("2-3", "A") are named in a class's checks and not kept: the app
  numbers sequentially and renumbers on every add, so a kept "2-3" would be gone
  the first time somebody added a class.
- A class code is kept only at a breed show. An Open show has no catalogue to
  hold one against.
- **One class of a name per show day**, the Class Builder's rule.
  `apply_problems` refuses a payload that breaks it; `draft_from_read` never
  sends one.
- **Fees** are validated with the fee editors' own guards (early-rate pair,
  bedding-only minimum). The main stall, shavings and camping lines take the
  Lodging step's codes (`stall`, `shavings`, `camping`) so Step 3 opens on the
  rows the bill priced — a stall imported as `horse_stall` would leave that
  step's Stalls card empty, and filling it in would bill a second stall. Only a
  line that reads as the main one gets a slot: tack stalls and early-arrival or
  late-departure nights stay on the Boarding Fees screen. No other fee is ever
  given one of those codes.
- **The PDF goes on file** as the show's `SHOWBILL` document when the box is
  ticked (it is by default). `showbill_source` stays `generated`: switching the
  Show Bill button to the upload is the deliberate second press in Step 10 that
  it always is.
- The checks are written against the rows just created
  (`showbill_checks.check_rows`): the show, a class, a fee by id; a judge or a
  club by the registry id the payload already carried.
- The import row records `accepted` (the payload the show was made from) and
  `show_id`.

## Storage

`show_bill_imports` (migration 141):

| Column | Notes |
| --- | --- |
| `created_by_user_id` | Whoever uploaded it; an import is theirs (or an admin's) to read and apply |
| `original_filename`, `mime_type`, `file_size`, `file_data` | The bill, kept so the show can have it on file |
| `status` | `pending` → `succeeded` / `failed` / `unsupported_media` |
| `extracted` | The normalised read, JSONB |
| `accepted` | The payload the show was made from |
| `show_id` | The show that came of it; NULL until applied |
| `model`, `input_tokens`, `output_tokens` | Which model read it, and what it cost |
| `created_at`, `completed_at`, `applied_at` | |

`show_bill_checks` (migration 187): one row per check — `step` (a wizard key),
`target_type` / `target_id` / `field` (the record and column, or all NULL for
one about the step), `value` (that column as created), `message`, `source`
(`bill`: the reader said so; `app`: the app's own look at the read), `action`
(what a one-press fix needs — the judge or venue the bill named, or a link),
`accepted_at` / `accepted_by_user_id`. Its state is not stored; see above.

No relationships on the import model, deliberately: `file_data` is a multi-megabyte
BYTEA and the confirm page polls this row every four seconds, so readers
select columns by name — the rule `ShowDocument` already follows.

## Configuration

`ANTHROPIC_API_KEY`. **Optional**: unset,
`GET /show-bill-imports/availability` says so, the upload page says so and
links to the step-by-step setup, and the list of recent reads still shows — a
read that finished before the key was removed can still be reviewed and
created. Uploads are rate limited to ten an hour per user, keyed on the user id:
every request reaches the backend from the Next.js server, so an IP-keyed limit
would be one global bucket and a single busy user would lock out everyone else.

## Sharp edges

- **The bill's printed class numbers are not kept.** See above; a check about
  a class names its printed number ("bill #2-3") so it can be found on paper.
- **Club classes a registry club does not exist for cannot be designated.** A
  club is added to the registry by an admin, or requested by a manager through
  `sanctioned_association_requests` from the Sanctioning step; a check on that
  step says so and names the classes the bill marked for it.
- **An import is applied once.** Re-running means uploading again — the row is
  the record of which show that read became.
- **The fixture for testing without a key** is the MNSPHC seed transcription
  written as a succeeded row; it exercises everything after the model call.
  With a fifth invented judge on the panel, the created prices matched the
  seed's hand-multiplied figures class for class.
