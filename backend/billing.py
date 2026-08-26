"""What an exhibitor owes a show, in one place.

Three screens quote the same money — the class-registration screen, the
sign-up screen, and the My Shows bill — and they must not disagree. Everything
that turns entries and reservations into cents lives here so there is one
answer rather than three implementations of it.

Nothing here collects payment. The app quotes the bill the show office will
collect at the gate; `entry_fee_cents` and the `show_fees` amounts are the
secretary's numbers, reported back.
"""
from __future__ import annotations

from datetime import date
from typing import Iterable, Optional

# NSBA Sanction Fees rule: 6% of entry fee, minimum $3, charged on every
# NSBA-approved entry (owed even if the exhibitor scratches).
# Source: https://www.nsba.com/images/documents/Show-Approval-Documents/Sanction-Fees.pdf
NSBA_SANCTION_MIN_CENTS = 300
NSBA_SANCTION_RATE = 0.06

# Which `show_fees` rows an exhibitor may reserve a quantity of at sign-up.
# Keyed on unit rather than a list of codes so a show that adds its own
# per-stall or per-night fee is offered without a code change here.
#
# `per_show` is the odd one and is not the same as `flat`: a flat fee is charged
# once however many you have, while per_show is charged once *per thing
# reserved*, however long the show runs. An electrical hook-up sold as "$60 for
# the weekend" is per_show — two of them cost $120, and a three-day show still
# costs $60 each. Pricing that as per_night silently doubles it on a two-day
# show, which is why the unit exists (migration 106).
RESERVABLE_FEE_UNITS = ("per_stall", "per_bag", "per_night", "per_show")


def has_early_rate(fee) -> bool:
    """Whether this fee actually offers an early rate.

    The discounted amount and the deadline are a pair. One without the other is
    a half-finished edit in the fee editor, not a price — treating it as one
    would either give the discount away forever or never.
    """
    return fee.early_amount_cents is not None and fee.early_deadline is not None


def early_rate_is_open(fee, on: Optional[date] = None) -> bool:
    """Whether a booking made on `on` (default today) still gets the early rate.

    This is the *quoting* question — what an exhibitor would pay if they
    reserved right now. What an existing booking pays is settled by
    `fee_rate_cents` against the date it was booked.
    """
    return has_early_rate(fee) and (on or date.today()) <= fee.early_deadline


def fee_rate_cents(fee, booked_on: Optional[date] = None) -> int:
    """Price of one unit of this fee for a booking dated `booked_on`.

    `booked_on` is `show_entry_reservations.reserved_at` — the day the
    exhibitor actually reserved — and defaults to today only when quoting a
    booking that doesn't exist yet. Never pass today's date for a booking that
    already exists: the point of an early rate is that it does not change out
    from under someone once the deadline passes.
    """
    return fee.early_amount_cents if early_rate_is_open(fee, booked_on) else fee.amount_cents


def show_is_nsba_sanctioned(show) -> bool:
    """NSBA approval comes from club sanctioning, not from the show type.

    Migration 080 split clubs out of show_types: NSBA is a club association a
    show opts into via show_sanctioning, so an "NSBA show" is now (for example)
    an OPEN or AQHA show carrying NSBA sanctioning.
    """
    return any(
        s.association is not None and s.association.code == "NSBA"
        for s in (show.sanctioning or [])
    )


def nsba_sanction_cents(entry_fee_cents: int) -> int:
    pct = int(round(entry_fee_cents * NSBA_SANCTION_RATE))
    return max(NSBA_SANCTION_MIN_CENTS, pct)


def office_charge_total_cents(show, distinct_horse_count: int, has_entries: bool) -> int:
    """The office/drug-testing charge, applied on the show's stated basis.

    `per_back_number` is charged once for the exhibitor — one back number, one
    charge, however many horses they bring. `per_horse` multiplies by the
    distinct horses they entered.
    """
    if not has_entries or show.office_charge_cents <= 0:
        return 0
    if show.office_charge_basis == "per_horse":
        return show.office_charge_cents * distinct_horse_count
    return show.office_charge_cents


