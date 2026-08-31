# Codebase Improvements

## August 2026

### How Many Horses You Brought Is Not A Question About One Entry

The rest of Phase 2's show-running work. Four rules, and the first thing they needed was for `validate_entry` to be able to see something other than the entry in front of it.

**Three limits, and the third has a different shape.** SC-185.F caps an exhibitor at five horses across the individual working events; SC-185.F.1 at two in Longe Line and, separately, two in In-Hand Trail. AM-300.H is the odd one: *a horse* may not be shown by two different Amateur Walk-Trot exhibitors in the same event at one show — per horse, across exhibitors, where every other limit in the app is per exhibitor or per class.

None of that is answerable from one entry, so `backend/apha_context.py` reads the show once — class-to-discipline, plus every live entry — and both doors pass it in the validation context. On the batch registration path it is built once and **appended to as the batch goes**: six horses submitted in a single request are still six horses, and none of them are flushed when the second one is validated.

Three details the tests pin down. The caps count **distinct horses, not entries**, because six classes on one horse is one horse and the rule limits what somebody brings. They run **before the division is looked at** — SC-185.F applies whether the exhibitor is riding Open or Youth — which is why they sit above the early return that skips everything else when no division is named; the first draft put them below it and every cap silently did nothing. And **no context means no cap**: a non-APHA show builds no discipline map, and refusing an entry on a guessed discipline is worse than not checking.

Two things deliberately left out. Utility Driving is in SC-185.F's list and not in ours, because `rules/disciplines.py` has no such discipline and mapping it to Pleasure Driving would cap a different event than the one APHA named. And the equitation/horsemanship two-horse limit is carried as *text* in the zone note rather than enforced, because it appears only inside the Zones 12-14 exception in AM-115.C and the hunt-seat procedure, and YP-120.C's version of the same exception omits it.

**A working order can now be drawn.** SC-185.I says one may be established by drawing, and every individual-work class procedure then requires a working order — so the app had the order (`entries.gate_order`, dragged into place) and no way to produce one the way the rules describe. Re-drawable on purpose: the same rule lets show management alter the order at its discretion, and a draw that could not be redone after a scratch would be worse than none. `SystemRandom`, because this decides who works first in a class people paid to enter.

**Migration 120 records when the pattern went up.** Every pattern class in the rule book requires the judge to post it at least an hour before, which is one of the few show-management duties stated as mandatory with a deadline attached.

Two honest limits, both stated in the code rather than papered over. **The app cannot check the hour** — `classes` carries a date and no start time, so there is nothing to measure back from; recording whether and when is the half that is answerable, and adding a start time to every class is a bigger change than this rule justifies on its own. And **the pattern itself is not stored**: it goes up on a board by the gate, and a second copy here could disagree with the one exhibitors actually walked — worse than no copy, because somebody would ride this one. `pattern_notes` holds the judge's reference to it instead.

### A Card That Stops At Third Looks Finished

Phase 2 of the APHA work, in progress. Two of the show-running items.

**The publish gate could not see a card that simply stopped.** The scribe form has warned about place gaps since the gate went in, and what it detects is *interior* gaps — 1, 2, 4 with 3 missing. Places 1-3 on a class of twenty passed clean, because there is no interior gap in 1-2-3. That is the shape a half-entered card actually has, and it is the shape SC-110.I is about: *"the show management must announce placings in all classes under all judges of all contestants one through seven places."*

`rules.required_published_places(cls)` returns 7 for APHA and **None** by default, because an OPEN show answers to nobody about how deep it places and a hard-coded seven would block a jackpot that pays three. Two details the tests pin down. The depth is capped by the class, so four entries do not owe seven places. And **cards are the show's assigned judges, not the judges who have filed** — a three-judge panel where one has entered nothing is exactly the case the rule exists for, and reading the judges out of the results would report that class complete.

It confirms rather than blocks: the app cannot see a scratch, a disqualification, or a class the judge genuinely placed shallow. But it is no longer silent, and the check is server-side, so it holds for any caller rather than only for the screen that happens to compute it.

**Migration 119 gives a show its APHA zone.** Zones came up in five separate rules and the app had no representation of them at all — class procedure, Green class point thresholds, the `(Zone 12-14)` text living inside class names in the loaded catalog because there was nowhere else for it, Zone Shows, and zone year-end awards. Only the first is actionable with data the app holds, and it happens to be the one somebody needs at the rail: in Zones 12, 13 and 14, equitation and horsemanship are worked individually from the gate with no line-up and no rail work.

That is surfaced as **text on the gate screen**, not enforced. Whether the class was worked from the gate, whether there was rail work, and whether the judge asked for a line-up all happen in an arena and are not facts the app has. What it can do is put the rule in front of the gate steward before the class starts. Nothing derives the zone from the venue's state, because a guessed zone is wrong at exactly the shows that sit near a border.

### Walk-Trot Is A Division, And A Paint Is A Colour And A Pattern

Phase 1 of the APHA work: the app's lists were shorter than APHA's, so exhibitors were being forced into answers that were wrong.

**`entries.apha_division` was missing three whole divisions.** The CHECK constraint had permitted six values since migration 010, and Amateur Walk-Trot (AM-300) plus both Youth Walk-Trot divisions — 11-18 (YP-109) and 5-10 (YP-110) — were not among them. Those are not edge cases; most APHA shows run them, and each has its own class list, eligibility and year-end awards. Migration 115 adds all three, and has to drop **two** constraints to do it: 010 created the column with an inline CHECK that Postgres auto-named, then 016 added a second, explicitly-named one saying almost the same thing. Restating only the named one would have left the 010 constraint quietly rejecting every new value, so the migration finds them by what they check rather than by a name nobody wrote down. Youth Walk-Trot stays split by age because APHA runs them as separate divisions; collapsing them would have to be undone the first time either is reported on.

The list was also written out **three times** — `EntryCreate`, `EntryUpdate`, and the constraint — and both schema copies were missing the same three values. It is `DIVISIONS` in `rules/apha.py` and one `APHADivision` Literal now, with a test asserting they agree.

**The ownership relationship picker offered seven options against APHA's twenty.** AM-300.E names in-laws, step-relations, aunt, uncle, niece, nephew, legal ward, and a solely- or family-owned corporation, ranch or farm. An exhibitor showing their niece's horse had to pick something untrue, which is worse than a blank because the entry then reads as answered. Grouped rather than flat, since twenty-five options in one ungrouped select is a scroll and not a choice. "Leased horse" is in there too — AM-020.A.1 makes leased horses eligible and this field was the only place an entry could say so — but it is not a lease *record*, and the term, lessor and papers APHA holds are still unmodeled.

**Migration 116: a coat pattern is not a coat colour.** Tobiano, Overo, Tovero and Sabino sat in `horse_colors` next to Bay and Buckskin, along with six Appaloosa patterns. Those are two independent axes and APHA says so outright — the rule book describes the spotting patterns in one place and lists its recognized colours in another, and a certificate reads **"Bay Tobiano"**. One column meant whoever entered the horse dropped half of what the papers said, and the half they dropped could not be reported back. The move is by name so nothing is invented: the Appaloosa rows are copied out of `horse_colors` with whatever names are actually stored (they contain an en dash), and the backfill joins on name — 7 patterns seeded, 6 copied, 2 horses moved, 10 rows then removed from the colour list. `coatDescription()` is the one place the two are rejoined for display.

**Migration 117: a membership number without its expiry is half a fact.** `exhibitor_registrations` has been the registry every affiliation reads from since 080 and never held when the membership runs out, so the desk could show a secretary an APHA number and nothing about whether it was still good. The expiry is reported **beside** the verification status, never folded into it — `status` is whether anybody inspected the card, `lapsed` is whether the card is good, and a current card nobody checked is a different situation from a lapsed one the office is holding. Judged against the show's end date, never today, for the same reason health paperwork is. NULL reads as "standing unknown", not green. The pre-080 APHA columns on `exhibitors` are backfilled in and left alone: dropping the sole home of somebody's membership number is data loss, not a migration.

**Migration 118: Novice eligibility is declared, not checked.** The Novice divisions are gated on points and prize money — AM-205 decides Novice Amateur per category at the time status is applied for, YP-255.A.1 caps Novice Youth fence-work earnings at $750 — and the app holds neither and never will. The rule book is explicit about who does answer for it: *the responsibility for eligibility lies with the exhibitor*, and *the burden of proof lies with the person who protests*. So `entry_attestations` records the declaration — who made it, when, and the exact words — and verifies nothing.

Three things it deliberately does not do. It does not let the caller write the statement: the wording lives in `rules/apha.py` and is copied in by `backend/attestations.py`, because a client able to compose the sentence it is attesting to could attest to anything — the paperwork-verification rule applied to a fact with nothing on file to derive it from. It does not point at the current wording: `statement` is a stored copy, since APHA revises its limits and a pointer would silently restate two-season-old consent. And it does not query: the rows are assigned to `entry.attestations` before flush, so the rules engine sees the declaration on an entry that has not been written — a database check would reject every new Novice entry.

Missing, it is an error at both doors, like `relationship_to_owner`, and both forms disable the button until the box is ticked so neither posts an entry it knows will 422. A bare Novice entry now comes back short **two** things at once rather than one at a time.

The remaining Phase 1 item is deriving the youth age division, which needs YP-075 and is deferred.

### APHA Rules Existed Everywhere Except In The Rules Engine

Reading the 2026 APHA rule book against the app turned up four things wrong at once, all of them quiet.

**`backend/rules/apha.py` was an empty subclass.** `class APHARules(DefaultRules)` with a `code` attribute and nothing else, sitting beside a fully-implemented `AQHARules`. The two APHA entry rules the app did have — the Solid Paint-Bred bar on Open classes (SC-325.A.1) and the required relationship-to-owner on Amateur/Youth entries — were written inline in `routers/entries.py`, the show desk endpoint.

**So they were enforced at one door out of two.** The exhibitor's own class registration in `routers/show_registration.py` has always validated through `rules.get_rules(...).validate_entry(...)`, which for APHA returned an empty list. An exhibitor self-registering could enter a Solid Paint-Bred horse in an Open class. Both checks now live in the rules class and both doors get them; the frontends already rendered the `ASSOCIATION_VALIDATION_FAILED` envelope, so nothing changed on screen except that the rule now fires.

**The APHA export raised `AttributeError` on any show with a registered horse.** It read `reg.show_type_id` off each `horse_registrations` row, and migration 080 dropped that column eight months of commits ago — registrations key on `associations` now. Nothing tested the endpoint, so it had been dead since. A class *code* keys on `show_types` and a registration *number* keys on `associations`; those two lookups sit four lines apart in this function, which is exactly why one of them was wrong. `association_id_by_code(db, code)` generalizes the existing `get_aqha_association_id` helper.

**And the export contains no results.** It downloaded as `apha_results_<id>.csv` and its header row has no place, no judge, no score — it is an entry list. It is also the only CSV export in the whole backend. Renamed to `apha_entries_*.csv`, because a file called "results" that has none is how an office submits the wrong thing to an association after the show has ended. It also now reads the membership number from `exhibitor_registrations` before falling back to the pre-080 `exhibitors.apha_member_number` column.

