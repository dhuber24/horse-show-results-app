# Setting A Show Up From Its Show Bill

Upload the club's own printed show bill and let the model read it. On the
confirm page, check the show's name, breed association and dates, find each
judge and the venue in the directories (or add them), and look over the two
notes drafted from the bill. Then press **Create draft show and start setup**.
The show, its judges and venue, club sanctioning, the class schedule with its
prices, the fee catalogue, and every futurity and side pot the bill runs are
made in one transaction as a **DRAFT**, filled in as far as the bill allows,
and the PDF is put on file as the show's uploaded bill. Nothing afterwards
waits on an Accept: what is worth a second look is listed in the show's
**office notes**, and what the bill tells exhibitors that no field holds is its
**show notes** (migration 189).

## Why

A real show is a lot of keying. The MNSPHC Paint-O-Rama is 172 classes over two
days, four judges, two sanctioning clubs and fourteen fee lines — and the club
had already laid every one of those out once, in the bill it sent to the
printer. `scripts/seed_mnsphc_paint_o_rama.py` is a day's hand transcription of
exactly that document. This feature is that transcription, done by the model and
checked by a person.

## The rule

**The model fills in; a person decides who a name is.** A show bill decides
what every exhibitor at the show is charged, so:

- The upload creates **nothing** but a `show_bill_imports` row.
- Create needs a person's press, with the four values a show row cannot exist
  without — name, breed association, first and last day — confirmed on the page.
- The show is created as a **DRAFT**, which no exhibitor sees. The office
  publishes it from setup when it is right, like any other show.
- **Nothing shared is written from the read alone.** Judges and venues are rows
  every show uses, so only an exact match is attached on its own — one
  directory judge of exactly the bill's name, one venue of exactly its name.
  Anyone else the person **finds in the directory, or adds**: a judge with an
  **email or a phone** (what tells two people of one name apart — a second row
  for somebody already there, with nothing to tell them apart, is the outcome
  the registry never recovers from), a venue with its **full address**. A new
  judge's form has its own **Save judge** button, which adds them to the
  directory there and then (`POST /judges/`) and turns the row into a settled
  directory pick; a form left unsaved is still added when the show is created,
  so Save settles a judge early rather than gating Create. A judge the bill
  names who is not judging (a steward misread, say) can be left off.
  A club the registry lacks is a line in the office notes, never a new club.
- **Everything else is filled in, and doubts are written down, not gated.**
  Every doubt about the read — the reader's own, and the app's (what a
  per-judge price was multiplied by, a fee that bills everybody who enters, a
  class moved to the first day) — is a line of the office notes, under the setup
  step that edits it. The office changes what looks wrong.

**Why nothing waits on an Accept** (2026-11-15). Migration 187 made each doubt a
check on its setup step that held the show in DRAFT until somebody pressed
Accept or changed the field. That made a review a round of pressing Accept on
values the office could simply change, and it made checks of lines the bill
printed with no field to hold them (a sponsor, the refund policy). The notes
carry the same doubts, in the place the office already reads, and the setup
steps are where anything is changed.

**Why the show is created first** (2026-11-13). The review used to be one long
screen with the whole show on it before anything was created. It was a second
copy of every setup step's form, drifting from the real one, and leaving the
page lost every edit made on it. Now the setup steps are the review.

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
  `/admin/shows/new`, above Step 1's form, for every role that can create a show
  (not on the `/admin/shows` list, whose *+ Create New Show* button leads there;
  that list shows a read still running or waiting to be created, above the shows):
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

A read holds only what the app has a place for; what has no field is said in
one of the two notes.

| Read and created | Said in the notes |
| --- | --- |
| Show name, dates, entry deadline, breed association (show type), APHA/AQHA show numbers, APHA zone | Show officials (managers, secretaries, stewards) and their contacts — office notes; the app does not create logins from a bill |
| Venue, when one on file has exactly its name; otherwise as the person finds or adds it | Awards and hi-point prizes, sponsors, refund and scratch policy, arrival and grounds rules — show notes |
| Judges, as the person settles them on the confirm page | Every doubt about the read — office notes |
| Club sanctioning and each club's separate fee | |
| Every class: day, name, discipline, division, class code, price, which clubs sanction it, whether it is a Grand & Reserve call-back | |
| Health paperwork required, the outside-shavings ban | |
| Stalls, shavings, camping and the show's own charges, with units | |
| Each **futurity**: its name, description, deadline, late fee, office fees, per-class fee tiers, entry instructions, award, rules and refund wording, and the classes the bill marks for it (created at $0, as a futurity class must be) | |
| Each **side pot or jackpot**: its name, description, entry fee, payback, and the classes the bill names for it | |

