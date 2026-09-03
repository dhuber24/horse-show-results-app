"""The reporting module behind the Financials screen.

A report here is data, not a page: a slug, a title, a column list, and rows of
cells. One frontend renderer draws all of them, so adding a report is a function
in `_REPORTS` below and nothing else — no migration, no route, no component.
That is the whole point of the registry, since which reports a show office
actually wants is not something anyone knows up front.

Every report is built from the payload `routers/show_financials.py` has already
assembled, and none of them query. Two consequences worth keeping: a report can
never disagree with the overview it was opened from, and the money in it came
from `billing.build_bill` like everything else.

Money travels as integer cents in the rows and is formatted by the renderer, so
a new report gets consistent currency formatting for free. Columns flagged
`is_money` are what tell it which those are.
"""
from __future__ import annotations

from typing import Callable, Optional

# ── Column helpers ─────────────────────────────────────────────────────────────


def _col(key: str, label: str, *, money: bool = False, right: bool = False) -> dict:
    return {
        "key": key,
        "label": label,
        "align": "right" if (money or right) else "left",
        "is_money": money,
    }


def _account_label(account: dict) -> str:
    return account["exhibitor_name"] or "(unnamed)"


def _money(cents: int) -> str:
    """Dollars for prose. Row cells stay as cents and are formatted by the
    renderer; only the note text needs this."""
    return f"-${abs(cents) / 100:,.2f}" if cents < 0 else f"${cents / 100:,.2f}"


# How a unit reads in a report cell. `code.replace("_", " ")` was fine while
# every unit was two words; `per_judge_per_horse` is not, and "per judge per
# horse" is exactly the ambiguity migration 112 split the unit to remove.
UNIT_LABEL = {
    "per_exhibitor": "per exhibitor",
    "per_horse": "per horse",
    "per_judge_per_horse": "per judge, per horse",
    "per_judge_per_exhibitor": "per judge, per exhibitor",
    "per_stall": "per stall",
    "per_bag": "per bag",
    "per_night": "per night",
    "per_day": "per day",
    "per_show": "per show",
    "per_entry": "per entry",
    "per_class_per_horse": "per class, per horse",
    "percent_of_entry": "% of entry",
    "flat": "flat",
}


def _unit_label(unit: str) -> str:
    return UNIT_LABEL.get(unit, unit.replace("_", " "))


def _sorted_by_back_number(accounts: list[dict]) -> list[dict]:
    """Back number order, with the not-yet-assigned last.

    The office works off the back number list, so that is the order every
    per-exhibitor report comes out in.
    """
    return sorted(
        accounts,
        key=lambda a: (
            a["back_number"] is None,
            a["back_number"] or 0,
            _account_label(a).lower(),
        ),
    )


# ── Reports ────────────────────────────────────────────────────────────────────


def _revenue_summary(fin: dict) -> dict:
    """Where the show's billed money comes from."""
    totals = fin["totals"]
    billed = totals["billed_cents"]

    rows: list[dict] = []

    def add(category: str, cents: int, detail: str = "") -> None:
        # A category the show does not use is left out rather than shown as a
        # row of zeroes — an OPEN show has no sanction fees and the sheet should
        # not imply it forgot to charge them.
        if cents == 0:
            return
        rows.append({
            "category": category,
            "detail": detail,
            "amount_cents": cents,
            "share": f"{(cents / billed * 100):.1f}%" if billed else "—",
        })

    add("Class entry fees", totals["class_fee_total_cents"])
    add(
        "Club sanction fees",
        totals["sanction_total_cents"],
        "Per-class fee for each club sanctioning the class entered",
    )
    # The show's own automatic charges, each on its own row — the office charge
    # among them since migration 132 made it an ordinary fee row rather than a
    # column, so it no longer needs a line of its own above this loop. Folding
    # them into one "other fees" line would hide the thing the office opens this
    # report to find out — which charge the money came from.
    for charge in totals.get("charge_lines", []):
        add(
            charge["label"],
            charge["line_total_cents"],
            f"{_money(charge['amount_cents'])} {_unit_label(charge['unit'])}",
        )
    for fee in totals["fee_lines"]:
        add(fee["label"], fee["line_total_cents"], f"{fee['quantity']} × {_unit_label(fee['unit'])}")

    notes = [
        "Amounts are what the show has billed. Payments are recorded against an "
        "exhibitor's account rather than against individual charges, so what has "
        "been collected cannot be split by category — see the Payments Received "
        "report for that.",
    ]
    if fin["side_pot_buy_ins_cents"]:
        notes.append(
            "Side pot buy-ins are not included here. They are not part of an "
            "exhibitor's show bill and are reported separately."
        )

    return {
        "columns": [
            _col("category", "Category"),
            _col("detail", "Basis"),
            _col("amount_cents", "Billed", money=True),
            _col("share", "Share", right=True),
        ],
        "rows": rows,
        "totals": {"category": "Total billed", "amount_cents": billed},
        "notes": notes,
    }


