"""Reading a placing off a card that may not have one.

`results.place` became nullable in migration 121, when a result gained an
`outcome` — placed, disqualified, eliminated, zero_score or no_score. Everything
that used to sort or compare `r.place` was written when every row had one, and
`min(results, key=lambda r: r.place)` raises a TypeError the first time it meets
a None.

Two decisions live here so the screens cannot disagree about them:

* An **unplaced row is not a candidate**. Best-of-several-judges means the best
  of the cards that placed the entry; a judge who disqualified it did not rank
  it last, they did not rank it at all.
* A **non-placed outcome earns nothing**. Side pot standings and futurity
  Hi-Point are settled from placings and scores, and a run that was thrown out
  should contribute neither. Every row written before migration 121 backfilled
  to `placed`, so no existing standing moves.
"""

from typing import Optional

# Sorts behind every real placing without pretending to be one. Only ever used
# as a sort key — never written to a row or shown to anybody.
UNPLACED_SORTS_LAST = 10**9

# The outcomes that take part in the ranking. A declared zero is one of them:
# cow work separates a 0 from a No Score (SC-265.E.4-6) precisely because the
# zero is a number the sheet compares — it belongs below every horse that
# scored, not off the card altogether. The other three are not in the running.
RANKED_OUTCOMES = frozenset({"placed", "zero_score"})


def result_outcome(result) -> str:
    """This row's outcome, defaulting to 'placed'.

    Through a getattr because rows written before migration 121, and the
    duck-typed rows the tests build, have no such attribute.
    """
    return getattr(result, "outcome", None) or "placed"


def is_ranked(result) -> bool:
    """Whether this card put the entry in the running at all."""
    return result_outcome(result) in RANKED_OUTCOMES


def is_placed(result) -> bool:
    """Whether this card ranked the entry and gave it a place."""
    return is_ranked(result) and getattr(result, "place", None) is not None


def place_key(result) -> int:
    """Sort key putting an unplaced row behind every placed one."""
    place = getattr(result, "place", None)
    return UNPLACED_SORTS_LAST if place is None else place


def placed_only(results):
    """The cards that actually ranked the entry."""
    return [r for r in results if is_placed(r)]


def best_placing(results):
    """The best card among several, or None when none of them placed the entry."""
    placed = placed_only(results)
    return min(placed, key=place_key) if placed else None


def reported_outcome(results) -> Optional[str]:
    """What to say about an entry no card placed.

    Returns None when something did place it — the placing is the answer then.
    Otherwise the first non-placed outcome on file. A panel that agreed will all
    say the same thing; a panel that disagreed is showing one judge's word, which
    is what a single-number screen can hold.
    """
    if not results or best_placing(results):
        return None
    for r in results:
        outcome = result_outcome(r)
        if outcome != "placed":
            return outcome
    return None
