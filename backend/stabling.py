"""Stalls: what a stall line sells, the window it is sold for, and whether an
exhibitor's stalls cover their horses (migration 194).

A show used to sell one kind of stall for the whole show. WSCA's Championship
Show sells a box stall three ways -- the full show, the pleasure days, the games
days -- each with its own price, move-in and move-out, and sells tie stalls and
tack stalls beside them. Three facts on a `per_stall` line say which:

* **What it sells** (`stall_kind_of`): a horse stall (box or tie), a tack stall,
  or an add-on priced per stall that is not a stall at all, such as the Early
  Move-In Pass. Only horse stalls stand a horse, so only they count toward the
  shavings floor (`reservations.stalls_reserved`) and toward the checks here.
* **When** (`show_fees.stall_period_id` -> `show_stall_periods`): no period is
  the whole show.
* **For a tack stall, how many horse stalls it needs** in the same period
  (`show_fees.horses_per_tack_stall`).

**Every check here is a flag, never a refusal.** "Every horse needs its own
stall" and "four horses per games tack stall" are the show's rules, and the
answer to a shortfall is often that somebody else is paying -- a parent, a
trainer, a group leader -- which only the office can see. So `stall_checks`
reports, and the sign-up form, the class page and the desk show the report.
"""
from __future__ import annotations

import re
from datetime import date, time, timedelta
from typing import Iterable, Mapping, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

STALL_UNIT = "per_stall"

# What a line priced per stall sells (migrations 194 and 198): a box, tie or
# tack stall -- the three stall types a stall period prices -- or an add-on
# priced per stall that is not a stall, such as the Early Move-In Pass.
BOX = "box"
TIE = "tie"
TACK = "tack"
ADD_ON = "add_on"
STALL_KINDS = (BOX, TIE, TACK, ADD_ON)
# A stall a horse stands in. A tack stall holds tack.
HORSE_KINDS = frozenset({BOX, TIE})

# The Early Move-In Pass (`frontend/lib/stalls-open.ts`): priced per stall or
# per exhibitor, and an extra on a stall rather than one. `early_move_in` is the
# whole show's; a stall period's own is `early_move_in_<period>` (migration 196).
# `early_arrival_stall` is the code the show bill import gave the whole-show
# pass before the Lodging step offered one.
EARLY_MOVE_IN_CODES = frozenset({"early_move_in", "early_arrival_stall"})
EARLY_MOVE_IN_PREFIX = "early_move_in_"

# "tack" as a word, in a label ("Tack stall") or a code ("tack_stall"). Not
# `\b`, which treats `_` as part of a word and so misses the code.
_TACK = re.compile(r"(?<![a-z])tack(?![a-z])", re.IGNORECASE)
# "tie" as a word, the same way: "Tie stall", "tie_stall" -- not "tied".
_TIE = re.compile(r"(?<![a-z])tie(?![a-z])", re.IGNORECASE)

# A stall that opens at noon or later does not stand a horse for that day's
# classes: WSCA's games stalls open at 9 PM on the Friday the pleasure classes
# finish, and counting Friday would let one pleasure stall and one games stall
# cover two horses showing on Friday. A morning move-in, or one with no hour,
# counts the day -- a one-day show that opens the barn at 6 AM shows that day.
AFTERNOON_MOVE_IN = time(12, 0)

# Check codes, as the screens read them.
HORSE_STALLS_SHORT = "HORSE_STALLS_SHORT"
TACK_STALL_HORSES = "TACK_STALL_HORSES"
PASS_WITHOUT_STALL = "PASS_WITHOUT_STALL"


def is_early_move_in(fee) -> bool:
    """Whether a fee line is an Early Move-In Pass: the whole show's, or a stall
    period's own (migration 196). Found by code, which the Lodging step writes."""
    code = getattr(fee, "code", None) or ""
    return code in EARLY_MOVE_IN_CODES or code.startswith(EARLY_MOVE_IN_PREFIX)


