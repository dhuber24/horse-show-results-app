"""Whether a horse's paperwork carries it through the show.

These rules decide who the show office telephones. Getting them wrong in one
direction chases an exhibitor for a document they already filed; in the other it
quietly clears a horse whose Coggins lapsed. Both are worse than the flag not
existing, because staff learn to stop reading a panel that cries wolf.

Only the pure half of `routers/horse_documents.py` is exercised here — the two
`load_*` helpers are database reads and are out of scope for this suite.
"""
from datetime import date

import pytest

from routers.horse_documents import (
    HEALTH_EXPIRED,
    HEALTH_MISSING,
    HEALTH_UNDATED,
    HEALTH_VALID,
    attested_health,
    document_health,
    effective_expiry,
    health_requirements,
    health_snapshot,
    health_status,
    latest_expiry,
    requirement_for,
)
from tests.factories import make_show

SHOW_END = date(2026, 6, 3)


# ── What a show asks for ──────────────────────────────────────────────────────


def test_coggins_carries_no_validity_window():
    """How long a negative test stays good is a state rule — twelve months in
    most, six in some — and the app does not know which state the horse is
    standing in. So a Coggins must carry its own printed expiry."""
    assert requirement_for(make_show(), "COGGINS").valid_days is None


def test_cvi_and_vaccination_windows_come_from_the_show():
    show = make_show(health_certificate_valid_days=14, vaccination_valid_days=180)

    assert requirement_for(show, "HEALTH_CERTIFICATE").valid_days == 14
    assert requirement_for(show, "VACCINATION").valid_days == 180


def test_a_show_predating_the_policy_columns_falls_back_to_the_defaults():
    """Migration 097 added the columns; older rows have to keep working."""
    bare = make_show()
    del bare.health_certificate_valid_days
    del bare.vaccination_valid_days

    assert requirement_for(bare, "HEALTH_CERTIFICATE").valid_days == 30
    assert requirement_for(bare, "VACCINATION").valid_days == 365


def test_vaccination_notes_ride_along_only_on_the_vaccination_requirement():
    show = make_show(vaccination_notes="Rhino/Flu within 6 months")

    assert requirement_for(show, "VACCINATION").notes == "Rhino/Flu within 6 months"
    assert requirement_for(show, "HEALTH_CERTIFICATE").notes is None
    assert requirement_for(show, "COGGINS").notes is None


def test_coggins_is_required_by_default_and_the_others_are_not():
    """Coggins is universal; a CVI follows from crossing a state line and
    vaccination rules come from the venue. A flat "no CVI on file" flag would
    light up every in-state horse at every show."""
    codes = [r.document_type for r in health_requirements(make_show())]
    assert codes == ["COGGINS"]


def test_a_show_can_ask_for_all_three_in_a_fixed_order():
    show = make_show(requires_health_certificate=True, requires_vaccination=True)

    codes = [r.document_type for r in health_requirements(show)]

    assert codes == ["COGGINS", "HEALTH_CERTIFICATE", "VACCINATION"]


def test_a_show_can_waive_coggins():
    show = make_show(requires_coggins=False, requires_vaccination=True)
    assert [r.document_type for r in health_requirements(show)] == ["VACCINATION"]


def test_requirement_for_answers_about_a_document_the_show_does_not_require():
    """Separate from `health_requirements` on purpose: the office can sign off
    on a paper the show never asked for, and the validity window still has to
    come from the show."""
    show = make_show(requires_health_certificate=False, health_certificate_valid_days=21)
    assert requirement_for(show, "HEALTH_CERTIFICATE").valid_days == 21


# ── When a document stops covering the horse ──────────────────────────────────


def test_a_printed_expiry_always_wins():
    """Even over a computed one, and even when the two disagree."""
    assert effective_expiry(date(2026, 1, 1), date(2026, 9, 1), valid_days=30) == date(2026, 9, 1)


def test_an_undated_document_is_counted_from_its_issue_date():
    """A CVI is written as "issued within 30 days", not "expires on"."""
    assert effective_expiry(date(2026, 5, 20), None, valid_days=30) == date(2026, 6, 19)


def test_effective_expiry_gives_up_when_it_cannot_say():
    assert effective_expiry(None, None, valid_days=30) is None
    assert effective_expiry(date(2026, 5, 20), None, valid_days=None) is None, "the Coggins case"
    assert effective_expiry(None, None, valid_days=None) is None


# ── The standing itself ───────────────────────────────────────────────────────


def test_nothing_on_file_is_missing():
    assert health_status([], SHOW_END) == HEALTH_MISSING


def test_a_document_covering_the_show_is_valid():
    assert health_status([date(2026, 12, 31)], SHOW_END) == HEALTH_VALID


def test_a_document_expiring_on_the_last_day_of_the_show_still_counts():
    assert health_status([SHOW_END], SHOW_END) == HEALTH_VALID


def test_status_is_judged_as_of_the_date_passed_not_today():
    """The whole point. A Coggins that lapses between now and the show is the
    exact case staff need to chase — evaluating against today would call it
    valid until it was too late."""
    lapses_before_the_show = date(2026, 5, 20)

    assert health_status([lapses_before_the_show], SHOW_END) == HEALTH_EXPIRED
    assert health_status([lapses_before_the_show], date(2026, 5, 1)) == HEALTH_VALID


