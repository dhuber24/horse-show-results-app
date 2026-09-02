# APHA And Association Rules

The app supports multiple associations. APHA and AQHA both have association-specific setup flows; this page documents APHA-specific behavior. AQHA behavior lives in [aqha.md](aqha.md).

## Association Catalog

Show types live in the `show_types` table. Current supported codes are:

- `AQHA`
- `APHA`
- `WSCA`
- `NSBA`
- `ApHC`
- `FQHR`
- `OPEN`

`OPEN` is excluded from certification and registration-number UI because it is unaffiliated.

## APHA Certifications

Certification data lives in `cert_org_users`. The table includes an `Org` column with a capital `O`; map it explicitly in SQLAlchemy.

Backend endpoint:

- `GET /certifications/verify?email=&org=`

Frontend proxy:

- `frontend/app/api/apha/verify-secretary/route.ts`

Rules:

- Show Secretary APHA certification is required when APHA is selected during registration.
- Show Manager APHA certification lookup is informational only.

## APHA Show Fields

| Area | Field |
| --- | --- |
| Shows | `apha_show_number`, `apha_zone`, `entry_deadline` |
| Horses | `is_solid_paint_bred`, `color_id` + `pattern_id` |
| Exhibitors | `exhibitor_registrations` (number + `expires_at`), `date_of_birth`, legacy APHA columns |
| Entries | `apha_division`, `relationship_to_owner`, `is_disqualified` |
| Classes | APHA code through `class_associations` |

### Divisions

`entries.apha_division` is one of nine values (migration 115), defined once in
`rules/apha.py` as `DIVISIONS` and mirrored by the `APHADivision` Literal in
`schemas.py`, the CHECK constraint, and `frontend/lib/apha.ts`:

`OPEN`, `SOLID_PAINT_BRED`, `AMATEUR`, `NOVICE_AMATEUR`, `AMATEUR_WALK_TROT`,
`YOUTH`, `NOVICE_YOUTH`, `YOUTH_WALK_TROT_11_18`, `YOUTH_WALK_TROT_5_10`.

The three Walk-Trot divisions arrived in migration 115; the other six had been
there since 010. Youth Walk-Trot is **split by age** because APHA runs 11-18
(YP-109) and 5-10 (YP-110) as separate divisions with separate class lists —
collapsing them into one would have to be undone the moment either is reported
on. A show running Walk-Trot could not record those entries at all before 115.

`DIVISION_LABELS` in the same module is how each is written in a message a person
reads; `.title()` on the stored value produces "Youth Walk Trot 11 18".

### Coat colour and pattern

Migration 116 split `horse_patterns` out of `horse_colors`. Tobiano, Overo,
Tovero, Sabino and the six Appaloosa patterns sat in the same list as Bay and
Buckskin, so a horse could be recorded as one or the other and never both — but
APHA papers say **"Bay Tobiano"**, and the half that got dropped could not be
reported back. `coatDescription()` in `frontend/lib/horse-coat.ts` is the one
place the two are joined for display.

### Novice eligibility is declared, not checked

`entry_attestations` (migration 118) records what the entrant declared about an
entry: the kind, the exact words, who declared it and when.

The Novice divisions are gated on points and prize money — AM-205 decides Novice
Amateur per category at the time status is applied for, YP-255.A.1 caps Novice
Youth fence-work earnings at $750 — and the app holds neither and never will.
The rule book says who does answer for it: *"the responsibility for eligibility
lies with the exhibitor"*, with the burden of proof on whoever protests. So the
app makes somebody say it and records that they did.

Three things this deliberately does **not** do:

- **It does not verify.** There is no points database to check against, and
  pretending otherwise would be worse than asking.
- **It does not let the caller write the statement.** The wording lives in
  `ATTESTATION_STATEMENTS` in `rules/apha.py` and is copied into the row by
  `backend/attestations.py`. A client able to compose the sentence it is
  attesting to could attest to anything. This is the same rule that stops a
  paperwork verification naming its own value — with the difference that there
  is nothing on file to derive a declaration from, so the backend supplies the
  text rather than reading it.
- **It does not point at the current wording.** `statement` is a stored copy,
  because APHA revises its limits and a pointer would silently restate what
  somebody agreed to two seasons ago. Same reasoning as a signed waiver keeping
  its own text.

The rows are assigned to `entry.attestations` **before** validation and before
commit, so the rules engine reads the declaration off an entry that has not been
written yet and the relationship cascade writes it on save. A check that queried
the database would reject every new Novice entry.

Missing, it is an **error at both doors** — the desk and the exhibitor's own
registration screen — like `relationship_to_owner`. Both forms show the tickbox
and disable the button until it is ticked, so neither posts an entry it already
knows will 422.

### Youth age divisions (YP-075)

"Youth must show in the appropriate age division based on their age as of
January 1 of the current year."

**`youth_age()` is not `horse_calendar_age()`, and the difference is a year.**
The horse helper subtracts calendar years because every horse has a January 1
birthday. A person does not: somebody born in June 2008 is seventeen on 1 January
2026 and turns eighteen that summer, so subtracting years would call them
eighteen and refuse a youth entry the rule allows. The two are tested side by
side on the same date for exactly that reason.

The cap comes from `entries.apha_division`, which is stored data — and two of the
four youth divisions state their range in the value itself:

| Division | Cap |
| --- | --- |
| `YOUTH` | 18 |
| `NOVICE_YOUTH` | 18 |
| `YOUTH_WALK_TROT_11_18` | 18 |
| `YOUTH_WALK_TROT_5_10` | 10 |

A class bracket may tighten it — a Youth entry in a class run as 13 and Under is
capped at thirteen — but **only ever tightens**. YP-075.A.1 says a 13 and Under
exhibitor "may choose which division to compete on a per class basis", so a
twelve-year-old in the 18 and Under class is the rule working, and a lower bound
read off a bracket would refuse it. The bracket reaches the rules engine through
`apha_brackets` on the shared context rather than `Class.division`, because that
relationship is not eager-loaded at either entry door.

An error, like SC-190.A.3.a: nothing at the show makes a nineteen-year-old
eligible. It declines when there is no date of birth on file.

**Three classes as 13 and Under.** A show offering a youth division must offer at
least three (YP-075.A.1, A.2), and they may not be combined. That is a warning on
the readiness panel, waived in **Zones 12, 13 and 14** — the same zone list the
equitation class procedures carry. A show that has not stated its zone is told so
in the finding, because it may well be exempt. The "may not be combined" half is
not checked: combining is something management does on the day and the app holds
no record of it.

