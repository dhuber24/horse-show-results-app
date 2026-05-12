# AQHA Research And Compliance Notes

Last researched: 2026-05-12

This note captures the first AQHA compliance pass for the app. It focuses on AQHA show bills/class schedules, AQHA show-management rules, class code structure, and the app gaps we should close before calling AQHA support production-ready.

## Primary Sources

- AQHA 2026 Rulebook: https://www.aqha.com/aqha-rulebook
- AQHA show-management forms and class-code list entry: https://www.aqha.com/management-forms
- AQHA show approval forms mirror page: https://www.aqha.com/resource-detail-view/-/asset_publisher/D6hvXWsL9zzH/content/show-approval-forms
- AQHA 2026 event dates: https://www.aqha.com/-/aqha-announces-2026-dates
- AQHA future World Show dates: https://www.aqha.com/future-world-championship-show-dates
- AQHA records research field descriptions: https://www.aqha.com/aqha-records-research
- AQHA Level 1 eligibility help: https://helpcenter.aqha.com/knowledge/how-do-i-know-if-i-am-eligible-to-show-level-1
- AQHA performance halter help: https://helpcenter.aqha.com/knowledge/what-are-the-requirements-for-showing-in-performance-halter-at-aqha-approved-events

AQHA's official rulebook page is the authority. During research, a temporary local PDF/text extraction copy was used only for searching rule numbers and was removed afterward so the repo keeps summarized notes and links rather than copied rulebook content.

Note on class-code sourcing: AQHA's management-forms page lists an "AQHA Class Code List" entry, but automated fetches can be blocked by AQHA.com's Cloudflare check. Keep source PDFs/exports out of version control and load the table from a user-downloaded official CSV/export instead.

## Show-Bill Samples Reviewed

Recent and future show bills consistently show that our AQHA schedule builder needs to handle class numbers, dates, judges/show numbers, concurrent classes, office/stall/RV fees, association add-ons, and AQHA/non-AQHA classes side by side.

- SDQHA 2026 schedule lists approved future AQHA shows and linked show bills, including Brookings Summer Shootout, Black Hills Summer Circuit, a special event, and Region 2: https://www.sdqha.com/shows
- Nebraska QHA 2026 schedule lists multiple future show bills and related pattern/stall documents: https://www.nebraskaquarterhorseassociation.com/2026-show-bill
- Ozark QHA 2026 show bill/source page for an AQHA and MQHA approved show: https://www.ozqha.com/
- Minnesota Bluff Country Classic 2026 show bill is a mixed AQHA/APHA/NSBA style bill with paired class numbers: https://www.mnqha.com/wp-content/uploads/2026BluffCountryClassicShowbill.pdf
- Illinois State Fair 2026 show bill shows AQHA, VRH, all-breed, concurrent ranch classes, deadlines, and facility fees: https://ilqha.com/adminfiles/userfiles/file/2026/2026%20IL%20State%20Fair%20Showbill.pdf
- Region Six 2025 packet is a useful recent full-packet example with AQHA administration fee and multi-show billing: https://www.aqhar6.com/wp-content/uploads/2025/06/full-packet-2025.pdf
- Virginia National Stock Horse 2025 show bill is a recent AQHA/VQHA sanctioned show example: https://myvqha.com/wp-content/uploads/2025/02/2025-National-Stock-Horse-Showbill.pdf

## AQHA Rulebook Requirements That Matter To The App

