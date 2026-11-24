"""The Adjustments Log report: who added each credit or charge, kept off the bill.

The exhibitor's bill prints an office adjustment as a line of its own, its
reason and amount, and nothing about who added it. That history is here.
"""

from datetime import datetime, timezone

from financial_reports import build_report, list_reports


def an_account(name, back_number, adjustments):
    return {
        "exhibitor_name": name,
        "back_number": back_number,
        "back_numbers": [back_number] if back_number is not None else [],
        "bill": {"adjustment_lines": adjustments},
    }


def an_adjustment(reason, cents, by, day):
    return {
        "id": f"{reason}-{day}",
        "reason": reason,
        "amount_cents": cents,
        "recorded_by_name": by,
        "created_at": datetime(2026, 6, day, 15, 0, tzinfo=timezone.utc),
    }


FIN = {
    "accounts": [
        an_account("Ann Rider", 12, [an_adjustment("Stall cleaning fee", 5000, "Pat Office", 13)]),
        an_account(
            "Bo Rider",
            None,
            [an_adjustment("Moved to a tie stall", -2500, None, 14)],
        ),
        an_account("Cy Rider", 30, []),
    ],
}


def test_it_is_offered_with_the_other_financial_reports():
    assert "adjustments-log" in [r["slug"] for r in list_reports()]


def test_every_adjustment_is_listed_newest_first_with_who_added_it():
    report = build_report("adjustments-log", FIN)
    rows = report["rows"]
    assert [r["exhibitor"] for r in rows] == ["Bo Rider", "Ann Rider"]
    assert rows[0] == {
        "added_on": "2026-06-14",
        "back_number": "—",
        "exhibitor": "Bo Rider",
        "reason": "Moved to a tie stall",
        "kind": "Credit",
        "amount_cents": -2500,
        "added_by": "—",
    }
    assert rows[1]["added_by"] == "Pat Office"
    assert rows[1]["kind"] == "Charge"
    assert rows[1]["back_number"] == 12


def test_the_total_nets_charges_against_credits():
    report = build_report("adjustments-log", FIN)
    assert report["totals"]["amount_cents"] == 2500
    assert "$50.00 charged and $25.00 credited" in report["notes"][0]


def test_a_show_with_no_adjustments_says_so():
    report = build_report("adjustments-log", {"accounts": [an_account("Cy Rider", 30, [])]})
    assert report["rows"] == []
    assert "has not added" in report["notes"][0]
