# Setting A Show Up From Its Show Bill

Upload the club's own printed show bill, let the model read it, check what it
read, press **Create draft show**. The show, its venue, judges, club
sanctioning, the class schedule with its prices, and the fee catalogue are made
in one transaction, and the PDF is put on file as the show's uploaded bill.

## Why

A real show is a lot of keying. The MNSPHC Paint-O-Rama is 172 classes over two
days, four judges, two sanctioning clubs and fourteen fee lines — and the club
had already laid every one of those out once, in the bill it sent to the
printer. `scripts/seed_mnsphc_paint_o_rama.py` is a day's hand transcription of
exactly that document. This feature is that transcription, done by the model and
checked by a person.

## The rule

**The model suggests. A person saves.** The same rule as
[document-extraction.md](document-extraction.md), for a bigger reason: a show
bill decides what every exhibitor at the show is charged. So:

- The upload creates **nothing** but a `show_bill_imports` row.
- The apply endpoint takes the **reviewed payload** and never reads
  `extracted` — there is no path from the file to a record that does not pass
  in front of somebody.
- The show is created as a **DRAFT**. Every setup step still works on it
  afterwards; the import is a head start on the wizard, not a replacement.

## A paid feature

Starting a show from its show bill is the first thing in this app a customer
pays for: every read spends model tokens on a document tens of pages long. It
is sold to the **show company** — the club or firm that runs the shows — and a
GaitDesk admin turns it on for that company at `/admin/companies/[id]` once the
company has paid (migration 142, `backend/show_companies.py`). It then reaches
every account in the company. An `ADMIN` always has it. **The app takes no
payment**: the arrangement is written in the company's notes and the switch is
turned by hand.

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
  the same pitch for everybody, and an **Upload show bill & automate my show**
  button that is live for a company on the plan and disabled for one that is
  not, with *"You must upgrade to GaitDesk Pro to enable this feature"* and
  whose company it is. The plan's name is `plan` on the feature in
  `show_companies.FEATURES`, reaching the page through `GET /users/me/features`
  (`catalog`), so the button, the show-bill pages and the 403 all name the same
  subscription and renaming it is one edit.
- **The screens only decide what to offer.** Both show-bill pages print the same
  upgrade message instead of a form. The endpoint is the enforcement — a stale
  page costs an offer, never a read.

## Scope

| Read and created | Read, listed, **not** created |
| --- | --- |
| Show name, dates, entry deadline, breed association (show type), APHA/AQHA show numbers, APHA zone | Show officials (managers, secretaries) — the app does not create logins from a bill |
| Venue (matched to one on file, or created by a manager) | Side pots and jackpots |
| Judges (matched to the registry, or created with their cards) | A futurity's categories, fees, deadline and Hi-Point awards |
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
   `resolved` (what the app matched it to).
5. The reviewer edits; `POST /show-bill-imports/{id}/apply` creates the show;
   the browser lands on the setup hub.

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
the fallback model rather than losing the read. No prompt caching: a show is
set up from its bill once, so there is no second read to share a cached prefix
with.

Two instructions matter more than the rest:

- **Class prices go in `class_rates`, never in `fees`.** A class price stored as
  a `per_entry` fee row bills every entry *on top of* the class's own price —
  a $36 class came to $552 on a real bill (see the Sharp Edges in `CLAUDE.md`).
  Classes point at a rate by key, so the reviewer checks five prices rather than
  a hundred and seventy.
- **Transcribe, never multiply.** A bill quotes "$9 per judge"; the app stores
  the multiplied figure on the class. The model reports the per-judge amount and
  says it is per judge, and the review screen does the multiplication in front
  of the reviewer — because the panel is one of the things they may change.

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

## The review screen

`frontend/app/admin/shows/new/from-showbill/[importId]/ReviewClient.tsx`, with
its state and arithmetic in `frontend/lib/showbill-import.ts` (tested in
`showbill-import.test.ts`).

- **Class prices** are the bill's rates, each editable, with the per-judge
  arithmetic shown: `× 2 WSCA judges = $10.00`. The count is the one billing
  uses for a per-judge fee (`cardedJudgeCount`): the judges on the panel carded
  with the rate's association, or the whole panel when none is — and it follows
  the judges section, so unticking a judge reprices every class that depends on
  them.
