"""Photos of the judge's card: who sees them, and what is taken.

Two rules here fail quietly rather than loudly.

**The card is the placings.** A photo the public could open before the class is
posted would post the class before the scribe did -- every score and every
placing is on it. So the public sees nothing until `results_published_at`, and
show staff see everything, the rule the results list keeps.

**A card is shown, not downloaded.** The class page puts the photo where the
results are read, so a PDF -- which a pattern may be -- is refused here rather
than appearing as a broken image at the rail.
"""
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from routers.card_photos import (
    MAX_PHOTO_BYTES,
    photo_filename,
    validate_photo,
    visible_to,
)

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 16
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 8
PDF = b"%PDF-1.7\n" + b"\x00" * 16

POSTED = datetime(2026, 9, 21, 14, 14, tzinfo=timezone.utc)


# ── Who sees them ────────────────────────────────────────────────────────────

def test_the_public_sees_no_card_before_the_class_is_posted():
    assert visible_to(is_staff=False, results_published_at=None) is False


def test_the_public_sees_the_cards_once_the_class_is_posted():
    assert visible_to(is_staff=False, results_published_at=POSTED) is True


def test_show_staff_see_the_cards_before_they_are_posted():
    """The scribe checks the photo came out before posting the class."""
    assert visible_to(is_staff=True, results_published_at=None) is True


# ── What is taken ────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "content,mime",
    [(JPEG, "image/jpeg"), (PNG, "image/png"), (WEBP, "image/webp")],
)
def test_a_photo_is_taken_and_its_type_read_off_the_bytes(content, mime):
    assert validate_photo(content) == mime


def test_a_pdf_is_refused_because_the_card_is_shown_in_the_page():
    with pytest.raises(HTTPException) as refused:
        validate_photo(PDF)
    assert refused.value.status_code == 400
    assert "photo" in refused.value.detail


@pytest.mark.parametrize(
    "content",
    [b"", b"not an image at all", JPEG[:3] + b"\x00" * (MAX_PHOTO_BYTES + 1)],
)
def test_empty_unknown_and_oversized_files_are_refused(content):
    with pytest.raises(HTTPException) as refused:
        validate_photo(content)
    assert refused.value.status_code == 400


def test_a_photo_at_the_limit_is_taken():
    assert validate_photo(JPEG[:3] + b"\x00" * (MAX_PHOTO_BYTES - 3)) == "image/jpeg"


# ── What it is called ────────────────────────────────────────────────────────

def test_a_saved_card_is_named_for_its_class_not_the_camera_roll():
    assert photo_filename("23", "image/jpeg") == "Class 23 judge's card.jpg"


def test_a_class_with_no_number_still_names_its_card():
    assert photo_filename(None, "image/png") == "Judge's card.png"