- `SHW100`: AQHA show approval is annual and discretionary. The app should not imply a show is AQHA-approved merely because `show_type = AQHA`; it should store approval/show number state explicitly.
- `SHW100.5`: Approved AQHA classes must be open to AQHA owners meeting age, ownership, and eligibility requirements.
- `SHW100.5.1`: Owners/lessees of horses in AQHA approved events generally need current AQHA membership, with exceptions for EWD, youth rookie, youth Level 1, amateur rookie, and amateur Level 1.
- `SHW100.6`: The horse must be entered with show management before the class starts.
- `SHW100.7`: Exhibitors are responsible for accurate entry forms.
- `SHW100.11`: One designated show manager or show secretary must have attended an AQHA show-management workshop within the preceding 3 years.
- `SHW110`: Judges must be chosen from AQHA's approved list; show calendar should state judge name before the show date.
- `SHW112`: AQHA classes consist solely of registered American Quarter Horses, with limited weanling exceptions. Leveled scored/pattern classes have concurrency rules for Level 2 and Level 3.
- `SHW112.4`: Age restrictions matter: no 2-year-old performance classes before July 1, and horses must be at least 3 for ranch riding, ranch trail, and VRH classes.
- `SHW112.6` and `SHW112.7`: Junior is 5 and under; senior is 6 and older.
- `SHW112.12`: Patterns and courses must be posted at least one hour before the class starts.
- `SHW114`: If Level 1 classes are offered, corresponding AQHA amateur or youth classes must also be offered; Level 1 timing/age grouping rules apply.
- `SHW116`: Open division approval requires minimum halter/performance class offerings.
- `SHW117`: Amateur/select amateur approval requires at least four AQHA-approved amateur/select performance events; select is age 50+.
- `SHW118`: Youth approval requires at least four approved youth performance events, including showmanship and either western pleasure or western horsemanship; youth eligibility runs through the end of the calendar year the exhibitor turns 19.
- `SHW120.2`: AQHA-approved U.S. and international shows collect a $10 show administration processing fee per horse per individual show number.
- `SHW121`: Premium lists, show bill, or class schedule must be submitted with the show approval application and must include prize money/awards, officers/officials, class schedule, exact location, show dates, entry closing date, and judging date/time.
- `SHW123`: Entry fees must be uniform within each division and specified on show approval; changes after approval are restricted.
- `SHW124`: Point-earning ties must be broken before a class is complete.
- `SHW126`: AQHA show results must be submitted in full, include roster of all horses entered, use accepted electronic format, and be submitted no later than the 10th business day after the show closes. Disqualified horses are not placed but still count as class entries.
- `SHW130`: Show secretary must not also be show manager or ring steward at that show; secretary is responsible for entries/results, eligibility/current membership verification, horse eligibility, registration-certificate inspection, and recording entries in the record owner name with complete registered name and number.

## Class-Code And Data Structure Implications

AQHA's records research descriptions confirm that AQHA show records are centered on:

- show begin/end date
- city/state
- judge
- class code
- class description
- number of entries
- placing
- points earned
- exhibitor
- horse/exhibitor or horse-level division context depending on Open, Youth, Amateur, Select, Rookie, Level 1, Level 2, and Level 3

The app uses `class_associations.association_class_code` to carry AQHA class codes. AQHA standard classes are stored in `aqha_standard_classes`, and the 2026 official list is available in `database/seeds/aqha_standard_classes.csv`.

Implemented AQHA data and code paths:

- Migration: `database/migrations/043_aqha_support.sql`
- Class-code extraction: `scripts/extract_aqha_standard_classes_from_pdf.py`
- Class-code import: `scripts/import_aqha_standard_classes.py`
- Backend lookup: `GET /aqha-standard-classes/` and `GET /aqha-standard-classes/divisions`
- Bulk class import: `POST /shows/{show_id}/classes/bulk` for AQHA shows
- Validation endpoint: `GET /shows/{show_id}/aqha-validation`
- Frontend picker: `frontend/app/admin/shows/[id]/AQHAClassPicker.tsx`
- Frontend validation proxy: `frontend/app/api/shows/[showId]/aqha-validation/route.ts`

The 2026 class-code load produced 1,589 classes: 491 Open, 451 Amateur, 626 Youth, and 21 Equestrians With Disabilities. AQHA 7-digit class codes are preserved as text.

## App Gap Map