### Which events earn Novice Amateur points (AM-250)

AM-250.A sorts the performance classes into twenty-five categories approved for
Novice Amateur points and awards. The category is the unit that matters beyond
this list: **AM-205 decides Novice Amateur status per category**, which is what
makes the declaration in `entry_attestations` a claim about a category rather
than about the exhibitor in general.

**Every finding here is a warning, and that is the rule rather than caution.**
AM-250 is about points and awards, not eligibility — a Novice Amateur may enter
Longe Line, and what they will not do is earn anything for it. Refusing the entry
would invent a restriction the rule does not impose, on the strength of a
discipline the classifier assigned.

Two findings: `APHA_NOVICE_AMATEUR_EVENT_NOT_APPROVED` quotes AM-250.A's own
exception for the events it names outright — Open or Amateur Halter, Longe Line
(All Ages), In-Hand Trail (All Ages) — and
`APHA_NOVICE_AMATEUR_EVENT_UNCATEGORIZED` covers everything simply absent from
the twenty-five.

**Two categories are deliberately left out of the map.** XV (Working Ranch Horse)
and XXI (Competitive Trail Horse) both carry "class no longer offered" footnotes,
for points earned before May 2015 and January 2024. Listing them as currently
approved would let a show award Novice Amateur points in a class APHA has
retired, so a class of either name reads as not approved — which is right.

**Timed Team Roping is named by the rule and not by the code.** The classifier's
plain "Team Roping" cannot be told apart from the Heading and Heeling that
Category VI *does* approve, so it falls through to the general message rather
than being quoted at, and a class routed to Heading or Heeling keeps its
category. Utility Driving (Category IV) has no discipline in the classifier at
all and is therefore absent.

### Zones

`shows.apha_zone` (1-14, migration 119). NULL means **not stated**, and nothing
derives it from the venue's state — a guessed zone is wrong at exactly the shows
that sit near a border. Set in setup Step 1.

Zones turned up in five separate rules while reading the rule book, and only one
of them is actionable with the data the app holds: in **Zones 12, 13 and 14**,
equitation and horsemanship are worked individually from the gate with no line-up
and no rail work, with a required working order and a maximum of two horses per
exhibitor (AM-115.C, YP-120.C, and the hunt-seat equitation class procedure).

`zone_individual_work_note(show, discipline_name)` returns that as **text**, not
as enforcement: whether the class was worked from the gate, whether there was
rail work, and whether the judge asked for a line-up all happen in an arena and
are not facts the app has. What it can do is put the rule in front of the person
running the gate before the class starts — the note rides on the class list
payload as `procedure_note` and renders on the gate screen's order-of-go panel.

The other four uses need data the app does not have: Green class point thresholds
(25, or 10 in Zones 12-14), Zone Shows, zone year-end awards, and the `(Zone
12-14)` text that currently lives inside class names in the loaded catalog
because there was nowhere else to put it.

### How deep a class must be placed before it is posted

SC-110.I: *"The show management must announce placings in all classes under all
judges of all contestants one through seven places after the class is complete."*

`rules.required_published_places(cls)` returns 7 for APHA and **None** by
default — an OPEN show answers to nobody about how deep it places, and inventing
a number would block a jackpot that only pays three. `placing_shortfall()` in
`routers/results.py` reports which places each judge's card is still missing;
`POST .../results/publish` refuses with `PLACINGS_INCOMPLETE` and the per-judge
shortfall, and `acknowledge_incomplete` posts anyway.

Three things about that check:

- **The depth is capped by the class.** Four entries cannot fill seven places.
- **Cards are the show's assigned judges, not the judges who have filed.** A
  three-judge panel where one has entered nothing is the case the rule is about,
  and keying off the results would report it complete.
- **It confirms rather than blocks.** The app cannot see a scratch, a
  disqualification, or a class the judge genuinely placed shallow. But it must
  not be silent: the scribe form's own gap warning only catches *interior* gaps
  (1, 2, 4 missing 3), so a card that simply stops at third looked finished to
  it, which is the shape a half-entered card actually has.

### How many horses one exhibitor may show

Three limits, and the third has a different shape from the other two:

| Rule | Limit | Scope |
| --- | --- | --- |
| SC-185.F | 5 horses | Per exhibitor, across all the individual working events, per show |
| SC-185.F.1 | 2 horses | Per exhibitor, in Longe Line — and separately, in In-Hand Trail |
| AM-300.H | 1 exhibitor | Per **horse**, per event, within Amateur Walk-Trot |

The first two are per exhibitor. The last is per horse and crosses exhibitors,
which is why none of them can be answered from the entry alone.
`apha_context.apha_entry_context(show_id, db)` reads the whole show once —
`apha_disciplines` (class → discipline) and `apha_entries` — and both routers
pass it in the validation context. On the batch registration path it is built
once and **appended to as the batch goes**, because six horses submitted in one
request are still six horses and none of them are flushed yet.

Things worth keeping in view:

- **The caps count distinct horses, not entries.** Six classes on one horse is
  one horse; the rule limits how many horses somebody brings.
- **They run before the division is considered**, and therefore on entries that
  name no division at all — SC-185.F caps the exhibitor whether they are riding
  Open or Youth.
- **No context means no cap.** A non-APHA show builds no discipline map, and a
  caller that has not built one must not have entries refused on a guessed
  discipline. A class routed to the "Unassigned" placeholder is likewise not
  capped, because it has no event.
- **Utility Driving is in the rule and not in the list.** `rules/disciplines.py`
  has no such discipline, and mapping it to Pleasure Driving would cap a
  different event than the one APHA named.
- The equitation/horsemanship two-horse limit is **not** enforced. It appears
  only inside the Zones 12-14 exception in AM-115.C and the hunt-seat equitation
  procedure, and YP-120.C's version of the same exception omits it — so it is
  carried in the zone note's text rather than as a rule.

### Working orders and posted patterns

`POST /shows/{id}/gate/classes/{cid}/draw` draws the order of go at random
(SC-185.I). The steward could always drag the order into place; there was no way
to produce one the way the rules describe. Re-drawable on purpose — the same rule
lets show management alter the order at its discretion, and a draw that could not
be redone after a scratch would be worse than none. It uses `SystemRandom`,
because this decides who works first in a class people paid to enter.

