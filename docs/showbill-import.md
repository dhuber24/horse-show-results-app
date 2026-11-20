# Setting A Show Up From Its Show Bill

Upload the club's own printed show bill — and, if the bill leaves things out,
the show's other papers beside it — and let the model read them. On the
confirm page, check the show's name, breed association and dates, find each
judge and the venue in the directories (or add them), and look over the two
notes drafted from the bill. Then press **Create draft show and start setup**.
The show, its judges and venue, club sanctioning, the class schedule with its
prices, the fee catalogue, and every futurity and side pot the bill runs are
made in one transaction as a **DRAFT**, filled in as far as the bill allows,
and the PDF is put on file as the show's uploaded bill. Nothing afterwards
waits on an Accept, and the read lists nothing for the office to check: the
office walks the setup steps against the bill and fixes what is wrong there.
What the bill tells the office is the show's **office notes**, and what it tells
exhibitors that no field holds is its **show notes** (migration 189).

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
  A club the registry lacks is left off for the office to request, never a new club.
- **Everything else is filled in, and nothing is gated or listed.** The office
  walks the setup steps against the bill and changes what looks wrong; the
  read raises no warnings (see *The notes*).

**Why nothing waits on an Accept** (2026-11-15). Migration 187 made each doubt a
check on its setup step that held the show in DRAFT until somebody pressed
Accept or changed the field. That made a review a round of pressing Accept on
values the office could simply change, and it made checks of lines the bill
printed with no field to hold them (a sponsor, the refund policy). The notes
carry the same doubts, in the place the office already reads, and the setup
steps are where anything is changed. (The doubts themselves were dropped
altogether on 2026-11-19: see *The notes*.)

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

## More than one document

A show bill rarely holds everything. Clubs print the refund and scratch policy,
the health papers, arrival and grounds rules and the high-point awards on a
separate **rules and information sheet**, and run a futurity off its own entry
sheet — and what the reader cannot see it can only leave blank. So an upload
may carry **up to four supporting documents** beside the bill (migration 201),
and the model reads them all as one show.

- **The bill is still one file, and still first.** Document 1 is always the
  show bill: it is the schedule, the one put on file with the show, and the one
  every read before 201 has. The supporting documents are
  `show_bill_import_documents`, in the order chosen; they are kept for the read
  and as the record of what it saw, and are **not** put on file with the show —
  `show_documents` has no type for a rules sheet.
- **Each document is labelled in the request** — a text block before each one
  saying "Document 1 -- the show bill, uploaded as …", "Document 2 -- a
  supporting document from the same show …" — so the prompt's rules can name
  them. A bill on its own is sent exactly as it was before 201.
- **The bill wins a disagreement.** Where two documents differ on a date, a
  price, a judge or a deadline, the read takes the bill's value.
- **What only a supporting document prints goes where the bill's would** — a
  health-certificate rule into the paperwork fields, a refund policy into the
  show notes, a futurity's fees into the futurity.
- A class is listed once even where two documents print it, in the bill's order
  and with the bill's number. A document about another show is ignored and
  warned about.
- **Limits.** Each file is checked as the bill is (magic bytes, 10 MB, PDF or
  JPEG/PNG/WebP), and **20 MB together**: every document goes to the model in
  one request, three times (once per pass), and a request is capped at 32 MB, which
  base64 fills a third faster. Four is more than any show's papers need. One
  upload is one read against the rate limit, however many documents it
  carries — but every document is paid for in every pass.
- The confirm page and the recent-reads lists name every document the read was
  made from ("bill.pdf + rules.pdf").

## Scope

A read holds only what the app has a place for; what has no field is said in
one of the two notes.

