"""Reading an association's class list off the file they publish.

The whole feature turns on this parser being right. A misread name goes into
the catalog, onto a class picker, and out on a show program under an
association's own class code — and unlike a scan of one horse's Coggins,
one bad read here is wrong for every show that uses that code.

The cases below are all taken from the real APHA and AQHA listings, including
the ones that broke the first attempt.
"""
import pytest

from imports.class_codes import (
    ParseError,
    duplicate_codes,
    parse_apha_lines,
    parse_aqha_lines,
    parse_csv,
    parse_upload,
)


def codes(result):
    return [c.code for c in result.classes]


def by_code(result):
    return {c.code: c for c in result.classes}


# ── APHA ─────────────────────────────────────────────────────────────────────

def test_apha_reads_code_and_name_under_a_division_heading():
    result = parse_apha_lines([
        "Open Division",
        "HS1 Weanling Stallions",
        "HS2 Yearling Stallions",
    ])
    assert codes(result) == ["HS1", "HS2"]
    assert by_code(result)["HS1"].name == "Weanling Stallions"
    assert by_code(result)["HS1"].division == "Open"


def test_apha_amateur_names_keep_their_leading_a():
    """"AGCS A Grand Champion Stallion" is a code and a name that starts "A ".

    Reading the code with a regex that allows trailing characters after an
    optional space swallows that "A" into the code — silently renaming every
    amateur class in the file and inventing 300 codes nobody has.
    """
    result = parse_apha_lines([
        "Amateur Division",
        "AGCS A Grand Champion Stallion",
        "ARCM A Reserve Champion Mare",
    ])
    assert codes(result) == ["AGCS", "ARCM"]
    assert by_code(result)["AGCS"].name == "A Grand Champion Stallion"


def test_apha_joins_a_code_printed_with_an_internal_space():
    """APHA prints a handful as "AM 40" rather than "AM40"."""
    result = parse_apha_lines([
        "Amateur Division",
        "AM 40 A Yearling & 2-Yr-Old Mares",
    ])
    assert codes(result) == ["AM40"]
    assert by_code(result)["AM40"].name == "A Yearling & 2-Yr-Old Mares"


def test_apha_rejoins_a_name_that_wrapped_onto_a_second_line():
    result = parse_apha_lines([
        "Open Division",
        "WCH4  Jr Hackamore/Snaffle Bit  ",
        "Working Cow Horse",
        "WHU1 Working Hunter All Ages",
    ])
    assert by_code(result)["WCH4"].name == "Jr Hackamore/Snaffle Bit Working Cow Horse"
    assert by_code(result)["WHU1"].name == "Working Hunter All Ages"


def test_apha_undoes_the_kerning_split_in_youth():
    """pypdf renders APHA's "Youth Division" heading as "Y outh Division"."""
    result = parse_apha_lines([
        "Y outh Division",
        "YSH1 Y Showmanship 18 & Under",
    ])
    assert by_code(result)["YSH1"].division == "Youth"


def test_apha_ranch_horse_keeps_its_sub_divisions_apart():
    result = parse_apha_lines([
        "Ranch Horse Classes",
        "Open",
        "RHC Ranch Horse Conformation",
        "Youth",
        "YRHC Y Ranch Horse Conformation",
    ])
    assert by_code(result)["RHC"].division == "Ranch Horse - Open"
    assert by_code(result)["YRHC"].division == "Ranch Horse - Youth"


def test_apha_mounted_shooting_files_every_sub_division_under_one_name():
    """The catalog keeps Ranch Horse split and Mounted Shooting flat.

    Not a tidiness choice — it is how the existing 634 rows are filed, and a
    reader that disagreed would report the whole section as renamed.
    """
    result = parse_apha_lines([
        "Mounted Shooting",
        "Open Division",
        "MSO  Open Mounted Shooting",
        "Amateur Division",
        "MSA1  Amateur Mounted Shooting All Ages",
    ])
    assert {c.division for c in result.classes} == {"Mounted Shooting"}
    assert codes(result) == ["MSO", "MSA1"]


