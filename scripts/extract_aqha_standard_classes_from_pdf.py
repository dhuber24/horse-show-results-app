"""Extract AQHA standard class codes from the official AQHA PDF listing.

Usage:
  python scripts/extract_aqha_standard_classes_from_pdf.py \
      "C:\\Users\\Home\\Downloads\\AQHA Class Master Listing for online.pdf" \
      database/seeds/aqha_standard_classes.csv \
      --source-year 2026

Requires:
  python -m pip install pypdf
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import Counter
from pathlib import Path


HEADER_LINE = "Division Show Class Code Show Class Name"
IGNORED_LINES = {
    "AQHA CLASS CODE LIST",
    "NEED AN EXCEL VERSION? EMAIL show@aqha.org",
}
CLASS_ROW_RE = re.compile(r"^(.+?)\s+(\d{6,8})\s+(.+)$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert the official AQHA Class Master Listing PDF to CSV.",
    )
    parser.add_argument("pdf_path", type=Path, help="Path to the AQHA class listing PDF")
    parser.add_argument("csv_path", type=Path, help="Output CSV path")
    parser.add_argument("--source-year", type=int, required=True, help="AQHA source year")
    return parser.parse_args()


def normalize_line(line: str) -> str:
    return " ".join(line.strip().split())


def extract_rows(pdf_path: Path, source_year: int) -> list[dict[str, str | int]]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("pypdf is required. Run: python -m pip install pypdf") from exc

    reader = PdfReader(str(pdf_path))
    rows: list[dict[str, str | int]] = []
    sort_orders: Counter[str] = Counter()
    seen_codes: set[str] = set()

    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        for line_number, raw_line in enumerate(text.splitlines(), start=1):
            line = normalize_line(raw_line)
            if not line or line == HEADER_LINE or line in IGNORED_LINES:
                continue

            match = CLASS_ROW_RE.match(line)
            if not match:
                raise ValueError(f"Page {page_number}, line {line_number}: could not parse {line!r}")

            division, code, name = match.groups()
            if code in seen_codes:
                raise ValueError(f"Duplicate AQHA class code found: {code}")
            seen_codes.add(code)

            sort_orders[division] += 1
            rows.append(
                {
                    "code": code,
                    "name": name,
                    "division": division,
                    "sort_order": sort_orders[division],
                    "source_year": source_year,
                    "notes": "",
                }
            )

    if not rows:
        raise ValueError("No AQHA class rows were extracted")
    return rows


def write_csv(csv_path: Path, rows: list[dict[str, str | int]]) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["code", "name", "division", "sort_order", "source_year", "notes"],
        )
        writer.writeheader()
        writer.writerows(rows)


def summarize(rows: list[dict[str, str | int]]) -> str:
    divisions = Counter(str(row["division"]) for row in rows)
    parts = ", ".join(f"{division}: {count}" for division, count in sorted(divisions.items()))
    return f"{len(rows)} classes ({parts})"


def main() -> int:
    args = parse_args()
    try:
        if not args.pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {args.pdf_path}")
        rows = extract_rows(args.pdf_path, args.source_year)
        write_csv(args.csv_path, rows)
        print(f"Wrote {summarize(rows)} to {args.csv_path}.")
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