def stall_kind_of(fee) -> Optional[str]:
    """What a fee line sells: `box`, `tie` or `tack`, `add_on`, or None if it
    is not priced per stall.

    The column (`show_fees.stall_kind`) wins where the office set it. Where it
    did not -- every line before migration 194, and every line the show bill
    import or a seed script creates -- it is read from the line: the move-in
    pass's code is an add-on, a line naming a tack stall is a tack stall, one
    naming a tie stall a tie stall, and anything else a box stall, which is what
    a stall line meant before there was a choice.
    """
    if getattr(fee, "unit", None) != STALL_UNIT:
        return None
    stated = getattr(fee, "stall_kind", None)
    if stated in STALL_KINDS:
        return stated
    if is_early_move_in(fee):
        return ADD_ON
    label = getattr(fee, "label", None) or ""
    code = getattr(fee, "code", None) or ""
    if _TACK.search(label) or _TACK.search(code):
        return TACK
    if _TIE.search(label) or _TIE.search(code):
        return TIE
    return BOX


def is_horse_stall(fee) -> bool:
    """A box or a tie stall: one a horse stands in."""
    return stall_kind_of(fee) in HORSE_KINDS


def period_days(period) -> tuple[date, date]:
    """The first and last day a stall in this period stands a horse for its
    classes.

    The move-out day counts: WSCA's pleasure stall is held until an hour after
    your last class on the Friday. The move-in day counts unless the barn opens
    at noon or later (`AFTERNOON_MOVE_IN`). A period that opens in the evening
    of its only day covers no day at all, which is right -- nobody shows from it.
    """
    first = period.move_in_date
    if period.move_in_time is not None and period.move_in_time >= AFTERNOON_MOVE_IN:
        first = first + timedelta(days=1)
    return first, period.move_out_date


def earliest_move_in(periods: Iterable):
    """The period that moves in first, or None for no periods. A day with no
    hour counts from the start of that day."""
    periods = list(periods)
    if not periods:
        return None
    return min(periods, key=lambda p: (p.move_in_date, p.move_in_time or time.min))


def stalls_open_from(periods: Iterable) -> tuple[Optional[date], Optional[time]]:
    """`shows.stalls_open_date` / `stalls_open_time` for these periods: the
    first period's move-in, or none at all for a show without periods.

    Move-in is set only by stall period, on the Lodging step's *Stalls & move-in*
    card; "stalls open" is what Show Details, the show bill and the sign-up
    form's arrival note say before an exhibitor has booked a stall, so it is
    kept to the periods rather than typed a second time
    (`routers/show_stall_periods`)."""
    first = earliest_move_in(periods)
    if first is None:
        return None, None
    return first.move_in_date, first.move_in_time


def covers(period, day: date) -> bool:
    """Whether a stall sold for `period` stands a horse on `day`. No period is
    the whole show."""
    if period is None:
        return True
    first, last = period_days(period)
    return first <= day <= last


def _period(periods_by_id: Mapping, fee):
    """The fee's period, or None for the whole show. A period id that is not
    on the show reads as the whole show rather than as no days at all."""
    period_id = getattr(fee, "stall_period_id", None)
    return periods_by_id.get(period_id) if period_id is not None else None


def horse_stall_shortfalls(
    fees: Iterable,
    periods_by_id: Mapping,
    booked: Mapping[UUID, int],
    horse_days: Mapping[UUID, tuple[str, set[date]]],
) -> list[dict]:
    """Each day more horses show than the exhibitor holds horse stalls for.

    `horse_days` is each horse they show with its name and the days it has a
    class. A stall counts on a day its period covers (`covers`), so one
    pleasure stall and one games stall cover a horse showing Thursday and
    another showing Saturday -- and a pleasure stall alone does not cover a
    Saturday class.

    Days with the same horses short by the same number are one item, so a
    weekend of two horses on one stall reads once rather than three times.
    """
    horse_lines = [
        (fee, booked.get(fee.id, 0))
        for fee in fees
        if is_horse_stall(fee) and booked.get(fee.id, 0) > 0
    ]
    showing: dict[date, list[str]] = {}
    for name, days in horse_days.values():
        for day in days:
            showing.setdefault(day, []).append(name)

    items: list[dict] = []
    by_key: dict[tuple, dict] = {}
    for day in sorted(showing):
        names = tuple(sorted(showing[day], key=str.casefold))
        stalls = sum(
            quantity
            for fee, quantity in horse_lines
            if covers(_period(periods_by_id, fee), day)
        )
        if len(names) <= stalls:
            continue
        key = (names, stalls)
        if key in by_key:
            by_key[key]["dates"].append(day)
            continue
        item = {
            "code": HORSE_STALLS_SHORT,
            "dates": [day],
            "horses": list(names),
            "stalls": stalls,
        }
        by_key[key] = item
        items.append(item)
    return items


