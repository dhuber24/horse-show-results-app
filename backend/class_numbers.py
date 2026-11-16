"""What number a class carries, and how a class is named in a sentence.

Two ways a show's classes get their numbers (`shows.class_numbers_as_printed`,
migration 191):

* **As printed.** A show read off its bill keeps the numbers the bill printed,
  exactly as printed -- "12", "5N", "2-3", "A" -- because that is the number
  exhibitors write on their entry forms and the announcer calls. Moving,
  adding or deleting a class leaves every other class's number alone. A class
  the bill printed no number for (a Grand & Reserve class, a "Ship Challenge")
  has none here either. A class added afterwards takes the next whole number
  after the highest on the show, and the office can change any of them.

* **Running order.** A show built by hand is numbered 1..N down the schedule,
  date then position, and renumbered whenever that order changes. A class
  entered by qualifying -- a Grand & Reserve champion class, which horses are
  called back into -- is skipped: show bills do not number them, and giving one
  a number pushes every class after it one off the bill.

No number is the empty string, not NULL: `classes.class_number` is NOT NULL
text, and every reader already treats it as text.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Sequence

# Longest number a class may carry. A bill's numbers are short ("112N",
# "2-3"); anything longer is a misread name, not a number.
NUMBER_MAX_LENGTH = 20

_LEADING_DIGITS = re.compile(r"^\s*(\d+)")


def number_in_order(ordered: Sequence[Any], *, as_printed: bool) -> None:
    """Set `sort_order` 1..N down `ordered`, and -- unless the numbers are the
    bill's -- the class numbers to match, skipping qualifying classes."""
    n = 0
    for i, cls in enumerate(ordered, start=1):
        cls.sort_order = i
        if as_printed:
            continue
        if cls.entered_by_qualification:
            cls.class_number = ""
        else:
            n += 1
            cls.class_number = str(n)


def next_number(existing: Iterable[str]) -> str:
    """The next whole number after the highest on the show. "112N" counts as
    112, so a class added after the bill's last one is 113."""
    highest = 0
    for number in existing:
        m = _LEADING_DIGITS.match(number or "")
        if m:
            highest = max(highest, int(m.group(1)))
    return str(highest + 1)


def hash_label(cls: Any) -> str:
    """'#12 Western Pleasure', or just the name for a class with no number."""
    number = (getattr(cls, "class_number", "") or "").strip()
    name = getattr(cls, "class_name", "") or ""
    return f"#{number} {name}".strip() if number else name


def class_label(cls: Any) -> str:
    """'Class 12 (Western Pleasure)', or just the name for a class with no number."""
    number = (getattr(cls, "class_number", "") or "").strip()
    name = getattr(cls, "class_name", "") or ""
    if not number:
        return name or "A class"
    return f"Class {number} ({name})" if name else f"Class {number}"