`PATCH .../pattern` records that a class's pattern has gone up (migration 120:
`classes.pattern_posted_at`, `classes.pattern_notes`). The timestamp is taken by
the backend, never sent by the caller — a class that could name the minute could
claim it met the one-hour rule after the fact.

Two deliberate limits:

- **The app cannot check the hour.** `classes` carries a date and no start time,
  so there is nothing to measure an hour back from. Recording *whether* and
  *when* is the half that is answerable; adding a start time to every class is a
  bigger change than this rule justifies on its own.
- **The pattern itself is not stored.** It goes up on a board by the gate, and a
  second copy here could disagree with the one exhibitors actually walked —
  somebody would ride this one. `pattern_notes` holds the judge's reference to
  it ("Green Western Riding Pattern #1"), which is what the office needs.

### Five outcomes, not one boolean

`results.place` was NOT NULL, so every row on a card had to claim a placing and
there was nowhere to put the states the rule book actually produces. Migration
121 makes it nullable and adds `results.outcome`:

| Outcome | Means | Ranked? |
| --- | --- | --- |
| `placed` | Ranked from the score or the placing typed. | yes |
| `zero_score` | The judge called a zero. | yes — below everyone who scored |
| `no_score` | No score at all. Not the same as a zero. | no |
| `disqualified` | Flat equitation words it *"should not be placed"*. | no |
| `eliminated` | Off course, fall, over the time allowed. | no |

Three decisions worth keeping in view:

- **A declared zero is a number.** SC-265.E.4-6 separates a 0 from a No Score
  precisely because the sheet compares the zero, so it ranks last rather than
  dropping off the card. `placings.RANKED_OUTCOMES` is the one place that split
  lives; `frontend/lib/result-outcomes.ts` mirrors it.
- **The outcome decides whether the app ranks the row; a human decides whether
  it carries a place.** AM-111.D keeps a rider eliminated *during a ride-off* in
  the placings, last among that group — and the app cannot know a ride-off
  happened, so `rank_card` leaves a non-ranked row's place exactly as the scribe
  filed it rather than clearing it.
- **It is per card, not per entry.** A card is what a judge hands in, and
  `place` — the thing this qualifies — has always lived on `results`. The
  coarser `entries.is_disqualified` stays for an entry that is out of the class
  before anybody judges it.

Everything that read a placing goes through `backend/placings.py` now, because a
nullable `place` breaks `min(results, key=lambda r: r.place)` the first time a
judge throws a horse out. Two rules are settled there once: an unplaced card is
not a candidate for "best of several judges" (a judge who disqualified an entry
did not rank it last), and a non-ranked outcome earns nothing in side pot
standings or futurity Hi-Point. Every pre-121 row backfilled to `placed`, so no
existing standing moved.

### The judge's card

The app took a *total* — the number somebody worked out on paper and keyed in.
A real card is a base score, a run of maneuver or fence scores, and penalties
off the top. Migration 122 holds the card and does the sum.

**There is no single card shape**, which is why this is a catalog rather than a
table with fixed columns. The rules supplied contain three incompatible systems:

| System | Marked | Penalties |
| --- | --- | --- |
| Equitation / Horsemanship on the flat | maneuvers −3 to +3, half points | fixed 3 / 5 / 10 |
| Equitation Over Fences (AM-111.F) | each fence −1.5 to +1.5, 0–100 scale | ~35 named, a third of them ranges |
| Cow work / Boxing (SC-265.E) | maneuvers −3 to +3 | 1 / 3 / 5, with letter codes |

`judging_systems` declares the scale, `judging_penalties` the catalog, and
`classes.judging_system_id` says which card a class is marked on — set at
`/admin/shows/[id]/classes/judging`. A class with none scores exactly as it did
before, with the scribe typing a total, which is also how every rail class works.

**What is seeded and what is not.** The scales and the penalty *tiers* are in the
rule text and are seeded. The base score of 70 is the app's default rather than a
citation, and each system's `notes` says so on screen. AM-111.F's table of
roughly thirty-five named penalties is **not** loaded — about a third are ranges
the judge chooses within, and inventing the labels under APHA's name would be
worse than an empty list. `card_penalties.label` is free text beside the optional
catalog pointer, so a scribe records what the judge actually called.

**Three structural decisions:**

- **`judge_cards` is keyed on `(class, entry, judge)`, not on a `results` row.**
  `bulk_save_results` is a delete-all-then-insert-all within one judge's card and
  the scribe screens autosave on a settle, so anything hanging off `results.id`
  by foreign key would be destroyed every time somebody typed.
- **The card does not write `results`.** `save_card` returns `effective_score`
  and the scribe screen carries it into the ordinary autosave. Two writers over
  one number, one of which deletes and reinserts, is how a score goes missing.
- **The computed figure is editable, and the override is audited.** A card the
  app refuses to add up is a scan with extra steps; a card held next to a
  separately typed total is two numbers that will disagree. So it computes, and
  `judge_cards.override_score` lets a human overrule it into `result_audit`.

This is the change that amends CLAUDE.md's *"does not calculate penalties"* line.
The boundary that has not moved: the app does not judge, does not decide what a
maneuver is worth, and does not decide which penalty applies.

Still open, and not papered over: `results.raw_score` remains one number per
entry per judge. What a card gives is the working behind it — not the judge's
full sheet with Form & Effectiveness and written comments, and not the
traditional symbol system AM-111 permits as an alternative (SC-215.E.3, which
has not been supplied). There is also no admin screen for editing the penalty
catalog; the seed plus free-text penalties is what carries a show today.

### The traditional symbol system (SC-215.E.3)

"Horses shall be scored either by traditional symbol system or by breed numeric
standard. In either case, scoring shall be from 0-100 and 70 shall be considered
average."

The app already had the numeric half — migration 122's judging systems build a
score from per-fence marks. **The symbol system is not a second card shape.** The
judge watches the round and picks a number inside a band; there are no maneuvers
to add up and nothing for a card to total, so forcing it into `judging_systems`
would mean inventing a maneuver range for a system that has none.

So it is guidance rather than a system: seven score bands held in `rules/apha.py`
with the zone notes and the category requirements, served by
`GET /judging-systems/symbol-system` (optionally `?discipline=`). A class scored
this way carries no judging system at all, which is what the app already does by
default — what was missing was the guidance beside the score box.