- **Classes** are a table per day. Each row picks a rate (or types a price),
  and ticks its clubs and *Must qualify*. A futurity class, a club code the
  registry lacks, a model note and a same-day duplicate name are said on the row.
- **A club mapped by hand designates its classes.** If the bill's "MNSPHC" was
  not found and the reviewer picks the registry row, the classes the bill marked
  MNSPHC are ticked for it (`mapClub`) — the bill already answered that question.
- **Other fees** show the family their unit puts them in — booked at sign-up,
  charged to everyone who enters, or printed only — and `per_entry` says in
  warning colour that it is added *on top of* a class's price.
- **Create draft show** checks what the form can see (`buildApplyPayload`), then
  the backend checks everything (`apply_problems`, `fee_problems`) and answers
  a 422 with **every problem at once** in `detail.problems`.

## Creating the show

`showbill_import.apply_import`, one transaction:

- The import row is locked `FOR UPDATE`; a second press gets 409 with the
  `show_id` the first one made.
- The show is created as `POST /shows` creates one, with the caller's
  `show_managers` / `show_secretaries` row.
- A **new venue** needs a manager or admin, the rule `POST /venues` enforces. A
  secretary picks one on file or leaves it blank.
- A **new judge** clashing with a registry judge on name + email (the
  migration 085 identity rule) is refused and named: the screen offered the
  match, and a second row with no email to tell them apart is the worse outcome.
- **Classes** go through `routers/classes._create_classes_auto_routed` — the
  Class Builder's own importer — a day at a time in program order, so the
  running number it assigns is already the schedule's 1..N. The bill's printed
  numbers ("2-3", "A") are shown on the review screen and not kept: the app
  numbers sequentially and renumbers on every add, so a kept "2-3" would be gone
  the first time somebody added a class.
- A class code is kept only at a breed show. An Open show has no catalogue to
  hold one against.
- **One class of a name per show day**, the Class Builder's rule. Other bulk
  imports skip a duplicate; this one refuses and names it, because the person
  who can fix it has the row in front of them.
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
  Show Bill button to the upload is the deliberate second press in Step 9 that
  it always is.
- The import row records `accepted` (the reviewed payload) and `show_id`.

## Storage

`show_bill_imports` (migration 141), shaped after `document_extractions`:

| Column | Notes |
| --- | --- |
| `created_by_user_id` | Whoever uploaded it; an import is theirs (or an admin's) to read and apply |
| `original_filename`, `mime_type`, `file_size`, `file_data` | The bill, kept so the show can have it on file |
| `status` | `pending` → `succeeded` / `failed` / `unsupported_media` |
| `extracted` | The normalised read, JSONB |
| `accepted` | The reviewed payload the show was made from |
| `show_id` | The show that came of it; NULL until applied |
| `model`, `input_tokens`, `output_tokens` | Which model read it, and what it cost |
| `created_at`, `completed_at`, `applied_at` | |

No relationships on the model, deliberately: `file_data` is a multi-megabyte
BYTEA and the review screen polls this row every four seconds, so readers
select columns by name — the rule `ShowDocument` already follows.

## Configuration

`ANTHROPIC_API_KEY`, the same key as document extraction. **Optional**: unset,
`GET /show-bill-imports/availability` says so, the upload page says so and
links to the step-by-step setup, and the list of recent reads still shows — a
read that finished before the key was removed can still be reviewed and
created. Uploads are rate limited to ten an hour per user, keyed on the user id
for the reason `document-extraction.md` gives.

## Sharp edges

- **The bill's printed class numbers are not kept.** See above; the review
  table shows them so a mismatch is visible while it can still be fixed by
  reordering.
- **Club classes a registry club does not exist for cannot be designated.** A
  club is added to the registry by an admin, or requested by a manager through
  `sanctioned_association_requests` from the Sanctioning step; the review screen
  says so against the club and its classes.
- **An import is applied once.** Re-running means uploading again — the row is
  the record of which show that read became.
- **The fixture for testing without a key** is the MNSPHC seed transcription
  written as a succeeded row; it exercises everything after the model call.
  With a fifth invented judge on the panel, the created prices matched the
  seed's hand-multiplied figures class for class.
