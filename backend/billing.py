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
#
# per_night, per_day and per_show are the three ways a venue prices the *same*
# camping spot, which is why the setup step offers them as a choice on one line
# rather than as three fee rows (migrations 108, 111). A day is not a night: a
# Friday-to-Sunday show is three days and two nights, so a per-day rate charged
# against a count of nights under-bills every camper by a day.
RESERVABLE_FEE_UNITS = ("per_stall", "per_bag", "per_night", "per_day", "per_show")

# Which `show_fees` rows the show charges automatically, from what the exhibitor
# entered rather than from anything they booked (migration 112).
#
# `shows.office_charge_cents` was the only such charge the app had, and there is
# exactly one of it. A show bill routinely carries several — an office fee per
# back number, a drug fee per horse, a judge fee per judge per horse - and the
# `per_horse` / `per_judge` rows the fee editors have accepted since migration
# 060 printed on the price list and reached nobody's account.
#
# `flat` is deliberately not here. A flat fee is charged once however many you
# have, and its *occurrence* is not derivable: a stall cleanout penalty applies
# to whoever left a mess, which no query answers. `per_exhibitor` is derived
# from having entries, which is the test `office_charge_total_cents` already
# makes.
#
# `per_entry`, `per_class_per_horse` and `percent_of_entry` are not here either,
# and must not be added: they are the class-fee vocabulary, and
# `classes.entry_fee_cents` is what charges per entry. Billing the setup step's
# `standard_class` row on top of it would double every class on every bill.
AUTOMATIC_FEE_UNITS = (
    "per_exhibitor",
    "per_horse",
    "per_judge_per_horse",
    "per_judge_per_exhibitor",
    # APHA SC-125.B, and every breed body's version of it: a fee "per entry per
    # show (Judge)" that show management collects and forwards. Neither of the
    # units above bills it -- an exhibitor with one horse in six classes owes six
    # of these, and `per_judge_per_horse` charges them one. This does not
    # contradict the paragraph above: `per_entry` is the class-fee vocabulary and
    # stays out, while this is a levy on top of the class fee (migration 125).
    "per_judge_per_entry",
)


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


def sanction_rates(show) -> dict:
    """What each club this show carries charges per class it sanctions.

    `{association_id: per_class_fee_cents}`, read off `show_sanctioning` — the
    amount the manager set in setup Step 3/5 and which the public show bill has
    always printed as "$2.00 per class". Clubs with no fee set are kept out, so
    a show that enrolled a club without pricing it bills nothing rather than
    zero-value lines.

    Migration 080 split clubs out of `show_types`, so "this show is NSBA
    sanctioned" is a `show_sanctioning` row rather than a show type.
    """
    return {
        s.association_id: s.per_class_fee_cents
        for s in (show.sanctioning or [])
        if (s.per_class_fee_cents or 0) > 0
    }


def class_sanction_cents(cls, rates: dict) -> int:
    """The club sanction fees one entry in this class owes.

    Summed over the clubs that actually sanction *this class*
    (`class_sanctioning`, migration 113) rather than applied to every class at a
    sanctioned show — an NSBA show runs plenty of classes NSBA has nothing to do
    with, and the exhibitor entering one of those owes nothing on it. A
    dual-sanctioned class legitimately carries both clubs' fees.

    `rates` comes from `sanction_rates(show)` and is passed in rather than
    re-derived per class: the caller is already looping entries, and re-reading
    `show.sanctioning` inside the loop is how a bill ends up quoting a different
    number than the screen it was opened from.
    """
    total = 0
    for row in (getattr(cls, "sanctioning", None) or []):
        total += rates.get(row.association_id, 0)
    return total


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


