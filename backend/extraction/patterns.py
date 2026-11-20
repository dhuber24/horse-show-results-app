"""Read a file of patterns into the show's patterns, each with its classes.

The Patterns step's AI upload (GaitDesk Pro, `PATTERN_READING`). A show's
patterns usually arrive as one book -- a pattern a page, each headed with its
discipline and the divisions that ride it ("Showmanship (Int, Sr, Sr+)") -- or
as a single page or photo. This reads where each pattern is and which of the
show's classes run it; `routers/show_patterns.py` cuts the pages out, saves
them as the step's own upload would, and attaches the classes.

Design notes:

* **A page at a time.** The file is cut into single pages (pypdf), each sent
  labelled "page 5 of 11", so the pages a pattern comes back on are pages the
  file can be cut at. A PDF pypdf cannot open is not read: guessing at pages
  would save the wrong drawing under a pattern's name.
* **Never guess a class.** A class is attached only where a pattern's heading
  names its discipline and division. A class the read leaves alone is the
  office's to attach by hand, as on Basic.
* **Nothing here writes to the database**, and a failure comes back as a
  result, never raised -- adding the patterns one at a time works as before.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
from typing import Any, Sequence

from .common import (
    STATUS_FAILED,
    STATUS_SUCCEEDED,
    STATUS_UNSUPPORTED_MEDIA,
    ExtractionResult,
    _document_block,
    _get_client,
    extraction_available,
    supports_extraction,
)
# One model for every read GaitDesk makes, with the same refusal fallback:
# the show bill's. Opus 5.5 gave the same 11 patterns on the same classes for
# WSCA's 2026 book (2026-11-20) at about four-fifths of the price; Opus 5 is
# kept so both readers move together.
from .showbill import FALLBACK_BETA, FALLBACK_MODELS, SHOWBILL_MODEL as PATTERNS_MODEL

logger = logging.getLogger(__name__)

# Thinking and the answer share it. A pattern list is short -- the WSCA 2026
# book of 11 patterns came back in about 1k output tokens -- so this is room,
# not an estimate. Streamed, so a long read cannot hit an HTTP timeout.
MAX_TOKENS = 32_000

# The same 32 MB request cap applies as to a show bill; a pattern book of a few
# dozen pages is well under it, and the upload itself is held to 10 MB.
MAX_PAGES = 100

_PATTERN = {
    "type": "object",
    "additionalProperties": False,
    "required": ["name", "first_page", "last_page", "classes"],
    "properties": {
        "name": {
            "type": "string",
            "description": "The pattern's own title as printed, without the show's name or year: "
            "'Showmanship (Int, Sr, Sr+)', 'Trail Pattern 2', 'W/T Western Horsemanship (17 & Under)'.",
        },
        "first_page": {
            "type": "integer",
            "description": "The page the pattern starts on, as labelled (1 is the first page).",
        },
        "last_page": {
            "type": "integer",
            "description": "The page it ends on: the same as first_page for a one-page pattern.",
        },
        "classes": {
            "type": "array",
            "items": {"type": "integer"},
            "description": "The index of every class in the show's class list that runs this pattern.",
        },
    },
}

PATTERNS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["patterns"],
    "properties": {
        "patterns": {
            "type": "array",
            "items": _PATTERN,
            "description": "Every pattern in the file, in the order printed. Empty when it holds none.",
        },
    },
}

SYSTEM_PROMPT = """You read the patterns a horse show office uploads, so each \
can be filed under the show's classes that run it. Your output is saved \
straight onto the show, where exhibitors read it, so transcribe what is \
printed and never guess.