**The bands stop at ten.** That is the rule's own shape, not a gap: below ten is
an elimination rather than a score, and inventing a band for it would put words
in APHA's mouth about where that line sits.

**Scoped to Working Hunter.** SC-215's section heading was not supplied, so the
scope is read from the rule's own words — "manners, way of going and style of
jumping", "an even hunting pace". Equitation Over Fences is AM-111.F, judges the
rider rather than the horse, and is already modeled as a card.

### A tie is a question for the judge

AM-115.B.2 and every pattern class procedure say the same thing: equal scores
are separated at the judge's discretion. The app used to flag two 71.5s
`is_tie` and post them as a shared place, and the only way to record the judge's
answer was to edit one of the scores they called.

`results.tiebreak_rank` (migration 121) holds the order the judge gave, lowest
first. `rank_card` sorts on `(score, tiebreak_rank)`, so two ranked 1 and 2 take
two places with **neither score touched**; equal scores with no rank on either
side stay tied. `rules.ties_must_be_broken(cls)` is False by default — a shared
place is an ordinary result at a show that answers to nobody — and True for APHA
on `pattern` and `time` classes only. A `placement` tie is one the scribe ticked
deliberately, recording a decision the judge already made on paper; a scored tie
is one the app *derived* from two numbers and nobody has been asked about.

`POST .../results/publish` refuses an unbroken tie with `TIES_UNRESOLVED`,
naming the card and the entries. `acknowledge_ties` posts a shared place anyway,
under its own flag rather than sharing `acknowledge_incomplete`: a shortfall
asks whether the card is finished, a tie asks which of two horses won.

### Membership standing

Membership numbers live in `exhibitor_registrations`, which since migration 117
also carries `expires_at`. The desk's check-in sheet reports it beside — never
folded into — the verification status, because they answer different questions:
`status` is whether anybody inspected the card, `lapsed` is whether the card is
good. Judged against the show's **end date**, never today, the same rule health
paperwork follows.

The pre-080 `exhibitors.apha_member_number` / `apha_member_expiry` columns are
backfilled into the registry by 117 and left in place — some records carry a
number only there, and the export still falls back to them.

## Getting The Show Approved

`GET /shows/{id}/apha-validation` is the APHA twin of the AQHA readiness read, in
the same shape and drawn by the same component. It runs
`APHARules.validate_show_schedule` over the show, then re-runs the per-entry
rules over every entry, and returns one list of issues plus the SC-090
application window.

**Everything it reports is a warning bar one.** None of SC-090 is enforceable
from here: the application goes to APHA on paper, the approved-judge list is
APHA's, and whether a show is APHA-sponsored — and so entitled to the word
"Championship" — is not a fact this app holds. What the app holds is the
calendar, the show's name, its class list and its judge panel, which is enough to
put each condition in front of the office while there is still time to act on it.
Nobody should meet these rules for the first time in a rejection letter.

The single error is a show that has run out of time to apply at all (SC-090.D.3),
because that is not advice. An error nobody can clear is one people learn to
scroll past, which is the failure mode this whole panel exists to avoid.

### The show number is the approval

APHA assigns the show number when it approves the show, and the results export
already refuses without one, so a number on file is the strongest evidence this
app can hold that approval happened. The deadline ladder is therefore history the
moment the number appears, and `application_window` comes back None.

The cost of being wrong is one nag at an office that has been approved but has
not typed the number in yet — and the fix for that is the field they already
have. The alternative was a second set of `apha_approval_status` /
`_submitted_at` / `_notes` columns mirroring the AQHA ones, which would have been
the third time this repo made the same association-prefixed pair; migration 114
exists because of the second time. See the Sharp Edge in `Claude.md`.

### The application ladder

SC-090.C wants the application postmarked at least 90 days out, and SC-090.D
prices the bands underneath — a late penalty fee per judge under 90 days, a
larger one under 60, and no approval at all under 30. `application_window()` in
`rules/apha.py` returns the basis date, the 90-day deadline, the days remaining
and the band; the panel draws a countdown from it rather than parsing a sentence.

The boundaries follow the rule's own wording: "at least ninety (90) days" makes
90 standard, and "less than thirty (30)" leaves 30 still approvable. An off-by-one
here is a late fee somebody was told they would not be paying.

**The measurement is against the entry deadline or the show date, whichever comes
first** — which is why `shows.entry_deadline` exists (migration 123). A show that
has not set one is counted from its first day, and the window reports
`basis: "start_date"` so the panel can say the real cutoff may be earlier. That
fallback is the optimistic direction, so it is stated rather than hidden.

### The class list, the name, and the judges

* **SC-090.E/F** — approval is not granted until the class list or show bill
  reaches APHA, and amendments inside 30 days need written notification. The app
  does not send that notice and says so, rather than letting the edit go through
  quietly. The countdown stops once the show has started; a finished show does not
  need a running clock on every screen.
* **SC-090.L and SC-090.P** — "Champion"/"Championship" are reserved for
  APHA-sponsored shows, and "World", "National" and "International" need APHA's
  written permission. Checked against `shows.name`, because that string is a fact
  the app holds. Reported and never refused: a club holding that permission is
  entitled to the name.
* **SC-090.B** — judges are selected from APHA's current approved list. What the
  app checks is `judge_associations`, which is what somebody typed into the judge
  registry, so this reports a gap in the app's **own records** and never claims a
  judge is unapproved. The reverse holds too: a carding recorded here does not
  make a judge approved. Only APHA's list does that, and the app does not hold it.

### What kind of show it is (SC-100, SC-105)

APHA divides approved shows into four categories, and each carries its own judge
limit. They live in `show_categories` (migration 124), keyed on `show_types` the
way `judging_systems` is, and are chosen on the show details form.

| Category | Judges | Days | Rule |
| --- | --- | --- | --- |
| Single-Judge Show | 1 in the arena at any given time | one or more | SC-100.A |
| Two-Judge Show | 2 in the arena at any given time | one or more | SC-105.C.1 |
| Paint-O-Rama | 3 or 4, never more than 4 at once | one or more | SC-105.D.2 |
| Zone Show | at most 6 | **two or more** | SC-105.E.2 |