def charge_multiplier(
    unit: str, horse_count: int, judge_count: int, entry_count: int = 0
) -> int:
    """How many of an automatic fee one exhibitor owes.

    The unit names both halves of the multiplication on purpose. "Per judge"
    alone does not say what it multiplies, and the readings differ by however
    many horses somebody brought or classes they entered — three judges at $5 is
    $15, $30 or $90 — which is the same trap `per_night` / `per_day` exist to
    close. A unit this does not recognise returns 0 rather than guessing: it is a
    price-list row, not a charge.

    `entry_count` defaults to 0 so a caller that predates `per_judge_per_entry`
    bills that unit at nothing rather than at a wrong multiple. Under-billing a
    fee nobody has created yet is recoverable; over-billing every exhibitor at a
    show is not.
    """
    if unit == "per_exhibitor":
        return 1
    if unit == "per_horse":
        return horse_count
    if unit == "per_judge_per_exhibitor":
        return judge_count
    if unit == "per_judge_per_horse":
        return judge_count * horse_count
    if unit == "per_judge_per_entry":
        return judge_count * entry_count
    return 0


def charge_lines(
    fees: Iterable,
    horse_count: int,
    judge_count: int,
    has_entries: bool,
    entry_count: int = 0,
) -> tuple[list[dict], int]:
    """Itemize the show's own automatic charges for one exhibitor.

    Returns (lines, total_cents). Nothing is charged to somebody with no
    entries — the same rule `office_charge_total_cents` applies, and for the
    same reason: a signed-up exhibitor who has not entered a class has not
    incurred the show's per-horse costs.

    A fee priced at zero produces no line. `POST /shows/{id}/fees/seed` writes
    several fee templates at $0 for the secretary to fill in, and a column of
    $0.00 rows on every exhibitor's bill is noise that teaches people to skim
    it.

    There is no early rate here, and `_assert_early_rate_valid` refuses to store
    one on these units: an early rate is chosen by the day a line was *booked*,
    and nothing books these.
    """
    if not has_entries:
        return [], 0
    lines: list[dict] = []
    total = 0
    for fee in fees:
        if fee.unit not in AUTOMATIC_FEE_UNITS or fee.amount_cents <= 0:
            continue
        quantity = charge_multiplier(fee.unit, horse_count, judge_count, entry_count)
        if quantity <= 0:
            continue
        line_total = fee.amount_cents * quantity
        lines.append(
            {
                "show_fee_id": fee.id,
                "code": fee.code,
                "label": fee.label,
                "unit": fee.unit,
                "amount_cents": fee.amount_cents,
                # Both counts travel with the line so the bill can show the
                # arithmetic — "$5.00 x 3 judges x 2 horses" is checkable
                # against a paper bill in a way "$5.00 x 6" is not.
                "horse_count": horse_count,
                "judge_count": judge_count,
                "entry_count": entry_count,
                "quantity": quantity,
                "line_total_cents": line_total,
            }
        )
        total += line_total
    return lines, total


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

        tier rate x classes entered
            + office fee
            + late fee x classes entered
            + the club membership they bought with the entry, if any

    Lateness is decided by `entry.entered_at`, the day the enrollment was
    taken, and never by today — the same rule as `fee_rate_cents`. Pricing off
    "now" would drop a late fee on every existing enrollment the moment the
    deadline passed.

    The membership (migration 109) is charged once per enrollment and is
    independent of `is_member`: the office fee follows the card the entrant
    already holds, while this is a card they are buying at the desk. Somebody
    joining on the day legitimately pays the non-member office fee *and* the
    membership — which is what the paper form does — and the two questions are
    asked separately for exactly that reason.
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
    membership = membership_fee_cents(entry)
    return tier_rate * entered_class_count + office + late + membership, is_late


