"""Read structured fields off an uploaded horse document.

The app currently asks exhibitors to hand-type the issue and expiration dates
printed on paperwork they just scanned. That is where undated and mistyped
Coggins records come from, and an undated Coggins blocks entry
(`routers/horse_documents.py::coggins_status`). This module reads the document
and hands the values back as a *suggestion* for the uploader to confirm.

Design notes:

* Nothing here writes to the database. The caller persists a
  `document_extractions` row for provenance and the uploader saves the values.
* The model is told to transcribe only what is printed. It is specifically told
  not to compute a Coggins expiration from a test date, because how long a
  Coggins is good for is a state and association policy question, not something
  legible on the page. `test_date` comes back separately so the UI can offer a
  derived date the human explicitly accepts.
* A failure here is never fatal. Extraction is a convenience over a form that
  still works by hand, so every error path returns a result the caller can show
  rather than raising into the upload.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Optional

logger = logging.getLogger(__name__)

EXTRACTION_MODEL = "claude-opus-5"

# `max_tokens` bounds thinking *and* the response on this model, and adaptive
# thinking is on by default — a budget sized only to the JSON would truncate
# mid-answer on a dense multi-page scan.
MAX_TOKENS = 8000

STATUS_SUCCEEDED = "succeeded"
STATUS_UNSUPPORTED_MEDIA = "unsupported_media"
STATUS_FAILED = "failed"

# TIFF is deliberately absent: the upload endpoint accepts it, but it is not a
# format the model reads, and adding an image-conversion dependency to support
# a format almost nothing scans to is not worth it. Those uploads fall back to
# the manual form, which is what everyone does today anyway.
_IMAGE_MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp"}
_PDF_MEDIA_TYPE = "application/pdf"

VALID_DOC_TYPES = ("COGGINS", "VACCINATION", "HEALTH_CERTIFICATE", "REGISTRATION")
ASSOCIATION_CODES = ("AQHA", "APHA", "ApHC", "FQHR", "NSBA", "WSCA")

_DATE_FIELDS = (
    "issue_date",
    "expiry_date",
    "test_date",
    "foaling_date",
)


def supports_extraction(mime_type: str) -> bool:
    """Whether this file type can be read at all."""
    return mime_type == _PDF_MEDIA_TYPE or mime_type in _IMAGE_MEDIA_TYPES


def extraction_available() -> bool:
    """Whether the service is configured. False just means the manual form."""
    return bool(os.getenv("ANTHROPIC_API_KEY"))


# --- Output schema -----------------------------------------------------------
# Structured outputs require `additionalProperties: false` and every property
# listed in `required`; optional values are expressed as nullable rather than
# omitted, so the shape coming back is always the same.


def _nullable(json_type: str, description: str) -> dict[str, Any]:
    return {"type": [json_type, "null"], "description": description}


def _nullable_enum(values: tuple[str, ...], description: str) -> dict[str, Any]:
    return {
        "anyOf": [{"type": "string", "enum": list(values)}, {"type": "null"}],
        "description": description,
    }


_VACCINATION_ITEM = {
    "type": "object",
    "additionalProperties": False,
    "required": ["name", "administered_on"],
    "properties": {
        "name": {"type": "string", "description": "Vaccine or disease name as printed."},
        "administered_on": _nullable("string", "Date given, YYYY-MM-DD. Null if not printed."),
    },
}

EXTRACTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "document_type",
        "issue_date",
        "expiry_date",
        "test_date",
        "horse_name",
        "result",
        "accession_number",
        "lab_name",
        "veterinarian_name",
        "veterinarian_clinic",
        "veterinarian_phone",
        "vaccinations",
        "association_code",
        "registration_number",
        "sire_name",
        "dam_name",
        "color",
        "sex",
        "foaling_date",
        "breeder",
        "low_confidence_fields",
        "notes",
    ],
    "properties": {
        "document_type": _nullable_enum(
            VALID_DOC_TYPES,
            "What kind of document this is. COGGINS is an equine infectious anemia "
            "(EIA) test result, often a VS 10-11 form. Null if it is none of these.",
        ),
        "issue_date": _nullable(
            "string",
            "Date the document was issued or signed, YYYY-MM-DD. Null unless printed.",
        ),
        "expiry_date": _nullable(
            "string",
            "Expiration date, YYYY-MM-DD, ONLY if an expiration is explicitly printed "
            "on the document. Do not compute one from the test date.",
        ),
        "test_date": _nullable(
            "string",
            "For a Coggins, the date blood was drawn or the test performed, YYYY-MM-DD.",
        ),
        "horse_name": _nullable("string", "Registered name of the horse as printed."),
        "result": _nullable_enum(
            ("NEGATIVE", "POSITIVE", "INCONCLUSIVE"),
            "Coggins/EIA test result.",
        ),
        "accession_number": _nullable("string", "Lab accession or case number."),
        "lab_name": _nullable("string", "Testing laboratory name."),
        "veterinarian_name": _nullable("string", "Accredited veterinarian who signed."),
        "veterinarian_clinic": _nullable("string", "Clinic or practice name."),
        "veterinarian_phone": _nullable("string", "Veterinarian or clinic phone number."),
        "vaccinations": {
            "type": "array",
            "description": "Vaccines listed. Empty array if none.",
            "items": _VACCINATION_ITEM,
        },
        "association_code": _nullable_enum(
            ASSOCIATION_CODES, "Breed or club association that issued a registration."
        ),
        "registration_number": _nullable("string", "Registration number as printed."),
        "sire_name": _nullable("string", "Sire, from a registration certificate."),
        "dam_name": _nullable("string", "Dam, from a registration certificate."),
        "color": _nullable("string", "Coat color as printed."),
        "sex": _nullable("string", "Sex as printed (e.g. Mare, Gelding, Stallion)."),
        "foaling_date": _nullable("string", "Date of birth, YYYY-MM-DD."),
        "breeder": _nullable("string", "Breeder as printed."),
        "low_confidence_fields": {
            "type": "array",
            "description": (
                "Names of fields above whose values you are unsure about — "
                "handwriting, poor scan quality, ambiguous date format. These get "
                "flagged for the person reviewing."
            ),
            "items": {"type": "string"},
        },
        "notes": _nullable(
            "string",
            "One short sentence for the reviewer if something needs their attention "
            "(illegible section, conflicting dates, page appears cut off). Null if "
            "the document read cleanly.",
        ),
    },
}


SYSTEM_PROMPT = """You transcribe equine paperwork for a horse show entry system. \
Show secretaries and exhibitors upload scans of Coggins (EIA) test results, health \
certificates, vaccination records, and breed registration certificates. Your output \
pre-fills a form that a person then reviews and corrects before saving.