def futurity_charge_cents(
    futurity,
    entry,
    entered_class_count: int,
) -> tuple[int, bool]:
    """What one futurity enrollment costs, and whether it was taken late.

    A futurity does not price its classes on the class row — the rate depends
    on which category the entrant qualifies for, which `classes.entry_fee_cents`
    cannot know, so a futurity class carries zero there and the tier supplies
    the price (migration 107). The charge is therefore:

        tier rate x classes entered  +  office fee  +  late fee x classes entered

    Lateness is decided by `entry.entered_at`, the day the enrollment was
    taken, and never by today — the same rule as `fee_rate_cents`. Pricing off
    "now" would drop a late fee on every existing enrollment the moment the
    deadline passed.
    """
    tier_rate = entry.fee_tier.amount_cents if entry.fee_tier is not None else 0
    office = (
        futurity.office_fee_member_cents
        if entry.is_member
        else futurity.office_fee_nonmember_cents
    )
    is_late = (
        futurity.entry_deadline is not None
        and entry.entered_at is not None
        and entry.entered_at > futurity.entry_deadline
    )
    late = futurity.late_fee_cents * entered_class_count if is_late else 0
    return tier_rate * entered_class_count + office + late, is_late


def futurity_lines(futurities: Iterable, entries: Iterable) -> tuple[list[dict], int]:
    """Itemize the caller's futurity enrollments against their class entries.

    `futurities` are Futurity rows for this show with `futurity_classes`,
    `fee_tiers` and `entries` loaded; `entries` are the exhibitor's Entry rows.
    Only enrollments belonging to the exhibitor's own `show_entries` row are
    charged, which is what `show_entry_ids` filters on at the caller.

    Returns (lines, total_cents). An enrollment whose horse has not been put in
    any of the futurity's classes still owes the office fee — the club took the
    paperwork — but no per-class money.
    """
    entry_list = list(entries)
    lines: list[dict] = []
    total = 0
    for futurity in futurities:
        futurity_class_ids = {fc.class_id for fc in futurity.futurity_classes}
        for enrollment in futurity.entries:
            entered = [
                e
                for e in entry_list
                if e.horse_id is not None
                and e.horse_id == enrollment.horse_id
                and e.class_id in futurity_class_ids
            ]
            charge, is_late = futurity_charge_cents(futurity, enrollment, len(entered))
            tier = enrollment.fee_tier
            lines.append(
                {
                    "futurity_id": futurity.id,
                    "futurity_name": futurity.name,
                    "futurity_entry_id": enrollment.id,
                    "horse_id": enrollment.horse_id,
                    "horse_name": (
                        enrollment.horse.name
                        if getattr(enrollment, "horse", None)
                        else None
                    ),
                    "fee_tier_name": tier.name if tier is not None else None,
                    "tier_amount_cents": tier.amount_cents if tier is not None else 0,
                    "class_count": len(entered),
                    "is_member": enrollment.is_member,
                    "office_fee_cents": (
                        futurity.office_fee_member_cents
                        if enrollment.is_member
                        else futurity.office_fee_nonmember_cents
                    ),
                    "is_late": is_late,
                    "late_fee_cents": (
                        futurity.late_fee_cents * len(entered) if is_late else 0
                    ),
                    "entered_at": enrollment.entered_at,
                    "line_total_cents": charge,
                }
            )
            total += charge
    return lines, total