def membership_fee_cents(entry) -> int:
    """What the club membership bought with this enrollment costs, or zero.

    `getattr` rather than a plain attribute read because every caller that
    predates migration 109 — and every test stub — hands over an enrollment
    without the relationship, and a futurity that sells no membership must
    total exactly what it did before.
    """
    option = getattr(entry, "membership_option", None)
    return option.amount_cents if option is not None else 0


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
            membership = getattr(enrollment, "membership_option", None)
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
                    "membership_name": (
                        membership.name if membership is not None else None
                    ),
                    "membership_fee_cents": membership_fee_cents(enrollment),
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
    rates = sanction_rates(show)

    class_lines: list[dict] = []
    class_fee_total = 0
    sanction_total = 0
    horse_ids: set = set()

    entry_list = list(entries)
    for entry in entry_list:
        cls = entry.class_
        if cls is None:
            continue
        sanction = class_sanction_cents(cls, rates)
        class_lines.append(
            {
                "entry_id": entry.id,
                "class_id": cls.id,
                "class_number": cls.class_number,
                "class_name": cls.class_name,
                "class_date": cls.class_date,
                "horse_name": entry.horse.name if getattr(entry, "horse", None) else None,
                "fee_cents": cls.entry_fee_cents,
                "sanction_cents": sanction,
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
    # The show's own automatic charges (migration 112). `show.fees` and
    # `show.judges` are read off the Show row, the way `office_charge_cents` and
    # `sanctioning` already are, so every caller must eager-load both. An
    # unloaded relationship raises MissingGreenlet in an async request, which is
    # loud; defaulting to "this show has no fees" would silently under-bill an
    # entire show, which is not.
    charge_line_list, charge_total = charge_lines(
        show.fees or [],
        len(horse_ids),
        len(show.judges or []),
        bool(entry_list),
        entry_count=len(entry_list),
    )
    futurity_line_list, futurity_total = futurity_lines(futurities, entry_list)

    return {
        "class_lines": class_lines,
        "reservation_lines": reservation_lines,
        "charge_lines": charge_line_list,
        "futurity_lines": futurity_line_list,
        "class_fee_total_cents": class_fee_total,
        "sanction_total_cents": sanction_total,
        "office_charge_cents": show.office_charge_cents,
        "office_charge_basis": show.office_charge_basis,
        "office_charge_total_cents": office_total,
        "reservation_total_cents": reservation_total,
        "charge_total_cents": charge_total,
        "futurity_total_cents": futurity_total,
        "total_cents": (
            class_fee_total
            + sanction_total
            + office_total
            + reservation_total
            + charge_total
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
        "sanction_total_cents": 0,
        "office_charge_total_cents": 0,
        "reservation_total_cents": 0,
        "charge_total_cents": 0,
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
    # The automatic charges are rolled up separately rather than folded into
    # `fee_lines`. Both are `show_fees` rows, but the Fees Reserved report reads
    # `fee_lines` as "what exhibitors booked at sign-up" and foots it against
    # `reservation_total_cents` — mixing in a drug fee nobody booked would leave
    # that sheet's rows disagreeing with its own total.
    charge_rollup: dict = {}

    for account in accounts:
        bill = account["bill"]
        totals["accounts"] += 1
        for key in (
            "class_fee_total_cents",
            "sanction_total_cents",
            "office_charge_total_cents",
            "reservation_total_cents",
            "charge_total_cents",
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

        for line in bill.get("charge_lines", []):
            charge = charge_rollup.setdefault(
                line["show_fee_id"],
                {
                    "show_fee_id": line["show_fee_id"],
                    "code": line["code"],
                    "label": line["label"],
                    "unit": line["unit"],
                    "amount_cents": line["amount_cents"],
                    "quantity": 0,
                    "line_total_cents": 0,
                    "exhibitors": 0,
                },
            )
            charge["quantity"] += line["quantity"]
            charge["line_total_cents"] += line["line_total_cents"]
            charge["exhibitors"] += 1

    totals["net_balance_cents"] = totals["billed_cents"] - totals["net_paid_cents"]
    totals["fee_lines"] = sorted(fee_lines.values(), key=lambda f: f["label"] or "")
    totals["charge_lines"] = sorted(
        charge_rollup.values(), key=lambda f: f["label"] or ""
    )
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


def automatic_fees(fees: Iterable) -> list:
    """The show's fee rows that bill without anyone asking for them.

    The other half of `reservable_fees`, and what the fee editors filter on so a
    charge the show applies to everybody is never offered as something to book.
    """
    return [f for f in fees if f.unit in AUTOMATIC_FEE_UNITS]


def find_fee(fees: Iterable, fee_id) -> Optional[object]:
    for fee in fees:
        if fee.id == fee_id:
            return fee
    return None
