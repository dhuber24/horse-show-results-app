"""Reading an uploaded pattern file into the show's patterns (GaitDesk Pro).

Pinned here:

* **Pro and Pro+ only.** Basic keeps the Patterns step's own upload and
  attaches classes by hand; the read is refused at a Basic show.
* **A page at a time.** The file goes to the model cut into labelled pages, so
  the pages a pattern comes back on are pages the file can be cut at, and a
  pattern is saved as only its own pages.
* **The office's choices stand.** A class already attached to a pattern keeps
  it; the read files new patterns and fills the gaps.
* **Nothing is guessed into the show.** A pattern on a page the file doesn't
  have is dropped; a class index the show doesn't have is ignored; a class two
  patterns name stays with the first.
"""
import asyncio
import io
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from extraction import patterns as reader
from routers.show_patterns import plan_read
from show_companies import BASIC, PATTERN_READING, PRO, PRO_PLUS, plan_features


def _pdf(pages: int) -> bytes:
    from pypdf import PdfWriter

    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=612, height=792)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def _pages(pdf: bytes) -> int:
    from pypdf import PdfReader

    return len(PdfReader(io.BytesIO(pdf)).pages)


def _found(name, first, last=None, classes=()):
    return {"name": name, "first_page": first, "last_page": first if last is None else last, "classes": list(classes)}


# ── Who has it ────────────────────────────────────────────────────────────────

def test_reading_patterns_is_pro_and_pro_plus_not_basic():
    assert PATTERN_READING in plan_features(PRO)
    assert PATTERN_READING in plan_features(PRO_PLUS)
    assert PATTERN_READING not in plan_features(BASIC)


def test_the_read_is_gated_on_the_shows_plan():
    """The gate is on the route, so a Basic show's office is refused before a
    token is spent -- the screen only decides what to offer."""
    from routers.show_patterns import router

    route = next(r for r in router.routes if getattr(r, "path", "").endswith("/patterns/read"))
    gates = [d.call for d in route.dependant.dependencies]
    assert any(getattr(g, "__qualname__", "").startswith("require_show_feature") for g in gates)


# ── Cleaning what the model said ──────────────────────────────────────────────

def test_a_pattern_on_no_page_of_the_file_is_dropped_and_one_running_off_the_end_stops_at_it():
    found = reader.clean_patterns(
        [_found("Trail", 9), _found("Ranch Riding", 3, 7), _found("Showmanship", 0)], class_count=0, page_count=4
    )
    assert [(p["name"], p["first_page"], p["last_page"]) for p in found] == [("Ranch Riding", 3, 4)]


def test_a_class_two_patterns_name_stays_with_the_first_and_an_unknown_one_is_ignored():
    found = reader.clean_patterns(
        [_found("Showmanship (Jr)", 1, classes=[0, 2]), _found("Horsemanship (Jr)", 2, classes=[2, 1, 99, True])],
        class_count=3,
        page_count=2,
    )
    assert [p["classes"] for p in found] == [[0, 2], [1]]


def test_a_name_printed_twice_is_numbered_and_a_blank_one_dropped():
    found = reader.clean_patterns(
        [_found("Trail", 1), _found(" trail ", 2), _found("", 3), _found("Backwards", 3, 2)], 0, 3
    )
    assert [(p["name"], p["last_page"]) for p in found] == [("Trail", 1), ("trail (2)", 2), ("Backwards", 3)]


# ── Cutting the file ──────────────────────────────────────────────────────────

def test_a_pattern_is_saved_as_only_its_own_pages():
    book = _pdf(5)
    assert _pages(reader.pattern_file(book, "application/pdf", 2, 3)) == 2
    # The whole file is kept as uploaded rather than rewritten.
    assert reader.pattern_file(book, "application/pdf", 1, 5) == book
    assert reader.pattern_file(book, "application/pdf", 6, 6) is None
    # An image is one page.
    assert reader.pattern_file(b"\xff\xd8\xff", "image/jpeg", 1, 1) == b"\xff\xd8\xff"
    assert reader.pattern_file(b"\xff\xd8\xff", "image/jpeg", 2, 2) is None


def test_a_pdf_that_will_not_open_is_not_read_a_page_at_a_time():
    assert reader.single_pages(b"%PDF-1.7 not really", "application/pdf") is None
    assert [len(p) > 0 for p in reader.single_pages(_pdf(3), "application/pdf")] == [True] * 3


# ── The model call ────────────────────────────────────────────────────────────

class _FakeStream:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get_final_message(self):
        return self._response


