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
        line_total = fee.amount_cents * reservation.quantity
        reservation_lines.append(
            {
                "show_fee_id": fee.id,
                "code": fee.code,
                "label": fee.label,
                "unit": fee.unit,
                "quantity": reservation.quantity,
                "amount_cents": fee.amount_cents,
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