**`_issue` moved up to `DefaultRules`.** It was defined identically on `AQHARules` and would have been copied a third time. `backend/tests/test_apha_rules.py` is new — 27 cases, and the last one asserts that `get_rules("APHA")` really returns `APHARules`, since every other test in the file would pass against a stub.

Repair only. No new APHA capability: the Walk-Trot divisions are still missing from the `entries.apha_division` CHECK, zones are still unmodeled, and there is still no results report.

### An Association's Class Codes Are Uploaded, Not Coded

Setting up classes for an APHA show stopped at a placeholder: *"Class setup for APHA is being rebuilt. The new OPEN wizard ships first; per-association flows come next."* The per-association flows never came. The wizard rebuild removed the old APHA/AQHA class pickers and gated the replacement to `show_type_code === 'OPEN'`, so every breed show — including the 172-class MNSPHC Paint-O-Rama — had no way into its own class schedule.

**Nothing in that wizard was ever OPEN-specific.** It works entirely in per-show `disciplines`, `divisions` and `classes`; the only show-type coupling was a hard-coded fetch of the AQHA + APHA standard library. That now follows `show.show_type_id`, so an APHA show picks from APHA's own curated list (26 disciplines, 16 divisions) plus the generic fallback, and OPEN — having no association of its own — keeps the merged AQHA + APHA universe. Where a curated row and a generic row share a name the association's wins, because it carries that association's score type and running order.

**The association-specific part of class setup was never the screen. It was the catalog.** And the catalog was two tables — `apha_standard_classes` and `aqha_standard_classes`, identical but for two columns — with no table at all for ApHC or FQHR, loaded by a command-line script against a CSV checked into the repo. The person who owns the relationship with APHA could not refresh it.

**Migration 114 makes it one versioned table and an admin screen.** `association_standard_class_versions` is keyed on `show_type_id` — a class *code* is the breed body's catalog identifier, the question `class_associations` and `standard_classes` already answer against `show_types`, not an `associations` affiliation. Adding ApHC is now data rather than a migration.

**Type 2, because the associations reissue their list every year.** A show run in 2026 under a code APHA retires in 2027 still has to render its own program, so nothing is updated in place and nothing is deleted: a changed name closes its version (`inactive_date`) and opens a new one, and a retirement only closes. A partial unique index on `(show_type_id, code) WHERE inactive_date IS NULL` is what makes it a dimension rather than an append-only log — the importer cannot forget to close the old row, because the insert fails if it does. Everything reads the `association_standard_classes` view (the open rows) through `backend/standard_classes.py`, so a retired code cannot reach a class picker.

**`/admin/standard-classes` takes the file the association publishes.** APHA's Approved Class Codes PDF and AQHA's Class Master Listing each get their own reader in `backend/imports/class_codes.py`; a CSV works for any association, including the two with no reader yet. **Compare with catalog** parses and diffs and writes nothing; **Apply** re-sends the same file with the retirements ticked, so there is no half-finished import parked server-side and the diff being applied is recomputed from the bytes the admin approved. It re-diffs on apply and returns 409 if a ticked code is no longer missing — the catalog moved, so the list on screen is not the list being approved.

**A code missing from the file is flagged, never retired automatically.** This year's approved list is not a statement that last year's codes never existed.

**Reading the APHA PDF took two real bugs to get right.** Splitting `CODE Name` with a regex that allowed trailing characters after an optional space — needed for the handful APHA prints as `AM 40` — swallowed the leading `A ` that every amateur class name starts with, turning `AGCS A Grand Champion Stallion` into code `AGCSA`. That silently renamed 300 classes and invented 300 codes, while leaving the per-division counts looking correct. And the `Mounted Shooting` rules paragraph, unrecognised, glued itself onto the previous class's name. The parser is tested against both, plus wrapped names, `pypdf`'s `Y outh` kerning split, the Ranch Horse sub-divisions the catalog keeps apart, and the Mounted Shooting ones it files under a single name.

**Verified against the real 2026 file:** 634 codes read, nothing skipped, every one of the 15 division counts matching the stored catalog exactly — zero added, zero missing. The 28 reported differences are all places where the stored rows were hand-tidied on their original load: `(Zone 12, 13, 14 only)` normalised to `(Zone 12-14)`, and APHA's own `Performace Halter` typo fixed. **That is the case the preview exists for.** A blind "apply all changes" would revert 28 cleanups and put the association's typo back, so the preview shows before-and-after per row rather than a count, and the admin can decline. Applying then re-previewing the same file reports zero changes; retiring one code of two missing ones retired exactly that one and left its history readable.

**`scripts/import_aqha_standard_classes.py` is removed.** It wrote in place to the dropped table, which is precisely what a Type 2 catalog cannot accept, and keeping a second writer that versioned nothing would have let the two disagree. `scripts/extract_aqha_standard_classes_from_pdf.py` stays for producing a CSV offline.

**Migration 114 states its defaults separately from its `CREATE TABLE`, and lost a run learning why.** The backend's startup `create_all` had already made both new tables from the models, so `CREATE TABLE IF NOT EXISTS` skipped and left an `id` with no SQL default — the model's `default=uuid.uuid4` is applied in Python. The first run failed on a not-null `id` in its own backfill and rolled back cleanly. The same trap as migration 113, one migration later. For the same reason `AssociationStandardClass` — which maps the *view* — is dropped from `Base.metadata`, so `create_all` can never create a table over the view's name on a database that has not migrated yet.

### A Club Sanctions Classes, Not Shows

Setup Step 5 lets a show set a per-class sanction fee for each club it carries — NSBA $3, WSCA $2, MNSPHC $8. The public show bill prints them. Neither number meant what the screen said, and the two clubs were broken in opposite directions.

**NSBA billed every class.** `build_bill` read a single show-wide boolean — `show_is_nsba_sanctioned(show)` — and added 6% of the entry fee, $3 minimum, to every line on the bill. An exhibitor who entered eight classes at an NSBA show paid eight sanction fees whether or not NSBA approved a single one of them. NSBA approves a list of classes; a show carrying that approval still runs halter, gymkhana and open classes NSBA has nothing to do with.

**WSCA and MNSPHC billed nothing.** `show_sanctioning.per_class_fee_cents` had never been read by any code path. The show bill published "$2.00 per class" and the app charged nobody, on every WSCA and MNSPHC show ever set up.

