"""How each class is placed: the four card types (migration 155).

The show office chooses between four kinds of card, per class:

  * **placing** -- Placing Cards: rank order, 1st, 2nd, 3rd; the rail classes.
  * **scored** -- Scored / Numeric Cards: maneuvers or fences scored with
    deductions -- reining, cutting, trail, hunter over fences.
  * **equitation** -- Equitation / Pattern Cards: rider position, accuracy and
    precision through a set pattern, on the ground or mounted -- showmanship,
    horsemanship, equitation.
  * **timed** -- Timed: the clock places the class.

`classes.score_type` stays the engine's field -- the scribe screens, the
ranking, side pots and the duplicate-horse rule all branch on it -- and each
card type maps onto exactly one score type. Scored and equitation both place by
score, which is the whole reason `classes.card_type` exists: `score_type`
cannot tell them apart.

Everything here is pure, so the rules are pinned by tests without a database.
"""

from __future__ import annotations

import re
from typing import Optional

CARD_TYPES = ("placing", "scored", "equitation", "timed")

SCORE_TYPE_FOR = {
    "placing": "placement",
    "scored": "pattern",
    "equitation": "pattern",
    "timed": "time",
}

# The card types a judge's-card sheet (`judging_systems`) can belong to. A
# placing card is a ranking and a timed class is a clock, so neither has one.
SHEET_CARD_TYPES = frozenset({"scored", "equitation"})

# Where the rider is judged through a set pattern -- on the ground
# (showmanship) or mounted (horsemanship, equitation). Everything else placed
# by score is a scored class: reining, trail, ranch riding, over fences.
_EQUITATION = re.compile(r"equitation|horsemanship|showmanship", re.IGNORECASE)


def derived_card_type(
    score_type: Optional[str],
    discipline_name: Optional[str] = None,
    class_name: Optional[str] = None,
    sheet_card_type: Optional[str] = None,
) -> str:
    """The card type of a class nobody has chosen one for.

    The score type decides placing and timed outright. A score-based class
    follows its sheet where it has one -- an equitation sheet is an equitation
    card -- and otherwise its discipline or its name.
    """
    if score_type == "time":
        return "timed"
    if score_type != "pattern":
        return "placing"
    if sheet_card_type in SHEET_CARD_TYPES:
        return sheet_card_type
    text = " ".join(part for part in (discipline_name, class_name) if part)
    return "equitation" if _EQUITATION.search(text) else "scored"


def effective_card_type(
    stored: Optional[str],
    score_type: Optional[str],
    discipline_name: Optional[str] = None,
    class_name: Optional[str] = None,
    sheet_card_type: Optional[str] = None,
) -> str:
    """The card type a class is placed by.

    The office's choice where it has made one -- **but only while it still
    agrees with `score_type`**. Anything that changes the score type without
    going through the Scoring step (the class editor, an import) would
    otherwise leave a class listed as a placing card and scored by number.
    """
    if stored in SCORE_TYPE_FOR and SCORE_TYPE_FOR[stored] == score_type:
        return stored
    return derived_card_type(score_type, discipline_name, class_name, sheet_card_type)


def sheet_fits(card_type: str, sheet_card_type: Optional[str]) -> bool:
    """Whether a judge's-card sheet may be put on a class of this card type. A
    sheet no card type claims is offered to both score-based ones."""
    if card_type not in SHEET_CARD_TYPES:
        return False
    return sheet_card_type is None or sheet_card_type == card_type
