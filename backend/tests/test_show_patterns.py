"""A show's patterns: what they are called, which classes run them, how they download.

Three rules here fail quietly rather than loudly.

**A class runs one pattern.** Pointing a class at a pattern has to *move* it off
the one it ran -- a class quietly on two patterns would show an exhibitor
whichever one a query happened to return first.

**The list reads like the schedule.** Patterns come back in the order their
first class runs, so "the pattern for class 23" is found where class 23 is.

**A name must survive the download header.** Headers go out as latin-1, and a
pattern called "Trail – Open" written in raw would 500 the one request whose
whole job is to hand somebody the pattern.
"""
from uuid import uuid4

import pytest
from fastapi import HTTPException

from routers.show_patterns import (
    MAX_PATTERN_BYTES,
    content_disposition,
    download_filename,
    name_from_filename,
    name_key,
    normalize_name,
    normalize_notes,
    pattern_sort_key,
    plan_assignment,
    validate_upload,
)

PDF = b"%PDF-1.7\n" + b"\x00" * 16


# ── Names ────────────────────────────────────────────────────────────────────

def test_a_name_is_one_line_single_spaced():
    assert normalize_name("  Showmanship \n Pattern   2 ") == "Showmanship Pattern 2"


@pytest.mark.parametrize("typed", [None, "", "   ", "\n\t"])
def test_nothing_typed_is_no_name_rather_than_a_blank_one(typed):
    assert normalize_name(typed) is None


def test_two_names_differing_only_in_case_and_spacing_are_the_same_pattern():
    """What the migration's unique index compares -- `lower(btrim(name))` -- on
    a name already cleaned. "Trail" and "trail " are one pattern to a reader."""
    assert name_key(normalize_name("Trail  Pattern ")) == name_key(normalize_name("trail pattern"))


@pytest.mark.parametrize(
    "filename,expected",
    [
        ("Showmanship_Pattern-2.pdf", "Showmanship Pattern 2"),
        ("trail.jpg", "trail"),
        ("Western Riding.v2.pdf", "Western Riding.v2"),
        ("C:\\fakepath\\Ranch Riding 4.png", "Ranch Riding 4"),
        ("no-extension", "no extension"),
    ],
)
def test_a_name_is_guessed_from_the_file_when_none_was_sent(filename, expected):
    assert name_from_filename(filename) == expected


@pytest.mark.parametrize("filename", [None, "", ".pdf", "___.pdf"])
def test_a_file_with_nothing_to_guess_from_gives_no_name(filename):
    assert name_from_filename(filename) is None


def test_notes_keep_their_line_breaks_and_lose_their_edges():
    typed = "\r\n  Walk-trot: trot where the pattern lopes.\r\nYouth 5-10: no backup.  \n"
    assert normalize_notes(typed) == (
        "Walk-trot: trot where the pattern lopes.\nYouth 5-10: no backup."
    )
    assert normalize_notes("   ") is None


# ── Files ────────────────────────────────────────────────────────────────────

def test_a_pdf_is_accepted_and_its_type_read_off_the_bytes():
    assert validate_upload(PDF) == "application/pdf"


def test_a_phone_photo_of_a_hand_drawn_pattern_is_accepted():
    assert validate_upload(b"\xff\xd8\xff\xe0" + b"\x00" * 16) == "image/jpeg"


@pytest.mark.parametrize(
    "content",
    [
        b"",
        b"PK\x03\x04" + b"\x00" * 16,  # a .docx, or a renamed anything
        b"%PDF" + b"\x00" * MAX_PATTERN_BYTES,  # one byte over the limit
    ],
)
def test_empty_unknown_and_oversized_files_are_refused(content):
    with pytest.raises(HTTPException) as refused:
        validate_upload(content)
    assert refused.value.status_code == 400


def test_a_download_is_named_for_the_pattern_not_the_camera_roll():
    assert download_filename("Trail Pattern", "image/jpeg") == "Trail Pattern.jpg"
    assert download_filename("Horsemanship 3", "application/pdf") == "Horsemanship 3.pdf"


def test_a_name_outside_latin_1_still_makes_a_header_that_can_be_sent():
    header = content_disposition("inline", "Trail \u2013 Open.pdf")
    header.encode("latin-1")  # what Starlette does with it; must not raise
    assert 'filename="Trail  Open.pdf"' in header
    assert "filename*=UTF-8''Trail%20%E2%80%93%20Open.pdf" in header


def test_a_quote_in_a_name_cannot_close_the_header_early():
    header = content_disposition("attachment", 'The "Big" Pattern.pdf')
    assert header.startswith('attachment; filename="The _Big_ Pattern.pdf"')


# ── Which pattern a class runs ───────────────────────────────────────────────

def test_pointing_a_class_with_no_pattern_at_one_adds_it():
    pattern, c1 = uuid4(), uuid4()
    assert plan_assignment({c1}, pattern, {}) == (set(), {c1})


def test_pointing_a_class_at_another_pattern_moves_it_rather_than_doubling_it():
    """A class runs one pattern: its old row goes and a new one is written."""
    old, new, c1 = uuid4(), uuid4(), uuid4()
    assert plan_assignment({c1}, new, {c1: old}) == ({c1}, {c1})


def test_no_pattern_clears_the_classes_that_had_one_and_nothing_else():
    old, c1, c2 = uuid4(), uuid4(), uuid4()
    assert plan_assignment({c1, c2}, None, {c1: old}) == ({c1}, set())


def test_a_class_already_on_that_pattern_is_left_alone():
    """A discipline-wide "set all" usually repeats most of its rows, and
    rewriting them would re-date `assigned_at` for classes nobody changed."""
    pattern, other = uuid4(), uuid4()
    same, moved, fresh = uuid4(), uuid4(), uuid4()
    clear, add = plan_assignment({same, moved, fresh}, pattern, {same: pattern, moved: other})
    assert clear == {moved}
    assert add == {moved, fresh}


# ── The order a reader gets them in ──────────────────────────────────────────

def test_patterns_read_in_the_order_their_first_class_runs():
    rows = [("Trail", 7), ("Showmanship", 0), ("Horsemanship", 3)]
    ordered = sorted(rows, key=lambda r: pattern_sort_key(*r))
    assert [name for name, _ in ordered] == ["Showmanship", "Horsemanship", "Trail"]


def test_a_pattern_running_no_class_yet_goes_last_alphabetically():
    rows = [("zebra", None), ("Western Riding", 12), ("Alpha", None)]
    ordered = sorted(rows, key=lambda r: pattern_sort_key(*r))
    assert [name for name, _ in ordered] == ["Western Riding", "Alpha", "zebra"]
