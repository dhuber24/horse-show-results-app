"""Which show bill a reader is handed, and what a file is allowed to be.

Two rules worth pinning down, both of which fail quietly rather than loudly.

**The choice and the file are separate facts.** `shows.showbill_source` says
which bill the show asked to publish; the SHOWBILL row in `show_documents` says
whether there is one. A page that read the column alone would render an empty
frame for a show pointed at a file that is not on record — no error, no message,
just a blank where the prize list should be. `_showbill_payload` is where the
two are resolved into the `effective_source` every renderer reads.

**A file's type comes from its bytes, never from the client.** These bytes are
served straight back to anonymous readers, so the browser's claim about what it
uploaded has no standing.
"""
from types import SimpleNamespace

import pytest

from routers.show_documents import _detect_mime, _showbill_payload


def make_show(source: str) -> SimpleNamespace:
    return SimpleNamespace(showbill_source=source)


DOCUMENT = {
    "id": "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
    "document_type": "SHOWBILL",
    "original_filename": "2026-spring-classic-show-bill.pdf",
    "mime_type": "application/pdf",
    "file_size": 481_233,
    "created_at": "2026-02-14T10:00:00+00:00",
}


# ── Which bill a reader actually gets ────────────────────────────────────────

def test_a_show_that_asked_for_the_generated_bill_gets_it():
    payload = _showbill_payload(make_show("generated"), None)
    assert payload["effective_source"] == "generated"
    assert payload["document"] is None


def test_a_show_with_a_file_and_the_choice_to_match_gets_the_uploaded_bill():
    payload = _showbill_payload(make_show("uploaded"), DOCUMENT)
    assert payload["effective_source"] == "uploaded"
    assert payload["document"]["original_filename"].endswith(".pdf")


def test_a_choice_with_no_file_behind_it_falls_back_rather_than_rendering_nothing():
    """The state the pair rule exists to prevent, resolved rather than trusted.

    `PUT /showbill-source` refuses to create it and `DELETE /showbill-document`
    resets the column, so it should not arise — but the one outcome a show bill
    must never have is being blank, and a renderer reading `source` would give
    exactly that.
    """
    payload = _showbill_payload(make_show("uploaded"), None)
    assert payload["source"] == "uploaded"
    assert payload["effective_source"] == "generated"


def test_a_file_on_record_the_show_has_not_published_stays_unpublished():
    """Uploading is not the same press as choosing.

    A manager comparing their club's PDF against the generated bill must be able
    to put it on file and look at it without every exhibitor's Show Bill button
    changing underneath them.
    """
    payload = _showbill_payload(make_show("generated"), DOCUMENT)
    assert payload["effective_source"] == "generated"
    assert payload["document"] is not None


# ── What a show bill is allowed to be ────────────────────────────────────────

@pytest.mark.parametrize(
    "magic,expected",
    [
        (b"%PDF-1.7\n", "application/pdf"),
        (b"\xff\xd8\xff\xe0" + b"\x00" * 8, "image/jpeg"),
        (b"\x89PNG\r\n\x1a\n" + b"\x00" * 8, "image/png"),
        (b"RIFF\x00\x00\x00\x00WEBPVP8 ", "image/webp"),
    ],
)
def test_the_type_is_read_off_the_magic_bytes(magic, expected):
    assert _detect_mime(magic) == expected


def test_anything_else_is_refused():
    # A ZIP, which is what a .docx is -- and what a renamed executable is too.
    assert _detect_mime(b"PK\x03\x04" + b"\x00" * 8) is None
    assert _detect_mime(b"") is None