- A pattern is a drawn course with its numbered directions -- showmanship, \
horsemanship, equitation, ranch riding, reining, trail, a barrel or pole \
course -- that the exhibitors in some classes ride or show. Shows usually \
print one per page, headed with the discipline and the divisions that ride \
it ("Showmanship (Int, Sr, Sr+)"). A pattern may run over two pages.
- Give each pattern its pages, using the page labels shown, and the classes \
that run it: the classes of that discipline in the divisions its heading \
names. A heading naming no division ("Saddle Seat Equitation") is every class \
of that discipline. Abbreviations match the class list's divisions (Int is \
Intermediate, Sr+ is not Sr++, W/T is Walk Trot).
- A class runs at most one pattern. A class no pattern's heading names gets \
none -- never guess one for it. With no class list, list the patterns and \
leave their classes empty.
- `name` is the pattern's title as printed, without the show's name or year.
- A rule sheet, a scoring sheet or an arena map is not a pattern. A file \
with no pattern in it is an empty list."""


def pdf_page_count(content: bytes) -> int | None:
    """How many pages a PDF has, or None when pypdf cannot open it."""
    try:
        from pypdf import PdfReader

        return len(PdfReader(io.BytesIO(content)).pages)
    except Exception:  # noqa: BLE001 - an unreadable PDF is not read
        logger.warning("pattern reading: could not count the pages of a PDF", exc_info=True)
        return None


def pdf_pages(content: bytes, first: int, last: int) -> bytes | None:
    """Pages `first` to `last` (1-based, inclusive) of a PDF as a PDF of their
    own, or None when they can't be cut out. pypdf copies only what those pages
    use, so a page cut from a 3 MB patterns book is about its share of it."""
    try:
        from pypdf import PdfReader, PdfWriter

        reader = PdfReader(io.BytesIO(content))
        if not 1 <= first <= last <= len(reader.pages):
            return None
        writer = PdfWriter()
        for n in range(first - 1, last):
            writer.add_page(reader.pages[n])
        out = io.BytesIO()
        writer.write(out)
        return out.getvalue()
    except Exception:  # noqa: BLE001 - that pattern is left for the office
        logger.warning("pattern reading: could not cut pages %s-%s from a PDF", first, last, exc_info=True)
        return None


def single_pages(content: bytes, mime_type: str) -> list[bytes] | None:
    """The file as one file per page, or None if any page won't cut. An image
    is one page, and so is a one-page PDF, kept as uploaded."""
    if mime_type != "application/pdf":
        return [content]
    count = pdf_page_count(content)
    if count is None:
        return None
    if count == 1:
        return [content]
    pages = [pdf_pages(content, page, page) for page in range(1, count + 1)]
    return None if any(p is None for p in pages) else pages  # type: ignore[return-value]


def pattern_file(content: bytes, mime_type: str, first_page: int, last_page: int) -> bytes | None:
    """A pattern's own file: its pages cut from a PDF, or an image as it is.
    The whole file is kept as uploaded rather than rewritten. None when those
    pages aren't in it."""
    if mime_type != "application/pdf":
        return content if first_page == 1 else None
    if first_page == 1 and last_page == pdf_page_count(content):
        return content
    return pdf_pages(content, first_page, last_page)


def class_list_text(classes: Sequence[dict[str, Any]]) -> str:
    """The show's classes, one a line under the index a pattern names them by:
    "4: #11 Sr+ Showmanship (Showmanship / Sr+)"."""
    lines = []
    for i, c in enumerate(classes):
        number = (c.get("class_number") or "").strip()
        where = " / ".join(v for v in (c.get("discipline"), c.get("division")) if v)
        lines.append(
            f"{i}: {'#' + number + ' ' if number else ''}{c['class_name']}" + (f" ({where})" if where else "")
        )
    return "\n".join(lines)


def clean_patterns(raw: Any, class_count: int, page_count: int) -> list[dict[str, Any]]:
    """The patterns, each on pages the file has and over classes the show has.

    A pattern on no page there is dropped -- there would be nothing to save --
    and a range running past the end stops at the last page. A class runs one
    pattern, so a class two patterns name stays with the first. A repeated
    name is numbered here; names already on the show are the caller's.
    """
    patterns: list[dict[str, Any]] = []
    names: set[str] = set()
    taken: set[int] = set()
    for p in raw or []:
        if not isinstance(p, dict):
            continue
        name = " ".join(str(p.get("name") or "").split())[:200]
        first, last = p.get("first_page"), p.get("last_page")
        if not name or not isinstance(first, int) or isinstance(first, bool) or not 1 <= first <= page_count:
            continue
        if not isinstance(last, int) or isinstance(last, bool) or last < first:
            last = first
        last = min(last, page_count)
        name = numbered(name, names)
        names.add(name.lower())
        classes = []
        for i in p.get("classes") or []:
            if isinstance(i, int) and not isinstance(i, bool) and 0 <= i < class_count and i not in taken:
                taken.add(i)
                classes.append(i)
        patterns.append({"name": name, "first_page": first, "last_page": last, "classes": classes})
    return patterns