| Read and created | Said in the notes |
| --- | --- |
| Show name, dates, entry deadline, breed association (show type), APHA/AQHA show numbers, APHA zone | Show officials (managers, secretaries, stewards) and their contacts — office notes; the app does not create logins from a bill |
| Venue, when one on file has exactly its name; otherwise as the person finds or adds it | Awards and hi-point prizes, sponsors, refund and scratch policy, arrival and grounds rules — show notes |
| Judges, as the person settles them on the confirm page | |
| Club sanctioning and each club's separate fee | |
| Every class: day, name, discipline, division, class code, price, which clubs sanction it, whether it is a Grand & Reserve call-back | |
| Health paperwork required, the outside-shavings ban | |
| Stalls, shavings, camping and the show's own charges, with units | |
| Each **futurity**: its name, description, deadline, late fee, office fees, per-class fee tiers, entry instructions, award, rules and refund wording, and the classes the bill marks for it (created at $0, as a futurity class must be) | |
| Each **side pot or jackpot**: its name, description, entry fee, payback, added money, and the classes the bill names for it; for one won on time (a barrel sidepot), its number of Ds and how far apart they are | |

A side pot the bill names no class for cannot exist (a pot is over classes), so
it is not created and an item to confirm says so. One whose fee or payback the bill
does not print takes `SidePotCreate`'s defaults ($10, 100%), and the notes say
that too.

**A sidepot with no run of its own is a side pot, even when the bill numbers it
like a class** (migration 205). The reader's rule used to be that "a jackpot
printed as a class of its own on the schedule is a class", which is right for a
jackpot pleasure class that has its own go and wrong for the WSCA Championship
Show's "108. $1,000 Added SIDEPOT 5D Barrels", whose rules say the times "will
be taken from age division run {there will not be a seperate run}": it came in
as three classes nobody runs. Now a sidepot that takes its times or placings
from other classes is read as a side pot over those classes, and one won on
time (`scoring: "time"`) is created as a `fastest_time` pot with its Ds, added
money and payout percent, its price taken from the entry fee table rather than
left as a class rate. What the bill rarely prints is defaulted and said: one D
when no Ds are printed, half-second splits, and the Ds' shares of the pool
(`schemas.DEFAULT_D_PERCENTS`, 30/25/20/15/10 for a 5D). Who may enter it — a
futurity or derby horse's age — is the office's to check, never a rule the app
applies. **The pot's classes are made timed** on apply, because a time pot reads
its classes' times and its own create route refuses an untimed class; the
import's discipline routing does not always get there on its own ("Int.
Barrels" under a games heading came in as a placing class). A futurity whose bill prints no fee tiers is created without them,
and the notes say to add them.

## Flow

1. `/admin/shows/new` links to `/admin/shows/new/from-showbill` when the
   caller's show company has the feature (see above).
2. The upload (`POST /show-bill-imports/`) checks the file the way
   `show_documents` does — magic bytes, 10 MB — and each supporting document
   (`supporting`, see *More than one document*) the same way, writes a
   `pending` row and answers **202** at once.
3. The read runs in the background (`showbill_import.start_read`), in its own
   database session, and writes the result onto the row.
