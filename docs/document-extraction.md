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

## Flow

1. Uploader picks a file in `HorseDocuments`.
2. `POST /horses/{horse_id}/documents/analyze` — reads the file, writes a
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

| Group | Fields |
| --- | --- |
| Any document | `document_type`, `issue_date`, `expiry_date`, `horse_name` |
| Coggins / health | `test_date`, `result`, `accession_number`, `lab_name`, `veterinarian_name`, `veterinarian_clinic`, `veterinarian_phone` |
| Vaccination | `vaccinations[]` (`name`, `administered_on`) |
| Registration | `association_code`, `registration_number`, `sire_name`, `dam_name`, `color`, `sex`, `foaling_date`, `breeder` |
| Always | `low_confidence_fields[]`, `notes` |

Only `document_type`, `issue_date`, and `expiry_date` are persisted onto the
document. The rest is shown for verification and kept in
`document_extractions.extracted`.

### Coggins expiration is never computed

A Coggins prints the date blood was drawn; how long that result stays valid is a
state and association policy question, not something legible on the form. So:

- `expiry_date` comes back **only** when an expiration is explicitly printed.
- `test_date` comes back separately.
- When the document is a Coggins with a test date and no printed expiry, the
  form offers a one-click *"Use 12 months from the test"* — a derived date the
  uploader accepts, never one the model asserted.

## Storage

`document_extractions` (migration 083) is the provenance record.

| Column | Notes |
| --- | --- |
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
  bookkeeping and should not fail the upload.