Transcribe what is printed. Do not infer, complete, or correct.

- If a field is not on the document, return null. A null costs someone ten seconds \
of typing; a plausible-looking wrong value can go unnoticed and end up gating a \
horse's eligibility to compete.
- Never compute an expiration date. Return `expiry_date` only when an expiration is \
explicitly printed. Coggins validity is set by state and association rules, not by \
the document, so a test date is not an expiration date — put it in `test_date`.
- Dates print in many formats and some are handwritten. Convert to YYYY-MM-DD. When \
a date is genuinely ambiguous (05/06/25 could be May or June, and the year could be \
2025 or 1925), pick the reading most consistent with the rest of the document and \
add the field to `low_confidence_fields`.
- Transcribe the horse's registered name exactly as printed, including punctuation \
and unusual spellings. Registered names are frequently odd on purpose. Do not \
normalize capitalization or expand abbreviations.
- List every field you are unsure of in `low_confidence_fields`. Under-reporting \
uncertainty is worse than over-reporting it — a flagged field just gets a second \
look, an unflagged wrong one may not.
- If the image is too poor to read, or the document is not equine paperwork at all, \
return nulls throughout and say so in `notes`."""


@dataclass
class ExtractionResult:
    """What a read produced, in a shape the caller can persist and return."""

    status: str
    fields: dict[str, Any] = field(default_factory=dict)
    error_message: Optional[str] = None
    model: Optional[str] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None

    @property
    def succeeded(self) -> bool:
        return self.status == STATUS_SUCCEEDED


_client = None


def _get_client():
    """Build the client on first use so the app boots without a key configured."""
    global _client
    if _client is None:
        from anthropic import AsyncAnthropic

        _client = AsyncAnthropic()
    return _client


def _document_block(content: bytes, mime_type: str) -> dict[str, Any]:
    data = base64.standard_b64encode(content).decode("utf-8")
    if mime_type == _PDF_MEDIA_TYPE:
        return {
            "type": "document",
            "source": {"type": "base64", "media_type": _PDF_MEDIA_TYPE, "data": data},
        }
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": mime_type, "data": data},
    }


def _normalize(raw: dict[str, Any]) -> dict[str, Any]:
    """Coerce the model's output into values the rest of the app can trust.

    Structured outputs guarantee the shape, not the semantics: a date field is
    guaranteed to be a string or null, not to be a real date. Anything that
    fails to parse is dropped to null rather than passed along, so a malformed
    value can never reach a form field as though it were read off the page.
    """
    out = dict(raw)

    for key in _DATE_FIELDS:
        value = out.get(key)
        if not value:
            out[key] = None
            continue
        try:
            out[key] = date.fromisoformat(str(value).strip()).isoformat()
        except ValueError:
            logger.info("extraction: dropping unparseable %s=%r", key, value)
            out[key] = None
            out.setdefault("low_confidence_fields", [])
            if key not in out["low_confidence_fields"]:
                out["low_confidence_fields"].append(key)

    if out.get("document_type") not in VALID_DOC_TYPES:
        out["document_type"] = None
    if out.get("association_code") not in ASSOCIATION_CODES:
        out["association_code"] = None

    for key, value in list(out.items()):
        if isinstance(value, str):
            out[key] = value.strip() or None

    if not isinstance(out.get("vaccinations"), list):
        out["vaccinations"] = []
    if not isinstance(out.get("low_confidence_fields"), list):
        out["low_confidence_fields"] = []

    return out


async def extract_horse_document(content: bytes, mime_type: str, filename: str) -> ExtractionResult:
    """Read a horse document. Never raises — failures come back as a result."""
    if not supports_extraction(mime_type):
        return ExtractionResult(
            status=STATUS_UNSUPPORTED_MEDIA,
            error_message=f"{mime_type} can't be read automatically. Enter the details by hand.",
        )
    if not extraction_available():
        return ExtractionResult(
            status=STATUS_UNSUPPORTED_MEDIA,
            error_message="Document reading is not configured on this server.",
        )

    try:
        client = _get_client()
        response = await client.messages.create(
            model=EXTRACTION_MODEL,
            max_tokens=MAX_TOKENS,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    # The prompt and schema are byte-identical on every upload,
                    # so each read after the first bills the prefix at cache
                    # rates.
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            output_config={
                "effort": "medium",
                "format": {"type": "json_schema", "schema": EXTRACTION_SCHEMA},
            },
            messages=[
                {
                    "role": "user",
                    "content": [
                        _document_block(content, mime_type),
                        {
                            "type": "text",
                            "text": (
                                f"Uploaded as {filename!r}. Transcribe this document. "
                                "The filename is a hint about the document type at best "
                                "— trust the page over the filename."
                            ),
                        },
                    ],
                }
            ],
        )
    except Exception as exc:  # noqa: BLE001 - surfaced to the uploader, never fatal
        logger.exception("extraction: request failed for %s", filename)
        return ExtractionResult(
            status=STATUS_FAILED,
            error_message=f"Could not read the document ({type(exc).__name__}). Enter the details by hand.",
            model=EXTRACTION_MODEL,
        )

    if response.stop_reason == "refusal":
        return ExtractionResult(
            status=STATUS_FAILED,
            error_message="The document could not be processed. Enter the details by hand.",
            model=response.model,
        )

    text = next((b.text for b in response.content if b.type == "text"), None)
    if not text:
        # Most likely the token budget went to thinking on a dense scan.
        return ExtractionResult(
            status=STATUS_FAILED,
            error_message="The document was too long to read in one pass. Enter the details by hand.",
            model=response.model,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        logger.error("extraction: unparseable JSON for %s", filename)
        return ExtractionResult(
            status=STATUS_FAILED,
            error_message="Could not read the document. Enter the details by hand.",
            model=response.model,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )

    return ExtractionResult(
        status=STATUS_SUCCEEDED,
        fields=_normalize(parsed),
        model=response.model,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
    )
