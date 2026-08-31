"""Adding up a judge's card.

CLAUDE.md used to say the app "does not calculate penalties". That line is
amended here deliberately rather than eroded by accident, and the reasoning is
worth keeping: once the app holds maneuvers and penalties it is either computing
the number that drives placings, side pot standings and futurity Hi-Point, or it
is holding a card next to a separately typed total that can silently disagree
with it. A card the app refuses to add up is a scan with extra steps.

What has *not* changed is the boundary. The app does not judge, does not decide
what a maneuver is worth, and does not decide which penalty applies — every
number here was called by a judge and written down by a scribe. It adds them up,
and a human may overrule the arithmetic.

The math is deliberately dull and lives apart from the router so it can be
exercised without a session:

    total = base + Σ maneuver scores − Σ penalties

Clamped to the system's `score_max` where it declares one (AM-111.F is scored on
a 0-100 scale), and never below zero — a run that fell far enough to go negative
scores zero, which is a real outcome on the result rather than a negative number
on the sheet.
"""

from decimal import Decimal
from typing import Iterable, Optional


def _dec(value) -> Decimal:
    """Everything through Decimal: these are money-like figures and a half-point
    that arrives as a float will eventually add up to 71.49999999999999."""
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def compute_score(
    system,
    maneuvers: Iterable,
    penalties: Iterable,
) -> Optional[Decimal]:
    """The card's total, or None when there is nothing on it yet.

    `system` supplies the base and any ceiling; `maneuvers` are objects with a
    `score`, `penalties` objects with a `value`. Both are read through getattr so
    the tests can hand in plain namespaces.

    None rather than the bare base when the card is empty: a card nobody has
    marked is not a 70, and writing one would put every unjudged entry into the
    placings at the same score.
    """
    maneuver_list = [m for m in maneuvers if getattr(m, "score", None) is not None]
    penalty_list = list(penalties)
    if not maneuver_list and not penalty_list:
        return None

    total = _dec(getattr(system, "base_score", None))
    for m in maneuver_list:
        total += _dec(m.score)
    for p in penalty_list:
        total -= _dec(getattr(p, "value", None))

    score_max = getattr(system, "score_max", None)
    if score_max is not None:
        total = min(total, _dec(score_max))
    return max(total, Decimal("0"))


def effective_score(card) -> Optional[Decimal]:
    """What this card is worth: the override if somebody set one, else the sum.

    One function so the scribe screen, the result it writes and any report all
    read the same number. `override_score` of 0 is a real answer and must not be
    swallowed by a falsy check.
    """
    override = getattr(card, "override_score", None)
    if override is not None:
        return _dec(override)
    computed = getattr(card, "computed_score", None)
    return None if computed is None else _dec(computed)


def is_overridden(card) -> bool:
    """Whether a human has replaced the arithmetic.

    An override equal to the computed figure still counts: somebody looked at
    the number and pinned it, and un-pinning it is a separate act.
    """
    return getattr(card, "override_score", None) is not None


def validate_maneuver(system, score) -> Optional[str]:
    """Why this maneuver score is not one the system allows, or None.

    Returns a message rather than raising so a caller can collect every bad row
    on a card in one response instead of failing on the first.
    """
    if score is None:
        return None
    value = _dec(score)
    low, high = _dec(system.maneuver_min), _dec(system.maneuver_max)
    if value < low or value > high:
        return f"must be between {low} and {high}"
    step = _dec(system.maneuver_step)
    if step > 0 and (value - low) % step != 0:
        return f"must be a multiple of {step}"
    return None


def validate_penalty(catalog_penalty, value) -> Optional[str]:
    """Whether this penalty amount is one its catalog row permits, or None.

    A fixed penalty must be its own value — a scribe typing 4 against a 3-point
    penalty has picked the wrong row. One stated as a range is the judge's call
    within that range, which is a third of AM-111.F's table.

    A penalty with no catalog row is unconstrained by design: it is what the
    judge called and nobody has loaded, and the alternative is the scribe hunting
    for the nearest wrong answer.
    """
    if catalog_penalty is None:
        return None
    amount = _dec(value)
    fixed = getattr(catalog_penalty, "value", None)
    if fixed is not None:
        return None if amount == _dec(fixed) else f"is fixed at {_dec(fixed)}"
    low = _dec(getattr(catalog_penalty, "min_value", None))
    high = _dec(getattr(catalog_penalty, "max_value", None))
    if amount < low or amount > high:
        return f"must be between {low} and {high}"
    return None