def numbered(name: str, taken: set[str]) -> str:
    """`name`, or "name (2)", "name (3)" ... -- the first not in `taken`
    (lower-cased), kept to the 200 characters a pattern's name may have."""
    candidate, n = name, 2
    while candidate.lower() in taken:
        suffix = f" ({n})"
        candidate = name[: 200 - len(suffix)] + suffix
        n += 1
    return candidate


async def read_patterns(
    content: bytes, mime_type: str, filename: str, classes: Sequence[dict[str, Any]]
) -> ExtractionResult:
    """Read the patterns in one uploaded file against the show's classes
    (`class_number`, `class_name`, `discipline`, `division`, in schedule
    order). On success `fields["patterns"]` is `clean_patterns`' list.
    Never raises."""
    if not supports_extraction(mime_type):
        return ExtractionResult(
            status=STATUS_UNSUPPORTED_MEDIA,
            error_message=f"{mime_type} can't be read automatically. Add the pattern below instead.",
        )
    if not extraction_available():
        return ExtractionResult(
            status=STATUS_UNSUPPORTED_MEDIA,
            error_message="Reading patterns is not set up on this server. Add them one at a time below.",
        )

    pages = await asyncio.to_thread(single_pages, content, mime_type)
    if pages is None:
        return ExtractionResult(
            status=STATUS_FAILED,
            error_message="That PDF's pages couldn't be read. Add its patterns one at a time below.",
        )
    if len(pages) > MAX_PAGES:
        return ExtractionResult(
            status=STATUS_FAILED,
            error_message=f"That file has {len(pages)} pages; upload the pattern pages only ({MAX_PAGES} at most).",
        )

    blocks: list[dict[str, Any]] = []
    for n, page in enumerate(pages, start=1):
        blocks.append({"type": "text", "text": f"{filename!r} -- page {n} of {len(pages)}:"})
        blocks.append(_document_block(page, mime_type))
    if classes:
        listing = "The show's classes, each with its index:\n\n" + class_list_text(classes)
    else:
        listing = "The show has no classes yet."
    instruction = (
        f"Above is the file the show office uploaded, a page at a time. {listing}\n\n"
        "List every pattern in the file, the pages it is on, and the indexes of the classes that run it."
    )

    try:
        client = _get_client()
        async with client.beta.messages.stream(
            model=PATTERNS_MODEL,
            max_tokens=MAX_TOKENS,
            betas=[FALLBACK_BETA],
            fallbacks=FALLBACK_MODELS,
            system=SYSTEM_PROMPT,
            output_config={
                # A pattern attached to the wrong class is one an exhibitor
                # rides, and the answer is short.
                "effort": "high",
                "format": {"type": "json_schema", "schema": PATTERNS_SCHEMA},
            },
            messages=[{"role": "user", "content": [*blocks, {"type": "text", "text": instruction}]}],
        ) as stream:
            response = await stream.get_final_message()
    except Exception as exc:  # noqa: BLE001 - surfaced to the office, never fatal
        logger.exception("pattern reading: request failed for %s", filename)
        return ExtractionResult(
            status=STATUS_FAILED,
            error_message=f"Could not read the patterns ({type(exc).__name__}). Try again, or add them below.",
            model=PATTERNS_MODEL,
        )

    usage = response.usage
    tokens = {
        "model": response.model,
        "input_tokens": usage.input_tokens
        + (usage.cache_creation_input_tokens or 0)
        + (usage.cache_read_input_tokens or 0),
        "output_tokens": usage.output_tokens,
    }
    if response.stop_reason in ("refusal", "max_tokens"):
        logger.error("pattern reading: %s stopped on %s", filename, response.stop_reason)
        return ExtractionResult(
            status=STATUS_FAILED,
            error_message="Could not read the patterns in that file. Add them one at a time below.",
            **tokens,
        )
    text = next((b.text for b in response.content if b.type == "text"), None)
    try:
        parsed = json.loads(text) if text else None
    except json.JSONDecodeError:
        parsed = None
    if not isinstance(parsed, dict):
        logger.error("pattern reading: no usable JSON for %s", filename)
        return ExtractionResult(
            status=STATUS_FAILED,
            error_message="Could not read the patterns. Try again, or add them below.",
            **tokens,
        )
    return ExtractionResult(
        status=STATUS_SUCCEEDED,
        fields={"patterns": clean_patterns(parsed.get("patterns"), len(classes), len(pages))},
        **tokens,
    )
