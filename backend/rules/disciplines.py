"""Discipline classifier for association-imported class names.

AQHA and APHA class lists store the discipline in the class **name** (e.g.
"JUNIOR WESTERN PLEASURE", "RANCH TRAIL 13 AND UNDER", "BARREL RACING").
Their class codes don't reliably encode discipline — APHA's `R1` alone means
six different disciplines, and AQHA's RHC code blocks ambiguously share
keys across brackets. Name-keyword matching produces stable, ~95%-accurate
routing for both associations from a single ordered table.

Bracket / section (Amateur, Youth, Open) comes from `*_standard_classes.division`
directly — that column IS clean.

Order matters: most-specific patterns must precede their substring parents,
e.g. ``"RANCH TRAIL"`` before ``"TRAIL"`` so a Ranch Trail class doesn't
get mis-routed into a generic Trail division.

To add a new discipline, append a row in the right priority position. If
the new keyword is a substring of an existing keyword, put the more specific
one first.

The same file also answers a second question off a class name: whether a class
is one you **qualify into** rather than enter -- see `entered_by_qualification`
at the foot of this module.
"""
from __future__ import annotations

import re
from typing import Literal

ScoreType = Literal["placement", "pattern", "time"]


# (keyword_substring, discipline_name, default_score_type) in priority order.
# Match is case-insensitive substring; first hit wins.
DISCIPLINE_KEYWORDS: list[tuple[str, str, ScoreType]] = [
    # ── Specific Ranch-prefixed disciplines (before generic Trail/Reining/etc) ──
    ("RANCH RAIL PLEASURE",          "Ranch Rail Pleasure", "placement"),
    ("RANCH PLEASURE",               "Ranch Pleasure",      "placement"),
    ("RANCH HORSE CONFORMATION",     "Ranch Conformation",  "placement"),
    ("RANCH CONFORMATION",           "Ranch Conformation",  "placement"),
    # VRH classes drop "RANCH" sometimes (VRH LIMITED CONFORMATION → ranch)
    ("VRH LIMITED CONFORMATION",     "Ranch Conformation",  "placement"),
    ("TIMED RANCH TRAIL",            "Timed Ranch Trail",   "time"),
    ("RANCH TRAIL",                  "Ranch Trail",         "pattern"),
    ("RANCH RIDING",                 "Ranch Riding",        "pattern"),
    ("RANCH REINING",                "Ranch Reining",       "pattern"),
    ("RANCH CUTTING",                "Ranch Cutting",       "pattern"),
    ("RANCH COW WORK",               "Ranch Cow Work",      "pattern"),
    ("RANCH BOX DRIVE",              "Ranch Box Drive",     "pattern"),
    ("RANCH BOXING",                 "Ranch Boxing",        "pattern"),
    ("RANCH SORTING",                "Ranch Sorting",       "time"),
    ("WORKING RANCH HORSE",          "Working Ranch Horse", "pattern"),
    ("VERSATILITY RANCH HORSE",      "Versatility Ranch Horse", "pattern"),
    ("VERSATILITY JUNIOR RANCH HORSE", "Versatility Ranch Horse", "pattern"),
    ("VERSATILITY SENIOR RANCH HORSE", "Versatility Ranch Horse", "pattern"),

    # ── In-Hand Trail / In Hand Trail (Halter Trail) — before generic Trail ──
    ("IN-HAND TRAIL",                "In-Hand Trail",       "pattern"),
    ("IN HAND TRAIL",                "In-Hand Trail",       "pattern"),

    # ── Hunter family (most-specific first) ──
    ("WORKING HUNTER UNDER SADDLE",  "Working Hunter Under Saddle", "placement"),
    ("WORKING HUNTER",               "Working Hunter",      "pattern"),
    ("GREEN HUNTER UNDER SADDLE",    "Hunter Under Saddle", "placement"),
    ("HUNTER UNDER SADDLE",          "Hunter Under Saddle", "placement"),
    # AQHA abbreviates Hunter Under Saddle as "HUS" in walk-trot variants
    (" HUS ",                        "Hunter Under Saddle", "placement"),
    (" HUS(",                        "Hunter Under Saddle", "placement"),
    ("HUNTER HACK",                  "Hunter Hack",         "placement"),

    # ── Equitation ──
    ("HUNT SEAT EQUITATION OVER FENCES", "Equitation Over Fences", "pattern"),
    ("EQUITATION OVER FENCES",       "Equitation Over Fences", "pattern"),
    ("HUNT SEAT EQUITATION",         "Hunt Seat Equitation", "pattern"),
    ("HUNT-SEAT EQUITATION",         "Hunt Seat Equitation", "pattern"),
    # AQHA walk-trot variants abbreviate Equitation → EQ / EQUIT
    ("HUNT SEAT EQ ",                "Hunt Seat Equitation", "pattern"),
    ("HUNT SEAT EQ(",                "Hunt Seat Equitation", "pattern"),
    ("HUNT SEAT EQUIT(",             "Hunt Seat Equitation", "pattern"),
    ("WESTERN HORSEMANSHIP",         "Western Horsemanship", "pattern"),
    ("HORSEMANSHIP",                 "Western Horsemanship", "pattern"),

    # ── Showmanship ──
    ("SHOWMANSHIP AT HALTER",        "Showmanship",         "pattern"),
    ("SHOWMANSHIP",                  "Showmanship",         "pattern"),

    # ── Western Pleasure / Riding ──
    ("GREEN WESTERN PLEASURE",       "Western Pleasure",    "placement"),
    ("WESTERN PLEASURE",             "Western Pleasure",    "placement"),
    # AQHA walk-trot variants abbreviate Western Pleasure → W PLEASURE
    ("W PLEASURE",                   "Western Pleasure",    "placement"),
    ("GREEN WESTERN RIDING",         "Western Riding",      "pattern"),
    ("WESTERN RIDING",               "Western Riding",      "pattern"),

    # ── Trail (after all Ranch/In-Hand/Working/etc) ──
    ("GREEN TRAIL",                  "Trail",               "pattern"),
    ("TRAIL",                        "Trail",               "pattern"),

    # ── Reining ──
    ("PARA REINING",                 "Reining",             "pattern"),
    ("HACKAMORE AND SNAFFLE REINING", "Reining",            "pattern"),
    ("GREEN REINING",                "Reining",             "pattern"),
    ("REINING",                      "Reining",             "pattern"),

    # ── Working Cow Horse / Cutting / Boxing ──
    ("HACKAMORE AND SNAFFLE COW HORSE", "Working Cow Horse", "pattern"),
    ("WORKING COW HORSE BOX DRIVE",  "Working Cow Horse",   "pattern"),
    ("WORKING COW HORSE BOXING",     "Working Cow Horse",   "pattern"),
    ("WORKING COW HORSE",            "Working Cow Horse",   "pattern"),
    ("CUTTING",                      "Cutting",             "pattern"),
    ("BOXING",                       "Working Cow Horse",   "pattern"),  # APHA Boxing All Ages

    # ── Speed events ──
    ("BARREL RACING",                "Barrel Racing",       "time"),
    ("POLE BENDING",                 "Pole Bending",        "time"),
    ("STAKE RACE",                   "Stake Race",          "time"),
    ("STAKE RACING",                 "Stake Race",          "time"),
    ("GOAT TYING",                   "Goat Tying",          "time"),

    # ── Ropings (timed) ──
    ("BREAKAWAY ROPING",             "Breakaway Roping",    "time"),
    ("TIE-DOWN ROPING",              "Tie-Down Roping",     "time"),
    ("TIE DOWN ROPING",              "Tie-Down Roping",     "time"),
    ("DALLY TEAM ROPING-HEADING",    "Team Roping — Heading", "time"),
    ("DALLY TEAM ROPING (HEADING)",  "Team Roping — Heading", "time"),
    ("TEAM ROPING HEADING",          "Team Roping — Heading", "time"),
    ("DALLY TEAM ROPING-HEELING",    "Team Roping — Heeling", "time"),
    ("DALLY TEAM ROPING (HEELING)",  "Team Roping — Heeling", "time"),
    ("TEAM ROPING HEELING",          "Team Roping — Heeling", "time"),
    ("TIMED TEAM ROPING",            "Team Roping",         "time"),
    ("STEER STOPPING",               "Steer Stopping",      "time"),
    ("TEAM PENNING",                 "Team Penning",        "time"),
    # AQHA youth Team Roping drops the "TEAM ROPING" prefix — match the bare verb
    ("HEADING ",                     "Team Roping — Heading", "time"),
    ("HEELING ",                     "Team Roping — Heeling", "time"),

    # ── Mounted Shooting (APHA breaks into rifle/shotgun) ──
    ("COWBOY MOUNTED SHOOTING",      "Mounted Shooting",    "time"),
    ("MOUNTED SHOOTING",             "Mounted Shooting",    "time"),
    ("RIFLE",                        "Mounted Shooting",    "time"),
    ("SHOTGUN",                      "Mounted Shooting",    "time"),

    # ── Dressage ──
    ("WESTERN DRESSAGE",             "Western Dressage",    "pattern"),
    ("DRESSAGE",                     "Dressage",            "pattern"),

    # ── Driving ──
    ("PLEASURE DRIVING",             "Pleasure Driving",    "placement"),
    ("UTILITY DRIVING",              "Pleasure Driving",    "placement"),

    # ── Jumping ──
    ("JUMPING",                      "Jumping",             "pattern"),

    # ── Working Western Rail (AQHA) ──
    ("WORKING WESTERN RAIL",         "Working Western Rail", "placement"),

    # ── Versatility patterns ──
    ("ENGLISH VERSATILITY PATTERN",  "English Versatility Pattern", "pattern"),
    ("WESTERN VERSATILITY PATTERN",  "Western Versatility Pattern", "pattern"),

    # ── Longe Line ──
    ("LONGE LINE",                   "Longe Line",          "placement"),

    # ── Color (APHA-specific) ──
    ("OVERO COLOR",                  "Color Class",         "placement"),
    ("TOBIANO COLOR",                "Color Class",         "placement"),
    ("COLOR CLASS",                  "Color Class",         "placement"),

    # ── Lead Line ──
    ("LEAD LINE",                    "Lead Line",           "placement"),

    # ── All Around ──
    ("ALL AROUND",                   "All Around",          "placement"),
    ("ALL-AROUND",                   "All Around",          "placement"),

    # ── Halter — Champion (catches Grand/Reserve Champion before halter-by-sex) ──
    ("PERFORMANCE GRAND CHAMPION",   "Performance Halter",  "placement"),
    ("PERFORMANCE RESERVE CHAMPION", "Performance Halter",  "placement"),
    ("PERFORMANCE HALTER",           "Performance Halter",  "placement"),
    ("GRAND CHAMPION",               "Halter",              "placement"),
    ("RESERVE CHAMPION",             "Halter",              "placement"),

    # ── Halter — group classes ──
    ("GET OF SIRE",                  "Halter — Group",      "placement"),
    ("SIRE AND GET",                 "Halter — Group",      "placement"),
    ("PRODUCE OF DAM",               "Halter — Group",      "placement"),
    ("MARE AND FOAL",                "Halter — Group",      "placement"),

    # ── Halter — sex/age catch-all (last) ──
    ("BROODMARES",                   "Halter",              "placement"),
    ("STALLIONS",                    "Halter",              "placement"),
    ("MARES",                        "Halter",              "placement"),
    ("GELDINGS",                     "Halter",              "placement"),

    # ── Niche / Mexico-only ──
    ("VAQUEJADA",                    "Vaquejada",           "placement"),
    ("LASSO CUMPRIDO",               "Lasso Cumprido",      "time"),
    ("LAZO DE PANAMA",               "Lazo de Panama",      "time"),
    ("CALAS",                        "Calas",               "placement"),
    ("COLAS",                        "Colas",               "placement"),
]