def test_apha_skips_the_rules_paragraphs():
    """A prose block must not be glued onto the previous class's name."""
    result = parse_apha_lines([
        "Open Division",
        "HS1 Weanling Stallions",
        "Mounted Shooting",
        "Mounted Shooting is allowed only as a special",
        "event and must be held at existing events hosted",
        "Open Division",
        "MSO Open Mounted Shooting",
    ])
    assert by_code(result)["HS1"].name == "Weanling Stallions"
    assert codes(result) == ["HS1", "MSO"]
    assert result.skipped == []


def test_apha_drops_page_furniture():
    result = parse_apha_lines([
        "1",
        "Open Division",
        "HS1 Weanling Stallions",
        "2026 APPROVED CLASS CODES  ",
    ])
    assert codes(result) == ["HS1"]
    assert result.skipped == []


def test_apha_sort_order_restarts_per_division():
    result = parse_apha_lines([
        "Open Division",
        "HS1 Weanling Stallions",
        "HS2 Yearling Stallions",
        "Amateur Division",
        "AGCS A Grand Champion Stallion",
    ])
    assert [c.sort_order for c in result.classes] == [1, 2, 1]


def test_apha_refuses_a_file_with_no_classes_in_it():
    with pytest.raises(ParseError):
        parse_apha_lines(["Some other document entirely.", "Page 1 of 4"])


# ── AQHA ─────────────────────────────────────────────────────────────────────

def test_aqha_reads_the_division_off_every_line():
    result = parse_aqha_lines([
        "Division Show Class Code Show Class Name",
        "Open 101000 GRAND CHAMPION STALLIONS",
        "Youth 401200 GRAND CHAMPION MARES",
    ])
    assert codes(result) == ["101000", "401200"]
    assert by_code(result)["401200"].division == "Youth"
    assert by_code(result)["401200"].name == "GRAND CHAMPION MARES"


def test_aqha_reports_lines_it_cannot_place_rather_than_dropping_them():
    result = parse_aqha_lines([
        "Open 101000 GRAND CHAMPION STALLIONS",
        "a line with no class code on it",
    ])
    assert codes(result) == ["101000"]
    assert result.skipped == ["a line with no class code on it"]


# ── CSV ──────────────────────────────────────────────────────────────────────

def test_csv_accepts_the_associations_own_column_names():
    data = b"Class Code,Class Description,Division\nWP1,Western Pleasure,Open\n"
    result = parse_csv(data)
    assert codes(result) == ["WP1"]
    assert by_code(result)["WP1"].name == "Western Pleasure"
    assert by_code(result)["WP1"].division == "Open"


def test_csv_without_a_code_or_name_column_is_refused():
    with pytest.raises(ParseError):
        parse_csv(b"something,else\n1,2\n")


def test_csv_row_missing_half_its_key_is_warned_about_not_guessed_at():
    data = b"code,name,division\nWP1,Western Pleasure,Open\n,Orphan Name,Open\n"
    result = parse_csv(data)
    assert codes(result) == ["WP1"]
    assert len(result.warnings) == 1


def test_csv_numbers_the_rows_when_the_file_does_not():
    data = b"code,name,division\nA,One,Open\nB,Two,Open\nC,Three,Youth\n"
    result = parse_csv(data)
    assert [c.sort_order for c in result.classes] == [1, 2, 1]


# ── dispatch and validation ──────────────────────────────────────────────────

def test_a_pdf_for_an_association_with_no_reader_says_to_send_a_csv():
    with pytest.raises(ParseError, match="CSV"):
        parse_upload("classes.pdf", b"%PDF-1.4 whatever", "ApHC")


def test_an_unknown_file_type_is_refused():
    with pytest.raises(ParseError):
        parse_upload("classes.docx", b"PK\x03\x04", "APHA")


def test_an_empty_upload_is_refused():
    with pytest.raises(ParseError):
        parse_upload("classes.csv", b"", "APHA")


def test_duplicate_codes_are_reported_so_the_import_can_refuse_them():
    result = parse_csv(b"code,name,division\nWP1,One,Open\nWP1,Two,Youth\n")
    assert duplicate_codes(result.classes) == ["WP1"]
    assert duplicate_codes(parse_csv(b"code,name\nWP1,One\n").classes) == []