def _outstanding_balances(fin: dict) -> dict:
    """Who still owes the show money, worst first."""
    owing = [a for a in fin["accounts"] if a["balance_cents"] > 0]
    owing.sort(key=lambda a: (-a["balance_cents"], _account_label(a).lower()))

    rows = [
        {
            "back_number": a["back_number"] if a["back_number"] is not None else "—",
            "exhibitor": _account_label(a),
            "entries": a["entry_count"],
            "billed_cents": a["bill"]["total_cents"],
            "paid_cents": a["net_paid_cents"],
            "balance_cents": a["balance_cents"],
            "status": "Nothing paid" if a["net_paid_cents"] == 0 else "Part paid",
        }
        for a in owing
    ]

    notes = []
    credit = fin["totals"]["credit_cents"]
    if credit:
        overpaid = sum(1 for a in fin["accounts"] if a["balance_cents"] < 0)
        notes.append(
            f"Separately, {overpaid} account(s) have overpaid by {_money(credit)} in total. "
            "That is deliberately not netted off the outstanding figure above — one "
            "exhibitor paying twice does not reduce what anyone else owes."
        )
    if not rows:
        notes.append("Every account at this show is settled.")

    return {
        "columns": [
            _col("back_number", "Back #", right=True),
            _col("exhibitor", "Exhibitor"),
            _col("entries", "Entries", right=True),
            _col("billed_cents", "Billed", money=True),
            _col("paid_cents", "Paid", money=True),
            _col("balance_cents", "Balance", money=True),
            _col("status", "Status"),
        ],
        "rows": rows,
        "totals": {
            "exhibitor": f"{len(rows)} account(s) owing",
            "billed_cents": sum(r["billed_cents"] for r in rows),
            "paid_cents": sum(r["paid_cents"] for r in rows),
            "balance_cents": fin["totals"]["outstanding_cents"],
        },
        "notes": notes,
    }


def _registrations(fin: dict) -> dict:
    """The full roster, with what each exhibitor is being billed."""
    rows = [
        {
            "back_number": a["back_number"] if a["back_number"] is not None else "—",
            "exhibitor": _account_label(a),
            "signed_up": "Sign-up" if a["signed_up"] else "Added by office",
            "entries": a["entry_count"],
            "horses": a["horse_count"],
            "billed_cents": a["bill"]["total_cents"],
            "balance_cents": a["balance_cents"],
        }
        for a in _sorted_by_back_number(fin["accounts"])
    ]
    reg = fin["registrations"]
    return {
        "columns": [
            _col("back_number", "Back #", right=True),
            _col("exhibitor", "Exhibitor"),
            _col("signed_up", "Source"),
            _col("entries", "Entries", right=True),
            _col("horses", "Horses", right=True),
            _col("billed_cents", "Billed", money=True),
            _col("balance_cents", "Balance", money=True),
        ],
        "rows": rows,
        "totals": {
            "exhibitor": f"{reg['exhibitors']} exhibitor(s)",
            "entries": reg["entries"],
            "horses": reg["horses"],
            "billed_cents": fin["totals"]["billed_cents"],
            "balance_cents": fin["totals"]["net_balance_cents"],
        },
        "notes": [
            f"{reg['signed_up']} completed sign-up online; {reg['staff_added']} were added "
            "by the show office. Both owe money and both are listed.",
        ],
    }


