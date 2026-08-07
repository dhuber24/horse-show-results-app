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
RESERVABLE_FEE_UNITS = ("per_stall", "per_bag", "per_night")


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


def build_bill(
    show,
    entries: Iterable,
    reservations: Iterable,
) -> dict:
    """Itemize one exhibitor's charges at one show.

    `entries` are Entry rows with `class_` and (optionally) `horse` loaded;
    `reservations` are ShowEntryReservation rows with `show_fee` loaded.
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

    return {
        "class_lines": class_lines,
        "reservation_lines": reservation_lines,
        "class_fee_total_cents": class_fee_total,
        "nsba_sanction_total_cents": sanction_total,
        "office_charge_cents": show.office_charge_cents,
        "office_charge_basis": show.office_charge_basis,
        "office_charge_total_cents": office_total,
        "reservation_total_cents": reservation_total,
        "total_cents": class_fee_total + sanction_total + office_total + reservation_total,
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