def tack_stall_shortfalls(
    fees: Iterable, periods_by_id: Mapping, booked: Mapping[UUID, int]
) -> list[dict]:
    """Each tack stall line booked with fewer horse stalls than it needs.

    Counted in the tack stall's own period, because the horses sharing a tack
    stall must all hold the same stall option (WSCA: "the horses sharing MUST
    all be the same stalling option"). A whole-show tack stall counts
    whole-show horse stalls.
    """
    fees = list(fees)
    items: list[dict] = []
    for fee in fees:
        need_each = getattr(fee, "horses_per_tack_stall", None)
        if stall_kind_of(fee) != TACK or not need_each:
            continue
        tack_stalls = booked.get(fee.id, 0)
        if tack_stalls <= 0:
            continue
        horse_stalls = sum(
            booked.get(other.id, 0)
            for other in fees
            if is_horse_stall(other)
            and getattr(other, "stall_period_id", None) == getattr(fee, "stall_period_id", None)
        )
        if horse_stalls >= tack_stalls * need_each:
            continue
        period = _period(periods_by_id, fee)
        items.append({
            "code": TACK_STALL_HORSES,
            "show_fee_id": fee.id,
            "label": fee.label,
            "period": period.name if period is not None else None,
            "tack_stalls": tack_stalls,
            "horses_per_tack_stall": need_each,
            "horse_stalls": horse_stalls,
        })
    return items


def pass_shortfalls(fees: Iterable, booked: Mapping[UUID, int], periods_by_id: Mapping) -> list[dict]:
    """Each Early Move-In Pass booked without the stalls it moves in early.

    A pass is for the stalls of its own period -- the whole show's pass for
    every stall -- and a tack stall moves in as much as a horse stall does. A
    pass sold per stall flags more passes than stalls; one sold per exhibitor
    flags a pass with no stall at all. A flag, like every check here: the stall
    may be on a group-mate's booking.
    """
    fees = list(fees)
    stall_lines = [fee for fee in fees if stall_kind_of(fee) in (BOX, TIE, TACK)]
    items: list[dict] = []
    for fee in fees:
        passes = booked.get(fee.id, 0)
        if passes <= 0 or not is_early_move_in(fee):
            continue
        period_id = getattr(fee, "stall_period_id", None)
        stalls = sum(
            booked.get(line.id, 0)
            for line in stall_lines
            if period_id is None or getattr(line, "stall_period_id", None) == period_id
        )
        one_each = bool(getattr(fee, "one_per_exhibitor", False))
        if (one_each and stalls > 0) or (not one_each and passes <= stalls):
            continue
        period = _period(periods_by_id, fee)
        items.append({
            "code": PASS_WITHOUT_STALL,
            "show_fee_id": fee.id,
            "label": fee.label,
            "period": period.name if period is not None else None,
            "passes": passes,
            "stalls": stalls,
            "one_per_exhibitor": one_each,
        })
    return items


def stall_checks(
    *,
    show,
    fees: Iterable,
    periods: Iterable,
    booked: Mapping[UUID, int],
    horse_days: Mapping[UUID, tuple[str, set[date]]],
) -> list[dict]:
    """Everything about one exhibitor's stalls the show would want to know.

    The horse check runs only where the office asked for a stall per horse
    (`shows.stall_per_horse_required`) and the show sells a horse stall at all.
    The tack check runs wherever a tack stall carries a minimum. Neither
    refuses anything -- see the module docstring.
    """
    stall_fees = [fee for fee in fees if getattr(fee, "unit", None) == STALL_UNIT]
    periods_by_id = {period.id: period for period in periods}
    checks: list[dict] = []
    if getattr(show, "stall_per_horse_required", False) and any(
        is_horse_stall(fee) for fee in stall_fees
    ):
        checks.extend(horse_stall_shortfalls(stall_fees, periods_by_id, booked, horse_days))
    checks.extend(tack_stall_shortfalls(stall_fees, periods_by_id, booked))
    checks.extend(pass_shortfalls(stall_fees, booked, periods_by_id))
    return checks


# ── Loading ─────────────────────────────────────────────────────────────────