def _payments_received(fin: dict) -> dict:
    """The payment log, for reconciling the drawer against the day."""
    rows = []
    for account in fin["accounts"]:
        for payment in account["payments"]:
            rows.append({
                "received_on": payment["received_on"],
                "back_number": account["back_number"] if account["back_number"] is not None else "—",
                "exhibitor": _account_label(account),
                "method": payment["method"].title(),
                "reference": payment["reference"] or "—",
                "amount_cents": payment["amount_cents"],
                "recorded_by": payment["recorded_by_name"] or "—",
            })
    # Most recent first — the day being reconciled is nearly always today's.
    rows.sort(key=lambda r: (str(r["received_on"]), r["exhibitor"]), reverse=True)

    totals = fin["totals"]
    notes = [
        f"{_money(totals['collected_cents'])} taken in and {_money(totals['refunded_cents'])} "
        "refunded. Refunds appear as negative amounts.",
    ]
    if not rows:
        notes = ["No payments have been recorded for this show yet."]

    return {
        "columns": [
            _col("received_on", "Received"),
            _col("back_number", "Back #", right=True),
            _col("exhibitor", "Exhibitor"),
            _col("method", "Method"),
            _col("reference", "Reference"),
            _col("amount_cents", "Amount", money=True),
            _col("recorded_by", "Recorded by"),
        ],
        "rows": rows,
        "totals": {
            "exhibitor": f"{len(rows)} payment(s)",
            "amount_cents": totals["net_paid_cents"],
        },
        "notes": notes,
    }


def _fees_sold(fin: dict) -> dict:
    """Stalls, shavings, and camping actually reserved — what to physically plan for."""
    rows = [
        {
            "label": fee["label"],
            "code": fee["code"],
            "unit": _unit_label(fee["unit"]),
            "quantity": fee["quantity"],
            "early_rate_quantity": fee["early_rate_quantity"],
            "line_total_cents": fee["line_total_cents"],
        }
        for fee in fin["totals"]["fee_lines"]
    ]
    return {
        "columns": [
            _col("label", "Fee"),
            _col("code", "Code"),
            _col("unit", "Unit"),
            _col("quantity", "Reserved", right=True),
            _col("early_rate_quantity", "At early rate", right=True),
            _col("line_total_cents", "Billed", money=True),
        ],
        "rows": rows,
        "totals": {
            "label": f"{len(rows)} fee(s) reserved",
            "quantity": sum(r["quantity"] for r in rows),
            "early_rate_quantity": sum(r["early_rate_quantity"] for r in rows),
            "line_total_cents": fin["totals"]["reservation_total_cents"],
        },
        "notes": [
            "Counts come from what exhibitors reserved at sign-up. Each line is "
            "priced at the rate in force on the day it was booked, so a show with "
            "an early deadline will show two rates against one fee.",
        ] if rows else ["Nothing reservable has been booked at this show yet."],
    }


def _charges_applied(fin: dict) -> dict:
    """The show's own per-exhibitor / per-horse / per-judge charges.

    The counterpart to Stalls, Shavings & Camping: that sheet is what people
    asked for, this one is what the show applied to them whether they asked or
    not. Both are `show_fees` rows and they are reported apart for that reason —
    "12 stalls sold" and "12 exhibitors charged a gate fee" are not the same
    kind of number and should never be added up together.
    """
    rows = [
        {
            "label": charge["label"],
            "code": charge["code"],
            "unit": _unit_label(charge["unit"]),
            "amount_cents": charge["amount_cents"],
            "exhibitors": charge["exhibitors"],
            "quantity": charge["quantity"],
            "line_total_cents": charge["line_total_cents"],
        }
        for charge in fin["totals"].get("charge_lines", [])
    ]
    return {
        "columns": [
            _col("label", "Charge"),
            _col("code", "Code"),
            _col("unit", "Charged"),
            _col("amount_cents", "Rate", money=True),
            _col("exhibitors", "Exhibitors", right=True),
            _col("quantity", "Units", right=True),
            _col("line_total_cents", "Billed", money=True),
        ],
        "rows": rows,
        "totals": {
            # Money only. Adding the exhibitor counts across rows double-counts
            # everyone who carries two charges, and adding the unit counts adds
            # horses to judge-horses — neither is a number the office wants.
            "label": f"{len(rows)} charge(s)",
            "line_total_cents": fin["totals"].get("charge_total_cents", 0),
        },
        "notes": [
            "These are charged automatically to every exhibitor who has entered "
            "a class — nobody books them. \"Units\" is what the rate was "
            "multiplied by across the show: exhibitors for a per-exhibitor "
            "charge, horses for a per-horse one, and judges × horses for a fee "
            "quoted per judge.",
            "The office charge on the show row is not listed here. It is one "
            "fixed charge rather than a fee row, and it appears on its own line "
            "in the Revenue Summary.",
        ] if rows else [
            "This show applies no automatic charges. They are set up under "
            "Other fees in Step 5 of show setup."
        ],
    }


