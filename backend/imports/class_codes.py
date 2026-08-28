"""Reading an association's published class-code list off an uploaded file.

Two shapes arrive. A CSV works for any association and is the fallback for one
whose PDF layout nobody has taught the app yet. A PDF is what APHA and AQHA
actually publish, and each lays its list out differently enough to need its own
reader -- APHA prints "CODE Name" under division headings, AQHA prints
"Division CODE Name" on every line.

Parsing only ever *proposes*. Nothing here writes; the router diffs the result
against the catalog and an admin applies it. Same rule as document extraction:
a misread name would go out on a show program.
"""
from __future__ import annotations

import csv
import io
import re
from collections import Counter
from dataclasses import dataclass, field


@dataclass
class ParsedClass:
    code: str
    name: str
    division: str
    sort_order: int
    notes: str | None = None


@dataclass
class ParseResult:
    classes: list[ParsedClass]
    warnings: list[str] = field(default_factory=list)
    #: Lines the reader could not place. Surfaced rather than swallowed -- a
    #: layout change shows up here before it shows up as missing classes.
    skipped: list[str] = field(default_factory=list)


class ParseError(ValueError):
    """The file could not be read as a class list at all."""


# -- shared helpers -----------------------------------------------------------

def _normalize(line: str) -> str:
    """Undo the two things PDF text extraction does to these lists.

    Kerned pairs come out split ("Y outh"), and column padding comes out as
    runs of spaces.
    """
    line = re.sub(r"\bY\s+outh\b", "Youth", line)
    return re.sub(r"\s{2,}", " ", line).strip()


def _read_pdf_lines(data: bytes) -> list[str]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - pypdf is a hard dependency
        raise ParseError("PDF support requires pypdf.") from exc
    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages]
    except Exception as exc:
        raise ParseError(f"Could not read the PDF: {exc}") from exc
    if not any(page.strip() for page in pages):
        raise ParseError(
            "No text could be read from this PDF. A scanned image needs to be "
            "converted to a CSV first."
        )
    return [line for page in pages for line in page.split("\n")]


# -- APHA ---------------------------------------------------------------------

_APHA_DIVISIONS = {
    "open division": "Open",
    "amateur division": "Amateur",
    "novice amateur division": "Novice Amateur",
    "amateur walk-trot division": "Amateur Walk-Trot",
    "youth division": "Youth",
    "novice youth division": "Novice Youth",
    "youth walk-trot division": "Youth Walk-Trot",
}
# A group heading changes how the division headings under it read. Ranch Horse
# repeats the whole division set beneath it and the catalog keeps those apart;
# Mounted Shooting and Calas & Colas repeat it too, but the catalog files all
# of each under one name.
_APHA_GROUPS = {
    "ranch horse classes": ("split", "Ranch Horse"),
    "mounted shooting": ("flat", "Mounted Shooting"),
    "calas & colas classes": ("flat", "Calas & Colas (Mexico Only)"),
}
_APHA_RANCH_SUBS = {
    "open": "Open",
    "youth": "Youth",
    "youth walk-trot": "Youth Walk-Trot",
    "novice youth": "Novice Youth",
    "amateur": "Amateur",
    "novice amateur": "Novice Amateur",
}
# Sections that are a paragraph of rules rather than a list of codes.
# Everything up to the next heading is prose.
_APHA_PROSE_STARTS = (
    "mounted shooting is allowed",
    "dressage may be approved",
    "for dressage class codes",
)
_APHA_NOISE = re.compile(
    r"^(\d{1,2}|20\d\d APPROVED CLASS CODES.*|\(mexico only\))$", re.I
)
_APHA_CODE = re.compile(r"^[A-Z][A-Z0-9]{1,5}$")
_APHA_NUM = re.compile(r"^\d{1,3}$")


def _apha_split_row(line: str) -> tuple[str, str] | None:
    """Split "CODE Name".

    The code is the first token, except for the handful APHA prints with an
    internal space ("AM 40 A Yearling & 2-Yr-Old Mares"). Matching that case
    with a trailing-characters regex instead swallows the leading "A " that
    every amateur class name starts with, silently renaming 300 classes.
    """
    parts = line.split(" ")
    if len(parts) < 2 or not _APHA_CODE.match(parts[0]):
        return None
    if len(parts) > 2 and parts[0].isalpha() and _APHA_NUM.match(parts[1]):
        return parts[0] + parts[1], " ".join(parts[2:])
    return parts[0], " ".join(parts[1:])


def parse_apha_lines(lines: list[str]) -> ParseResult:
    """The APHA reader, over already-extracted lines.

    Split from the PDF entry point so the layout rules can be tested without
    a PDF — that is where the bugs live.
    """
    classes: list[ParsedClass] = []
    order: Counter[str] = Counter()
    skipped: list[str] = []
    division: str | None = None
    group: str | None = None
    prose = False
    pending: ParsedClass | None = None

    def flush() -> None:
        nonlocal pending
        if pending is not None:
            pending.name = _normalize(pending.name)
            classes.append(pending)
            pending = None

    for raw in lines:
        line = _normalize(raw)
        if not line:
            continue
        key = line.lower().rstrip(":").strip()

        if key.startswith(_APHA_PROSE_STARTS) or key == "dressage":
            flush()
            prose = True
            continue
        if _APHA_NOISE.match(line):
            flush()
            continue
        if key in _APHA_GROUPS:
            flush()
            prose = False
            mode, name = _APHA_GROUPS[key]
            group = key
            division = None if mode == "split" else name
            continue
        if key in _APHA_DIVISIONS:
            flush()
            prose = False
            # Inside a flat group the division headings are presentation only:
            # the whole group files under one catalog division.
            if group and _APHA_GROUPS[group][0] == "flat":
                continue
            group = None
            division = _APHA_DIVISIONS[key]
            continue
        if group and _APHA_GROUPS[group][0] == "split" and key in _APHA_RANCH_SUBS:
            flush()
            prose = False
            division = f"{_APHA_GROUPS[group][1]} - {_APHA_RANCH_SUBS[key]}"
            continue
        if prose:
            continue

        row = _apha_split_row(line)
        if row and division:
            flush()
            code, name = row
            order[division] += 1
            pending = ParsedClass(
                code=code, name=name, division=division, sort_order=order[division]
            )
        elif pending is not None:
            # A class name that wrapped onto a second line in the PDF.
            pending.name += " " + line
        else:
            skipped.append(line)
    flush()

    if not classes:
        raise ParseError(
            "No APHA class codes were found. Is this the Approved Class Codes list?"
        )
    return ParseResult(classes=classes, skipped=skipped)


