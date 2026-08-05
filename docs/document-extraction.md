# Document Extraction

Reading dates, registration numbers, and vet details off uploaded horse
paperwork so the uploader confirms them instead of typing them.

## Why

Every horse document upload asked the exhibitor to hand-type the issue and
expiration dates printed on the scan they had just attached. That is where
undated and mistyped Coggins records come from — and an undated Coggins blocks
entry (see the Coggins Gate section in [show-workflow.md](show-workflow.md)),
which is the failure the `coggins_override_audit` escape hatch exists to absorb.

Extraction attacks that at the source: the values are read off the page and
pre-filled, and the person saving them only has to agree.

## The rule

**The model suggests. A human saves.** Nothing extracted is written to a record
without someone looking at it. This is not caution for its own sake —
`horse_documents.expiry_date` is the field the entry gate reads, so a misread
year would silently admit an expired horse or block a valid one, and neither
failure announces itself.

Two consequences in the code:

- The analyze endpoint saves no document. It returns a suggestion.
- Once a document has been read, the upload form's existing auto-upload-when-
  complete behavior is suppressed and an explicit **Looks right — save** button
  appears. Auto-upload stays on for values the uploader typed themselves.

## Two upload surfaces

| Surface | Endpoint | Gate |
| --- | --- | --- |
| `HorseDocuments` — horse already exists | `POST /horses/{horse_id}/documents/analyze` | Same as upload: ADMIN or the horse's owner |
| Add-a-horse wizard — no horse yet | `POST /documents/analyze` | Authenticated, rate limited |

The wizard stages health documents in the browser and saves them only after the
horse is created, so there is no `horse_id` to authorize against at the moment
the file is chosen. That is also the first place an exhibitor ever files a
Coggins, which makes it the surface extraction most needs to reach.

Hence `document_extractions.horse_id` is nullable (migration 084): a row with a
NULL `horse_id` is a read taken before its horse existed. It gets attached when
the queued document is finally saved, in the same transaction that links the
document.

**The unattached endpoint has a genuinely weaker gate**, and that is worth
stating rather than burying: with no horse there is nothing to check ownership
against, so any signed-in user can read any file they already hold. They learn
nothing about anyone else's data, but it spends model tokens — so it is rate
limited to 20/minute **keyed on the user id, not the client address**. Every
request reaches the backend from the Next.js server, so an IP-keyed limit would
be one global bucket and a single busy user would lock out everyone else.

## Flow