async def load_stall_periods(db: AsyncSession, show_id: UUID) -> list:
    from models import ShowStallPeriod

    result = await db.execute(
        select(ShowStallPeriod)
        .where(ShowStallPeriod.show_id == show_id)
        .order_by(ShowStallPeriod.sort_order, ShowStallPeriod.created_at)
    )
    return list(result.scalars().all())


async def horse_days_by_exhibitor(
    db: AsyncSession, show_id: UUID, exhibitor_id: Optional[UUID] = None
) -> dict[UUID, dict[UUID, tuple[str, set[date]]]]:
    """For each exhibitor, each horse they show and the days it has a class.

    A horse is the exhibitor's to stall when they entered it, or when they ride
    it on somebody else's team (`entry_team_members.horse_id`, migration 192).
    A teammate riding the team's own horse brings no horse. A withdrawn entry
    shows nothing. One exhibitor, or everybody at the show for the desk.
    """
    from models import Class, Entry, EntryTeamMember, Horse

    out: dict[UUID, dict[UUID, tuple[str, set[date]]]] = {}

    def add(exhibitor, horse_id, name, day) -> None:
        horses = out.setdefault(exhibitor, {})
        _name, days = horses.setdefault(horse_id, (name or "Unnamed horse", set()))
        days.add(day)

    entered = (
        select(Entry.exhibitor_id, Entry.horse_id, Horse.name, Class.class_date)
        .join(Class, Entry.class_id == Class.id)
        .join(Horse, Entry.horse_id == Horse.id)
        .where(Class.show_id == show_id, Entry.status != "WITHDRAWN")
    )
    ridden = (
        select(EntryTeamMember.exhibitor_id, EntryTeamMember.horse_id, Horse.name, Class.class_date)
        .join(Entry, EntryTeamMember.entry_id == Entry.id)
        .join(Class, Entry.class_id == Class.id)
        .join(Horse, EntryTeamMember.horse_id == Horse.id)
        .where(Class.show_id == show_id, Entry.status != "WITHDRAWN")
    )
    if exhibitor_id is not None:
        entered = entered.where(Entry.exhibitor_id == exhibitor_id)
        ridden = ridden.where(EntryTeamMember.exhibitor_id == exhibitor_id)
    for query in (entered, ridden):
        for exhibitor, horse_id, name, day in (await db.execute(query)).all():
            add(exhibitor, horse_id, name, day)
    return out


async def booked_by_exhibitor(
    db: AsyncSession, show_id: UUID, exhibitor_id: Optional[UUID] = None
) -> dict[UUID, dict[UUID, int]]:
    """For each exhibitor, how many of each fee line they hold."""
    from models import ShowEntry, ShowEntryReservation

    query = (
        select(ShowEntry.exhibitor_id, ShowEntryReservation.show_fee_id, ShowEntryReservation.quantity)
        .join(ShowEntry, ShowEntryReservation.show_entry_id == ShowEntry.id)
        .where(ShowEntry.show_id == show_id, ShowEntryReservation.quantity > 0)
    )
    if exhibitor_id is not None:
        query = query.where(ShowEntry.exhibitor_id == exhibitor_id)
    out: dict[UUID, dict[UUID, int]] = {}
    for exhibitor, fee_id, quantity in (await db.execute(query)).all():
        out.setdefault(exhibitor, {})[fee_id] = quantity
    return out


async def stall_checks_for_exhibitor(
    db: AsyncSession,
    show,
    exhibitor_id: UUID,
    *,
    booked: Optional[Mapping[UUID, int]] = None,
) -> list[dict]:
    """One exhibitor's checks. `booked` replaces what they hold, for the
    sign-up form asking about a booking it has not saved yet."""
    from models import ShowFee

    fees = (
        await db.execute(
            select(ShowFee).where(ShowFee.show_id == show.id, ShowFee.unit == STALL_UNIT)
        )
    ).scalars().all()
    if not fees:
        return []
    if booked is None:
        booked = (await booked_by_exhibitor(db, show.id, exhibitor_id)).get(exhibitor_id, {})
    horse_days = (await horse_days_by_exhibitor(db, show.id, exhibitor_id)).get(exhibitor_id, {})
    return stall_checks(
        show=show,
        fees=fees,
        periods=await load_stall_periods(db, show.id),
        booked=booked,
        horse_days=horse_days,
    )
