"""Import the official AQHA Class Code List into aqha_standard_classes.

Expected CSV columns:
  code,name,division

Optional CSV columns:
  sort_order,source_year,notes

The importer accepts common header variants such as "Class Code",
"Class Name", and "Class Description" so a lightly cleaned AQHA export can be
loaded without hand-editing every header.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import os
import re
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse


HEADER_ALIASES = {
    "code": {"code", "classcode", "aqhaclasscode", "classnumber", "classno"},
    "name": {"name", "classname", "classdescription", "description"},
    "division": {"division", "category", "section"},
    "sort_order": {"sortorder", "sort", "order", "displayorder"},
    "source_year": {"sourceyear", "year", "showyear"},
    "notes": {"notes", "note", "remarks", "remark"},
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Load official AQHA class codes into aqha_standard_classes.",
    )
    parser.add_argument(
        "csv_path",
        type=Path,
        help="Path to an official AQHA class-code CSV.",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Delete existing AQHA standard classes before importing.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and summarize the CSV without writing to the database.",
    )
    parser.add_argument(
        "--source-year",
        type=int,
        default=None,
        help="Default source year for rows that do not include source_year.",
    )
    parser.add_argument(
        "--default-division",
        default=None,
        help="Division to use when a CSV row does not include a division.",
    )
    return parser.parse_args()


def load_dotenv(path: Path = Path(".env")) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower().strip().lstrip("\ufeff"))


def canonicalize_headers(headers: list[str]) -> dict[str, str]:
    canonical: dict[str, str] = {}
    for header in headers:
        normalized = normalize_header(header)
        for field, aliases in HEADER_ALIASES.items():
            if normalized in aliases and field not in canonical:
                canonical[field] = header
    return canonical


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = " ".join(value.strip().split())
    return value or None


def parse_int(value: str | None, field: str, row_number: int) -> int | None:
    value = clean_text(value)
    if value is None:
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"Row {row_number}: {field} must be an integer") from exc


def get_value(row: dict[str, str], headers: dict[str, str], field: str) -> str | None:
    header = headers.get(field)
    if header is None:
        return None
    return row.get(header)


def read_rows(
    csv_path: Path,
    *,
    source_year: int | None,
    default_division: str | None,
) -> list[tuple[str, str, str, int, int | None, str | None]]:
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError("CSV must include a header row")
        headers = canonicalize_headers(reader.fieldnames)
        missing = [field for field in ("code", "name") if field not in headers]
        if missing:
            raise ValueError(
                "CSV is missing required column(s): "
                + ", ".join(missing)
                + ". Accepted examples: code/name or Class Code/Class Name."
            )

        rows: list[tuple[str, str, str, int, int | None, str | None]] = []
        seen_codes: set[str] = set()
        sort_order = 0
        for row_number, row in enumerate(reader, start=2):
            code = clean_text(get_value(row, headers, "code"))
            name = clean_text(get_value(row, headers, "name"))
            division = clean_text(get_value(row, headers, "division")) or clean_text(default_division)
            notes = clean_text(get_value(row, headers, "notes"))
            row_source_year = parse_int(get_value(row, headers, "source_year"), "source_year", row_number)
            explicit_sort_order = parse_int(get_value(row, headers, "sort_order"), "sort_order", row_number)

            if not any(clean_text(value) for value in row.values()):
                continue
            if not code or not name:
                raise ValueError(f"Row {row_number}: code and name are required")
            if not division:
                raise ValueError(
                    f"Row {row_number}: division is required. "
                    "Provide a division column or pass --default-division."
                )

            code = code.upper()
            if code in seen_codes:
                raise ValueError(f"Row {row_number}: duplicate AQHA class code {code}")
            seen_codes.add(code)

            sort_order = explicit_sort_order if explicit_sort_order is not None else sort_order + 1
            rows.append((code, name, division, sort_order, row_source_year or source_year, notes))

    if not rows:
        raise ValueError("CSV did not contain any class rows")
    return rows


def database_url() -> tuple[str, bool]:
    load_dotenv()
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")

    url = url.replace("postgresql+asyncpg://", "postgresql://", 1)
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    sslmode = query.pop("sslmode", None)
    ssl_query = query.pop("ssl", None)
    clean_url = urlunparse(parsed._replace(query=urlencode(query)))

    use_ssl = (
        "neon.tech" in url
        or os.getenv("DB_SSL", "").lower() == "true"
        or sslmode in {"require", "verify-ca", "verify-full"}
        or ssl_query in {"true", "1", "require"}
    )
    return clean_url, use_ssl


async def import_rows(
    rows: list[tuple[str, str, str, int, int | None, str | None]],
    *,
    replace: bool,
) -> None:
    try:
        import asyncpg
    except ImportError as exc:
        raise RuntimeError("asyncpg is required. Install backend requirements first.") from exc

    url, use_ssl = database_url()
    connection = await asyncpg.connect(url, ssl=use_ssl)
    try:
        async with connection.transaction():
            if replace:
                await connection.execute("DELETE FROM aqha_standard_classes")
            await connection.executemany(
                """
                INSERT INTO aqha_standard_classes
                    (code, name, division, sort_order, source_year, notes)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (code) DO UPDATE SET
                    name = EXCLUDED.name,
                    division = EXCLUDED.division,
                    sort_order = EXCLUDED.sort_order,
                    source_year = EXCLUDED.source_year,
                    notes = EXCLUDED.notes
                """,
                rows,
            )
    finally:
        await connection.close()


def summarize(rows: list[tuple[str, str, str, int, int | None, str | None]]) -> str:
    divisions: dict[str, int] = {}
    for _, _, division, *_ in rows:
        divisions[division] = divisions.get(division, 0) + 1
    division_summary = ", ".join(f"{division}: {count}" for division, count in sorted(divisions.items()))
    return f"{len(rows)} classes ({division_summary})"


async def main() -> int:
    args = parse_args()
    try:
        rows = read_rows(
            args.csv_path,
            source_year=args.source_year,
            default_division=args.default_division,
        )
        print(f"Validated {summarize(rows)}.")
        if args.dry_run:
            print("Dry run only; no database changes written.")
            return 0
        await import_rows(rows, replace=args.replace)
        action = "Replaced" if args.replace else "Upserted"
        print(f"{action} {summarize(rows)} into aqha_standard_classes.")
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