def build_bill(
    show,
    entries: Iterable,
    reservations: Iterable,
    futurities: Iterable = (),
) -> dict:
    """Itemize one exhibitor's charges at one show.

    `entries` are Entry rows with `class_` and (optionally) `horse` loaded;
    `reservations` are ShowEntryReservation rows with `show_fee` loaded;
    `futurities` are Futurity rows carrying only *this* exhibitor's enrollments
    (the caller filters them — see `show_office._load_financials`).

    `futurities` defaults to empty so every existing caller keeps working and a
    show with no futurity is unchanged down to the key set.
    """
    nsba = show_is_nsba_sanctioned(show)

    class_lines: list[dict] = []
    class_fee_total = 0
    sanction_total = 0
    horse_ids: set = set()

    entry_list = list(entries)
    for entry in entry_list:
        cls = entry.class_
        if cls is None:
            continue
        sanction = nsba_sanction_cents(cls.entry_fee_cents) if nsba else 0
        class_lines.append(
            {
                "entry_id": entry.id,
                "class_id": cls.id,
                "class_number": cls.class_number,
                "class_name": cls.class_name,
                "class_date": cls.class_date,
                "horse_name": entry.horse.name if getattr(entry, "horse", None) else None,
                "fee_cents": cls.entry_fee_cents,
                "nsba_sanction_cents": sanction,
            }
        )
        class_fee_total += cls.entry_fee_cents
        sanction_total += sanction
        if entry.horse_id:
            horse_ids.add(entry.horse_id)

    reservation_lines: list[dict] = []
    reservation_total = 0
    for reservation in reservations:
        fee = reservation.show_fee
        if fee is None or reservation.quantity <= 0:
            continue
        # Priced off the day this line was booked, not today — see
        # fee_rate_cents. `amount_cents` is what the exhibitor is charged;
        # `standard_amount_cents` is kept alongside it so the bill can show
        # what the early rate saved them.
        rate = fee_rate_cents(fee, reservation.reserved_at)
        line_total = rate * reservation.quantity
        reservation_lines.append(
            {
                "show_fee_id": fee.id,
                "code": fee.code,
                "label": fee.label,
                "unit": fee.unit,
                "quantity": reservation.quantity,
                "amount_cents": rate,
                "standard_amount_cents": fee.amount_cents,
                "is_early_rate": rate != fee.amount_cents,
                "reserved_at": reservation.reserved_at,
                "line_total_cents": line_total,
            }
        )
        reservation_total += line_total

    office_total = office_charge_total_cents(show, len(horse_ids), bool(entry_list))
    futurity_line_list, futurity_total = futurity_lines(futurities, entry_list)

    return {
        "class_lines": class_lines,
        "reservation_lines": reservation_lines,
        "futurity_lines": futurity_line_list,
        "class_fee_total_cents": class_fee_total,
        "nsba_sanction_total_cents": sanction_total,
        "office_charge_cents": show.office_charge_cents,
        "office_charge_basis": show.office_charge_basis,
        "office_charge_total_cents": office_total,
        "reservation_total_cents": reservation_total,
        "futurity_total_cents": futurity_total,
        "total_cents": (
            class_fee_total
            + sanction_total
            + office_total
            + reservation_total
            + futurity_total
        ),
    }


# ── What was collected ─────────────────────────────────────────────────────────
#
# `build_bill` says what an exhibitor owes. Everything below turns that plus the
# recorded payments into a balance, and rolls a show's accounts into one set of
# figures for the Financials screen. It lives here for the same reason the bill
# does: the show's revenue total and the exhibitor's own bill must not be two
# implementations that disagree.


def payment_totals_cents(payments: Iterable) -> dict:
    """Split an account's payment rows into money in, money back, and the net.

    `amount_cents` is signed — a refund is a negative row (see migration 096) —
    so the net is what settles the balance while the two gross figures are what
    the office reconciles the drawer against. A day that took $600 and refunded
    $100 is not the same day as one that took $500, and the summary must be able
    to say so.
    """
    collected = sum(p.amount_cents for p in payments if p.amount_cents > 0)
    refunded = sum(-p.amount_cents for p in payments if p.amount_cents < 0)
    return {
        "collected_cents": collected,
        "refunded_cents": refunded,
        "net_paid_cents": collected - refunded,
    }


def build_account(
    show,
    entries: Iterable,
    reservations: Iterable,
    payments: Iterable,
    futurities: Iterable = (),
) -> dict:
    """One exhibitor's standing at one show: billed, paid, and the difference.

    The bill comes from `build_bill` untouched, so what Financials shows an
    exhibitor owes is character-for-character what My Shows shows them.
    """
    bill = build_bill(show, entries, reservations, futurities)
    totals = payment_totals_cents(payments)
    return {
        "bill": bill,
        **totals,
        "balance_cents": bill["total_cents"] - totals["net_paid_cents"],
    }


