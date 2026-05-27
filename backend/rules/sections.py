"""Bracket/section classifier for association class names.

AQHA's `aqha_standard_classes.division` column carries only a coarse bracket
(Amateur / Open / Youth / Equestrians With Disabilities). The class name
itself encodes the finer bracket — Select (50+), Novice Amateur, Walk-Trot
13 & Under, etc. This module refines the base bracket using name keywords
so the Standard Library matrix can offer real, usable cells like
"Western Pleasure × Select" or "Showmanship × Walk-Trot 13 & Under".

Sister module to `disciplines.py`. Same conventions: ordered keyword list,
first hit wins, most-specific patterns first.
"""
from __future__ import annotations


# (keyword_substring, refined_section_name) in priority order.
# Match is case-insensitive substring on the class name; first hit wins.
# These refined names must match standard_sections.name rows seeded for AQHA.
SECTION_KEYWORDS: list[tuple[str, str]] = [
    # ── Walk-Trot brackets (most specific first) ──
    # AQHA CSV uses "WALK TROT" without hyphen; APHA uses "WALK-TROT".
    ("WALK-TROT 13 AND UNDER",       "Walk-Trot 13 & Under"),
    ("WALK TROT 13 AND UNDER",       "Walk-Trot 13 & Under"),
    ("WALK-TROT 13 & UNDER",         "Walk-Trot 13 & Under"),
    ("WALK TROT 13 & UNDER",         "Walk-Trot 13 & Under"),
    ("WALK-TROT 14-18",              "Walk-Trot 14-18"),
    ("WALK TROT 14-18",              "Walk-Trot 14-18"),
    ("WALK-TROT 14 & OVER",          "Walk-Trot 14-18"),
    ("WALK-TROT-CANTER",             "Walk-Trot-Canter"),
    ("WALK TROT CANTER",             "Walk-Trot-Canter"),
    ("WALK-TROT",                    "Walk-Trot"),
    ("WALK TROT",                    "Walk-Trot"),

    # ── Lead Line ──
    ("LEAD LINE",                    "Lead Line"),

    # ── Select (50+) — comes before Amateur because "Amateur Select" is Select bracket ──
    ("AMATEUR SELECT",               "Select (50+)"),
    ("SELECT AMATEUR",               "Select (50+)"),
    ("SELECT ",                      "Select (50+)"),

    # ── Novice Amateur / Level 1 Amateur ──
    ("NOVICE AMATEUR",               "Novice Amateur"),
    ("L1 AMATEUR",                   "Novice Amateur"),
    ("LEVEL 1 AMATEUR",              "Novice Amateur"),
    ("ROOKIE AMATEUR",               "Novice Amateur"),

    # ── Youth age splits (must precede generic Youth fallback) ──
    ("YOUTH 13 AND UNDER",           "Youth 13 & Under"),
    ("YOUTH 13 & UNDER",             "Youth 13 & Under"),
    ("YOUTH 14-18",                  "Youth 14-18"),
    (" 13 AND UNDER",                "Youth 13 & Under"),
    (" 13 & UNDER",                  "Youth 13 & Under"),
    (" 14-18",                       "Youth 14-18"),
    (" 18 & UNDER",                  "Youth 14-18"),
    (" 18 AND UNDER",                "Youth 14-18"),

    # ── Equestrians With Disabilities (kept as-is, not refined) ──
    # Base bracket from CSV is already correct; no override needed.
]


# Maps coarse AQHA division column values to refined-section fallback names
# when no keyword in SECTION_KEYWORDS matches the class name.
BASE_BRACKET_FALLBACK: dict[str, str] = {
    "Open":                          "Open",
    "Amateur":                       "Amateur",
    "Youth":                         "Youth 14-18",
    "Equestrians With Disabilities": "Equestrians With Disabilities",
}


def classify_section(class_name: str, base_bracket: str) -> str:
    """Return the refined section name for an AQHA class.

    `base_bracket` is the CSV `division` column (Amateur/Open/Youth/EWD).
    The class name is checked against SECTION_KEYWORDS for refinements;
    on no match, the coarse base bracket is mapped to its standard_sections
    row via BASE_BRACKET_FALLBACK.

    Returns the section name string. The caller is responsible for resolving
    it to a standard_sections row id, creating one if missing.
    """
    if class_name:
        upper = class_name.upper()
        for keyword, refined in SECTION_KEYWORDS:
            if keyword in upper:
                return refined
    return BASE_BRACKET_FALLBACK.get(base_bracket, base_bracket)