- AQHA rules now enforce the first practical validation slice in `backend/rules/aqha.py`: official class-code presence, horse AQHA registration, exhibitor AQHA membership number presence, youth/select DOB checks, youth/stallion restriction, junior/senior horse-age checks, ranch/VRH minimum horse age, and 2-year-old performance class timing.
- Shows now have basic AQHA show-number and approval-status fields. Multi-judge circuits may still need one show number per judge/show identity.
- The app has per-association horse/exhibitor registrations, but no AQHA-specific membership expiration/amateur/youth/Level 1 eligibility workflow.
- Horse records can store registrations by association, and AQHA entry validation now requires an AQHA horse registration number for AQHA classes.
- Horse age is derivable from foaling date, and AQHA entry validation now covers junior/senior, 2-year-old performance timing, ranch/VRH minimum age, youth/stallion restrictions, youth age, and select-amateur age where current data allows.
- `class_associations` can carry AQHA codes, and `aqha_standard_classes` plus API/UI picker/importer plumbing now exists. The 2026 AQHA Class Master Listing has been extracted to `database/seeds/aqha_standard_classes.csv` and loaded into the database.
- Bulk import now supports APHA and AQHA standard-class sources.
- Results are currently one placing per class entry. AQHA multi-judge / multi-show-number reporting likely needs judge-specific result cards or a show-number dimension.
- DQ handling exists for APHA-ish fields, but AQHA explicitly requires DQed horses to count as entries while not receiving a placing. That rule should be represented association-neutrally.
- AQHA show-management workshop dates are stored on users as `aqha_management_workshop_completed_at`; show validation warns when no assigned show manager or show secretary is current within 3 years of the show start date.
- Show-bill generation is not modeled as an approval artifact. AQHA wants a premium list/show bill/class schedule submitted with approval and containing specific required fields.
- A read-only AQHA validation endpoint now exists at `GET /shows/{show_id}/aqha-validation` for schedule and existing-entry issues.

## Suggested Implementation Sequence

1. Extend AQHA validation once new data exists for owner/lessee membership, AQHA amateur status, AQHA Level 1 eligibility, and per-judge show identities.
2. Add a fuller AQHA pre-approval checklist for `SHW121` show-bill/premium-list fields.
3. Add show-bill/premium-list checklist or export that includes AQHA-required fields from `SHW121`.
4. Add optional per-judge show-number / result-card modeling if AQHA export is a goal, because one class result may need separate judge cards/show numbers.
5. Add AQHA results export after class codes, show numbers, roster, DQ handling, and per-judge results are modeled.

## Near-Term Safe Win

The first safe-win build is now implemented: an AQHA class-code catalog, AQHA class picker, entry validation, and a show-level validation endpoint. These pieces let secretaries build schedules from official AQHA classes and gives every class the association code AQHA expects later in exports.

## Current Validation Behavior

Entry create/update blocks AQHA entries when validation returns an error:

- missing AQHA class code on the class
- class code not present in `aqha_standard_classes`
- missing horse on an AQHA entry
- horse missing AQHA registration number
- exhibitor missing AQHA membership number, except EWD is warning-only today because AQHA has rule exceptions that need more specific data
- youth class without exhibitor DOB
- youth exhibitor over AQHA youth age
- youth class with a stallion
- Select class without exhibitor DOB
- Select exhibitor under 50
- junior class with horse over 5
- senior class with horse under 6
- ranch/VRH class with horse under 3
- 2-year-old performance class scheduled before July 1

Show-level validation currently reports:

- missing AQHA show number
- AQHA approval status not marked `APPROVED`
- no assigned show manager or show secretary with an AQHA show-management workshop date within 3 years of show start
- classes missing AQHA class codes
- class codes not present in `aqha_standard_classes`
- Level 1 Amateur/Youth classes missing a corresponding base class
- all existing entry-level AQHA issues

## AQHA Class-Code Import Workflow

1. Download/export the official AQHA Class Code List from AQHA's management forms.
2. If the source is the 2026 PDF, extract it to CSV:

```powershell
python scripts/extract_aqha_standard_classes_from_pdf.py "<path-to-AQHA-Class-Master-Listing.pdf>" database/seeds/aqha_standard_classes.csv --source-year 2026
```

3. If the source is already spreadsheet data, convert it to CSV with columns equivalent to `code`, `name`, and `division`; optional columns are `sort_order`, `source_year`, and `notes`.
4. Validate without writing:

```powershell
python scripts/import_aqha_standard_classes.py database/seeds/aqha_standard_classes.csv --dry-run --source-year 2026
```

5. Replace the lookup table once the dry run passes:

```powershell
python scripts/import_aqha_standard_classes.py database/seeds/aqha_standard_classes.csv --replace --source-year 2026
```
