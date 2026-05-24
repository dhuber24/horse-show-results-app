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

Solid Paint-Bred horses cannot enter APHA Regular Registry Open classes. The entry creation endpoint enforces this.

## Class Associations

Dual-sanctioned classes use `class_associations`:

- `class_id`
- `show_type_id`
- `association_class_code`

This lets one class carry, for example, APHA and NSBA codes.

## APHA Standard Class Import

APHA reference classes are stored in `apha_standard_classes`.

Backend endpoints:

- `GET /apha-standard-classes/`
- `GET /apha-standard-classes/divisions`
- `POST /shows/{show_id}/classes/bulk`

Frontend component:

- `frontend/app/admin/shows/[id]/APHAClassPicker.tsx`

Bulk import from the APHA catalog only applies to APHA shows. AQHA shows use the parallel AQHA standard-class catalog and picker.

On import, each picked class is **auto-routed** into a per-show Division (discipline) and Section (bracket). Discipline comes from name-keyword classification in `backend/rules/disciplines.py` — APHA codes don't encode discipline cleanly (e.g. code `R1` alone covers six different disciplines), but APHA class names are clean enough for 100% keyword coverage. Section comes from the `apha_standard_classes.division` column (which holds the bracket — Amateur/Youth/Novice/Open/etc.). Missing divisions/sections are created on the fly and the (div, sec) membership is registered. The picker shows a "Will create division" column and a routing-summary panel so the secretary can preview before committing.

## APHA Results Export

Backend endpoint:

- `GET /shows/{show_id}/apha-export`

The export requires:

- The show is APHA.
- `apha_show_number` is set.
- Entries/classes contain enough APHA data for the CSV.