1. Uploader picks a file in `HorseDocuments` (or the wizard's Health step).
2. The matching analyze endpoint reads the file, writes a
   `document_extractions` row, returns the fields. Saves no document.
3. The form pre-fills; extracted fields are marked *read from document*,
   uncertain ones *check this*, and everything the model read (vet, lab,
   accession, sire/dam) is listed read-only so the uploader can confirm the file
   is the right one.
4. Uploader corrects anything wrong and presses save.
5. `POST /horses/{horse_id}/documents` with `extraction_id` links the extraction
   to the created document **in the same transaction**, recording what was saved
   and which suggestions were overridden.

## What it extracts

One extractor covers all four `document_type` values. The schema is in
`backend/extraction/documents.py`.

The Coggins fields follow the section layout of a VS 10-11 form, because the
section a value sits under is what identifies it:

| Form section | Fields |
| --- | --- |
| Any document | `document_type`, `issue_date`, `expiry_date` |
| 1. Administrative & tracking | `accession_number`, `test_date` (date blood **drawn**) |
| 2. Contact information | `owner_name`, `owner_address`, `stable_name`, `veterinarian_name`, `veterinarian_clinic`, `veterinarian_phone`, `clinic_license_number` |
| 3. Equine identification | `horse_name`, `age_text`, `sex`, `breed`, `color`, `microchip_number`, `markings`, `identity_images_present` |
| 4. Laboratory test data | `lab_name`, `date_received`, `date_reported`, `test_type` (AGID / ELISA), `test_reason` |
| 5. Official result | `result`, `technician_name` |
| Vaccination | `vaccinations[]` (`name`, `administered_on`) |
| Registration | `association_code`, `registration_number`, `sire_name`, `dam_name`, `foaling_date`, `breeder` |
| Always | `low_confidence_fields[]`, `notes` |

### Three dates, easily transposed

A Coggins carries **three** dates and getting them the wrong way round has
consequences:

| On the form | Field | Why it matters |
| --- | --- | --- |
| Date blood drawn | `test_date` | Validity runs from **here** |
| Date received | `date_received` | Lab handling only |
| Date reported | `date_reported` | Also the document's `issue_date` unless one is printed separately |

The derived-expiry offer uses `test_date`. Using `date_reported` instead would
quietly hand the horse the extra days between the draw and the lab's report.

### A positive result is extraordinary

A finalized Coggins virtually always reads NEGATIVE — a non-negative sample is
escalated to federal authorities for quarantine rather than issued as a routine
certificate. So the model is told that POSITIVE is an exceptional reading to be
returned only when the box is unmistakably marked, and flagged if there is any
doubt. `reviewWarnings()` then surfaces POSITIVE or INCONCLUSIVE as a red banner
in the review panel rather than a quiet row in a detail list, along with a
`identity_images_present: NONE` reading — these forms prove identity with photos
or a vet-drawn silhouette, and one missing them is worth a second look.

Identity images are reported as present or absent only. The model is explicitly
told not to describe them: the person reviewing has the document open, so a
generated description adds nothing and risks inventing detail.

Only `document_type`, `issue_date`, and `expiry_date` are persisted onto the
document. The rest is shown for verification and kept in
`document_extractions.extracted`.

### Coggins expiration is never computed

A standard EIA form has **no expiration field at all** — it prints the date blood
was drawn, and how long that result stays valid is a state and association policy
question. So:

- `expiry_date` comes back **only** when an expiration is explicitly printed,
  which for a Coggins is essentially never. `null` is the correct answer.
- `test_date` comes back separately.
- When the document is a Coggins with a test date and no printed expiry, the
  form offers a one-click *"Use 12 months from the blood draw"* — a derived date
  the uploader accepts, never one the model asserted.

`twelveMonthsAfter()` clamps a Feb 29 draw to Feb 28 rather than letting it roll
into March. This date decides whether a horse may compete, so where the calendar
is ambiguous it rounds against extra eligibility.

## Storage

`document_extractions` (migration 083) is the provenance record.

| Column | Notes |
| --- | --- |
| `horse_id` | NULL when the read predated the horse (wizard); set on save |
| `document_id` | NULL until save; NULL forever if the upload is abandoned |
| `extracted` | Raw model output, JSONB, stored whole so the schema can widen without a migration |
| `accepted` | The values actually saved |
| `overridden_fields` | Suggestions the human changed. Empty means every suggestion was taken as-is |
| `status` | `succeeded` / `unsupported_media` / `failed` |
| `model`, `input_tokens`, `output_tokens` | Which model read it, and what it cost |

This is what makes a date on a horse's record answerable after the fact: typed
by hand, accepted from the model, or corrected. `overridden_fields` is also the
measurement that says whether extraction is worth keeping — a field overridden
most of the time is a field the extractor is getting wrong.

## Configuration

`ANTHROPIC_API_KEY` in `.env`, passed through in `docker-compose.yml`.

**It is optional.** With no key set, `extraction_available()` is false, the
analyze endpoint returns `unsupported_media` with an explanation, and the upload
form behaves exactly as it did before extraction existed. The same is true when
the API is down or the model can't read the scan — every failure path degrades
to the manual form rather than blocking the upload. Extraction is a shortcut
over a form that still works by hand, and it must never be the reason someone
can't file their paperwork.

## Model configuration

`claude-opus-5`, in `backend/extraction/documents.py`:

- **Structured outputs** (`output_config.format`) pin the response shape, so the
  caller never parses free text. Shape is guaranteed; semantics are not — dates
  are re-parsed server-side in `_normalize()` and anything that isn't a real
  date is dropped to null and flagged rather than passed along.
- **Adaptive thinking** is on (the model's default) and `effort` is `medium`.
  `max_tokens` is 8000 because on this model the budget covers thinking *and*
  the response; a budget sized to the JSON alone truncates on a dense scan.
- **Prompt caching** on the system block — the prompt and schema are
  byte-identical on every upload, so each read after the first bills the prefix
  at cache rates.

## Sharp edges

- **TIFF is accepted for upload but cannot be read.** The upload endpoint's
  `_detect_mime` allows TIFF; the model does not read it. Those uploads return
  `unsupported_media` and fall back to manual entry. Supporting it would mean an
  image-conversion dependency for a format almost nothing scans to.
- **The analyze endpoint uses the *manage* permission, not *view*.** It reads
  the contents of a file being added to someone's horse, so the caller should
  already be allowed to add documents there — show staff who can read existing
  paperwork cannot run extraction on someone else's horse.
- **An extraction row can outlive its upload.** Abandoned reads keep
  `document_id` NULL. They are still a record of what the model produced and are
  deliberately not cleaned up.
- **An extraction is claimed once.** Re-submitting an `extraction_id` that
  already has a document, or one belonging to another horse, is ignored rather
  than rejected — the document is what the user asked for, provenance is
  bookkeeping and should not fail the upload. A NULL `horse_id` is the one case
  that is *not* a mismatch: that read predated the horse, and saving attaches it.
- **Shared UI helpers live in `frontend/lib/document-extraction.ts`**, not in
  either component. Both surfaces show the same review panel and field markers,
  and the horse-page form and the wizard would otherwise drift.
- **The wizard needs no auto-upload suppression.** Its "Add Document" button is
  already a deliberate click, so the uploader confirms what was read by
  construction — unlike `HorseDocuments`, which had an auto-upload-when-complete
  shortcut that had to be switched off once a document was read.