class _FakeClient:
    def __init__(self, answer, stop_reason="end_turn"):
        self.calls = []
        self._answer = answer
        self._stop = stop_reason
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self._stream))

    def _stream(self, **kwargs):
        self.calls.append(kwargs)
        usage = SimpleNamespace(
            input_tokens=100, output_tokens=20, cache_creation_input_tokens=0, cache_read_input_tokens=0
        )
        return _FakeStream(
            SimpleNamespace(
                model=reader.PATTERNS_MODEL,
                stop_reason=self._stop,
                usage=usage,
                content=[SimpleNamespace(type="text", text=json.dumps(self._answer))],
            )
        )


CLASSES = [
    {"class_number": "3", "class_name": "PW Showmanship", "discipline": "Showmanship", "division": "PW"},
    {"class_number": "55", "class_name": "PW Horsemanship", "discipline": "Western Horsemanship", "division": "PW"},
]


def _use(monkeypatch, client):
    monkeypatch.setattr(reader, "_get_client", lambda: client)
    monkeypatch.setattr(reader, "extraction_available", lambda: True)


def test_the_file_is_sent_a_labelled_page_at_a_time_with_the_shows_classes(monkeypatch):
    client = _FakeClient({"patterns": [_found("Showmanship (PW)", 2, classes=[0]), _found("Trail", 7)]})
    _use(monkeypatch, client)

    result = asyncio.run(reader.read_patterns(_pdf(3), "application/pdf", "Patterns.pdf", CLASSES))

    assert result.succeeded, result.error_message
    (call,) = client.calls
    # The show bill reader's model and fallback: both readers move together.
    from extraction.showbill import FALLBACK_MODELS, SHOWBILL_MODEL

    assert call["model"] == SHOWBILL_MODEL
    assert call["fallbacks"] == FALLBACK_MODELS
    assert call["output_config"]["effort"] == "high"
    assert call["output_config"]["format"]["schema"] is reader.PATTERNS_SCHEMA
    content = call["messages"][0]["content"]
    labels = [b["text"] for b in content if b["type"] == "text"]
    assert labels[:3] == [f"'Patterns.pdf' -- page {n} of 3:" for n in (1, 2, 3)]
    assert [b["type"] for b in content].count("document") == 3
    assert "1: #55 PW Horsemanship (Western Horsemanship / PW)" in labels[-1]
    # Page 7 of a 3-page file is nothing to save.
    assert result.fields["patterns"] == [_found("Showmanship (PW)", 2, classes=[0])]
    assert (result.input_tokens, result.output_tokens) == (100, 20)


def test_a_show_with_no_classes_still_has_its_patterns_read(monkeypatch):
    client = _FakeClient({"patterns": [_found("Trail", 1, classes=[0])]})
    _use(monkeypatch, client)

    result = asyncio.run(reader.read_patterns(b"\xff\xd8\xff", "image/jpeg", "trail.jpg", []))

    assert "no classes yet" in client.calls[0]["messages"][0]["content"][-1]["text"]
    assert result.fields["patterns"] == [_found("Trail", 1)]


@pytest.mark.parametrize("stop", ["refusal", "max_tokens"])
def test_a_read_cut_short_is_a_failure_the_office_is_told_about(monkeypatch, stop):
    _use(monkeypatch, _FakeClient({"patterns": []}, stop_reason=stop))
    result = asyncio.run(reader.read_patterns(_pdf(1), "application/pdf", "p.pdf", CLASSES))
    assert not result.succeeded and "one at a time" in result.error_message


def test_a_server_without_a_key_says_so_before_reading(monkeypatch):
    client = _FakeClient({"patterns": []})
    monkeypatch.setattr(reader, "_get_client", lambda: client)
    monkeypatch.setattr(reader, "extraction_available", lambda: False)
    result = asyncio.run(reader.read_patterns(_pdf(1), "application/pdf", "p.pdf", CLASSES))
    assert not result.succeeded and client.calls == []


# ── What the read adds to the show ────────────────────────────────────────────

def test_a_class_the_office_already_attached_keeps_its_pattern():
    a, b, c = uuid4(), uuid4(), uuid4()
    plan, kept = plan_read(
        [_found("Showmanship", 1, classes=[0, 1]), _found("Horsemanship", 2, classes=[2])],
        class_ids=[a, b, c],
        assigned={b},
        names_on_file=set(),
    )
    assert plan == [("Showmanship", 1, 1, [a]), ("Horsemanship", 2, 2, [c])]
    assert kept == 1


def test_a_name_already_on_file_is_numbered_rather_than_refused():
    plan, _kept = plan_read(
        [_found("Trail", 1), _found("Trail", 2)], class_ids=[], assigned=set(), names_on_file={"TRAIL"}
    )
    assert [name for name, *_ in plan] == ["Trail (2)", "Trail (3)"]