**Two different claims, and `judge_limit_basis` says which one is being made.**
SC-105.D.2 and SC-105.E.2 bound how many judges a show may *have* — "limited to
three (3) or four (4) judges", "a maximum of six (6) judges" — so the assignment
count answers them outright, and the finding is
`APHA_CATEGORY_JUDGE_LIMIT_EXCEEDED`. SC-100.A and SC-105.C.1 bound how many may
judge **in the arena at any given time**, which is concurrency the app does not
model: a two-judge show rotating three judges through a two-judge arena is
perfectly legal. There the finding is
`APHA_CATEGORY_JUDGE_COUNT_UNEXPECTED` and it says in as many words that it is a
reason to check the category rather than a rule it can tell you was broken.

The category-count checks are skipped entirely at zero judges: a show still being
built has no panel, and `APHA_JUDGES_NOT_ASSIGNED` already says so once.
Migration 124 also puts `min_judges` at 2 for the Zone Show, on the basis of
SC-105.A defining multiple-judge shows as "two-judge shows, Paint-O-Ramas or Zone
Shows" — one judge is not multiple. SC-105.E.2 itself states only a maximum.

### The clinic, and what it lifts

`shows.offers_clinic` exists because it changes a check. SC-105.C.3 exempts a
two-judge show offered with a clinic from the SC-095 minimum class requirements,
pending APHA approval, so `show_minimums()` returns `applies: false` with an
`exempt_reason` naming the rule — reported separately from the judge count,
because "not required" and "under three judges" are different answers and only
one of them changes when the show adds a judge.

It can genuinely fire despite SC-095 only biting at three or more judges, and the
reason is the concurrency reading above: a `two_judge` show may legitimately have
three judges assigned. Everything else the rules say about clinics — that the
clinician must be APHA-approved, and that the show may not run in conjunction
with an approved Paint-O-Rama (SC-100.A.1, SC-105.C.2) — is not checkable and
rides on the panel as text.

### What SC-100 and SC-105 are not modeled for

Reported against the chosen category as text (`category_requirements()`), never
as findings, because a finding the office can never clear is one they learn to
scroll past:

* Paint-O-Rama sponsorship by an official APHA Regional Club (SC-105.D.1), and
  the livestock-show and state-fair exception (SC-105.D.3.a.2).
* The per-year caps — two Paint-O-Ramas per regional club, four in Zone 10, one
  Zone Show per zone (SC-105.D.3.a, SC-105.E.1). The app holds one show and
  cannot count a club's year.
* Clinician approval, and the location and sequencing rules for back-to-back
  two-judge shows (SC-105.C.4, SC-105.C.7).
* SC-105.B's ten-judge ceiling on shows held in combination, which is a fact
  about several shows at once.
* **Ancillary judges** (SC-105.B.7.b) — `show_judges` has no main/ancillary
  distinction, so nothing enforces that an ancillary judge is aligned with
  exactly one main judge.
* SC-105.B.5's concurrent-judging arena split, and SC-105.B.6's rule that Grand
  and Reserve Champion results wait until every judge has finished that sex
  division. The publish gate already refuses to post a class until every
  **assigned** judge has filed a card, which covers the narrow reading of B.6;
  the broad one needs the feeder classes, and "the respective sex division" is
  not something the app can identify.

Two of SC-105.B are already how the app works, and are stated on the panel for
every multiple-judge category so the office can see it is not quietly doing
something else: **B.4**, that each judge works independently with no consultation
during judging except over a disqualification or a 5- or 3-point penalty with a
scribe or designated person present — the app never combines judges' cards and
places each independently; and **B.3**, that an entry is an entry under every
judge with fees assessed accordingly — which is exactly what the
`per_judge_per_horse` and `per_judge_per_exhibitor` fee units do.

### Three years old for the versatility and ranch events (SC-190.A.3.a)

"Horses must be three-years-old or older to exhibit in English Versatility
Pattern, Western Versatility Pattern, and Ranch classes." Checked on entry at
both doors, and **an error rather than a warning** — a departure from most of the
APHA work here, and deliberate. A missing Coggins can be produced and a
membership bought at the counter; a two-year-old cannot become three, so the
entry is ineligible in a way nothing at the show can fix, and results filed on it
are what APHA refuses.

Age is counted in **show years** — every horse has a January 1 birthday, so a
horse foaled in December 2023 is three for the whole of 2026. `horse_calendar_age`
mirrors AQHA's `_calendar_year_age` deliberately: the convention belongs to the
industry rather than to one association, and two implementations would eventually
disagree about a December foal.

It declines to run in the two cases where it would be guessing — no foaling date
on file gives no age, and no discipline in the context is every non-APHA show.
Same posture as the SC-185.F horse caps, which read the same map.

**"Ranch classes" is read as the ranch events SC-190.A enumerates and no wider.**
The classifier knows a dozen disciplines beginning with the word — Ranch Trail,
Ranch Reining, Ranch Conformation — and Ranch Conformation is a halter class. A
rule applied to every name starting with "Ranch" would refuse entries in classes
the rule never listed.

### The minimum a show must offer (SC-095)

SC-095.A is conditional on the judge panel — **three or more judges** and the
show must offer two Open halter classes (Junior, 2 and under; Senior, 3 and
over) and four performance contests, or it is not approved. The panel size is the
one hard fact in the rule.

Everything else is inference, and the whole design follows from that. "Open
division" is not a column: the app holds a per-show discipline (`Halter`) and a
per-show bracket, and at a real APHA show the Open halter classes are bracketed
by **age** ("Yearling", "Four Year & Older") while Amateur and Youth carry their
names in the bracket instead. So Open is read as the absence of another
division's name, and the age split is read out of the class name and its bracket
together.

**So almost none of it is reported as a finding.** `show_minimums()` returns what
it found — the Junior list, the Senior list, and the Open halter classes it could
not place — and the panel prints all three for somebody to check by eye. Only
shortfalls that survive every reading of the rule are raised:

| Finding | When |
| --- | --- |
| `APHA_MINIMUM_HALTER_MISSING` | No Open halter class of any kind |
| `APHA_MINIMUM_HALTER_AGE_GAP` | Junior or Senior missing, **and every Open halter class was understood** |
| `APHA_MINIMUM_PERFORMANCE_SHORT` | Fewer than four non-halter classes |

The middle one carries the important restriction. A Grand & Reserve Champion
class is Open halter with no age in it, so a schedule holding one is a schedule
the app has not fully read — claiming a missing Junior class there is how an
office learns to stop reading the panel.

**Performance contests are counted against SC-190.A's own list.**
`PERFORMANCE_DISCIPLINES` holds the twenty disciplines behind that rule's
twenty-eight entries — the Green variants collapse into their parents because
the classifier routes them there — written as the names `rules/disciplines.py`
produces so the two cannot drift on wording. `performance_confirmed` is the
figure the requirement is judged on.