def test_an_undated_row_reports_undated_rather_than_expired():
    """It names the fixable data problem. "Expired" would send the exhibitor
    after a new test they may not actually need."""
    assert health_status([None], SHOW_END) == HEALTH_UNDATED
    assert health_status([None, date(2020, 1, 1)], SHOW_END) == HEALTH_UNDATED


def test_one_current_document_is_enough_even_beside_a_lapsed_one():
    assert health_status([date(2020, 1, 1), date(2026, 12, 31)], SHOW_END) == HEALTH_VALID


def test_latest_expiry_names_the_furthest_out_date():
    assert latest_expiry([date(2026, 1, 1), date(2027, 5, 3), None]) == date(2027, 5, 3)
    assert latest_expiry([None, None]) is None
    assert latest_expiry([]) is None


# ── One horse, one document, in the shape every screen renders ────────────────


def test_document_health_snapshots_what_the_file_says():
    check = document_health(requirement_for(make_show(), "COGGINS"), [(None, date(2027, 5, 3))], SHOW_END)

    assert check["code"] == "COGGINS"
    assert check["status"] == HEALTH_VALID
    assert check["expiry_date"] == date(2027, 5, 3)
    assert check["file_snapshot"] == "valid:2027-05-03"
    assert check["attested"] is False


def test_document_health_with_nothing_on_file_snapshots_the_absence():
    """`missing:none` is a perfectly good thing for the office to attest to —
    an exhibitor handing over a paper the app has never seen is the ordinary
    case at a horse show."""
    check = document_health(requirement_for(make_show(), "COGGINS"), [], SHOW_END)

    assert check["status"] == HEALTH_MISSING
    assert check["file_snapshot"] == "missing:none"


def test_document_health_carries_the_message_for_its_own_document_type():
    show = make_show()
    coggins = document_health(requirement_for(show, "COGGINS"), [], SHOW_END)
    vaccination = document_health(requirement_for(show, "VACCINATION"), [], SHOW_END)

    assert coggins["message"] != vaccination["message"]
    assert "Coggins" in coggins["message"]


# ── The office's own inspection, folded in ────────────────────────────────────


def _missing_coggins() -> dict:
    return document_health(requirement_for(make_show(), "COGGINS"), [], SHOW_END)


def test_an_inspection_with_no_date_leaves_the_horse_flagged():
    """"I looked at this" and "this is valid" are different claims. One click
    clearing a flag on a test that expired in 2019 is exactly what the sign-off
    exists to prevent, run backwards."""
    check = attested_health(_missing_coggins(), attested_expiry=None, as_of=SHOW_END)

    assert check["status"] == HEALTH_MISSING
    assert check["attested"] is False


def test_an_inspection_of_a_lapsed_paper_leaves_the_horse_flagged():
    check = attested_health(_missing_coggins(), attested_expiry=date(2026, 5, 1), as_of=SHOW_END)

    assert check["status"] == HEALTH_MISSING


def test_an_inspection_covering_the_show_clears_the_flag():
    check = attested_health(_missing_coggins(), attested_expiry=date(2027, 5, 3), as_of=SHOW_END)

    assert check["status"] == HEALTH_VALID
    assert check["expiry_date"] == date(2027, 5, 3)
    assert check["attested"] is True, "the app is not holding this document, and must say so"
    assert "show office" in check["message"]


def test_an_inspection_dated_the_last_day_of_the_show_clears_the_flag():
    check = attested_health(_missing_coggins(), attested_expiry=SHOW_END, as_of=SHOW_END)
    assert check["status"] == HEALTH_VALID


def test_an_already_valid_check_is_returned_untouched():
    """The overlay only ever applies where the file falls short."""
    on_file = document_health(
        requirement_for(make_show(), "COGGINS"), [(None, date(2027, 5, 3))], SHOW_END
    )

    assert attested_health(on_file, date(2030, 1, 1), SHOW_END) is on_file


def test_the_attestation_never_reaches_the_snapshot():
    """`file_snapshot` is the standing derived from the documents alone.
    Snapshotting the overlaid value would have the sign-off recording its own
    effect, and the check would read back stale the instant it was written —
    staleness has to keep meaning "the file changed under me".
    """
    cleared = attested_health(_missing_coggins(), date(2027, 5, 3), SHOW_END)

    assert cleared["status"] == HEALTH_VALID
    assert cleared["file_snapshot"] == "missing:none"
    assert health_snapshot(cleared) == "missing:none"


def test_health_snapshot_falls_back_when_no_file_snapshot_was_carried():
    assert health_snapshot({"status": "valid", "expiry_date": date(2027, 5, 3)}) == "valid:2027-05-03"
    assert health_snapshot({"status": "missing", "expiry_date": None}) == "missing:none"


@pytest.mark.parametrize("document_type", ["COGGINS", "HEALTH_CERTIFICATE", "VACCINATION"])
def test_every_document_type_has_attested_wording(document_type):
    show = make_show(requires_health_certificate=True, requires_vaccination=True)
    check = document_health(requirement_for(show, document_type), [], SHOW_END)

    cleared = attested_health(check, date(2027, 5, 3), SHOW_END)

    assert cleared["status"] == HEALTH_VALID
    assert cleared["message"] != check["message"]