def classify_class_name(name: str) -> tuple[str, ScoreType] | None:
    """Return (discipline_name, default_score_type) for an association class name.

    Returns None if no keyword matches — caller should fall back to the
    per-show "Unassigned" placeholder.
    """
    if not name:
        return None
    upper = name.upper()
    for keyword, discipline, score_type in DISCIPLINE_KEYWORDS:
        if keyword in upper:
            return (discipline, score_type)
    return None


# ── Classes you qualify into rather than enter ───────────────────────────────
#
# A Grand & Reserve Champion halter class is not entered. The first- and
# second-place horses from each qualifying class are called back, so nobody can
# sign up for one at registration -- there is nothing to sign up *for* until the
# qualifying classes have been judged.
#
# This is a name test for the same reason `classify_class_name` is one: the
# association's own class list says it in the name and nowhere else. It decides
# the column's **starting value** only -- `classes.entered_by_qualification` is
# the authority once the class exists, and the secretary can tick or untick it,
# exactly as `score_type` is derived at create time and stored thereafter.
#
# Deliberately narrow. "Champion" on its own is not enough: a Hi-Point champion
# is an award rather than a class, and a show is entitled to name an ordinary
# class something with "champion" in it. Only the two shapes that appear on
# real schedules match -- a Grand/Reserve pairing, or one of the two on its own
# followed by "champion".
_QUALIFYING_ONLY_RE = re.compile(
    r"""
      \b grand \s* (?: & | and | / ) \s* reserve \b   # "Grand & Reserve ..."
    | \b reserve \s* (?: & | and | / ) \s* grand \b   # ... and the other order
    | \b grand \s+ champion (?: ship )? \b
    | \b reserve \s+ champion (?: ship )? \b
    """,
    re.IGNORECASE | re.VERBOSE,
)


def entered_by_qualification(name: str | None) -> bool:
    """True when a class of this name is reached by placing, not by entering.

    Used to seed `classes.entered_by_qualification` when a class is created,
    and mirrored by migration 129's backfill. If this pattern changes, the
    backfill does not re-run -- existing shows keep whatever is stored, which
    is the point of storing it.
    """
    if not name:
        return False
    return bool(_QUALIFYING_ONLY_RE.search(name))