Before SC-190.A arrived the only number available was `performance_upper_bound`,
every class that is *not* halter. That could notice a show short of four and
could never confirm one that met it. It is still computed and still reported,
because the gap between the two says how many classes were not matched and
therefore how much of the count rests on the classifier having routed them
correctly. On a real 172-class Paint show: 68 confirmed, 134 not halter, and
every one of the 66 in between is a class SC-190.A genuinely does not enumerate.

**What is absent from that list is as informative as what is in it.**
Showmanship, Longe Line and In-Hand Trail appear in SC-190.A.1 and A.2 as classes
a yearling or two-year-old may be offered, but not in the enumeration; the speed
events and the equitation classes are not there at all. So a schedule of nothing
but barrel racing counts **zero** performance contests toward SC-095, which is a
surprising enough consequence to have its own test. The finding reports both
numbers so that reading can be checked rather than trusted.

Performance Halter and Halter — Group count as halter throughout, because
counting them as performance would inflate the number that produces the finding.

One trap has a test of its own. APHA's *performance* Junior/Senior split is
5-and-under against 6-and-over and has nothing to do with halter's 2 and 3, so
matching on the word "Junior" would read a Junior Western Pleasure as satisfying
SC-095.A.1.a.

### What SC-175 and SC-180 carry that is not modeled

SC-175.M.6 is worth recording as a correction rather than a gap: it gives the
recommended halter age classes as Weanling, Yearling, Two-year-old,
Three-year-old, Four-year-old-and-older, **or combined as "2 and Under" and "3
and Over"** — which is exactly the Junior/Senior split SC-095.A.1 asks for and
exactly what `show_minimums` was already reading out of class names. That reading
was inference when it was written; SC-175.M.6 makes it the rule's own structure.

Still not modeled, and each one is a real rule the app is silent about:

* **SC-175.D** — a horse may show in only one point-earning halter class, though
  a Youth and/or Amateur halter class is allowed in addition to the Open
  age-group class. Checkable in principle from the show-wide entry context, but
  Grand and Reserve Champion classes sit in the same discipline and division as
  the age classes that feed them, so a naive check would flag every champion
  qualifier. It needs championship classes identified first.
* **SC-175.M.7** — Performance Halter is for horses that completed at least one
  performance class other than showmanship at the same show, and they may not
  enter the other SC-175 halter classes. Both halves are derivable and neither is
  built.
* **SC-175.M.8** — a mare in the Broodmare class may not enter the other halter
  classes, and eligibility rests on a Broodmare status card show management
  inspects. The exclusivity is derivable; the card is a `show_verifications` kind
  that does not exist.
* **SC-175.M.10** — Grand and Reserve Champions are mandatory in each sex
  division once three horses aged one or older are exhibited in it. Needs sex
  divisions and championship classes identified, plus entry ages.
* **SC-175.C** — only weanlings may be exhibited without a registration
  certificate.
* **SC-175.G** — all Open halter classes of a sex division must be judged before
  that division's Grand and Reserve. Same family as SC-105.B.6, and blocked on
  the same thing.
* **SC-175.L.3** — the halter disqualification list (lameness, parrot mouth,
  cryptorchid, incorrect pattern, failure to set up, loose horse, disruptive
  horse, pacing). These map onto `results.outcome = 'disqualified'` and would make
  a good catalog beside `judging_penalties`, with the Youth and Amateur exception
  in L.3.d and L.3.e — not disqualified, but not placed over anyone who completed
  the pattern — needing care, because it is a placing rule rather than an outcome.
* **SC-180** — Produce of Dam takes two produce with at least one Regular
  Registry, Get of Sire takes three with at least two. No points are awarded.
  Group halter classes are already their own discipline in the classifier; the
  composition rules are not checked.
* **SC-190.A.1 and A.2** — the May 15 rules for what a yearling or two-year-old
  may be offered. Derivable from the class date and the horse's age, and not yet
  built; SC-190.A.3.a was taken first because it carries no date arithmetic.
* **SC-190.A** also opens by requiring APHA registration to exhibit in a
  performance class at all (RG-010.B, SC-165.A). `horse_registrations` holds the
  numbers, so this is derivable — but it would refuse entries on paperwork, which
  is the block this app deliberately took off health documents, so it wants a
  decision rather than a patch.

### SC-095.B and .C are permissions, not requirements

B allows age divisions to be added "if entries justify" (SC-185.E). There is
nothing to check in a permission.

C allows an approved show to hold classes concurrently with other equine
associations — "the horses will work one time for each class and the judge(s)
will judge the class for exhibitors in the APHA and the other equine
associations concurrently". That is the rule the app's dual-sanctioning already
assumes: `class_sanctioning` designates **one** class as approved by another club
rather than duplicating it, which is precisely "the horses will work one time".
It is also why a dual-sanctioned class legitimately carries both clubs' fees —
two bodies are taking results off one go.

### What SC-090 is not modeled for

Most of the rule is APHA's scheduling problem rather than the app's, and none of
it is derivable here: the 200-mile separation between same-date shows (SC-090.J),
show-date priority and the traditional holiday weekends (SC-090.K), and the
reserved titles in SC-090.P beyond the words in the name check. The app holds one
show and does not know where any other show is.

**SC-090.G is still not checked**, and now for a better reason than a missing
rule. SC-175, SC-180 and SC-190 have been supplied, so the events are known —
but the rule is about a show that *denies or restricts entries* in them, and the
app can see which classes a show **offers**, never whether an entry was refused
at the desk or an eligibility condition was attached outside the app. The
supplied text moved this from "unknown" to "known and unanswerable".

## APHA Entry Validation

APHA rules live in `backend/rules/apha.py` and are reached the same way every
other association's are — `rules.get_rules(show.show_type.code)`, then
`validate_entry`. Two checks are implemented:

