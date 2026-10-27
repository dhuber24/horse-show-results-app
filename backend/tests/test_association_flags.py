"""Association rules flag an entry; they do not refuse it (2026-10-27).

Which registrations and rules a show holds its exhibitors to is the show
company's call, so both entry doors save an entry the APHA or AQHA rules would
turn away and hand the issues back on `EntryOut.association_warnings`. The one
thing still refused is a value the database cannot store.
"""
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from rules import REFUSING_CODES, refusing_issues
from schemas import EntryOut


def issue(code, severity="error"):
    return {"severity": severity, "code": code, "message": f"{code} happened."}


def test_an_association_error_does_not_refuse_the_entry():
    issues = [
        issue("APHA_HORSE_TOO_YOUNG"),
        issue("APHA_YOUTH_TOO_OLD"),
        issue("APHA_HORSE_LIMIT_EXCEEDED"),
        issue("APHA_RELATIONSHIP_REQUIRED"),
        issue("APHA_NOVICE_ELIGIBILITY_REQUIRED"),
        issue("AQHA_HORSE_REGISTRATION_REQUIRED"),
        issue("AQHA_EXHIBITOR_MEMBERSHIP_REQUIRED"),
        issue("AQHA_YOUTH_AGE"),
    ]
    assert refusing_issues(issues) == []


def test_a_division_the_database_cannot_store_is_still_refused():
    refused = refusing_issues([issue("APHA_HORSE_TOO_YOUNG"), issue("APHA_DIVISION_UNKNOWN")])
    assert [i["code"] for i in refused] == ["APHA_DIVISION_UNKNOWN"]


def test_every_refusing_code_is_one_the_rules_actually_raise():
    # A typo here would quietly let a malformed value through to the CHECK.
    source = "".join(p.read_text() for p in Path(__file__).parent.parent.joinpath("rules").glob("*.py"))
    for code in REFUSING_CODES:
        assert f'"{code}"' in source, code


def an_entry(**over):
    return SimpleNamespace(
        id=uuid4(),
        class_id=uuid4(),
        exhibitor_id=uuid4(),
        horse_id=uuid4(),
        back_number=12,
        status="ENTERED",
        apha_division="YOUTH",
        relationship_to_owner="Self",
        attestations=[],
        is_disqualified=False,
        gate_order=None,
        gate_checked_in=False,
        gate_no_show=False,
        created_at=datetime(2026, 6, 12, tzinfo=timezone.utc),
        **over,
    )


def test_a_saved_entry_carries_its_warnings_back():
    out = EntryOut.model_validate(an_entry(association_warnings=[issue("APHA_YOUTH_TOO_OLD")]))
    assert [w.code for w in out.association_warnings] == ["APHA_YOUTH_TOO_OLD"]
    assert out.association_warnings[0].severity == "error"


def test_an_entry_read_back_later_has_no_warnings():
    assert EntryOut.model_validate(an_entry()).association_warnings == []
