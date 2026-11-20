"""A side pot paid on time, in D splits (migration 205).

A barrel sidepot has no run of its own. Each buy-in is one run in one of the
pot's classes -- the time the rider made in their age division -- and the pot
ranks those times, lowest first:

* **The Ds are measured from the fastest time.** With half-second splits the
  1D is the fastest time up to 0.499 behind it, the 2D starts 0.500 behind,
  and so on; everything past the last line is in the last D. A time exactly
  on a line belongs to the slower D, which is how a 5D is called at the
  in-gate.
* **The pool is shared between the Ds** by `d_percents`, fastest D first, and
  each D pays places by the pot's payout schedule, the band picked by how many
  paid into the whole pot ("number of placings based on the number of
  entries").
* **Unclaimed D money is spread over the Ds that have runners**, in proportion
  to their shares. A D with no runners claims nothing, and a D with fewer
  runners than paid places claims only the places it fills. The money a D
  gains this way goes to the places it filled, in proportion to their
  schedule shares, so none of it is left unclaimed a second time. (The show
  company's call, made for the WSCA Championship Show, 2026-11-19.)
* **Ties split the positions they occupy evenly**, the same as every other
  pot.

Everything is exact (`Fraction`) until the last step, which floors each payout
and gives the odd cents to the fastest run paid, as the per-place pots give
theirs to first place. Whatever no place can take -- every D empty, or a
schedule whose shares add up to less than 100% -- is reported as unawarded,
never paid to somebody by default.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from typing import Hashable, Optional


@dataclass
class TimedRun:
    """One buy-in: its key, and its time in seconds (None: no time to rank)."""

    key: Hashable
    time: Optional[Decimal]


@dataclass
class RunStanding:
    key: Hashable
    time_ms: int
    d_number: int
    place: int
    behind_ms: int


@dataclass
class DLine:
    d_number: int
    percent: int
    from_ms: Optional[int]
    runners: int = 0
    paid_places: int = 0
    amount_cents: int = 0


@dataclass
class TimePotResult:
    standings: list[RunStanding] = field(default_factory=list)
    payouts: dict[Hashable, int] = field(default_factory=dict)
    d_lines: list[DLine] = field(default_factory=list)
    unawarded_cents: int = 0


def to_ms(seconds: Decimal | float | int) -> int:
    """A time in whole milliseconds, half up -- `results.raw_score` holds three
    decimals, so this is exact for anything the scribe typed."""
    return int(Decimal(str(seconds)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP) * 1000)


def rank_runs(runs: list[TimedRun], d_count: int, d_split_ms: int) -> list[RunStanding]:
    """Each timed run's D and its place inside that D, fastest first.

    Runs without a time are left out; the caller reports them as unranked.
    """
    timed = [(r.key, to_ms(r.time)) for r in runs if r.time is not None]
    if not timed:
        return []
    fastest = min(t for _, t in timed)
    by_d: dict[int, list[tuple[Hashable, int]]] = {}
    for key, t in timed:
        behind = t - fastest
        d = min(behind // d_split_ms, d_count - 1) + 1
        by_d.setdefault(d, []).append((key, t))

    out: list[RunStanding] = []
    for d in sorted(by_d):
        rows = sorted(by_d[d], key=lambda kt: kt[1])
        last_t: Optional[int] = None
        place = 0
        for idx, (key, t) in enumerate(rows, start=1):
            if t != last_t:
                place = idx
                last_t = t
            out.append(RunStanding(key=key, time_ms=t, d_number=d, place=place, behind_ms=t - fastest))
    return out


def pay_time_pot(
    standings: list[RunStanding],
    pool_cents: int,
    d_count: int,
    d_split_ms: int,
    d_percents: list[int],
    splits: list[int],
) -> TimePotResult:
    """Share `pool_cents` between the Ds and their places. See the module doc."""
    fastest = min((s.time_ms for s in standings), default=None)
    lines = [
        DLine(
            d_number=d,
            percent=d_percents[d - 1] if d - 1 < len(d_percents) else 0,
            from_ms=None if fastest is None else fastest + (d - 1) * d_split_ms,
        )
        for d in range(1, d_count + 1)
    ]
    result = TimePotResult(standings=standings, d_lines=lines)
    if pool_cents <= 0 or not splits or not standings:
        result.unawarded_cents = max(pool_cents, 0)
        return result

    in_d: dict[int, list[RunStanding]] = {}
    for s in standings:
        in_d.setdefault(s.d_number, []).append(s)

    total_splits = sum(splits)
    claimed: dict[int, int] = {}  # D -> percent x (sum of the splits it fills)
    for line in lines:
        runners = in_d.get(line.d_number, [])
        line.runners = len(runners)
        line.paid_places = min(len(runners), len(splits))
        claimed[line.d_number] = line.percent * sum(splits[: line.paid_places])

    unclaimed = sum(line.percent for line in lines) * total_splits - sum(claimed.values())
    with_runners = [line for line in lines if line.runners]
    share_base = sum(line.percent for line in with_runners)

    exact: dict[Hashable, Fraction] = {}
    for line in with_runners:
        weight = Fraction(claimed[line.d_number])
        if share_base:
            weight += Fraction(unclaimed * line.percent, share_base)
        amount = Fraction(pool_cents) * weight / (100 * 100)
        filled = splits[: line.paid_places]
        filled_total = sum(filled)
        if not filled_total or not amount:
            continue
        position_value = [amount * s / filled_total for s in filled]

        runners = sorted(in_d[line.d_number], key=lambda s: (s.place, s.time_ms))
        i = 0
        while i < len(runners):
            place = runners[i].place
            group = [s for s in runners if s.place == place]
            slots = position_value[place - 1 : place - 1 + len(group)]
            each = sum(slots, Fraction(0)) / len(group)
            for s in group:
                if each:
                    exact[s.key] = each
            i += len(group)

    floored = {key: int(value) for key, value in exact.items()}
    target = int(sum(exact.values(), Fraction(0)))
    leftover = target - sum(floored.values())
    if leftover and floored:
        # The odd cents go to the fastest run paid, as a per-place pot's go to
        # first place.
        first = min(
            (s for s in standings if s.key in floored),
            key=lambda s: (s.d_number, s.place, s.time_ms),
        )
        floored[first.key] += leftover

    result.payouts = {k: v for k, v in floored.items() if v > 0}
    by_key = {s.key: s for s in standings}
    for key, cents in result.payouts.items():
        lines[by_key[key].d_number - 1].amount_cents += cents
    result.unawarded_cents = pool_cents - sum(result.payouts.values())
    return result


def time_pot(
    runs: list[TimedRun],
    pool_cents: int,
    d_count: int,
    d_split_ms: int,
    d_percents: list[int],
    splits: list[int],
) -> TimePotResult:
    """Rank the runs into Ds and pay them: `rank_runs` then `pay_time_pot`."""
    return pay_time_pot(
        rank_runs(runs, d_count, d_split_ms), pool_cents, d_count, d_split_ms, d_percents, splits
    )