def _side_pot_money(fin: dict) -> dict:
    """Pot money, which is not part of anyone's show bill."""
    rows = [
        {
            "name": pot["name"],
            "status": pot["status"].title(),
            "entry_count": pot["entry_count"],
            "paid_count": pot["paid_count"],
            "buy_ins_cents": pot["buy_ins_cents"],
            "payout_pool_cents": pot["payout_pool_cents"],
            "paid_out_cents": pot["paid_out_cents"],
            "retained_cents": pot["retained_cents"],
        }
        for pot in fin["side_pots"]
    ]
    return {
        "columns": [
            _col("name", "Side pot"),
            _col("status", "Status"),
            _col("entry_count", "Entries", right=True),
            _col("paid_count", "Paid", right=True),
            _col("buy_ins_cents", "Buy-ins", money=True),
            _col("payout_pool_cents", "Payout pool", money=True),
            _col("paid_out_cents", "Paid out", money=True),
            _col("retained_cents", "Show keeps", money=True),
        ],
        "rows": rows,
        "totals": {
            "name": f"{len(rows)} pot(s)",
            "buy_ins_cents": fin["side_pot_buy_ins_cents"],
            "paid_out_cents": fin["side_pot_paid_out_cents"],
            "retained_cents": fin["side_pot_retained_cents"],
        },
        "notes": [
            "Buy-ins are counted from pot entries marked paid. Payout pool is the "
            "buy-ins less the show's cut; Paid out is only filled in once a pot "
            "is settled.",
            "None of this is included in an exhibitor's show bill or balance.",
        ] if rows else ["This show has no side pots."],
    }


# ── Registry ───────────────────────────────────────────────────────────────────

_REPORTS: dict[str, dict] = {
    "revenue-summary": {
        "title": "Revenue Summary",
        "description": "Billed money broken down by where it comes from — entry fees, office charges, and each boarding fee.",
        "build": _revenue_summary,
    },
    "outstanding-balances": {
        "title": "Outstanding Balances",
        "description": "Every account still owing money, largest first, with what they have paid so far.",
        "build": _outstanding_balances,
    },
    "registrations": {
        "title": "Registrations",
        "description": "The full roster — entries, horses, and amount billed per exhibitor.",
        "build": _registrations,
    },
    "payments-received": {
        "title": "Payments Received",
        "description": "The payment log for reconciling the drawer, newest first, refunds included.",
        "build": _payments_received,
    },
    "fees-sold": {
        "title": "Stalls, Shavings & Camping",
        "description": "What exhibitors actually reserved, and how much of it went at the early rate.",
        "build": _fees_sold,
    },
    "charges-applied": {
        "title": "Office, Horse & Judge Charges",
        "description": "The charges the show applies to everyone who entered, and what each has billed.",
        "build": _charges_applied,
    },
    "side-pot-money": {
        "title": "Side Pot Money",
        "description": "Buy-ins, payout pools, and the show's cut for each pot. Kept out of exhibitor balances.",
        "build": _side_pot_money,
    },
}


def list_reports() -> list[dict]:
    """Every report the module can produce, in the order they are offered."""
    return [
        {"slug": slug, "title": spec["title"], "description": spec["description"]}
        for slug, spec in _REPORTS.items()
    ]


def get_report_spec(slug: str) -> Optional[dict]:
    return _REPORTS.get(slug)


def build_report(slug: str, fin: dict) -> Optional[dict]:
    """Run one report against an already-assembled financials payload."""
    spec = _REPORTS.get(slug)
    if spec is None:
        return None
    built: Callable[[dict], dict] = spec["build"]
    result = built(fin)
    return {
        "slug": slug,
        "title": spec["title"],
        "description": spec["description"],
        **result,
    }