A side pot the bill names no class for cannot exist (a pot is over classes), so
it is not created and the office notes say so. One whose fee or payback the bill
does not print takes `SidePotCreate`'s defaults ($10, 100%), and the notes say
that too. A futurity whose bill prints no fee tiers is created without them,
and the notes say to add them.

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
   succeeded the response carries `extracted` (what the bill said), `resolved`
   (what the app matched it to) and `drafted` (the two notes). The page asks
   for the name, breed association and dates; for each judge, a directory
   search (the bill's same-surname candidates first), *add them*, or *leave
   them off*; for the venue, a search or *add it*; and shows both notes to edit,
   clear or download. A judge left off, a venue settled or the dates moved
   redraft the office notes (`POST /show-bill-imports/{id}/draft-notes`, which
   writes nothing) until somebody has typed in them.
5. `POST /show-bill-imports/{id}/create-show` (`ShowBillImportStart`) refuses a
   judge left unsettled, and — from a manager or admin, who may add one — a
   venue the bill names left blank (`showbill_import.start_problems`). It builds
   the payload from the read (`showbill_draft.draft_from_read`) and creates the
   show through `apply_import` in one transaction. The browser lands on Step 1,
   where the office notes are.

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
schema should be tried against the API once before it ships. (The 2026-11-15
schemas were: both compiled.)

No prompt caching: the output schema sits ahead of the bill in the prompt
prefix, so the two passes share no prefix — measured, the second pass read
nothing from the cache and both paid the 1.25× cache write. Both read the bill
at the plain input rate.

**The two passes.** The header pass reads the show, judges, clubs, class
rates, fees, and the two notes (`notes_for_exhibitors`, `notes_for_office`);
the class pass reads the classes, each naming the futurity and side pots it
belongs to, and the futurities and side pots themselves. The doubts are plain
`warnings` naming what each is about, plus a class's own `note`.

**A read holds only what the app has a place for** (2026-11-15). Show officials,
a judge's home town and the old `not_imported` list came out of the schema; the
notes say what has no field. Earlier reads still work: their tagged doubts,
officials and `not_imported` lines are drafted into the office notes
(`showbill_draft._legacy_doubts`, `legacy_office_lines`). The header schema has
been refused as "The compiled grammar is too large" before (2026-11-13), and
the limit has no local check, so a field added to either schema is tried
against the API first; `test_the_header_holds_only_what_the_app_has_a_place_for`
pins the header's shape.

Two instructions matter more than the rest:

- **Class prices go in `class_rates`, never in `fees`.** A class price stored as
  a `per_entry` fee row bills every entry *on top of* the class's own price —
  a $36 class came to $552 on a real bill (see [design/billing.md](design/billing.md)).
  Classes point at a rate by key, so the reviewer checks five prices rather than
  a hundred and seventy.
- **Transcribe, never multiply.** A bill quotes "$9 per judge"; the app stores
  the multiplied figure on the class. The model reports the per-judge amount and
  says it is per judge; `showbill_draft` multiplies it by the bill's judges kept
  on the confirm page and says so in the office notes — because the panel is
  one of the things the office may change.

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

## The notes

`backend/showbill_draft.py` drafts both; the confirm page shows them, and what
the person leaves is what the show gets (both stay editable on Step 1).

- **Show notes** (`shows.public_notes`, 5,000 characters) — what the bill tells
  exhibitors that no field holds, as the reader wrote it. Printed on Show
  Details and the generated show bill.
- **Office notes** (`shows.office_notes`, 20,000 characters, never public) —
  *To check, from the show bill*, grouped under the setup step that edits each
  line, then *From the show bill*: what the bill told the office (its officials
  and their contacts).

| Section | What it lists |
| --- | --- |
| Basics & Staff | An entry deadline after the show starts (left blank); a venue the bill names left blank |
| Judges | A judge the bill names who was left off |
| Lodging | A booked line's early rate or minimum left off, a reservable line that bills oddly |
| Class Builder | A class's note; classes with no readable day or one off the show's dates (put on the first day); a class the bill prints twice on a day (only the first is created) |
| Sanctioning | A club's fee as read; a club the registry lacks, with the classes the bill marked for it |
| Futurities & Side Pots | Each futurity and side pot set up, and what the bill left out of it; a side pot with no classes, not set up |
| Fees | **One line per class rate**: how many classes it priced, and the arithmetic — `$5.00 × 2 WSCA judges = $10.00`; classes the bill left unpriced; every fee that bills everybody who enters, `per_entry` said to be on top of the class price |
| Paperwork | The health papers the bill never mentions, and what that left them at |
| The whole bill | The reader's own doubts |

- **A per-judge class price is multiplied by the judges kept**, by the
  carded-judge rule billing uses (`per_judge_count`): those carded with the
  rate's association, or the whole panel. The prices are worked out at Create
  and do not follow the panel afterwards — which is why every rate is a line.
- **Not a gate.** Nothing in the notes holds the show in DRAFT.

## Creating the show

`showbill_import.create_show_from_read` builds the payload with
`showbill_draft.draft_from_read` — pure, and what `test_showbill_draft.py`
exercises — and hands it to `apply_import`. **The payload is always creatable**:
a value the create would refuse is left off or moved and the office notes say so
(a deadline after the show starts, a class off the show's dates, a second class
of a name on a day, an early rate the fee editors would refuse, a futurity's
late fee with no deadline). A first day moved on the confirm page moves the
schedule with it, day for day.

`showbill_import.apply_import`, one transaction:

- The import row is locked `FOR UPDATE`; a second press gets 409 with the
  `show_id` the first one made.
- The show is created as `POST /shows` creates one, with the caller's
  `show_managers` / `show_secretaries` row.
- A venue or judge is created only as the confirm page added it — a judge with
  an email or phone, a venue with its full address — under the rules
  `POST /venues` (manager or admin) and `POST /judges` (name + email identity)
  keep.
- **Classes** go through `routers/classes._create_classes_auto_routed` — the
  Class Builder's own importer — a day at a time in program order.
- **The bill's printed class numbers are kept, verbatim** (migration 191). The
  read takes each number as printed ("12", "5N", "2-3"), the draft carries it as
  `class_number`, and a bill that printed any number makes the show
  `class_numbers_as_printed`: each class keeps the bill's number, blank where
  the bill printed none — a Grand & Reserve class, a "Ship Challenge" — and
  nothing renumbers the show afterwards. A bill that numbers nothing is numbered
  down the running order instead, as a show built by hand is. See
  `backend/class_numbers.py` and [design/show-setup.md](design/show-setup.md).
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
- **Futurities and side pots** are created as their own create routes make
  them, over the classes just made (named by payload index, since none existed
  yet): a futurity with its tiers, a side pot with the default scoring and
  payout schedule.
- The show takes the two notes as the confirm page left them.
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

`show_bill_checks` (migration 187) is no longer mapped. Migration 189 copied
every check nobody accepted onto the end of its show's office notes, under
*Left to check from the show bill:*; the table is dropped in a later release.

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

- **A class the bill prints twice under one name is created once.** A bill
  that runs a companion class under the same name — "5" and "5N", Amateur
  Performance Stallions both — loses the second to the one-name-per-day rule,
  and the office notes say so. A line about a class names its printed number
  ("bill #5N") so it can be found on paper.
- **Club classes a registry club does not exist for cannot be designated.** A
  club is added to the registry by an admin, or requested by a manager through
  `sanctioned_association_requests` from the Sanctioning step; the office notes
  say so and name the classes the bill marked for it.
- **A secretary cannot add a venue** (`POST /venues` is manager or admin), so a
  secretary whose venue is not in the directory leaves it blank and the office
  notes say so.
- **An import is applied once.** Re-running means uploading again — the row is
  the record of which show that read became.
- **The fixture for testing without a key** is the MNSPHC seed transcription
  written as a succeeded row; it exercises everything after the model call.
  With a fifth invented judge on the panel, the created prices matched the
  seed's hand-multiplied figures class for class.