def parse_apha_pdf(data: bytes) -> ParseResult:
    return parse_apha_lines(_read_pdf_lines(data))


# -- AQHA ---------------------------------------------------------------------

_AQHA_HEADER = "Division Show Class Code Show Class Name"
_AQHA_IGNORED = {
    "AQHA CLASS CODE LIST",
    "NEED AN EXCEL VERSION? EMAIL show@aqha.org",
}
_AQHA_ROW = re.compile(r"^(.+?)\s+(\d{6,8})\s+(.+)$")


def parse_aqha_lines(lines: list[str]) -> ParseResult:
    """The AQHA reader, over already-extracted lines.

    AQHA prints the division on every line, so there is no heading state.
    """
    classes: list[ParsedClass] = []
    order: Counter[str] = Counter()
    skipped: list[str] = []

    for raw in lines:
        line = _normalize(raw)
        if not line or line == _AQHA_HEADER or line in _AQHA_IGNORED:
            continue
        match = _AQHA_ROW.match(line)
        if not match:
            skipped.append(line)
            continue
        division, code, name = (part.strip() for part in match.groups())
        order[division] += 1
        classes.append(
            ParsedClass(
                code=code, name=name, division=division, sort_order=order[division]
            )
        )

    if not classes:
        raise ParseError(
            "No AQHA class codes were found. Is this the Class Master Listing?"
        )
    return ParseResult(classes=classes, skipped=skipped)


def parse_aqha_pdf(data: bytes) -> ParseResult:
    return parse_aqha_lines(_read_pdf_lines(data))


# -- CSV ----------------------------------------------------------------------

_CSV_ALIASES = {
    "code": {
        "code", "classcode", "aqhaclasscode", "aphaclasscode", "classnumber",
        "classno", "showclasscode",
    },
    "name": {"name", "classname", "classdescription", "description", "showclassname"},
    "division": {"division", "category", "section", "showdivision"},
    "sort_order": {"sortorder", "sort", "order", "displayorder"},
    "notes": {"notes", "note", "remarks", "remark"},
}


def _csv_key(header: str) -> str | None:
    squashed = re.sub(r"[^a-z0-9]", "", (header or "").lower())
    for field_name, aliases in _CSV_ALIASES.items():
        if squashed in aliases:
            return field_name
    return None


def parse_csv(data: bytes) -> ParseResult:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ParseError("The CSV has no header row.")

    mapping = {h: _csv_key(h) for h in reader.fieldnames}
    if "code" not in mapping.values() or "name" not in mapping.values():
        raise ParseError(
            "The CSV needs at least a code column and a name column. Found: "
            + ", ".join(reader.fieldnames)
        )

    classes: list[ParsedClass] = []
    order: Counter[str] = Counter()
    warnings: list[str] = []
    for line_no, row in enumerate(reader, start=2):
        values = {
            mapping[h]: (row.get(h) or "").strip()
            for h in reader.fieldnames
            if mapping.get(h)
        }
        code = values.get("code", "")
        name = values.get("name", "")
        if not code and not name:
            continue
        if not code or not name:
            warnings.append(f"Row {line_no}: skipped, needs both a code and a name.")
            continue
        division = values.get("division") or "Unassigned"
        raw_sort = values.get("sort_order") or ""
        if raw_sort.isdigit():
            sort_order = int(raw_sort)
        else:
            order[division] += 1
            sort_order = order[division]
        classes.append(
            ParsedClass(
                code=code,
                name=name,
                division=division,
                sort_order=sort_order,
                notes=values.get("notes") or None,
            )
        )

    if not classes:
        raise ParseError("The CSV had a header but no class rows.")
    return ParseResult(classes=classes, warnings=warnings)


# -- dispatch -----------------------------------------------------------------

#: Associations whose published PDF the app knows how to read. Anything else
#: uploads a CSV, which is less a limitation of that association than an
#: admission that nobody has taught the app their layout yet.
PDF_PARSERS = {
    "APHA": parse_apha_pdf,
    "AQHA": parse_aqha_pdf,
}


def parse_upload(filename: str, data: bytes, show_type_code: str) -> ParseResult:
    if not data:
        raise ParseError("The uploaded file is empty.")
    lowered = (filename or "").lower()

    if lowered.endswith(".csv"):
        return parse_csv(data)
    if lowered.endswith(".pdf") or data[:5] == b"%PDF-":
        parser = PDF_PARSERS.get((show_type_code or "").upper())
        if parser is None:
            raise ParseError(
                f"The app does not know how {show_type_code} lays out its PDF. "
                "Upload a CSV with code, name, and division columns instead."
            )
        return parser(data)

    raise ParseError("Upload a PDF or a CSV.")


def duplicate_codes(classes: list[ParsedClass]) -> list[str]:
    counts = Counter(c.code for c in classes)
    return sorted(code for code, n in counts.items() if n > 1)