| Rule | Code | What it says |
| --- | --- | --- |
| SC-325.A.1 | `APHA_SOLID_PAINT_BRED_OPEN` | A Solid Paint-Bred horse may not enter an Open division class. |
| AM-300.E, YP-015 | `APHA_RELATIONSHIP_REQUIRED` | Every ownership division — Amateur, Novice Amateur, Amateur Walk-Trot, Youth, Novice Youth and both Youth Walk-Trot divisions — must state the exhibitor's relationship to the horse's owner. |
| AM-205, YP-255.A.1 | `APHA_NOVICE_ELIGIBILITY_REQUIRED` | Novice Amateur and Novice Youth entries must carry an eligibility declaration. |
| migration 115 | `APHA_DIVISION_UNKNOWN` | The named division is not one of the nine. Caught here rather than left to the CHECK constraint, which surfaces as an IntegrityError naming nothing. |

Every shortfall is reported at once — a bare Novice entry comes back short two
things, and returning only the first sends somebody round the loop twice.

`RELATIONSHIP_OPTION_GROUPS` in `frontend/lib/apha.ts` is the picker and
`RELATIONSHIP_OPTIONS` in `backend/rules/apha.py` is what checks a value that
arrives. APHA's ownership rule names roughly twenty relationships — in-laws,
step-relations, aunt, uncle, niece, nephew, legal ward, a family-owned farm,
ranch or corporation — and the app offered seven, so an exhibitor showing their
niece's horse had to pick something untrue. "Leased horse" is there because
AM-020.A.1 makes leased horses eligible and this field is the only place an
entry can say so; it is **not** a lease record, and the term, the lessor and the
papers APHA holds are not modeled anywhere.

**The exhibitor is asked once, per horse, not once per class.** Migration 128
moved the answer to `exhibitor_horses.relationship_to_owner`, written from the
registration wizard's horses step, and `POST /shows/{id}/register` copies it onto
every entry. Asking it per class from a list of twenty-five meant somebody
entering eight classes on their own horse answered "Self" eight times and could
answer differently on the eighth — a data error nothing would have caught. A
value on the request still wins, because the office's own entry form
legitimately types one in for a walk-up.

Both fire only when the entry names an `apha_division`. Which division an entry
belongs in is not derivable from the class *in general* — the same class runs
for Open, Amateur and Youth — so an entry that names none is not checked.

### Which divisions a class is run for (`divisions_for_bracket`)

The picker offered all nine on every class, so a class the show had already
named "56 - Youth WT Showmanship Ages 5-10" could be entered as Amateur. That is
not a class the show is running, and nothing downstream would have caught it:
`apha_division` is stored data, and the checks above take the entry at its word.

`divisions_for_bracket(bracket_name, class_name=None)` reads the division out of
the class's bracket — the column that exists for exactly this — falling back to
the class name, since a show that files everything under "Unassigned" still
writes "Youth Showmanship" on the class. Patterns are ordered longest-first so
"Novice Youth" is tested before "Youth" and "Amateur Walk-Trot" before both its
parents; the two Youth Walk-Trot bands are told apart by the age the bracket
states, split at ten by YP-075.

**Every bracket that matches resolves to exactly one division**, which is what
lets the exhibitor's entry form drop the picker altogether: pick a class, pick a
horse, press the button. A plain "Youth" or "Amateur" bracket is *not* paired
with its Novice variant — a Novice division is not a choice made inside an
Amateur class. A show that offers one runs it as its own class, bracketed
"Novice Amateur" or "Novice Youth" (MNSPHC's schedule has class 59 "Novice
Amateur Showmanship" beside class 60 "Amateur Showmanship"), and an exhibitor
holding Novice status at a show offering no Novice class shows in Amateur.

**A bracket that says nothing files no division at all.** `None` means *the class
does not say*, and the entry goes in without one — which is what every entry did
before the picker existed, and what `validate_entry` returns early on by design.
It is never turned into a guess: "Yearling Stallions" is almost always an Open
halter class, and filing it as OPEN would be right most of the time and would
refuse a Solid Paint-Bred horse (SC-325.A.1) the rest of it — an entry the show
meant to take, turned away over a division nobody chose.

The exhibitor's form states the division it derived, so somebody can see what is
being filed for them, and shows nothing where the class is silent. **The desk
keeps its picker**, because staff overriding is the reason it has one; `create_entry`
fills a blank from the class the same way, so both doors store the same thing.

**These were inline in `routers/entries.py` until they were moved here, and that
was a live hole.** The desk endpoint enforced them by hand; the exhibitor's own
class registration in `routers/show_registration.py` has always validated through
the rules engine, and `APHARules` was an empty subclass of `DefaultRules`. So an
exhibitor self-registering could enter a Solid Paint-Bred horse in an Open class.
Anything added here must go in the rules class, not in a router, or it protects
one door out of two. `backend/tests/test_apha_rules.py` asserts the dispatcher
actually returns `APHARules`, because every other test in that file would pass
against a stub.

## Class Associations

Dual-sanctioned classes use `class_associations`:

- `class_id`
- `show_type_id`
- `association_class_code`

This lets one class carry, for example, APHA and NSBA codes.

## APHA Standard Class Import

APHA reference classes are stored in `association_standard_classes` (the view over
`association_standard_class_versions`, filtered to the APHA show type). Admins load
the current list by uploading APHA's own **Approved Class Codes** PDF at
`/admin/standard-classes` — the reader is `parse_apha_pdf` in
`backend/imports/class_codes.py`, and the upload previews a diff before anything is
written. `apha_standard_classes` was dropped in migration 114.

Backend endpoints:

- `GET /apha-standard-classes/`
- `GET /apha-standard-classes/divisions`
- `POST /shows/{show_id}/classes/bulk`

Class setup itself is **setup Step 6** at `/admin/shows/[id]/classes`, which serves
every show type and follows `show.show_type_id` for its standard library. The
old per-association `APHAClassPicker.tsx` was removed in the wizard rebuild and
is not coming back — the association-specific part of class setup is the catalog,
not the screen.

On import, each picked class is **auto-routed** into a per-show Division (discipline) and Section (bracket). Discipline comes from name-keyword classification in `backend/rules/disciplines.py` — APHA codes don't encode discipline cleanly (e.g. code `R1` alone covers six different disciplines), but APHA class names are clean enough for 100% keyword coverage. Section comes from the catalog's `division` column (which holds the bracket — Amateur/Youth/Novice/Open/etc.). Missing divisions/sections are created on the fly and the (div, sec) membership is registered. The picker shows a "Will create division" column and a routing-summary panel so the secretary can preview before committing.

## What The Office Sends APHA

`GET /shows/{id}/reports` is a registry in the same shape as
`financial_reports.py`: a slug, a title, a column list and rows of cells, drawn
by one frontend renderer. Adding a report is a function in
`backend/show_reports.py` — no route, no component, no migration.

| Report | What it is |
| --- | --- |
| Show Results | Every **posted** placing, by class and by judge, with back number, membership number, horse, registration number and class code. |
| Class Summary | One row per class — entries, cards filed against the panel, pattern posting, posted or draft. |
| Entry Cards | Every entry taken, withdrawals included and marked. |
| Judges' Cards | The maneuvers, penalties and totals recorded off each card, and any override. |
| Compliance Sheet | What is on file per exhibitor and what is outstanding. |
| Eligibility Declarations | Every Novice declaration, quoted in the words the entrant agreed to. |

The whole show loads once in `routers/show_reports.py` and every report is built
from that payload without querying, so two reports cannot disagree about the
same class and the retention bundle cannot disagree with the reports inside it.

Access is the **show-office tier** — ADMIN, or the SHOW_SECRETARY /
SHOW_MANAGER assigned to this show. A `SCRIBE` writes placings and a
`GATE_STEWARD` runs the in-gate; neither has business reading an exhibitor's
membership number off a compliance sheet, which is the line Financials already
draws.

### Only posted classes are reported as results

Posting a class is what makes its placings official, and a report the office
forwards to an association must not be the first place a half-typed card counts
as a result. The number of unposted classes rides on the report as a note, so a
missing class is never a mystery. Entry Cards deliberately does *not* wait on
posting — an entry is a document in its own right.

### The retention bundle does not satisfy SC-110.J on its own

SC-110.J asks management to retain the **original signed** judge's placing
cards, the show results and the entry cards for at least a year.
`GET /shows/{id}/reports/archive` produces four of those reports on one
printable page, generated from the show's own data the way the show bill is —
and says in its own `caveats` that the signed cards are paper the judge hands to
the office and nothing here is that document. Judges' Cards is what the *scribe*
recorded, which is a useful record and a different thing.

Generated rather than uploaded, for the show bill's reason: an uploaded archive
is a second source of truth that goes stale the moment a placing is corrected,
and worse than none because people trust the copy they printed.

### The compliance sheet is an output, never an input

AM-300.E.4 is explicit that an exhibitor who fails the ownership requirement
*"will lose any APHA points earned but will maintain placings"*, and everyone
else's placings are unchanged. So the sheet lists what is missing and nothing
reads it back — it never recomputes a class. Nothing on it is verified by the
app either: a membership number is what somebody typed and an attestation is
what somebody declared. What the office physically inspected is recorded
separately, in `show_verifications` at the registration desk.

Membership expiry is judged against the show's **end date**, never today — the
same rule health paperwork and `exhibitor_registrations.expires_at` already
follow.

### Filing the results (SC-125)

**The format question has an answer, and the answer is that the rule book does
not hold it.** SC-125.A says show results consist of "electronic results (in the
format specified by the APHA Performance Department)" — it delegates the layout
rather than defining it. So the Show Results report's columns are not unconfirmed
for want of a rule; the rule points somewhere this app cannot read, and the
caveat stays until something from the Performance Department replaces it. That is
a different statement from "not supplied", and worth making precisely: no amount
of further rule-book reading will settle it.