def summarize_accounts(accounts: Iterable) -> dict:
    """Roll every account at a show into one set of figures.

    Outstanding and credit are tracked separately rather than as one signed
    number. Summing balances would net one exhibitor's overpayment against
    another's arrears and report less owed than actually is — the office needs
    "$1,840 still to collect", not a figure quietly reduced by someone who paid
    twice. `net_balance_cents` is kept alongside for the books, where the netted
    figure is the right one.
    """
    totals = {
        "accounts": 0,
        "class_fee_total_cents": 0,
        "nsba_sanction_total_cents": 0,
        "office_charge_total_cents": 0,
        "reservation_total_cents": 0,
        "futurity_total_cents": 0,
        "billed_cents": 0,
        "collected_cents": 0,
        "refunded_cents": 0,
        "net_paid_cents": 0,
        "outstanding_cents": 0,
        "credit_cents": 0,
        "accounts_outstanding": 0,
        "accounts_paid_in_full": 0,
        "accounts_unpaid": 0,
    }
    # Per-fee rollup: how many stalls the show actually sold, and for how much.
    # Keyed by fee id so a show's own custom fee is included with no change here.
    fee_lines: dict = {}

    for account in accounts:
        bill = account["bill"]
        totals["accounts"] += 1
        for key in (
            "class_fee_total_cents",
            "nsba_sanction_total_cents",
            "office_charge_total_cents",
            "reservation_total_cents",
            "futurity_total_cents",
        ):
            # .get, because an account built before futurities existed — or by
            # a caller that passes no futurities — has no such key, and a show
            # with none must roll up to zero rather than raise.
            totals[key] += bill.get(key, 0)
        totals["billed_cents"] += bill["total_cents"]
        totals["collected_cents"] += account["collected_cents"]
        totals["refunded_cents"] += account["refunded_cents"]
        totals["net_paid_cents"] += account["net_paid_cents"]

        balance = account["balance_cents"]
        if balance > 0:
            totals["outstanding_cents"] += balance
            totals["accounts_outstanding"] += 1
            if account["net_paid_cents"] == 0:
                totals["accounts_unpaid"] += 1
        elif balance < 0:
            totals["credit_cents"] += -balance
            totals["accounts_paid_in_full"] += 1
        else:
            totals["accounts_paid_in_full"] += 1

        for line in bill["reservation_lines"]:
            fee = fee_lines.setdefault(
                line["show_fee_id"],
                {
                    "show_fee_id": line["show_fee_id"],
                    "code": line["code"],
                    "label": line["label"],
                    "unit": line["unit"],
                    "quantity": 0,
                    "line_total_cents": 0,
                    "early_rate_quantity": 0,
                },
            )
            fee["quantity"] += line["quantity"]
            fee["line_total_cents"] += line["line_total_cents"]
            if line["is_early_rate"]:
                fee["early_rate_quantity"] += line["quantity"]

    totals["net_balance_cents"] = totals["billed_cents"] - totals["net_paid_cents"]
    totals["fee_lines"] = sorted(fee_lines.values(), key=lambda f: f["label"] or "")
    return totals


def side_pot_money(pot, paid_entry_count: int, payouts: Iterable) -> dict:
    """A pot's money, kept apart from the exhibitor's bill on purpose.

    Pot buy-ins are not in `build_bill` and are not added to an account balance
    here: doing so would make Financials disagree with the bill the exhibitor
    sees on My Shows. The show's cut is whatever `payback_percent` does not pay
    back out.
    """
    taken = pot.entry_fee_cents * paid_entry_count
    pool = (taken * pot.payback_percent) // 100
    paid_out = sum(p.payout_cents for p in payouts)
    return {
        "buy_ins_cents": taken,
        "payout_pool_cents": pool,
        "paid_out_cents": paid_out,
        "retained_cents": taken - pool,
    }


def reservable_fees(fees: Iterable) -> list:
    """The show's fee rows an exhibitor picks quantities of, in the secretary's
    configured order."""
    return [f for f in fees if f.unit in RESERVABLE_FEE_UNITS]


def find_fee(fees: Iterable, fee_id) -> Optional[object]:
    for fee in fees:
        if fee.id == fee_id:
            return fee
    return None
