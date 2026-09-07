"""The cards an exhibitor holds, and the one date they all expire on.

APHA gates five of its divisions on a card rather than on age or membership
alone -- Amateur, Novice Amateur, Amateur Walk-Trot, Novice Youth and Youth
Walk-Trot 11-18 -- and every one of them runs 1 January to 31 December and is
renewed annually. APHA says so twice, in the two places an exhibitor meets it:
"Amateur cards run January 1-December 31 and must be renewed annually"
(apha.com/competition/amateurs), and on the entry form itself, "ALL APHA
AMATEUR, NOVICE AMATEUR, AMATEUR WALK TROT, NOVICE YOUTH AND YOUTH WALK TROT
11-18 CARDS EXPIRE DECEMBER 31ST".

**So the expiry is derived, not stored** -- the same call the app makes about a
horse's age. What somebody holds is *a 2026 Amateur card*; the 31 December is
the rule, not a fact about their card, and a date box would let a card claim to
expire in June. `card_expiry()` is the only place the rule is written down, so
nothing can quote a different one.

Renewing is therefore raising `valid_year`, not editing a date. That is what the
annual renewal *is*, and it keeps the two ideas apart: a card for a year the
show has not reached yet is not a lapsed card that somebody has been sloppy
about.

**Which associations issue which cards is a map, and it only knows APHA.**
AQHA's card rules have not been supplied, and offering an exhibitor a card whose
year-end this app has guessed at is worse than offering none -- they would file
it, the desk would read it, and nobody would find out until the gate. Adding an
association is one entry here once its rule is in hand.

The division codes are `entries.apha_division`'s own vocabulary (migration 115),
deliberately, because a card is what entitles an entry to name that division and
two lists for one concept is how they drift apart. YOUTH and
YOUTH_WALK_TROT_5_10 are absent because APHA's notice does not list them --
youth eligibility is age and youth membership, not a card -- and OPEN and
SOLID_PAINT_BRED need no card at all.

Nothing here refuses anything. A card is paperwork, and paperwork flags rather
than blocks: what the office holds in its hand is the authority, which is why
`show_verifications` exists.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from rules.apha import DIVISION_LABELS

#: The divisions APHA issues a competition card for, in the order the rule book
#: and the entry form list them. Mirrors the CHECK constraint on
#: `exhibitor_competition_cards.division` (migration 134).
APHA_CARD_DIVISIONS = (
    "AMATEUR",
    "NOVICE_AMATEUR",
    "AMATEUR_WALK_TROT",
    "NOVICE_YOUTH",
    "YOUTH_WALK_TROT_11_18",
)

#: Keyed on `associations.code`. An association absent from this map issues no
#: card *as far as this app knows*, which is not the same claim as issuing none
#: -- see the module docstring.
CARD_DIVISIONS_BY_ASSOCIATION = {
    "APHA": APHA_CARD_DIVISIONS,
}

#: Every division any association issues a card for. What the API validates an
#: incoming division against; which association may carry it is a separate
#: question, asked by `card_divisions_for`.
ALL_CARD_DIVISIONS = tuple(
    dict.fromkeys(d for divisions in CARD_DIVISIONS_BY_ASSOCIATION.values() for d in divisions)
)

#: The earliest year a card could name. APHA was founded in 1962; the upper
#: bound keeps a mistyped year out of the table. Mirrors the CHECK constraint.
MIN_CARD_YEAR = 1962
MAX_CARD_YEAR = 2100


def card_divisions_for(association_code: Optional[str]) -> tuple[str, ...]:
    """The divisions this association issues a card for. Empty is a real answer."""
    if not association_code:
        return ()
    return CARD_DIVISIONS_BY_ASSOCIATION.get(association_code.strip().upper(), ())


def issues_cards(association_code: Optional[str]) -> bool:
    return bool(card_divisions_for(association_code))


def division_label(division: str) -> str:
    """How the division reads on screen.

    Borrowed from the rules rather than restated: `.title()` on the stored value
    gives "Youth Walk Trot 11 18", which is not what anybody calls it.
    """
    return DIVISION_LABELS.get(division, division)


def card_expiry(valid_year: int) -> date:
    """31 December of the competition year. The whole rule, in one place."""
    return date(valid_year, 12, 31)


def is_current(valid_year: int, as_of: date) -> bool:
    """Is the card still good on `as_of`?

    `as_of` is never defaulted to today, for the reason health paperwork and
    membership expiry are not: the question a show office asks is whether the
    card covers *the show*, and a card that lapses on the last day of a
    New Year's show is exactly the one to chase. A card is good through the last
    day of its year, so this is inclusive.
    """
    return card_expiry(valid_year) >= as_of


def current_card_year(today: date) -> int:
    """The competition year a card bought today would be for.

    The calendar year, because the card year is the calendar year -- stated as a
    function so the screens that pre-fill the box and the tests that pin the
    behaviour agree about it.
    """
    return today.year