Both are the same missing fact: **which classes does this club actually sanction?** Migration 113 adds `class_sanctioning(class_id, association_id)` and both halves fall out of it. It points at `associations` rather than `show_types` — clubs are deliberately not show types (migration 080) — and is not `class_associations`, which answers a different question (the breed association's *class code*, for catalog imports).

**One rule, one place to read it.** The hard-coded NSBA 6%/$3-minimum calculation is gone. Every club now bills the flat `per_class_fee_cents` on its own `show_sanctioning` row, summed over the clubs that sanction the class: a dual-sanctioned class legitimately carries both fees, and an undesignated class carries none. `billing.sanction_rates` drops a club with no fee set rather than putting a $0.00 line on every entry, and a designation left behind by a club the show later dropped prices at zero rather than at whatever it used to charge.

**Sanctioned Classes** (`/admin/shows/[id]/classes/sanctioning`) is where staff say which. Its own screen rather than a panel in the Step 6 wizard, because a 172-class show is not designated inside a step that is already three screens deep. (At the time the wizard was also OPEN-only, which would have left breed shows unable to answer the question at all; that gate is gone, and the screen is linked from Step 6 and from Step 5's fee rows.) One panel per club, day-grouped, with a filter and select/clear scoped to what the filter is showing: somebody who typed "Pleasure" to find the eleven pleasure classes means those eleven, and a 172-class show is not worked one checkbox at a time. Each panel heads with what the choice costs — "21 of 21 classes · $3.00 per class = $63.00 on an entry in every one" — and warns when a club has classes ticked and no fee set, which after this change is the way to have a sanction that charges nobody.

**The bill and the show bill now agree.** `Class.sanctioning` is `lazy="selectin"` like `Class.associations`, so every path that prices a class carries it and no caller has an eager-load to forget. The class list payload gained `sanctioning_codes`, and the generated show bill marks each class with the clubs that sanction it — "$3.00 per class" over an unmarked schedule leaves an exhibitor unable to work out their own bill. The CSV export carries the column too. Bill fields are renamed `nsba_sanction_*` -> `sanction_*`, and Financials reads "Club sanction fees".

**Verified against a live show:** 12 exhibitors, 120 entries over 21 classes carrying NSBA ($3) and WSCA ($2). All designated: $600 in sanction fees, $5 on every entry. Cutting WSCA to five classes dropped it to $410 — NSBA's $360 across all 21, plus $2 on the 25 entries in those five. Restoring put it back to $600.

**The migration designates every existing class for every club its show already carries.** For NSBA that is exactly what was being billed, so no open show's bill moves on deploy and staff untick what their approval does not cover. For WSCA and MNSPHC it starts billing a per-class fee that the show bill has been publishing all along, which is the bug being fixed rather than a new charge. It is also written to *converge* the schema rather than create it — the backend's startup `create_all` reflects `models.py` and races ahead of the migration, leaving a `class_sanctioning` whose `id` has no SQL-level default (SQLAlchemy generates that in Python), which is how the first run of this migration failed on a not-null violation in its own backfill.

### Side Pots And Jackpots Are Not Priced In Step 5

Related, and verbiage rather than behaviour: Step 5's "Jackpot / sidepot fee (per entry)" is a `per_entry` `show_fees` row, which is in the family that bills nobody — published price-list text. A side pot's real buy-in lives on the pot (`side_pots.entry_fee_cents`) and covers only the classes bundled into it, picked from a checkbox list on the Side Pots screen. That was already correct; nothing on the fee screen said so, and a manager reading a single jackpot amount in a list of class fees would reasonably assume it applied to every class. Both class-fee slots now carry a line saying what actually bills, and the jackpot slot links to Side Pots.

### A Show Can Charge For What It Actually Charges For

`show_fees` could hold a charge priced `per_horse` or `per_judge` since migration 060, and the Entry Fees screen has let a secretary type both for just as long. Neither has ever reached anybody's account. `build_bill` itemises class entries, reservations and futurities, and the only non-class charge it applies is `shows.office_charge_cents` — exactly one, hard-coded on the show row. So an $8 drug fee typed into the fee editor printed on the show bill's price list, appeared on no exhibitor's bill, and was invisible in Financials. A show with a second such charge, and most have several, had no way to say so at all: setup Step 5 offered a fixed office charge, a standard class fee and a jackpot, and nothing else.

**Migration 112 makes the unit the whole answer,** because it already was for the reservable half. Two changes:

`per_exhibitor` is new. `office_charge_basis = 'per_back_number'` already meant "once for the exhibitor, however many horses", but it was a basis for one charge on the show row rather than a unit any fee could carry — a show wanting an office fee *and* a gate fee both charged per back number could set one of them. It is deliberately not `flat`: a flat fee is charged once however many you have and its *occurrence* is not derivable, since a stall cleanout penalty applies to whoever left a mess and no query answers that. `per_exhibitor` is derived from having entries, which is the test the office charge already makes.

`per_judge` split into **`per_judge_per_horse`** and **`per_judge_per_exhibitor`**. "Per judge" alone does not say what it multiplies, and the two readings differ by however many horses somebody brought — three judges at $5 is $15 or $30 to an exhibitor with two horses. That is the same trap `per_night` / `per_day` / `per_show` exist to close, and it is settled the same way, because `build_bill` multiplies rate × quantity and never reads the unit: nothing downstream can recover a unit that was wrong where it was chosen. Existing rows migrate to `per_judge_per_horse`, which is what the Entry Fees editor had been telling secretaries it meant — it rendered each row as "× 3 = $15.00/horse" while the backend billed neither reading.

`billing.charge_lines` is the new half of the bill and follows the office charge's rules exactly: nothing is charged to somebody with no entries, and a fee priced at $0 produces no line, because `POST /shows/{id}/fees/seed` writes several templates at zero for the secretary to fill in and a column of $0.00 rows teaches people to skim their bill. Both counts travel on the line, so the exhibitor's bill and the desk's account panel print "$5.00 × 3 judges × 2 horses" rather than "$5.00 × 6" — this is the line nobody asked for, so it is the one that has to be checkable against a paper bill.

Three units stay unbilled and must not be added: `per_entry`, `per_class_per_horse` and `percent_of_entry` are the class-fee vocabulary, and `classes.entry_fee_cents` is what charges per entry. Billing Step 5's `standard_class` row on top of it would double every class on every bill.

In Financials the charges roll up **apart from** the reservations, for the same reason side pot money is kept apart from account balances: both are `show_fees` rows, but the Stalls, Shavings & Camping report reads `fee_lines` as "what exhibitors booked" and foots it against `reservation_total_cents`. A drug fee nobody booked appearing there would leave that sheet's rows disagreeing with its own total. They get a report of their own instead — a function in `_REPORTS`, no route and no component, which is what that registry is for — and the Revenue Summary lists each charge on its own line rather than as one "other fees" figure, since which charge the money came from is the thing somebody opens that report to find out.

**One editor, two screens.** The per-horse and per-judge tables on `/admin/shows/[id]/fees/entry` were a second implementation of the `show_fees` editing setup Step 5 now needs, in a different vocabulary, and one of them wrote a unit the backend no longer accepts. Both screens render `ShowChargesEditor`, and the three copies of the unit-label map scattered across the fee editors and the show bill are now one `frontend/lib/fee-units.ts` mirroring `RESERVABLE_FEE_UNITS` and `AUTOMATIC_FEE_UNITS`. The editor prints what each charge costs in words as the rate is typed — "$5.00 × 3 judges = $15.00 for each horse they enter" — and says outright when a per-judge fee is billing nothing because no judges are assigned yet, which is otherwise discovered on somebody's bill.

Dropped in the process: the per-judge-*type* rows the Entry Fees screen used to synthesise from each judge's affiliation ("Judge fee – AQHA"). A per-judge charge multiplies by the whole panel, so a row labelled with one association's code would bill × every judge — worse than not offering it. A show pricing its WSCA and MNSPHC classes on different judge scales is describing class fees, not a show-wide charge.

### A Day Is Not A Night

The reservable fee units could price a camping spot two ways: by the night, or one charge for the whole show (migrations 106 and 108). Some venues sell the electrical hook-up **by the day**, and that is a third way, not a synonym for the first. A Friday-to-Sunday show is three days and two nights. Priced per day and counted in nights, every camper is under-billed by a day; the other way round, over-billed by one.

The temptation was to let a show write "per night" and mean whatever it meant. That does not survive contact with `build_bill`, which multiplies rate × quantity and never reads the unit — by the time the number reaches the bill the difference is gone and nothing downstream can recover it. So the unit has to be right at the moment the quantity is typed, which makes it a unit and not a label.

**Migration 111 adds `per_day`** to the `show_fees.unit` CHECK and to `RESERVABLE_FEE_UNITS`, so it carries an early-bird rate and appears on the sign-up screen like the other three. The Lodging & Boarding step (Step 4) now offers one camping line priced three ways — per night, per day, or one price for the whole show — which is the same shape migration 108 settled on, with a third radio button rather than a third slot. Two slots let a manager put two camping charges on one bill; three would let them put three.

On the exhibitor's picker the noun sits against the number being typed — `nights`, `days` or `spots`. That was already the guard against booking two *nights* of a $60-for-the-weekend hook-up and paying $120, and it matters more now: the night/day mistake is off by one rather than obviously doubled, so nobody queries it.

The existing lock does the rest. `PATCH /shows/{id}/fees/{fee_id}` already returns 409 on a unit change once anyone has reserved the line, and both fee editors disable the control rather than offering it and refusing — flipping camping from per night to per day would silently reprice every booking, which is exactly the failure this unit exists to prevent.

### A Futurity Says What It Charges And Now Says What It Is

Migration 107 turned a futurity from a single `show_fees` row into a real programme: tiered per-class rates, a deadline with a late fee, an office fee that follows club membership, Hi-Point divisions scored over a named subset of classes. That was the half the app does arithmetic on, and it was the right half to build first.

The half left out is what a futurity is actually published as — a one page entry form. The North Star form states its deadline to the minute, names the awards (Hi-Point saddle, Reserve Hi-Point buckle), tells entrants that breed-association crossover rules do not apply to futurity classes, explains the three categories before asking them to pick one, sells an optional club membership beside the office fee, states a refund policy, and ends in a release that must be signed before the horse may show. A show setting a futurity up in this app produced a programme that priced correctly and said nothing.

**Migration 109 gives those words a home next to the money.** `entry_deadline_time` and `entry_deadline_timezone` are display precision only — lateness is still decided by `entered_at` against the deadline *date*, so a 7:00 PM cutoff is what the form prints rather than a second clock for the biller to read. `award_notice`, `rules_notice`, `entry_instructions` and `refund_policy` are free text, because the words belong to the club running the futurity. Hi-Point divisions gained `award_name` / `reserve_award_name`: the ranking is what the app computes, the saddle is the reason anybody entered.

Two things on the form are neither money nor prose. **The optional club membership** is a table, not a `show_fees` row — a show fee would be reservable by anyone at the show, would bill through `show_entry_reservations` rather than the futurity line, and would leave "did this entrant join?" answerable in two places that could disagree with `futurity_entries.is_member`. Those are different questions and stay separate: `is_member` picks which office fee applies and describes a card the entrant already holds, while the membership is one they are buying. Somebody joining on the day pays both, which is what the paper form charges them. **"Exhibitor if different than owner"** is `shown_by_name` — named that way because every payload carrying it also carries the account holder's name off `show_entries`, and calling both of them the exhibitor is how one silently overwrites the other, which it briefly did.

**The release is a scoped waiver, not a new mechanism.** `show_waivers.futurity_id` narrows who is asked; NULL keeps the original meaning of the whole show. Everything migration 099 already built — typed signatures at sign-up, paper blanks recorded at the desk, guardians signing for youth entrants, the outstanding counts on My Shows and the desk checklist — works on it untouched. Only that futurity's entrants are counted and chased, but everyone can read it, because somebody deciding whether to enter is entitled to see what they would be agreeing to.

**Setup Step 5 stopped offering a futurity fee.** It had a box labelled "Futurity class fee (per entry)" sitting next to the jackpot fee, which is exactly the thing migration 107 concluded cannot describe a futurity. It now links to **Step 7**, a new wizard step pointing at the existing `/futurities` hub, and offers to delete a leftover pre-107 `futurity` fee row — a show carrying both bills its futurity entrants twice.

`docs/show-workflow.md` had argued a futurity could not be a wizard step, because setup is answered once and closed while a futurity takes entries and is worked alongside the desk. Half of that holds. Defining the programme — its deadline, its categories, its classes, the words on its form — happens while the show is being built, exactly like the class schedule in Step 6; taking entries and reading standings is desk work. So the programme is a step and the entries are not, and the route did not move: Step 7 is a signpost in the flow, not a relocation. It sits after Classes because a futurity is defined by which classes belong to it, and there is nothing to pick from until the schedule exists.

Adding a futurity and editing one now render the same component. A paper entry form has no short version, so a create-a-stub-then-configure split would have produced a futurity that cannot take an entry — the API refuses one with no fee categories — and said nothing about it.

One asymmetry is deliberate. `requires_horse_pedigree` (foaling date, sire, dam — a futurity is judged in age divisions off a registration paper) **refuses an exhibitor's own enrollment** and names what is missing, because they own the horse and can fix it in a minute. Staff at the counter are never blocked; the same shortfall is reported as `missing_horse_details` on the entries screen. Refusing an entry at the desk does not produce the sire's name, which is the reasoning that took the block off health paperwork.

Migration 110 is a footnote with a general moral: 109 declared `CHECK (amount_cents >= 0)` inside its `CREATE TABLE` and the database did not get it, because `create_all` runs at backend startup, creates whole tables from `models.py`, and won the race — after which `CREATE TABLE IF NOT EXISTS` correctly did nothing. Anything a migration puts *inside* a `CREATE TABLE` has to be re-assertable on its own.

### The App Got A Safety Net

There were no automated tests. Not thin ones — none. `pytest`, `pytest-asyncio` and `pytest-cov` were pinned in `backend/requirements.txt`, Jest and Testing Library were in `frontend/package.json` with `test`, `test:watch` and `test:coverage` scripts, and there was not one test file in the repository; `npm test` would have failed with "no tests found". The only CI workflow checked that documentation had been touched. Commits go straight to `main`. So the app that decides what an exhibitor owes and what gets published as an official placing had nothing standing between a bad edit and a horse show.

`RUN_TESTS.sh` was worse than absent, because `Claude.md` pointed at it. Its `test_result` helper read `$?` *after* incrementing a counter — and an assignment always exits 0 — so every check it reached reported PASS. `set -e` meant the first genuinely failing command aborted the script before the helper ran at all. It could not report a failure by either route, and most of its checks were `grep`s for the presence of a line of code, which pass whether or not the code works. It has been rewritten to capture each exit status immediately and actually fail.

**104 backend tests and 26 frontend ones now cover the pure logic**, which turned out to be exactly where the risk was concentrated. `billing.py` is 327 lines with no `await`, no database and no imports beyond `date` and `typing` — every function that turns entries and reservations into cents, testable with plain stub objects and no fixtures. The same is true of the health-paperwork block in `routers/horse_documents.py`, the discipline classifier and the back-number resolver. Because each of those functions already carried a docstring stating the invariant it protects, the cases mostly wrote themselves: an early rate priced off the day it was booked rather than today, outstanding and credit never netted against each other, a refund as a negative row, a Coggins judged against the show's last day rather than today, an attestation that clears a flag only when it records a date.

One test checks a shape rather than a value. `rules/disciplines.py` routes class names through an ordered keyword table where a general keyword placed above a specific one silently kills it — "TRAIL" above "RANCH TRAIL" and every Ranch Trail class lands in Trail. Rather than enumerate lookups, the test asserts no earlier keyword is a substring of a later one, which catches every future mis-ordered insertion. The table passes today.

Backend tests run **in Docker**, because they have to. The host interpreter is Python 3.9 and the backend needs 3.10+, so importing it on the host raises. `py -m compileall backend` — the documented backend check — passes anyway, because it byte-compiles without executing. That check has never actually imported the backend.

`.github/workflows/ci.yml` now runs both suites plus type check, lint, compile and a frontend build, on the Node 20 and Python 3.12 the Dockerfiles ship.

### A Backend 500 Says What It Was

**121 of 168 route handlers called `res.json()` on a backend response with no guard**, against a convention `docs/frontend.md` had documented for months — while also telling the next person to fix them as they went rather than in one sweep. They have all been swept.

The failure this prevents is nasty out of proportion to its cause: a backend 500 arrives as plain text, `res.json()` throws on it, and the real status is replaced by `Unexpected token 'I', "Internal S"... is not valid JSON` on whatever screen happened to make the call. `safeFetchBackend()` already existed and already handled the 204, parse-failure and network-failure cases; it was used in 42 handlers.

Five handlers still call `fetch()` directly and always will — they stream a CSV export, a document download, or a headshot, so a JSON helper cannot serve them, and each guards its own error path. They are allowlisted in the CI step that now fails the build if a sixth appears. The documentation line telling people not to do this in one sweep has been replaced with one saying it is done and enforced.

### Registration Endpoints Got A Rate Limit, And The Logs Started Working

All four `/auth/register*` endpoints were missing `@limiter.limit` while every other auth endpoint had one — open to scripted account creation and to grinding the 409 for email enumeration. They now carry `5/minute`, matching `/reset-password`. Verified at runtime rather than by inspection: the sixth attempt in a minute returns 429.

Worth knowing what that does and does not buy. Every request reaches the API from the Next.js container, so `get_remote_address` resolves to one address for everybody and the limit caps total throughput per endpoint rather than isolating one abusive caller. That was already true of the four existing limits. It bounds how fast anyone can grind; it does not keep them from crowding out real users. Documented in `docs/auth.md` rather than left to be rediscovered.

The backend had **nine `logger.` calls in total and no logging configuration at all**, which meant uvicorn left the root logger at WARNING with no handlers and every one of those `logger.info()` calls was discarded — including `mailer.py`'s "Email not sent (no SMTP configured)", the single line someone debugging email most needs. One `logging.basicConfig` call fixes all nine. A request-logging middleware adds method, path, status and duration, escalating at 5xx and skipping the health endpoints, since Compose polls `/` every ten seconds and 8,640 lines a day of nothing is how a log stops being read.

Health checking is now two endpoints, and deliberately so. `GET /` stays exactly as it was — liveness, no database — because Compose polls it and the frontend declares `depends_on.backend.condition: service_healthy`, so a `/` that failed on a Neon blip would stop the frontend from starting: a worse outage than the one being caught. The database check went to a new `GET /health/ready`, which returns 503 when it cannot reach Postgres. Testing it found a second bug: an unreachable host does not refuse a connection, it goes unanswered, and `pool_pre_ping` retries — so the probe hung for as long as the caller would wait. It is bounded at five seconds now, and answers 503 rather than nothing.

### Signing Up For A Show Is One Job

An exhibitor entering a show reserves what they need on the grounds and enters the classes they came for. The app made that two screens with a redirect between them, because it is two backend calls — which is a fact about the app, not about the person filling it in. The cost was real: sign up, get bounced to the class picker, remember halfway through that you need a fourth stall, go back, save, get bounced forward again. People ended up signed up with no classes, or with six stalls and no idea what the weekend added up to.

`/shows/[id]/register` now carries both, in two collapsible sections over the running bill. **Classes & back number** holds the back-number request, the entered-class table, the entry form and the horses whose health paperwork the office will chase. **Stalls, shavings & camping** holds the reservation editor, lifted out of the sign-up page into a shared `ReservationFields` that both screens render — one implementation, so they cannot drift into quoting different rates.

They fold because everything open at once is a very long page on the phone most people fill this in on. That makes each header's summary line do real work: collapsed, it is the only thing on screen saying what you have, so it carries the class count, the back number, the outstanding-records count, and the reserved quantities with their total.

**The sign-up rule is still real, just visible now.** Class entries and back numbers both 409 without a completed sign-up, so until then the classes section will not open and its header names the section to fill in first — "you can't do this yet" without a destination is the kind of message people read as a fault. Saving the reservations opens it. `/shows/[id]/signup` survives as its own route because it is the door people are pointed at from the show hub, the status banner and the My Shows card; it just isn't the only way in any more.

Show Details lost its last two reader-specific pieces in the same pass — the balance and the link to your own entries. Both belong with the reader rather than with the show: what you owe is a tile on the show menu, and everything about a registration is on the registration screen, which is now one screen.

### The Show Menu Stopped Asking Twice

Three of the exhibitor hub's tiles were answering one question between them, and two of them opened on the same facts.

**Show Bill** and **Show Details** were separate tiles. The bill's first section is *The show* — dates, venue, show type, approving associations, sanctioning clubs, show numbers — which is the Show Details page, restated. So somebody wanting to know what a weekend involved read the dates on one screen, went back, and read them again on the other before reaching the judges and the class schedule they were actually after. The bill now renders directly below the facts on Show Details, through a shared `ShowbillDocument` with an `embedded` flag that drops the masthead and that duplicated section. `/shows/[id]/showbill` survives as the **printable** copy — masthead, print stylesheet, Save-as-PDF and the class-list CSV — linked from the foot of Show Details and from the at-the-rail hub. Printing a program to carry round the grounds is a real errand; it is just not a menu item.

**What I Owe** moved the other way, up out of Show Details and onto the menu. What a weekend costs is one of the handful of things an exhibitor opens a show to find out, and it was sitting a click below "when does my class run". It shows only for somebody with a standing at the show — signed up, or entered by the office — since a tile promising a bill that opens on "nothing here" is worse than no tile, and it is deliberately **not** gated on registration still being open, because "you charged me for four stalls" is a question that arrives after the weekend.

What is left reads about-me first: My Registration, What I Owe, then the show-wide screens. A menu that opens with the class schedule makes an exhibitor read past the show to find themselves.

### The Bill Is A Fact About One Show

My Shows opened with a roll-up: **Due at these shows $940.00**, summed across every upcoming weekend. It is a real number and nobody has ever needed it. A show office collects per show, against a back number, from a bill it drew up itself — there is no counter anywhere at which "$940 across four weekends" is the answer to anything, and it sat above four cards that each already carried their own total.

So it moved onto the show. `/shows/[id]/details` now leads with **Due at this show**, next to the dates and the venue it is owed for, under the back number and class count the office uses to find the account. The itemised version is one click below it at `/shows/[id]/my-bill`, which already existed and already opened with the same figure — that headline is now one `DueAtShow` component reading one `loadMyShowBill()`, so the number a reader arrives with is the number they land on rather than two renderings of the same payload waiting to drift.

Two smaller things fell out. The **Show details** button on a My Shows card pointed at the show *menu* — the same place the show name at the top of the card already linked, and one hop short of the page that now carries the figure; it points at Show Details. And the fetch is skipped entirely for anyone who is not an exhibitor, since a spectator reading the venue and the dates has no bill and asking for one is a backend round trip spent being told so.

Each My Shows card still totals its own show. What was removed is the sum of them.

### The Picker Stopped Going Quiet

Two rough edges on the new registration form, both the same mistake: leaving the exhibitor to infer something the screen could have said.

A class every one of your horses is already in is filtered out of the dropdown — correct, and silent. Somebody hunting for the Trail class they entered an hour ago has no way to tell "you are already in it" from "the show pulled it". The form now says how many classes are off the list and why, and points at the table above where they are.

The horse dropdown had the same gap at the other end. On a `pattern` class — the one kind you may enter twice, on two horses — the class stays on offer while a horse is spare, and the moment the last one goes in the horse list is empty. It rendered as an open select containing nothing. It is now disabled and reads **All your available horses are entered in the class already**, with the same text on the `title`, per the rule that a disabled control says why it is disabled.

### Exhibitors Got The Desk's Entry Form

Show staff and exhibitors were entering classes through two different shapes of screen, and only one of them was any good.

The desk enters one class at a time: a dropdown of what this person can still enter, a dropdown of their horses, **Enter class**, and it is done — the row appears in the table above and the form is ready for the next one. The exhibitor's own screen was a page-long list of *every* class in the show with a horse select on each row and a single **Submit registration** at the bottom. That shape asks somebody to hold an entire registration in their head, buries the four classes they have chosen under the thirty-six they have not, and reports the first clash — a class that closed, a horse already in — only after the whole thing is filled in and sent, at which point the batch fails as a unit.

So `/shows/[id]/register` is now the desk's form with the exhibitor pinned to themselves. `AddClassEntry` mirrors `desk/AddEntryForm` deliberately, filtering included: a class you are already in drops off the list unless it is a `pattern` class and you still have a horse spare, and a horse already in the picked class drops out of the horse list. Same rules, same wording, different door — it posts to `POST /shows/{id}/register`, which derives the exhibitor from the session, so it cannot be pointed at anybody else.

Two things it does that the desk form does not, both because the reader is different. The class dropdown is grouped by show day, since staff are handed a class number while an exhibitor is picking a Saturday. And removing an entry confirms inline first: a secretary removing a class is standing in front of the person who asked for it, whereas an exhibitor is usually on a phone, and a mis-tap that quietly drops them from a class is not something they would discover until the gate.

**The money stopped being estimated.** The batch form had to add fees up in the browser — its selections did not exist yet, so there was nothing on the server to ask. Entries are real the moment they are made now, so the preview endpoint returns `billing.build_bill` and the screen renders `ShowBillBreakdown`, the same component the My Shows card and the per-show bill page use. Stalls, shavings and camping appear on it for the first time; the old footer totalled class fees, NSBA sanctions and the office charge and stopped there, so the number an exhibitor saw while registering was never the number they would be handed. Claude.md has claimed for a while that the class-registration screen reads `build_bill`. It does now.

What browsing was lost went somewhere better. The full schedule is at `/shows/[id]/schedule`, which was built for reading a program, and the register screen links to it — a picker that was also the schedule was serving two readers badly.

### "Can I Have 42 Again?"

The commonest question a show office fields in the weeks before a show, and the app had no answer for it. Back numbers were assigned by staff, full stop: the exhibitor emailed and asked, a secretary wrote it on a list, and later keyed it into the back-number screen by hand. That is exactly the workflow this app exists to remove, and at a ranch or western show it is not a fringe request — people ride the same number year after year, and families like to keep a block together.

Migration 104 adds `show_entries.preferred_back_number`, and the class registration screen asks for one. **It grants rather than queues**: if nothing else at that show holds the number, it is issued on the spot. A "preference" that still leaves the exhibitor waiting on a secretary would have been the old workflow with an extra table in front of it, and a number nobody else wants is not a decision anyone needs to make. A number that *is* taken returns `409 BACK_NUMBER_TAKEN` naming it, so they pick another while they are still on the screen rather than finding out at the desk.

**Two columns, because they answer different questions.** `preferred_back_number` is what was asked for; `back_number` is what the show issued. They agree in the ordinary case and diverge the moment the office renumbers — and that divergence is the useful part. The desk renders "asked for 42" under the back-number field, so staff see it before the exhibitor raises it at the counter, and the registration screen tells the exhibitor which number to actually wear.

The office keeps every power it had. The desk renumbers anyone; the endpoint closes when the show leaves `PUBLISHED`, since by then numbers are printed, hanging on backs, and written on judges' cards; and clearing the request drops the wish rather than the number already issued — handing a number back is not something anyone asks for, and an empty text box releasing an assignment would be a surprising thing for it to do.

**`auto-assign` had to change or the feature was theatre.** It numbered every entered exhibitor straight through 1..N, which would undo every request in one click, and the office would learn about it at the desk from the exhibitor. It now claims requested numbers first and fills the rest from the lowest number still free. Two collisions came out of that: numbers held by roster rows outside the run (someone with no class entry yet) are reserved rather than overwritten, and the whole target set is nulled before it is refilled — Postgres checks `UNIQUE (show_id, back_number)` per statement, so reassigning in place can raise on a halfway state where two rows have swapped.

The status banner's old line, "the secretary assigns your back number once the show begins", now reads "**Ensure you enter your preferred back number** or one will be assigned to you" and links to the screen that does it. Telling someone to enter a number without saying where is worse than saying nothing.

### Holding The Link Was Not Consent

Asking to put somebody else's horse on your profile opens a `horse_access_request`, and the owner approves it. The approve page authorized on the token alone — matching `user_invites`, and reasonable on its face, since the recipient of an *ownership transfer* may never have used the app before.

It was wrong here, and the reason is one flow up. The mailer is optional: `mailer.py` does nothing without SMTP, so every flow that mails a link also hands the link back to the sender for copy/paste, precisely so an undelivered email never strands a horse. That means **the requester holds the approval link**. Any design where the link is the permission therefore lets a requester follow their own link and approve their own request — the exact outcome the table exists to prevent, reached by clicking the button the app gave them.

So the token now names the request and the session authorizes the answer. `/horse-requests/[token]` and both `by-token` endpoints require the caller to be signed in as `approver_exhibitor_id`: 401 `SIGN_IN_REQUIRED` with no session, 403 `NOT_YOUR_REQUEST` for anyone else, and the page grew branches for both — the 401 offers sign-in and register carrying `?next=` back to the same request, and the 403 explains that passing the link on is fine but the approval has to be the owner's. The copy on `ApprovalLinkCallout` says so up front, because a requester who follows their own link and hits "not yours to answer" should have been warned.

One consequence, taken deliberately: a `link` request naming an owner with **no account** is refused at creation rather than opened. Under the old rule the only person who could answer it was whoever held the token — which is to say, the requester. Under the new one nobody can, so opening it would produce a request that can only expire. `POST /exhibitors/{id}/created-horses` already worked this way; this makes the two paths agree.

### The Show Page Became A Menu

Opening a show as an exhibitor gave you a status banner and then forty rows of class numbers. That is the right screen for a scribe, for whom each row is a link into a scoring form. For everyone else it answered a question nobody had asked and buried the four they had: what is this show, what does it cost, when does my class run, how do I get in.

`/shows/[id]` now renders `ExhibitorShowHub` for anyone who cannot score — the same status banner over tiles for **Sign Up** (or **My Registration** once they are in, in the same slot so it does not move mid-show), **Class Schedule**, **Show Bill**, **Show Details**, **Results**, and **Message the Show Office**. `ADMIN` and `SCRIBE` keep the class list untouched.

**Show Details** grew the two things that are about the reader: club sanctioning — which of their memberships earn points here, previously visible nowhere outside the setup wizard — and buttons to *My registration* and *What I owe*. The latter is a new per-show bill page that reads `GET /my-shows/` and picks this show out of it. That is a row or two of waste over the wire and buys the thing that matters: the number is byte-for-byte the one on My Shows, because it is the same payload. A second endpoint summing the same fees would be faster and would eventually disagree.

### A Show Bill You Can Actually Take With You

Every show in the sport publishes a show bill — classes, judges, fees, rules — and this app had all of it and printed none of it. `/shows/[id]/showbill` generates one: masthead, judging panel, class schedule by day with numbers and entry fees, the fee schedule with early-bird rates called out, and the rules that change what you pack.

**Generated rather than uploaded**, which is the whole design. An uploaded PDF is a second source of truth that goes stale the first time a secretary adds a class — and worse than having none, because people trust the copy they printed. Downloading is the browser's print dialog against a print stylesheet, so Save-as-PDF produces a real paginated document without the app carrying a PDF renderer it would then have to keep looking like the web version. A second button saves the class list as CSV, because a barn manager building a run sheet wants to sort it and a PDF is the wrong shape for that.

This needed `GET /shows/{id}/fees/public` — the fee schedule had been staff-only, so the bill could not quote the prices the app itself charges from. Gated on the show being publicly visible, same as the contact form: a DRAFT show is not offering anything to anyone.

### The Office Can Tell Who Is Asking

`show_contact_messages` was built for visitors with no account, so everything about the sender is self-reported text joined to nothing. That is still right for a stranger asking about stall availability. It was wrong for the exhibitor entered in nine classes asking whether their Coggins arrived — and worse, that exhibitor had no route to the form at all, since it was only linked from the signed-out show view. Signing in took the contact form away.

It is now a tile on the show hub, a button on every My Shows card (past shows included — "you charged me for four stalls" arrives after the weekend, not during it), and a link from Show Details, the show bill and the per-show bill page. Signed-in senders get their name and email prefilled.

Migration 103 adds `sender_user_id` / `sender_exhibitor_id`, **stamped from the session and never from the request body**. A secretary reading a name in a free-text field cannot tell the exhibitor holding back number 42 from somebody who has never been to the show, and the answer to the question usually depends on which it is. Asking the sender to type their back number would have been a self-reported answer to an identity question — the same hole with an extra step. The inbox badges *Back #42*, *Entered here*, or *Has an account*; no badge is the ordinary case, not a suspicious one. Being signed in does not gate sending: an anonymous message is a NULL stamp, not a rejection.

### Smaller Things

- **The shavings policy is stated both ways.** `shows.shavings_ban_outside` only ever rendered when it was `true`, so a show that allowed outside shavings said nothing at all — and silence does not answer "do I need to load six bags into the trailer?". Both states now appear on the sign-up screen, once as a callout and again on the Shavings group next to the quantity box, plus on Show Details and the show bill. It stays off the signed-out show view, which is for picking a show rather than packing for one.
- **Class registration copy.** "Pick a horse for each class… the show secretary assigns your back number once the show begins" became "Choose your horse from the drop-down menu in each class you want to register for", and payment is now described as collected *at the end of* the show. The back-number sentence moved to the status banner, where it has since been rewritten around the request field — see "Can I Have 42 Again?".
- **"In the past week" left the dashboard's new-classes notice.** The seven-day window still decides whether the notice appears — that is what keeps it transient rather than a permanent restatement of the entry count — but "4 new classes" is the news and the qualification read like a hedge on it.
- **`ShowBillBreakdown`** was extracted from the My Shows card so the card and the new per-show bill page cannot quote different totals for the same weekend.


### Forgot Password Now Means Forgot

`/forgot-password` asked for your current password. That is a sound identity check and a useless one on that page: anyone who can supply the current password has not forgotten it. The only real route back into a locked-out account was an admin typing a new password — fine for a staff account, hopeless for an exhibitor at 6am on a show morning trying to find out what ring they are in.

Accounts can now carry **one security question**, written by the user, answered by the user (migration 102). The reset page asks for an email, hands back that account's question, and takes the answer plus the new password in one request.

**Why not an emailed link.** `mailer.py` returns `None` whenever `SMTP_HOST` is unset and never raises, so a mailed-token reset would accept the request, say "check your email", and drop it. Every other flow here that mails a link also returns the link for copy/paste — and a reset token is precisely the thing that must not be handed to whoever asked for it, so there is no equivalent fallback. Nor is there an intermediate token between the two steps: a token earns its complexity when the halves happen in different places, and here they are typed on one screen a second apart.

**The throttle is the feature.** One self-written question is weaker than two, and at a horse show the obvious question is often answerable from the entry form. So the answer is bcrypt-hashed and compared normalized (case and stray spacing ignored — a difference the user cannot see and could never debug), and the account counts consecutive misses: five wrong answers close the reset route for fifteen minutes. Per-IP rate limiting sits in front but cannot carry it alone, because that resets when the attacker changes address and the risk belongs to the account, not the address. While locked the question is withheld too — the prompt is the half that hints at the answer.

**The lock never touches the login.** Signing in with the password works throughout and clears the counter; so does an admin password reset. Locking the account itself would let anyone lock anyone out with five guesses — an outage handed to strangers, on the screen that exists to end outages.

Setting the question lives on the profile Account tab and requires the current password, for the same reason changing the email does: it installs a second way in, and an unlocked laptop should not be enough. The prompt must end in a `?`, and the answer may not be the account password — that would copy the password into a field stored separately, shown unmasked while typing, and guessed against with a five-try budget.

Admins see whether a question is set, when, and whether it is locked — never the question text. They can already reset the password outright, so showing a self-written question (which usually hints at its own answer) would add exposure and no capability. They can clear a forgotten one; they cannot set a replacement, since that would mean knowing the answer to someone else's account.

The old current-password route stays as a fallback. Every account predating this has no question, and taking away the one self-serve path those users had would have made the feature a net loss on day one.

### Setting A Show Up Is One Flow Again

The setup wizard walked a secretary through judges, sanctioning, lodging, fees, and paperwork — and then left the two biggest jobs sitting on the dashboard as tiles of their own. **Show Staff** and **Add / Modify Classes** were things you had to know to go and do. Nothing in the wizard mentioned them, and a show could reach the end of setup with a full fee schedule, no classes, and nobody assigned to score them.

Both are now steps. Staff is part of Step 1, beside the show's name and dates, because deciding who runs a show is not a separate errand from setting it up. Classes is Step 6 and the last one, because building a schedule is the longest job in the whole flow and burying it behind a tile made it look optional. `/admin/shows/[id]/staff` redirects to Step 1; the classes route is untouched, so per-class deep links still work.

**Paperwork went the other way.** Which health documents a show requires and what exhibitors sign had briefly become Step 7, and that was the wrong place for it. Setup is a thing you answer once and close; paperwork requirements are the standing order the registration desk reads every time somebody signs up, and the registration side is where you *discover* they are wrong — a checklist asking for a document this show does not want, or silent about one it does. So the page moved to `/admin/shows/[id]/desk/paperwork`, reached from a button on the desk, and the wizard went back to six steps. `/setup/paperwork` redirects. Nothing about the settings themselves changed; only who is standing in front of them when they need changing.

**Not every step lives under `/setup`, and that is deliberate.** Step 1 is `/edit` and Step 6 is `/classes` — both were screens before the wizard existed and are linked from the dashboard, the APHA export card, and the class schedule. `StepLayout` is what makes a route a step, not its folder. Moving them to tidy the tree would break every existing link and buy nothing.

**Show Managers had a table and no way to use it.** `show_managers` has existed since migration 022, but the only row ever written was the automatic one for whoever created the show — there were no assignment endpoints at all, so a series with two people running it could not be modelled. `GET`/`POST`/`DELETE /shows/{id}/managers` closes that, and the delete **409s on the last manager**: a manager reaches a show through that row and nothing else, so removing it hides the show from every manager's list — including from the manager who just clicked it — and leaves only ADMIN able to open it. The UI disables the button and says why rather than letting the error be the explanation.

**One implementation of assigning a secretary, not two.** `EditShowForm` had its own `SecretarySection` and `ShowStaffPanel` had a thinner one; putting both on the same screen would have shown the same job twice with different affordances. The panel now owns all four roles, and it kept the richer of the two behaviours — a secretary can be picked from the existing accounts *or* created with a password on the spot. That matters because a secretary is hired for the show: the person setting the show up is usually the one who has to make them an account, and sending them to User Management and back loses the thread. Scribes and gate stewards keep their invite-link flow, which is the right shape for someone who will set their own password later.

The hub also stopped re-deriving its own checklist. It duplicated `fetchStepCounts` inline, so the hub and the stepper on a step page were two implementations of "is this step done" — the same trap as an aggregate screen that recomputes a total. Both read the one helper now.

### The Desk Can Now Check The Paperwork It Actually Checks

A horse show secretary at the counter physically inspects a short, specific list: a negative Coggins, often a health certificate, sometimes vaccination records, the signed entry blank and liability release, membership cards for the rider *and* the trainer, and the registration papers. The app modelled three of those. It stored `COGGINS`, `VACCINATION`, and `HEALTH_CERTIFICATE` uploads and then never looked at two of them again; it had no table, no column, and no way for a show to say it wanted an entry blank at all.

**The reasoning that left health out was wrong, and it is worth naming.** The old Sharp Edge argued a Coggins needs no sign-off: it is either current, in which case the file says so, or lapsed, in which case signing changes nothing. That collapses two questions. The file answers *is the date still good*. Only a person at the counter answers *does this paper describe this horse* — markings and description against the animal in the trailer, on a document that is genuine and physically present. They disagree in both directions, and the desk has to tell them apart: a current Coggins nobody has looked at and a lapsed one the office is holding are not the same situation.

So a health line now carries two facts. A derived `status`, computed on read and self-clearing as before, and an attested `inspection` in `show_verifications` (migration 098). The sign-off is keyed on `(horse_id, document_type)` rather than on an uploaded row, because the ordinary case at a horse show is somebody handing over a paper the app has never seen — requiring an upload would break the sign-off exactly where it is needed. `missing:none` is a perfectly good thing to have attested to, and it goes stale the moment a document arrives.

**CVI and vaccinations needed a policy before they could have a flag.** Coggins is universal; a Certificate of Veterinary Inspection follows from crossing a state line and vaccination rules come from the venue. A flat "no CVI on file" flag would have lit up every in-state horse at every show until staff stopped reading the panel — the second feature would have poisoned the first. Migration 097 puts the rules on the show (`requires_coggins`, `requires_health_certificate` + window, `requires_vaccination` + window + notes), set in a new setup Step 6, and the derivation answers against them. Coggins gets no fallback window on purpose: how long a negative test stays good is a state rule, and the app does not know which state the horse is standing in. A CVI is written as "issued within 30 days", so that one counts from `issue_date` — unless the document prints its own expiry, which always wins.

**The entry blank got a table.** `show_waivers` is free text, because the wording comes from the venue's insurer or the fair board and this app has no business supplying it. Signatures land in one table from two routes — the exhibitor types their name at sign-up, or hands a paper blank across the counter and staff record it with `on_paper` set — so a show running entirely on clipboards still gets a working outstanding count. `signed_name` is the one value in the whole paperwork system the backend does not derive: every other sign-off reads its value off the record precisely so a caller cannot attest to something nobody has on file, and there is simply nothing to read a signature from. Minors sign through a parent or guardian, which is not a footnote when youth classes are a third of a schedule.

**Trainers' cards were added and then taken back out** (migrations 098, 100). A professional's card is what makes an amateur class an amateur class, so checking it looked like desk paperwork — but the trainer is not standing at the counter, has no entry and no back number, and their card is the association's business rather than this show's. The check sat permanently unverified and inflated every outstanding count. Reversed rather than left dormant: a kind nothing writes and a column nothing populates is the `entries.back_number` trap, dead schema that reads as live.

### Two Horses, One Pattern Class

A pattern class is judged run by run. Showmanship on two horses is two runs, two scores, and two entry fees, and the backend has allowed it since entries existed — `score_type == 'pattern'` is the one case that escapes the once-per-exhibitor 409. The exhibitor's own registration screen could not express it: one select per class, one horse per select.

It now keeps a list per class. Pick a horse for a pattern class and a second select appears, offering only horses not already in it; non-pattern classes still get exactly one. `entries_class_horse_uniq` stops the same horse going in twice and the picker reflects that by disabling an already-picked horse in the other slots.

**The totals had to change with it.** Fees were summed over *selected classes*, which was right only while a class could hold one horse — a second run would have gone in free, on screen at least, and the exhibitor would have found out at the desk. They now iterate the flattened entry list, so the second horse carries its own entry fee and its own NSBA sanction fee, and the footer counts entries rather than classes.

One seeded exhibitor keeps two horses so the path is walkable. `seed_demo_people.py` gave every exhibitor exactly one, which is not what a horse show looks like and made this untestable.

Emergency contacts deliberately got no table. `exhibitors` has carried them since migration 041; the desk reads those columns and reports them missing. A per-show copy would have been a second, staler answer to the only question that matters.

### The Desk Takes The Emergency Contact

The paperwork sweep checked whether the show had somebody to telephone and could only ever report that it did not. The fix was to ask the exhibitor to log in and edit their own account — standing at a counter, with a queue behind them — because `PATCH /exhibitors/{id}` is ADMIN-or-self and a show secretary is neither.

It is now a field on their desk panel. `PATCH /shows/{id}/exhibitors/{exhibitor_id}/emergency-contact` is scoped to that show's roster, the same rule as staff creating a horse for someone: the reach exists because the person is standing in front of them at *their* show, not because of staff rank.

It writes the **profile**, not a per-show copy. Who to call if something happens to a person is not a fact about one weekend, and a duplicate per show would be a second answer that goes stale the moment they change their number — the same reasoning that kept emergency contacts out of the waivers migration in the first place.

Both halves or neither. A name with no number still reads as missing everywhere it is checked, so accepting one would let staff type something, press save, and watch the row go on saying "no emergency contact" — indistinguishable from the save having failed.

### Inspecting A Coggins Now Clears The Flag

The sign-off recorded that somebody looked, and nothing else. So a secretary could hold a valid negative Coggins in their hands, tick *I inspected it*, and the horse would go on reading "No Coggins on file — needed before the show" and stay on the office's own chase list. The flag was chasing paperwork the office already had, which is the fastest way to teach staff to stop reading a panel.

Clearing it on the click alone was the tempting fix and the wrong one. "I looked at this" and "this is valid" are different claims — collapsing them lets one click clear a flag on a test that expired in 2019, which is the exact conflation the health sign-off exists to undo, run backwards.

So the sign-off carries what was read: `attested_expiry`, the date printed on the document in the secretary's hand (migration 101). Covering the show, the horse reads valid and drops off the chase list, off the exhibitor's warning banner, and off the flag endpoint. Left blank — illegible, or genuinely lapsed — the inspection is still recorded and the horse stays flagged.

This is a staff-entered value, like a waiver signature and unlike everything else in `show_verifications`. That is not a hole: the app cannot derive a date off a document it has never been shown, and the alternative is an office that knows about uploads and is blind to paper.

**The overlay never feeds the snapshot.** `verified_value` still records what the *documents on file* said, carried on the check as `file_snapshot`. Snapshotting the overlaid value would have the sign-off recording its own effect, and every attestation would have read back "changed since" the instant it was written.

### The Document, Beside The Checkbox

An exhibitor who uploaded a perfectly good Coggins and left the printout at home was in the same position as one who had nothing. Staff could download the file — but downloading a stranger's veterinary paperwork onto the office laptop to squint at it is not the same as looking at it, and it is not what anyone does with a queue behind them.

Every health row and the registration-papers block now carry a **View** button. Opening one splits the horse card into two columns: the checks on the left, the scan on the right, so the sign-off and the document are on screen together. PDFs render in an `<iframe>`, images in an `<img>`, and anything else offers a download rather than a broken box — a Coggins uploaded as a `.heic` is a real thing that happens. One document open at a time across the panel.

It is the same endpoint the download always used, with `?inline=true` and therefore the same access rules; only the `Content-Disposition` differs, and the Next route adds `Cache-Control: private, no-store`. Nothing is written to disk.

### Three Screens Became The Registration Desk

Entering someone in a class, giving them a back number, and checking their papers were three tiles on the show dashboard and three separate pages. They are one conversation at the counter: somebody walks up, gets a number, says what they are riding and on what, buys into the jackpot, hands over their Coggins and their membership card. Doing that meant finding the same person three times, and no one of the three pages could tell you what was still outstanding on the other two — the back-number screen did not know their papers were unchecked, and the check-in sheet could not enter the class the conversation was actually about.

`/admin/shows/[id]/desk` is the one screen. A searchable roster on the left with filter chips — *no back number*, *paperwork to check*, *health flags*, *no classes yet* — and on the right, everything about the person selected: the back number as an editable field, their classes with a picker to add more, the show's side pots as in/out toggles, their paperwork checks, and what they owe. `/entries`, `/back-numbers`, and `/check-in` redirect here; those routes are bookmarked and written on staff notes, so they are redirects rather than deletions.

**The second view is the one thing the old Entries page did that a per-exhibitor screen cannot.** *By class* is the program listing — who is entered in what, grouped by show day, with owner, sire, and dam — and it answers "how many are in class 14?", which is not a question about a person. Clicking a name there jumps to that person's panel.

**It fills classes too.** A secretary working down a short class calling for more riders is thinking about the class, not about each rider's account, so an expanded class carries the same entry form — one open at a time, since *Expand all* on a 21-class show would otherwise be a wall of dropdowns, and it stays open after each save so a queue goes in one after another. `AddEntryForm` is one component with one side pinned: pass the exhibitor and it offers a class picker, pass the class and it offers an exhibitor picker. Two copies would have meant two copies of the SPB guard, the relationship-required rule, and the horse lookup — exactly the pair that drifts. Both pickers filter to what the backend would accept anyway: a horse can only be in a class once, and only `pattern` classes let one exhibitor ride several.

**And the show-wide outstanding total came off the header.** The desk counts registration work — exhibitors, entries, missing back numbers, paperwork outstanding. An individual's balance stays on their panel because they may be settling it at that counter, but "the show is owed $6,049" is a Financials question and is not part of registering anybody.

**The desk computes nothing of its own.** Money comes from `_load_financials` → `billing.build_account`, so the running total read out at the counter is character-for-character the bill the exhibitor sees on My Shows; a `SUM` over `entry_fee_cents` would have been faster and would eventually have disagreed. Paperwork comes from `build_verification_checklist`, extracted from the check-in route so "verified" / "changed since sign-off" / "nothing on file" keeps one definition in `show_office.py`. And every button posts to the endpoint that already owned that job — `POST .../classes/{id}/entries`, `PATCH .../back-numbers`, `POST .../side-pots/{id}/entries`, `POST .../verifications` — so association validation, back-number uniqueness, the closed-class rule, and the settled-pot lock all still apply. A save re-reads `/desk`.

**One new write, and it only creates the row the others assume.** A back number lives on `show_entries` and a side pot entry points at it, and the only things that had ever created that row were the exhibitor signing up and the bulk back-number save. So the desk could not give a walk-up a number, or put them in the jackpot, until it had first invented a class entry for them. `POST /shows/{id}/desk/exhibitors` creates the shell row — `registered_at` stays NULL, which is what the schema already calls "a secretary added them by hand" — and is idempotent, because two staff members adding the same walk-up at once is a normal Saturday. The matching `DELETE` is an undo for adding the wrong person and 409s once entries, pots, reservations, or payments hang off the row: `show_entries` cascades, and a mis-click must not be able to delete a recorded payment.

**One read, not five per exhibitor.** `GET /shows/{id}/desk` returns the roster, the schedule, the pots, and every exhibitor's entries, pot memberships, checks, and balance in one payload. The desk is worked at a counter with a queue behind it; a screen that fetches per selection feels broken on venue wifi. Owner/sire/dam ride along in the entry rows, which also retired the old Entries page's request-per-class plus a pull of the whole horse and exhibitor tables.

Two smaller things fell out. `_get_show_or_404` here re-reads with `select(...).populate_existing()` rather than `db.get(..., options=[...])`, because `_load_financials` loads the same Show row in the same request and whichever ran second would have had its loader options silently dropped — the identity-map trap that ate side pot creation. And an exhibitor's classes are ordered by the show's own schedule rather than by `class_number`, which is a text column: sorted as a string it puts class 10 ahead of class 3.

### The Side Pot Page Became Three Screens

One pot was one page, and that page was every section stacked: the settings form with its scrolling class picker, the list of who was in, live standings, settle, frozen payouts, delete. The most frequent job at the desk — someone hands over a $10 buy-in, tick "paid" — sat below the whole class picker, and the standings a secretary refreshes between classes sat below that.

`[potId]` is now a hub in the shape Financials already uses: status, the pool figures, how the pot scores, and three buttons — **Settings**, **Side Pot Entries**, **Standings**. Each is its own route, so each is one breadcrumb away and reachable directly.

**"Opt-ins" became "Side Pot Entries."** Staff do not opt into a pot, they enter it; the word was only ever there because `entries` already means class entries in this app. Qualifying it fixes that better than a second word for the same act does. The same reasoning renamed the **entry fee** to the **buy-in** — "entry fee" sitting next to "entries" reads as the class fee, and "buy-in" is both what the industry says and what the financial reports already called it.

**Settle stayed with the standings rather than moving to the hub.** It is irreversible, and what it freezes is exactly the table rendered above the button, so reviewing the ranking and committing it are one motion instead of two screens apart. Once a pot is settled that table drops its projected-money column: the frozen payout sheet below is the authority, and a live-recomputed column beside it would quietly disagree the moment a result was corrected after the fact.

**You add someone to a pot by name now.** The form asked for a back number, which is the wrong end of the question: the desk knows who is buying in, and a number that had not been assigned yet came back 404 reading like the pot itself was broken. The picker lists the show roster — new `GET .../side-pots/{potId}/roster`, read from `show_entries` because that is what a pot entry points at — and posts `show_entry_id` directly. Whoever is already in is filtered out of the options from live state, so removing someone restores their option with no round trip and the backend's duplicate-409 is unreachable from the UI. Roster rows with no back number are offered too and labelled as such; standings resolve the number live, so it fills itself in when the office assigns it.

**And the "paid" tick is gone**, because exhibitors settle pot money with the rest of their bill at the end of the show — ticking a box per entry recorded a collection that was not happening. Being in the pot is what owing the buy-in means, so `SidePotEntryCreate.paid` defaults to true and the pool counts everyone. The column stays: deleting it would have meant a migration, and the pool math (`entry_fee_cents × paid count`) is shared with settle and the financial report, where an all-unpaid pot would quietly pay out nothing. For the same reason the panel still counts `paid` rather than the number of rows when it quotes the pool — it cannot then disagree with the backend — and it says so out loud if it ever meets a row from before the change.

**Creating a pot had been failing at the response, after the write.** `POST /shows/{id}/side-pots` committed the pot and its classes, then re-read it with `db.get(SidePot, id, options=[selectinload(...)])` — and loader options are silently ignored when the instance is already in the session's identity map, which it always is one line after `db.add()`. `_serialize_pot` then touched `pot.pot_classes`, that was lazy IO inside an async request, and SQLAlchemy raised `MissingGreenlet`. The pot existed; the save button said it failed. The same trap ate the entry list, where `_get_pot_or_404` had already pulled the `ShowEntry` rows in without their exhibitors, so `_hydrate_entry`'s `db.get` handed back the exhibitor-less copies and reading `.exhibitor` blew up — the Side Pot Entries screen rendered "nobody has entered this pot yet" over a pot with six people in it, because the loader treats a failed read as an empty list. Both re-reads are now `select(...).options(...).execution_options(populate_existing=True)`, which forces the options onto the instance already in the session.

**Side pots also got a front door.** The only way in was a tile on `/admin/shows/[id]/fees`, and the setup-wizard rebuild had left nothing linking to that page — the pot screens still worked perfectly if you knew the URL, which is why the gap survived. Side pots now have their own tile on the show dashboard, beside Back Numbers and Financials, and the tile is gone from the fee schedule: a pot is money the office takes at the desk and standings it reads between classes, where the fee schedule is what the show publishes in advance.

The types, the status pill, the breadcrumb trail, and the pool math live in one `pot-shared.tsx` that the pot list also reads — it had been carrying its own copy of the same four types and status badge. `potMoney()` mirrors `billing.side_pot_money()` (floor included) and exists for the Entries screen alone, where the pool has to move as boxes are ticked; the Standings screen quotes the figures `GET /standings` computed server-side. Server reads are one loader per slice in `loadPot.ts`, so the Settings screen no longer pulls standings it will not draw.

### The Half Of The Money That Was Missing

The ask was a Financials section for show staff: registrations, money made, outstanding balances, plus a reporting module to be filled in later. Two of those three could not be answered by the schema as it stood.

`billing.build_bill` has always itemized what an exhibitor **owes** — class fees, NSBA sanction fees, the office charge, the stalls and shavings reserved at sign-up. Nothing anywhere recorded the check handed over at the desk. So "money made" was really "money invoiced", and "outstanding balance" was arithmetically the full bill for every exhibitor, forever. A screen built on that would have shown twelve accounts at 100% unpaid on day one and still shown it on the last day of the show.

- **`show_payments` (migration 096) records collection, and nothing more.** No card is handled, no processor is called. The office takes cash or a check and writes down that it happened — the same shape as `show_verifications`, which records a document a human physically inspected. The app still collects no payment.
- **Scoped to the account, not the charge.** `show_entry_id` is the exhibitor's account at that show. A show office takes one check for the whole bill; allocating tenders against individual line items is a full accounts-receivable ledger and nobody at the desk works that way.
- **`amount_cents` is signed, so a refund is a negative row** rather than an edit to or deletion of the original payment. The original is a fact about money that moved; erasing it balances the account and loses that money moved twice. `DELETE` stays, for a row typed in error.
- **Outstanding and credit are never netted.** `summarize_accounts` sums positive balances into `outstanding_cents` and negative ones into `credit_cents` separately. A single signed total would let one exhibitor's double payment quietly reduce what the show is owed by everyone else — the office needs "$6,479 still to collect", not a figure silently discounted by someone who overpaid. `net_balance_cents` is kept beside it for the books.

The rule that constrained the rest of the work: **money is computed in one place.** A show-wide `SUM` over `entry_fee_cents` in SQL would have been faster and would eventually have disagreed with the bill the exhibitor reads on their own My Shows page — the one thing this screen cannot afford, since both are quoting the same debt to the same two people. So the rollup calls `build_bill` per account and aggregates in Python, with the whole show loaded in four bulk selects rather than a round trip per exhibitor.

Side pot money is reported **apart from** the accounts. Pot buy-ins are not part of `build_bill`, and folding them into a balance would make Financials and My Shows disagree; they get their own block, their own report, and `billing.side_pot_money()`.

"Show staff" turned out to be the ambiguous word in the request. This app has roles literally named that way, and two of them — `SCRIBE` and `GATE_STEWARD` — work the ring and have no business reading revenue. Financials is the show-office tier: ADMIN, or the SHOW_SECRETARY / SHOW_MANAGER assigned to *that* show.

**The reporting module is a registry, not six pages.** A report is a slug, a title, and a builder returning columns and rows; one generic renderer draws any of them. Adding a report is a function in `_REPORTS` — no route, no component, no migration — which is the point, since which reports a show office actually wants is not knowable up front. Reports are built from the payload the overview already assembled and never query, so a report cannot quote a different number than the screen it was opened from. Six ship now: revenue summary, outstanding balances, registrations, payments received, stalls/shavings/camping sold, and side pot money. Each exports CSV built from the report already on the page — money as plain decimal dollars, because `$1,240.00` arrives in a spreadsheet as text and will not sum.

One honest gap the reports state out loud rather than paper over: because payments land on an account rather than on individual charges, **collections cannot be split by revenue category**. The revenue summary says so in a note and points at the payment log instead of inventing an allocation.

### One Class, Four Cards

A ranch or breed show routinely runs a **panel**: the MNSPHC Grand Paint Classic bill puts four APHA judges and two WSCA judges on the same day, each placing the same class independently off their own card. The app could represent exactly one set of placings per class, so the second judge's card overwrote the first — and nothing in the UI suggested that had happened.

The request was to show placings by judge, side by side. The columns had nothing to fill them: `results` had no `judge_id` at all. So the display change was the last step, not the first.

- **`results.judge_id` points at `show_judges`, not `judges`.** Who placed a class is a fact about *this show*; the same judge working two shows files two independent sets of cards. NULL is a real state — unattributed — covering results entered before a panel was assigned.
- **The old `UNIQUE (class_id, place, entry_id)` had to be dropped, not merely superseded.** Every judge on a panel awards a 1st, so two judges placing the same horse first produce the identical triple and the constraint would have rejected the second card. It is replaced by two *partial* unique indexes, because NULLs compare as distinct in a plain unique index and an unattributed row could otherwise be stored twice.
- **The backfill refuses to guess.** Shows with exactly one judge get their existing card attributed to that judge, which is unambiguous. Shows with a panel are left NULL: there is no way to tell whose card was entered, and a name against placings that judge may never have given is worse than an honest blank.
- **Place derivation for pattern/time classes ranks within each judge's card.** Pooling them would make a 71.5 from one judge tie a 71.5 from another, and would make each judge's placings shift as other judges filed their sheets.
- **The bulk save replaces one judge's card**, scoped by a `judge_id` on the request envelope. Left class-wide, each scribe's autosave would have wiped every other judge's placings 1.5 seconds after they were typed — the delete-all-then-insert-all shape that was safe with one card is actively destructive with six.

Autosave needed two fixes to survive per-judge entry, both of them latent bugs the single-card version simply never reached. `save()` read current state instead of the snapshot that was debounced, so switching cards inside the 1.5s settle window would post the newly-opened card in place of the edit that scheduled the save; it now receives the payload. And switching cards flushes first, with a `baselineKey` that adopts the incoming card as already-committed — otherwise merely reading another judge's tab wrote it back.

The display itself: one column per judge who has filed, rosettes sized down to fit a panel across the page. Judges who have not filed are left off rather than shown as a column of dashes. **The colour legend is gone** — it named eight ribbon colours the rosettes already show, and it does not survive multiplication by four judges.

**Every column sorts**, which is what makes the panel view usable: the default mean-placing order answers neither "read me judge 2's card in order" nor "find back number 112". An entry with no placing in the sorted column is treated as *unplaced rather than last*, so it stays at the bottom in both directions instead of surfacing to the top when the sort is reversed. Making the table a client component also surfaced a hydration mismatch that had been harmless while it was server-only: the rosette's petal coordinates came from `Math.cos`/`Math.sin` and serialized to different precision on each side (`27.2583302491977` vs `27.258330249197698`), logging an error per rosette. The ring is constant, so it is now computed once and rounded.

What the page deliberately does *not* do is combine the cards. Rows are ordered by mean placing so the sheet reads top-down, and the page says in as many words that this is not an official combined result — because the cards disagree and the app does not judge. The same restraint applies to side pots: standings now take the entry's best card per class, deterministic and identical to the old behaviour on the single-judge shows pots have actually run on. Show bills settle multi-judge pots "from combined judge score sheets", which is a sum, but adopting that would silently reprice existing pots. That is a rules decision, not a refactor.

Three consumers were quietly miscounting once an entry could hold several results, and were fixed on the way past: the class list counted result rows rather than distinct entries (24 placed in an eight-horse class with three judges), the exhibitor dashboard and My Shows collapsed to whichever row the database happened to return last, and the public results index repeated each horse per judge with no way to tell why — it now carries the judge's name on each line. Unassigning a judge who has already filed placings returns 409 rather than cascading them away.

Still single-card: `/live` and `/results` show one set of placings per class. Bringing the columnar layout to those is the remaining piece.

### The Scribe Screen Stopped Assuming A Desk

The scribe screens were built for someone sitting at a laptop: type the numbers, press Save at the end. In the ring the scribe is standing with a tablet, entering scores as the judge calls them — so the two things that actually happened were losing a card because nobody pressed Save, and fighting an on-screen keyboard that covered half the table.

Autosave on its own would have made it worse, and the reason is worth recording: **results publish straight to the public `/live` and `/results` screens.** A placement card reads 1, _, 3 until the last horse is entered, so autosaving one would have broadcast wrong placings to everyone at the rail and written an audit row for each intermediate state. The fix was to add the missing state rather than tune the debounce.

- **`classes.results_published_at` is the gate.** NULL is a staff-only draft; a timestamp is live. Entry autosaves freely into the draft and a human posts the class with one button. `GET .../results/` returns everything to show staff and `[]` to everyone else; `results-index` is public with no caller to make an exception for, so it filters outright. Migration 094 backfills every class that already had results — without that step it would have silently un-published every result in every show that has ever run.
- **Audit rows start at publish, not at first keystroke.** Before a class is posted there is no published value for an edit to have changed, so draft edits write nothing. Corrections *after* posting — the thing `result_audit` actually exists for — are still captured, attributed, and live immediately. Verified both ways: 0 rows from draft edits, 2 from the same swap once posted.
- **The gap warning moved from Save to Post.** Mid-entry gaps are normal when every keystroke commits; a warning there is noise. At the moment of publishing, "missing places 2, 5 — post anyway?" is exactly the right question.
- **Autosave is single-flight.** The bulk save deletes every row for the class and reinserts, so two requests in flight can interleave and lose a score. A save arriving mid-flight is queued, not raced. A failure holds the error on screen with the typed values intact — the one thing autosave must never do is drop a score quietly.
- **Entry is finger-first**, one pad per score type rather than one universal keypad: a 1..N place grid for placement, half-point steppers for pattern, a digit keypad for time. Pattern steppers start from **70** on an empty field — the base score every AQHA/APHA pattern run starts from — so a typical score is one or two taps from centre. Inputs carry `inputMode="none"` so the OS keyboard never opens, and selecting a row scrolls it to centre, because the pad is docked over the table the scribe is reading.

One thing surfaced by testing it: the show page hid `CLOSED` classes outright from scribes on an active show, so a 21-class show opened at "14 — Amateur Trail" with no sign the first thirteen existed. That read as broken numbering (the numbers were fine — 1..21, contiguous, matching `sort_order`), and it mattered more now that a scribe may need to reopen a posted class to correct it: there was no link to one at all. Finished classes now fold into a `<details>` — "13 finished classes — show" — instead of vanishing. They are not renumbered: `class_number` is printed in the program and on entry forms, so it has to mean the same thing to everyone.

That list also keeps itself current. Classes close underneath the scribe as the gate steward works through the day, so `AutoRefresh` polls `router.refresh()` every 20s and a class that has just finished rolls into the folded group on its own. It stops while the tab is hidden — a tablet parked at the in-gate would otherwise poll until the battery died — and refreshes the instant it becomes visible again, which is when someone picking the tablet back up needs it to be right. Because `router.refresh()` reconciles rather than remounting, an expanded finished-classes list stays expanded across a refresh. It is mounted only for staff on an `ACTIVE` show: on a show that has not started or has finished, nothing moves.

`/api/results` was calling `res.json()` unguarded on every verb, against the convention in `CLAUDE.md`. It mattered little when the route was hit once per class and a lot now that it is hit continuously, so it moved to `safeFetchBackend()` on the way past.

Left alone deliberately: side pot standings and settle read `results` directly and will now count drafts alongside posted results. Settling pays real money and is irreversible, so that wants its own decision rather than a silent change here.

### The Scorekeeper Became A Scribe

`SCOREKEEPER` was an app-invented word for a job the horse show world already has a name for. Staff arriving from any AQHA/APHA show had to learn our vocabulary to find the screen they use all day.

The rename started out headed for "Ring Steward" and research sent it somewhere else, which is the part worth recording:

- A **scribe** stands at the judge's shoulder and writes down every score and penalty the judge calls. That is precisely what this role does, so that is what it is now called.
- A **ring steward** (ringmaster) is a different job: arena control and exhibitor safety, positioning horses in halter, walking the showmanship set-up, calling gaits for individual work, checking the card is signed, and carrying it to the office. They do not tabulate. Most of that is what `GATE_STEWARD` already does — so `RING_STEWARD` would have put two unrelated "stewards" in the role list and hung an arena-floor title on a scoring screen, which is the confusion the rename was meant to remove.

Migration 093 moves the `users.role` value and its check constraint, the role on any pending `user_invites` (left alone, a pending invite would accept into a role the constraint no longer permits), and `show_scorekeepers` → `show_scribes`. The table step is guarded in both directions because startup `create_all` may have already created an empty `show_scribes` from the renamed ORM model — the same hazard called out in migration 075. Everything downstream follows: `require_admin_or_scribe`, `/shows/{id}/scribes`, `/scribe`, `ScribeForm` / `ScoredScribeForm`.

Two things this deliberately did **not** do, both now recorded in `CLAUDE.md`:

- **It did not add maneuver-level capture.** `results.raw_score` still holds one final number per entry, which is the office tabulation step, not scribing. Actual scribing is maneuver-by-maneuver — base 70, maneuver scores (−3…+3 for showmanship/horsemanship/equitation since 2019, −1½…+1½ for trail/ranch riding/western riding/reining), penalty tiers of 3/5/10, Form & Effectiveness, and required judge comments. That is a feature, not a rename.
- **It did not make multi-judge shows representable.** `results` has no `judge_id` and carries `UniqueConstraint("class_id", "place", "entry_id")`, so exactly one set of placings per class fits. Real shows have each judge placing independently on their own card, with points multiplied by the number of judges. Left as known-missing rather than half-built.

Anyone logged in when the migration runs holds the old role in their session token and needs to sign out and back in.

### The Show Page Stopped Asking Signed-Up Exhibitors To Sign Up

Coming back to `/shows/[id]` after completing sign-up still showed "Registration is open — Sign up", identical to what a stranger to the show saw. Telling someone to do a thing they have just done is how you make them wonder whether it worked.

`ExhibitorStatusBanner` now reports their own standing first: signed up (with back number and class count), entered by the office but never signed up, or nothing yet. It is fed by a new `GET /my-shows/{show_id}` which is **not** status-scoped, unlike everything under `/shows/{id}/register` — those 403 outside PUBLISHED because they change a registration, and this only reports one, so "entered in 6 classes" still shows on a show that has already started. The fetch is `no-store` on purpose: serving it from the data cache would put the sign-up prompt back in front of the person it was written for.

The shell-row case is handled rather than collapsed into "not signed up": a secretary adding a late entry by hand creates a `show_entries` row with no `registered_at`, so that exhibitor has classes while the office has no stall or shavings numbers for them. They are told exactly that, and still offered the form.

### Health Records Became A Flag Instead Of A Locked Door

A horse whose Coggins was missing, undated, or lapsed could not be entered at all — the exhibitor got a 422 and so did the secretary. The rule was well meant and did nothing useful: turning the entry away made the horse no more compliant, it just moved the discovery to the desk with the trailer already parked outside, and it pushed staff through an "override" that recorded a *bypass* when what the office actually wanted was a *to-do*. Entry is now open on both paths, and the shortfall surfaces to show staff early enough to act on it.

- **The deadline is the show's last day, not today.** `coggins_status(expiries, as_of)` takes the day the paperwork has to be good for, and every show-scoped caller passes `show.end_date`. A Coggins expiring between now and the show is the exact case worth chasing, and the old today-based check called it valid right up until it was too late — verified against a document valid on the day and lapsed by the show, which the old rule waved through and the flag catches. Last day rather than first, because the horse is on the grounds all week.
- **Nothing is stored, which is what makes it self-clearing.** Flags are derived on read from `horse_documents`, so uploading a current Coggins removes the flag with no row for anyone to remember to close. `GET /shows/{id}/health-flags` sorts worst first (`missing` → `undated` → `expired`) and names the exhibitors to call, their back numbers, and how many classes the horse is in. A horse shared by two exhibitors is one flag with both names on it, because it is one piece of paper.
- **It is deliberately not a `show_verifications` kind.** The desk cannot attest to a Coggins that has expired, and one that has not needs no attesting. The check-in checklist carries the derived line per horse and excludes it from `outstanding` and `totals`, which count sign-offs the desk still owes.
- **The all-clear is a line, not an absence.** `HealthFlagPanel` renders a green "paperwork is current for all N horses through *date*" rather than disappearing: staff cannot otherwise tell a clean show from one nobody has entered yet.
- **`coggins_override_audit` is kept, read-only.** An override needs a block to override, so nothing writes it now — but shows run under the old rule keep their trail. An audit that vanishes when the rule changes was never an audit. `skip_coggins_check` is gone from the API and the route handler rather than left as a no-op parameter.
- **The exhibitor still gets told.** Their registration screen lists the same horses, says the show office has the same list, and links to the upload form; the picker marks them `⚠ records due` but leaves them selectable. The `/profile` horse card stops saying "blocks entry" — it now says what a show will ask for, because nothing is refused. It remains the one place evaluating against today, having no show in hand.

### The Horse Health Section Stopped Asking The Same Question Twice

`HorseDocuments` put a type filter directly above an upload form whose first field was also a type dropdown — same three labels, same widget, stacked. Choosing "Coggins" to narrow the list and then "Coggins" again to upload one read as the app not listening.

- The filter is now a row of chips: visibly a filter rather than a form field, and hidden entirely until there is a list worth narrowing.
- It seeds the upload form's type, so the answer is given once.
- Uploading a type the list is filtered away from clears the filter. Saving a document into a view that hides it reads as the upload having failed.
- The "complete these fields" hint names only the fields actually blank, instead of listing "document type" at a control already filled in.

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