4. `/admin/shows/new/from-showbill/[importId]` polls
   `GET /show-bill-imports/{id}` every few seconds. Once the read has
   succeeded the response carries `extracted` (what the bill said), `resolved`
   (what the app matched it to) and `drafted` (the two notes). The page asks
   for the name, breed association and dates; for each judge, a directory
   search (the bill's same-surname candidates first), *add them*, or *leave
   them off*; for the venue, a search or *add it*; and shows both notes to edit,
   clear or download.
5. `POST /show-bill-imports/{id}/create-show` (`ShowBillImportStart`) refuses a
   judge left unsettled, and — from a manager or admin, who may add one — a
   venue the bill names left blank (`showbill_import.start_problems`). It builds
   the payload from the read (`showbill_draft.draft_from_read`) and creates the
   show through `apply_import` in one transaction. The browser lands on Step 1.

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

**The bill is read in three passes**, each held to its own schema: `HEADER_SCHEMA`
(the show, judges, clubs, class rates, fees, the two notes), then
`CLASSES_SCHEMA` (the class list) and `STALLS_SCHEMA` (the stall periods and the
stall rules they share) at the same time. The class pass is told the rate keys
the first chose, so every class's `rate_key` still points at a rate; the stall
pass needs nothing from it. The split is
forced by two API limits on a structured-output schema, both of which refused
every upload as `BadRequestError` until 2026-11-12:

- **At most 16 union-typed properties** (a `["string", "null"]` type or an
  `anyOf`). The schema had 34. Optional *text* is now a plain string the model
  leaves empty, which `_clean_str` reads as `None`, so everything downstream sees
  exactly what it did; numbers, booleans and enums keep `null`.
- **"The compiled grammar is too large."** The whole bill in one schema is
  refused even though each half compiles, so the class list has its own pass.
  So was the header with the stall periods added to it (2026-11-18, every
  upload refused until they moved to their own pass). A third pass reads the
  documents once more, so a read costs about half as much input again; it runs
  beside the class pass, so a read takes no longer.

`test_showbill_import.py` pins the union count per schema. The grammar limit
has no local check — the API compiles the grammar — so a field added to either
schema should be tried against the API once before it ships. (The 2026-11-15
schemas were: both compiled.)

No prompt caching: the output schema sits ahead of the bill in the prompt
prefix, so the passes share no prefix — measured, the second pass read
nothing from the cache and both paid the 1.25× cache write. Every pass reads the
bill at the plain input rate.

**The three passes.** The header pass reads the show, judges, clubs, class
rates, fees, and the two notes (`notes_for_exhibitors`, `notes_for_office`);
the class pass reads the classes, each naming the futurity and side pots it
belongs to, and the futurities and side pots themselves; the stall pass reads
the stall periods and `stall_notes`, which the read keeps on its `show` as
before.

**A read holds only what the app has a place for** (2026-11-15). Show officials,
a judge's home town and the old `not_imported` list came out of the schema; the
notes say what has no field. Earlier reads still work: their officials and
`not_imported` lines are drafted into the office notes (`legacy_office_lines`),
and their tagged doubts are ignored. The header schema has
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
  on the confirm page and says so on the Fees step — because the panel is
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

`backend/showbill_draft.py` drafts two notes. **Both are information about the
show, never a list of things to check.**

- **Show notes** (`shows.public_notes`, 5,000 characters) — what the bill tells
  exhibitors that no field holds, as the reader wrote it. Printed on Show
  Details and the generated show bill.
- **Office notes** (`shows.office_notes`, 20,000 characters, never public) —
  what the bill tells the show office that no field holds: its officials and
  their contacts, how the office runs (`notes_for_office`, and an older read's
  officials and `not_imported` lines).

**The read raises no warnings** (removed 2026-11-19). It used to: first as *To
check* lines in the office notes (migration 189), then as items to dismiss on
each setup step, on the section and even the row they were about (migration
202, never released), plus a *Before you create* box on the confirm page. It
grew too convoluted: placing each doubt on the right step, card and item took
tagging rules in the prompt, keyword routing in the draft and a slot on every
setup page, and the office still had to read each one. Now the reader is asked
for no warnings and no per-class notes, and nothing is stored or shown. Where
the bill can't be followed, the draft quietly does the safe thing and the
office fixes it on the step:

- A per-judge class price is multiplied by the judges kept, by the
  carded-judge rule billing uses (`per_judge_count`), and does not follow the
  panel afterwards.
- An entry deadline after the show starts is left blank; a class with no day,
  or one off the show's dates, goes on the first day; a class printed twice on
  a day is created once; a club class run alongside a breed class of the same
  name is its own class, named for the club.
- A club the registry lacks is left off; a side pot with no classes is not set
  up; a futurity late fee with no deadline is left off; an early rate or a
  minimum the fee editors would refuse is left off.
- A stall period with no move-in, or one too far from the show, takes the
  Lodging step's default; an Early Move-In Pass whose times don't fit is left
  for the office to set.
- **Shows created before migration 202** keep their *To check* lines in their
  office notes; nothing moves them.

### Each note on the step that holds it

The reader writes each note into the field for the part of the show it is
about, never everything into the show notes (2026-11-18). A rule printed twice
— the stall rules in the show notes *and* in the stall period's move-in notes,
both on Show Details — is a rule that will one day say two different things.

| What the bill says | Where it goes | Step |
| --- | --- | --- |
| Stalls and moving in and out: unloading, the barn office, stall assignments, bedding and cleaning, departure | the rules every period shares in `stall_notes` → the move-in notes of the **first** stall period; what only one period's exhibitors need → that period's own `move_in_notes` (see *Stall periods* below) | Lodging |
| Which vaccinations, how recent | `vaccination_notes` → `shows.vaccination_notes` | Paperwork |
| Wording about one fee or booked item | that fee's `notes` | Lodging / Fees |
| A futurity's or side pot's wording | the futurity's five texts, the side pot's description | Futurities & Side Pots |
| The show officials and how the office runs | `notes_for_office` → office notes | Basics & Staff |
| Anything else for exhibitors: awards, sponsors, refund policy, office hours, grounds rules | `notes_for_exhibitors` → show notes | Basics & Staff |

### Stall periods (2026-11-18)

The stall pass returns `stall_periods`: one per window the bill sells stalls for,
each with its move-in and move-out, a move-out note, its own move-in notes, a
reserve-by day, the stall types it sells (`box` / `tie` / `tack`, each with its
price, a lower price until the reserve-by day, a tack stall's horse minimum and
notes) and at most one Early Move-In Pass. Create makes each a
`show_stall_periods` row and writes its prices exactly as the Lodging step's
*Stalls & move-in* card does (`showbill_import._stall_lines`): one `per_stall`
line per stall type with its `stall_kind` and `stall_period_id`, named
"Box stall — Pleasure"; the show's first box or tie stall coded `stall`, the
rest `stall_<kind>_<period id>`; the pass an `add_on` coded
`early_move_in_<period id>`. So the step opens on every price in its cell.

- **Why this replaced "one period, never several".** WSCA's 2026 Champ Show
  bill and stalling sheet were read with one *Full show* period holding every
  window's rules (cut short at 2,000 characters), and the eleven stall prices
  as whole-show fees: the Lodging step listed them under *Other charges per
  stall*, and the office had to rebuild all three periods by hand. The show is
  a DRAFT, so a misread price reaches nobody before the office has looked; one
  item on Lodging lists every period and its prices to check.
- **Shared rules are said once.** Show Details prints every period's notes
  together, so the rules every period shares (`show.stall_notes`) open the
  first period's notes rather than being copied into each.
- **Prices that rise after a date** ("stalling prices DOUBLE after the class
  entry deadline") are the raised price with the printed one as the early
  price until the reserve-by day, as the Lodging step sets a period's early
  price. A lower price with no reserve-by day is dropped.
- **Stalls are never `fees` as well.** When any period prices a stall or a
  pass, `fee_codes(stalls_priced=True)` gives no fee the `stall` or
  `early_move_in` code, so a stall deposit cannot be read as the stall.
- **A day the bill does not print is the step's own default** — moving in the
  day before the show at 12 PM, out on its last day with no hour — and an item
  on Lodging says which was assumed. So is a printed day too far from the show
  to be right (more than two weeks before it, or after it). A pass whose
  move-in is not before its period's is left for the office to set. Every
  period moves with the schedule when the first day is moved on the confirm
  page.
- **Stall rules with no period read** make a *Full show* period to hold them.
  A read made before this change (one `stalls_move_in` for the show) still
  makes its one *Full show* period, with no prices.
- **No nullable field was added**: a price or count the bill doesn't print is
  0 and a period without a pass has an empty list, so the union count is
  unchanged. They are read in their own pass (`STALLS_SCHEMA`): added to the
  header they made its grammar too large, and every upload was refused.

## Creating the show

`showbill_import.create_show_from_read` builds the payload with
`showbill_draft.draft_from_read` — pure, and what `test_showbill_draft.py`
exercises — and hands it to `apply_import`. **The payload is always creatable**:
a value the create would refuse is left off or moved and an item to confirm says so
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
  late-departure nights stay on the Boarding Fees screen. The first
  early-arrival or priority move-in line priced **per stall** is the step's
  Early Move-In Pass (`early_move_in`); the step moves it into the show's
  first stall period, making a *Full show* period to hold it if the show has
  none. A read with stall periods prices its stalls and passes there instead
  (*Stall periods* above), and then neither code goes to a fee.
- **Camping options and permits** (2026-11-18). Every camping or hook-up line
  the bill prices per night, per day or per show (`camp`, `hook-up`,
  `electric`, `RV`, `water`, `sewer`) is a camping option: the plain one keeps
  `camping`, each further one is `camping_<name>`, so WSCA's three electrical
  prices are three options on the Lodging step. A parking, side-by-side, golf
  cart or vehicle line priced per show or per day is a permit, `permit_<name>`,
  and is coded first, so a "Parking Permit" is never taken for the camping
  line, as WSCA's was. The pass's end ("2 PM to 4 PM") is read as its
  `move_in_until` (`show_fees.move_in_end_*`, migration 203). No other fee is ever given one of those codes, nor
  `early_arrival_stall`, which the step also reads as the pass.
- **The PDF goes on file** as the show's `SHOWBILL` document when the box is
  ticked (it is by default). `showbill_source` stays `generated`: switching the
  Show Bill button to the upload is the deliberate second press in Step 10 that
  it always is.
- **Futurities and side pots** are created as their own create routes make
  them, over the classes just made (named by payload index, since none existed
  yet): a futurity with its tiers, a side pot with the default payout
  schedule and the scoring it was read with — `fastest_time` with its Ds for a
  sidepot won on time, otherwise `sum_placings`.
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

`show_bill_import_documents` (migration 201) holds the supporting documents
read with the bill — `import_id`, `position` (the order chosen, unique per
import), `original_filename`, `mime_type`, `file_size`, `file_data` — and is
deleted with its import.

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

- **A club's concurrent class is its own class, named for the club.** A bill
  that prints "5. Amateur Performance Stallions / 5N. NSBA" runs the NSBA class
  in the ring with class 5 — the same horses, but NSBA's own fee
  ($/class/judge, outside the flat fee), its own judges' cards and its own
  placings. The reader is told to split it into its own entry carrying the
  club code and the club's rate (the class-schedule rules in
  `extraction/showbill.py`, which also say a Grand & Reserve class the bill
  leaves unnumbered stays unnumbered); the
  draft creates it as "Amateur Performance Stallions (NSBA)", number "5N",
  rather than dropping it to the one-name-per-day rule, and one office-notes
  line lists them ("#5N with #5") and says to start each at the gate with *Run
  with*. Nothing links the pair: the gate's concurrent start is how they run
  together. A repeat with **no** club code is still a duplicate — the first is
  created and an item to confirm says so. A line about a class names its printed number
  ("bill #5N") so it can be found on paper.
- **Club classes a registry club does not exist for cannot be designated.** A
  club is added to the registry by an admin, or requested by a manager through
  `sanctioned_association_requests` from the Sanctioning step; an item to
  confirm there says so and names the classes the bill marked for it.
- **A secretary cannot add a venue** (`POST /venues` is manager or admin), so a
  secretary whose venue is not in the directory leaves it blank and an item to
  confirm on Basics & Staff says so.
- **An import is applied once.** Re-running means uploading again — the row is
  the record of which show that read became.
- **An upload that has not become a show can be cancelled**, and is deleted
  with its supporting documents (`DELETE /show-bill-imports/{id}`, 204):
  reading, ready to create, or failed. *Cancel upload* is beside each read in
  both lists (above the shows, and on the upload page) and on the confirm
  page, behind a confirm, since the only way back is another upload and
  another read. The confirm page's other button is *Back to uploads*, which
  leaves the read ready to create: a link labelled *Cancel* that did that was
  read as cancelling it. An upload a show was made from is kept (409). The
  row is locked as Create locks it, so the two cannot both happen; a read
  still running when its upload is cancelled finishes and writes to nothing
  (`_read`). Deleting rather than marking it cancelled, because nothing reads a
  read that made no show — the token counts on it are not reported anywhere.
- **The fixture for testing without a key** is the MNSPHC seed transcription
  written as a succeeded row; it exercises everything after the model call.
  With a fifth invented judge on the panel, the created prices matched the
  seed's hand-multiplied figures class for class.
