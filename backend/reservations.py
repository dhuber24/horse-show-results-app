"""What a show requires an exhibitor to book, and why.

`show_fees.min_quantity` (migration 128) is a floor the secretary typed in --
"at least four bags". It is the whole answer where it is set, and it is set on
almost no show, because the fact a show usually records is a different one:
`shows.shavings_ban_outside`, ticked in setup Step 4, which says outside
bedding is not allowed on the grounds.

Those two are the same requirement written down twice, and only one of them
was being enforced. A show that bans outside shavings, sells bags, and never
typed a number into the fee took sign-ups with **no bedding at all** -- the
exhibitor answered the question by leaving it alone, and the office found out
when a horse arrived with nowhere to stand.

So the floor is derived rather than only read:

* An explicit `min_quantity` always wins where it is higher. The show has said
  something more specific than "some", and this must not talk it down.
* A ban on outside shavings puts a floor of one bag on the bedding lines --
  but only on an exhibitor who has reserved a stall. A day-haul entry that
  ships in on the Saturday and goes home has nothing to bed, and charging them
  for a bag they cannot use would be the requirement misfiring in the one
  direction nobody can argue their way out of at the desk.

One bag rather than a guess at how many, because the number is the show's to
state and the app does not know how deep this venue wants a stall bedded.
A show wanting a real minimum sets `min_quantity` and this defers to it.

Enforced in `save_signup` and mirrored by the sign-up form's picker, which
starts at the floor and will not go under it. As ever the form is a courtesy:
the router refuses the same booking whether or not a screen was involved.
"""
from __future__ import annotations

from typing import Iterable, Mapping
from uuid import UUID

# The units a bag of bedding is sold in, and the units a stall is sold in.
# Read off the fee's unit rather than its `code`, for the same reason the
# sign-up picker groups by unit: a show that adds its own bedding line under a
# name nobody has seen before still bills `per_bag`, and a rule keyed on the
# seeded `shavings` code would silently skip it.
BEDDING_UNITS = frozenset({"per_bag"})
STALL_UNITS = frozenset({"per_stall"})

# The units a floor may be set on at all.
#
# Bedding only -- not camping (`per_night` / `per_day` / `per_show`), for the
# reason below, and not stalls either. A minimum stall count was offered here
# once, on the reasoning that a venue requiring two stalls a rig is no
# stranger than one requiring four bags -- but nobody has ever needed a floor
# under how many stalls an exhibitor books: they book what they need, and
# there is no venue policy like "every rig takes a stall" the way "every stall
# gets bedded" is a real one. A bag count is different -- the venue is stating
# how deep it wants a stall bedded, which is a fact about the *grounds*, not
# about the booking. So this is bedding's alone.
#
# Camping is excluded for the reason its own comment used to give: a minimum
# is a *policy* -- "we will not have horses bedded on less than this" -- and
# no show has ever required everybody who enters to also camp. Offering the
# control there put a box on the setup screen whose own explanation
# ("required of everyone who signs up") was nonsense against the line it sat
# under, and a stray value in it would have refused sign-ups for not booking a
# camping spot.
REQUIRABLE_FEE_UNITS = BEDDING_UNITS


def _quantity(requested: Mapping[UUID, int], fee_id: UUID) -> int:
    """A line that was left out is a line booked at nought.

    This is the whole reason the check runs over the fee catalogue rather than
    over the lines that were sent: omitting the line entirely is the easiest
    way to book none of something, and a range check on the request cannot see
    a line that is not in it.
    """
    return requested.get(fee_id, 0)


def stalls_reserved(fees: Iterable, requested: Mapping[UUID, int]) -> int:
    """How many stalls this booking reserves, across every stall line.

    Summed across lines because a show sells several: a horse stall, a tack
    stall, early arrival. Any of them means the exhibitor is stabling here.
    """
    return sum(
        _quantity(requested, f.id) for f in fees if f.unit in STALL_UNITS
    )


def required_quantity(fee, *, show, stalls: int) -> int:
    """The fewest of this line the show will accept in this booking.

    `stalls` is what the booking under consideration reserves, not what the
    exhibitor reserved last time -- somebody dropping to no stalls at all is
    dropping the bedding requirement with it, in the same save.

    Read here as well as guarded on the way in, because the column is older
    than the guard: a stray minimum on a camping line, set before this rule
    existed, would otherwise go on refusing sign-ups from a box no screen
    offers any more.
    """
    if fee.unit not in REQUIRABLE_FEE_UNITS:
        return 0
    floor = fee.min_quantity or 0
    if (
        fee.unit in BEDDING_UNITS
        and getattr(show, "shavings_ban_outside", False)
        and stalls > 0
    ):
        floor = max(floor, 1)
    return floor


def minimum_shortfall(fees: Iterable, *, show, requested: Mapping[UUID, int]):
    """The first line this booking does not reach the floor on, or None.

    Returns `(fee, floor, booked)`. First rather than all of them: the sign-up
    form fixes one line at a time and a list of everything wrong at once reads
    as a broken form rather than a missing number.
    """
    fees = list(fees)
    stalls = stalls_reserved(fees, requested)
    for fee in fees:
        floor = required_quantity(fee, show=show, stalls=stalls)
        booked = _quantity(requested, fee.id)
        if floor and booked < floor:
            return fee, floor, booked
    return None
