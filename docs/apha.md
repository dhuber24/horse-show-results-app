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
| Horses | `is_solid_paint_bred` |
| Exhibitors | APHA member fields and date of birth |
| Entries | `apha_division`, `relationship_to_owner`, `is_disqualified` |
| Classes | APHA code through `class_associations` |

## APHA Entry Validation

APHA rules live in `backend/rules/apha.py` and are reached the same way every
other association's are — `rules.get_rules(show.show_type.code)`, then
`validate_entry`. Two checks are implemented:

| Rule | Code | What it says |
| --- | --- | --- |
| SC-325.A.1 | `APHA_SOLID_PAINT_BRED_OPEN` | A Solid Paint-Bred horse may not enter an Open division class. |
| — | `APHA_RELATIONSHIP_REQUIRED` | Amateur, Novice Amateur, Youth and Novice Youth entries must state the exhibitor's relationship to the horse's owner. |

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

