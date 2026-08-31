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
| Shows | `apha_show_number` |
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

`RELATIONSHIP_OPTION_GROUPS` in `frontend/lib/apha.ts` is the picker. APHA's
ownership rule names roughly twenty relationships — in-laws, step-relations,
aunt, uncle, niece, nephew, legal ward, a family-owned farm, ranch or
corporation — and the app offered seven, so an exhibitor showing their niece's
horse had to pick something untrue. "Leased horse" is there because AM-020.A.1
makes leased horses eligible and this field is the only place an entry can say
so; it is **not** a lease record, and the term, the lessor and the papers APHA
holds are not modeled anywhere.

Both fire only when the entry names an `apha_division`. Which division an entry
belongs in is not derivable from the class — the same class runs for Open,
Amateur and Youth — so an entry that names none is not checked.

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

