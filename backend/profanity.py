"""The words a show's discussion board refuses (migration 183).

The board is public and takes posts from visitors with no account, so a post
is checked before it is saved, and one carrying a word on this list is refused
with the word named, for the poster to reword. Refused rather than starred out:
nothing offensive is ever stored, and the poster sees exactly what tripped it
rather than a post that went up looking different from what they typed.

**This is a first line, not moderation.** It catches the common words and the
usual dodges -- capitals, `$h1t`, `fuuuuck`, `f.u.c.k` -- and nothing cleverer.
The show office hiding a post deals with the rest, and the filter must never be
the reason a post that says nothing wrong is refused. So:

- **Whole words, not substrings,** for nearly everything. Matching inside words
  is how "Scunthorpe" and "Essex" get refused. Only a few stems that occur in
  no innocent English word are matched anywhere in a word (`ANYWHERE`).
- **Endings only where no innocent word results.** "Spic" takes none, or
  "spicy" would be refused; "prick" is not listed at all, for "pricked".
- **Nothing a horse show says for a living, or says at the rail.** *Ass* (a
  donkey -- donkey classes exist), *jackass* (a male donkey), *cock* (a rooster),
  *dick* (a name), *hell* and *damn*, and *chink* ("a chink in the fence") are
  deliberately absent.
"""

from __future__ import annotations

import re

# Stems that appear in no innocent English word, so they are found anywhere in
# a word: "fucking", "motherfucker", "fuckwit".
ANYWHERE = (
    "fuck",
    "motherf",
    "nigger",
    "nigga",
    "faggot",
)

# Whole words that may carry the endings below and still be the word:
# "shits", "bitches", "bitching", "shitty".
WITH_ENDINGS = (
    "shit",
    "bullshit",
    "dipshit",
    "horseshit",
    "shithead",
    "cunt",
    "bitch",
    "bastard",
    "whore",
    "slut",
    "twat",
    "wanker",
)

ENDINGS = ("", "s", "es", "ed", "er", "ers", "ing", "in", "y", "ty", "ier", "iest")

# Whole words matched exactly as written, because an ending would make an
# innocent word of them: "spicy", "retarder".
EXACT = (
    "asshole",
    "assholes",
    "dumbass",
    "dumbasses",
    "fag",
    "fags",
    "retard",
    "retards",
    "retarded",
    "spic",
    "spics",
    "kike",
    "kikes",
    "wetback",
    "wetbacks",
)

# The usual letter-for-symbol dodges.
_LEET = str.maketrans({
    "0": "o",
    "1": "i",
    "!": "i",
    "|": "i",
    "3": "e",
    "4": "a",
    "@": "a",
    "5": "s",
    "$": "s",
    "7": "t",
    "+": "t",
})

# A run of three or more of one letter is one letter: "fuuuuck". Two are left
# alone, because English doubles letters all the time ("shiitake").
_RUN = re.compile(r"(.)\1{2,}")

# Four or more single letters split by dots, dashes, underscores, asterisks or
# spaces -- "f.u.c.k", "s h i t" -- are joined before checking.
_SPLIT = r"[\s._*\-]+"
_SPELLED_OUT = re.compile(rf"\b(?:[a-z]{_SPLIT}){{3,}}[a-z]\b")

_WORD = re.compile(r"[a-z]+")

_WHOLE = {word + ending for word in WITH_ENDINGS for ending in ENDINGS} | set(EXACT)


def _normalise(text: str) -> str:
    lowered = text.lower().translate(_LEET)
    lowered = _SPELLED_OUT.sub(lambda m: re.sub(_SPLIT, "", m.group(0)), lowered)
    return _RUN.sub(r"\1", lowered)


def find_profanity(text: str) -> list[str]:
    """The words in `text` the board refuses, each once, in the order found.

    Empty when there is nothing to refuse. Each comes back normalised --
    "Sh1t" as "shit" -- which is how the refusal names it.
    """
    found: list[str] = []
    for word in _WORD.findall(_normalise(text)):
        hit = word in _WHOLE or any(stem in word for stem in ANYWHERE)
        if hit and word not in found:
            found.append(word)
    return found


def refusal_message(words: list[str]) -> str:
    """The sentence the board prints when a post is refused."""
    quoted = ", ".join(f"“{word}”" for word in words)
    return (
        f"Please reword your post -- the board doesn't allow {quoted}. "
        "Everybody at the show can read it, young riders included."
    )