**The deadline is derivable, and is a countdown rather than a note.** Ten
calendar days from the last scheduled day of the show, and a show more than
thirty days delinquent is listed in the Paint Horse Journal.
`results_window()` returns `due`, `delinquent_after`, `days_remaining` and a band
of `open` / `late` / `delinquent`, and is None until the show's last day — there
is nothing to file before then, and a countdown running for eleven months is
noise on every screen it reaches.

**The app cannot see a postmark**, so `APHA_RESULTS_OVERDUE` and
`APHA_RESULTS_DELINQUENT` say the date has gone by and never that the results
were not sent. Both say so in their own text, because a warning that reads as an
accusation on a show that filed on day nine is one the office learns to dismiss.

`RESULTS_SUBMISSION_REQUIREMENTS` carries the rest of SC-125.A as text on the
panel — the signed cards, the score sheets for every scored class, the judges
evaluation forms without which results are not processed and future approvals are
denied, and the special handling fee for anything not sent electronically.

### The assessment fee (SC-125.B)

"Show Management must collect a fee per entry per show (Judge)... and forward to
the APHA office in order for show results to be processed." The app could not
bill that: its automatic units multiply by distinct horses or by the exhibitor,
and one horse in six classes is one horse and six entries. Migration 125 adds
**`per_judge_per_entry`** to close it, in the automatic family, with an
`association_assessment` fee template.

Named generically rather than as an APHA column because every breed body levies a
version of it, and a `show_fees` row the show prices is how this app already
handles that. `per_entry` stays where it is — that unit is class-fee vocabulary
and bills nobody, and `classes.entry_fee_cents` is what charges per entry.

### Retention, corrected (SC-125.D)

SC-125.D asks for one thing SC-110.J does not: a copy of the show results **as
received from APHA**. That is APHA's own document, produced after the results are
processed, and this app has no way to hold it — so the retention bundle names it
in its caveats. A bundle listing only its own output would look complete while
missing one of the three documents the rule requires.

SC-125.E allows one year from the date of the show for a correction and none
after, which is the same year the records must be kept, and puts the burden of
spotting an error on the owner of record at the time the horse was exhibited.

## APHA Entry Export

Backend endpoint:

- `GET /shows/{show_id}/apha-export` → `apha_entries_<show_id>.csv`

The export requires:

- The show is APHA.
- `apha_show_number` is set.

**This exports entries, not results.** Its columns are show number, show year,
back number, registration number, horse, class code, class description,
exhibitor member number and exhibitor name — there is no place, judge or score
in it. The download was named `apha_results_*.csv`, which is how an office ends
up submitting the wrong file to APHA. A real results report is separate work.

Two id lookups sit next to each other in this endpoint and are easy to confuse:

- The **class code** keys on `show_types`, through `class_associations`.
- The **horse registration number** and **exhibitor membership number** key on
  `associations`, through `horse_registrations` and `exhibitor_registrations`.

Reading `show_type_id` off a registration row is what made this endpoint raise
`AttributeError` on every show whose entered horses held a registration — the
column was dropped by migration 080. Use `association_id_by_code(db, code)`.

The membership number prefers `exhibitor_registrations` and falls back to the
pre-080 `exhibitors.apha_member_number` column, which is still the only place
some records carry one. Which of those is the source of truth is not settled yet.

