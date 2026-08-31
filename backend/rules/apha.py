"""APHA (American Paint Horse Association) validation rules.

These cover only what the app can answer from data it already holds. Membership
standing, amateur card status, and the point-limited Novice divisions all need
modeling that does not exist yet.

Both entry doors reach these checks through `rules.get_rules` — the show desk
(`routers/entries.py`) and the exhibitor's own class registration
(`routers/show_registration.py`). That is why they live here rather than inline
in a router: both checks below were originally written into the desk endpoint
only, so an exhibitor self-registering was validated against an empty rule set
and could enter a Solid Paint-Bred horse in an Open class.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

from .default import DefaultRules


# Every APHA division an entry may be made in. Mirrors the CHECK constraint on
# `entries.apha_division` (migration 115) — the database is what enforces it;
# this list is what the rules can reason about.
DIVISIONS = (
    "OPEN",
    "SOLID_PAINT_BRED",
    "AMATEUR",
    "NOVICE_AMATEUR",
    "AMATEUR_WALK_TROT",
    "YOUTH",
    "NOVICE_YOUTH",
    "YOUTH_WALK_TROT_11_18",
    "YOUTH_WALK_TROT_5_10",
)

# How each division is written when it appears in a message somebody reads.
# `.title()` on the stored value produces "Youth Walk Trot 11 18", which is not
# what the class list or the rule book calls it.
DIVISION_LABELS = {
    "OPEN": "Open",
    "SOLID_PAINT_BRED": "Solid Paint-Bred",
    "AMATEUR": "Amateur",
    "NOVICE_AMATEUR": "Novice Amateur",
    "AMATEUR_WALK_TROT": "Amateur Walk-Trot",
    "YOUTH": "Youth",
    "NOVICE_YOUTH": "Novice Youth",
    "YOUTH_WALK_TROT_11_18": "Youth Walk-Trot 11-18",
    "YOUTH_WALK_TROT_5_10": "Youth Walk-Trot 5-10",
}

# Divisions whose eligibility turns on who owns the horse, so the entry has to
# say how the exhibitor is related to that owner. Open and Solid Paint-Bred are
# absent on purpose: eligibility there is a property of the horse's registry,
# and nobody's relationship to the owner changes it.
#
# The Walk-Trot divisions are in because AM-300.E places the same ownership
# condition on Amateur Walk-Trot as AM-020 does on Amateur, and YP-015 does the
# same for youth.
RELATIONSHIP_REQUIRED_DIVISIONS = frozenset({
    "AMATEUR",
    "NOVICE_AMATEUR",
    "AMATEUR_WALK_TROT",
    "YOUTH",
    "NOVICE_YOUTH",
    "YOUTH_WALK_TROT_11_18",
    "YOUTH_WALK_TROT_5_10",
})

# Divisions gated on points and prize money — facts the app does not hold and
# never will. AM-205 decides Novice Amateur per category at the time status is
# applied for; YP-255.A.1 caps Novice Youth fence-work earnings at $750. Both
# say the same thing about who answers for it, which is why this is a declaration
# rather than a check.
ATTESTATION_REQUIRED_DIVISIONS = frozenset({
    "NOVICE_AMATEUR",
    "NOVICE_YOUTH",
})

# The exact words somebody agrees to. Written into `entry_attestations.statement`
# by the router so the row keeps the wording that was actually shown — APHA
# revises its limits, and a stored pointer would restate two-season-old consent.
# `frontend/lib/apha.ts` carries the display copy; keep the two in step.
ATTESTATION_STATEMENTS = {
    "novice_eligibility": (
        "I declare that this exhibitor is within APHA's point and earnings limits "
        "for this Novice division as of January 1 of the current show year. "
        "Eligibility is the exhibitor's responsibility (APHA AM-205, YP-255.A.1)."
    ),
}


# SC-110.I — "The show management must announce placings in all classes under all
# judges of all contestants one through seven places after the class is complete."
PUBLISHED_PLACES = 7

# Zones where equitation and horsemanship are worked individually from the gate
# with no rail work and a required working order (AM-115.C, YP-120.C, and the
# hunt-seat equitation class procedure). Every one of those rules carries the
# same exception clause, so it is one list.
INDIVIDUAL_WORK_ZONES = frozenset({12, 13, 14})

# The disciplines that exception applies to, as `rules/disciplines.py` names them.
INDIVIDUAL_WORK_DISCIPLINES = frozenset({
    "Hunt Seat Equitation",
    "Western Horsemanship",
})


# SC-185.F — "An exhibitor may exhibit a maximum of five horses, with no maximum
# restriction on the number of Junior or Senior horses up to a total of five, in
# individual working events", followed by a named list. These are those events as
# `rules/disciplines.py` spells them, so the two cannot drift apart on wording.
#
# The rule's Green variants are absent on purpose: the classifier routes "Green
# Trail" to Trail and "Green Working Hunter" to Working Hunter, which is the same
# event for this cap. Utility Driving is in the rule and **not** here, because the
# classifier has no such discipline — inventing a mapping to Pleasure Driving
# would cap a different event than the one APHA named.
INDIVIDUAL_WORKING_EVENTS = frozenset({
    "Barrel Racing",
    "Breakaway Roping",
    "Cutting",
    "English Versatility Pattern",
    "Jumping",
    "Pole Bending",
    "Ranch Box Drive",
    "Ranch Cow Work",
    "Ranch Cutting",
    "Ranch Pleasure",
    "Ranch Reining",
    "Ranch Riding",
    "Ranch Sorting",
    "Ranch Trail",
    "Reining",
    "Stake Race",
    "Steer Stopping",
    "Team Penning",
    "Team Roping",
    "Tie-Down Roping",
    "Timed Ranch Trail",
    "Trail",
    "Western Riding",
    "Western Versatility Pattern",
    "Working Cow Horse",
    "Working Hunter",
})
MAX_INDIVIDUAL_WORKING_HORSES = 5

# SC-185.F.1 — "In Longe Line, and In-Hand Trail an exhibitor may show a maximum
# of two horses." Counted per event rather than across the pair: the rule names
# them separately and they run as separate classes.
TWO_HORSE_EVENTS = frozenset({"Longe Line", "In-Hand Trail"})
MAX_TWO_HORSE_EVENT_HORSES = 2


def zone_individual_work_note(show, discipline_name):
    """The class-procedure note for this show's zone, or None.

    Returned as text rather than enforced, because none of it is data the app
    holds: whether the class was worked from the gate, whether there was rail
    work, and whether the judge asked for a line-up are all things that happen in
    an arena. What the app can do is put the rule in front of the person running
    the gate before the class starts.
    """
    zone = getattr(show, "apha_zone", None)
    if zone not in INDIVIDUAL_WORK_ZONES:
        return None
    if discipline_name not in INDIVIDUAL_WORK_DISCIPLINES:
        return None
    return (
        f"Zone {zone}: work each exhibitor individually from the gate. "
        "No line-up and no rail work, and a working order is required. "
        "Maximum two horses per exhibitor."
    )


# ── SC-090: getting the show approved ────────────────────────────────────────
#
# None of what follows is enforceable, and that is why it lives here rather than
# in a router. The application goes to APHA on paper, the approved-judge list is
# APHA's, and whether a show is APHA-sponsored — and so entitled to the word
# "Championship" — is not a fact this app holds. What the app does hold is the
# calendar, the show's name, its class list and its judge panel, which is enough
# to put each condition in front of the office while there is still time to act
# on it. Nobody should learn these from a rejection letter.

# SC-090.C — "at least ninety (90) days prior to the first day of the show".
# SC-090.D prices the bands underneath: a late penalty fee per judge under 90
# days, a larger one under 60, and no approval at all under 30.
APPLICATION_STANDARD_DAYS = 90
APPLICATION_LATE_DAYS = 60
APPLICATION_CLOSED_DAYS = 30

# What each band costs, in the terms of the rule that sets it. Kept beside the
# thresholds because a number of days means nothing without the consequence.
APPLICATION_BAND_NOTES = {
    "standard": "That is inside the standard application window (SC-090.C).",
    "late": (
        "Under 90 days the application carries a late penalty fee per judge on "
        "top of the application fee (SC-090.D.1)."
    ),
    "late_second": (
        "Under 60 days the application carries the larger late penalty fee per "
        "judge (SC-090.D.2)."
    ),
    "closed": "Under 30 days APHA will not approve the show (SC-090.D.3).",
}

# SC-090.E/F — approval waits on the class list, and amendments stop being a
# private matter 30 days out.
CLASS_LIST_NOTICE_DAYS = 30

# SC-090.L and SC-090.P — the words APHA keeps. "Champion"/"Championship" are
# reserved for shows APHA sponsors; "World", "National" and "International" may
# be used only with APHA's written permission.
#
# Reported, never refused. The app cannot tell an APHA-sponsored show from any
# other, and a club holding that written permission is entitled to the name.
RESERVED_SHOW_WORDS = {
    "championship": "reserved for APHA-sponsored shows (SC-090.L)",
    "champion": "reserved for APHA-sponsored shows (SC-090.L)",
    "world": "needs APHA's written permission (SC-090.L, SC-090.P)",
    "national": "needs APHA's written permission (SC-090.L, SC-090.P)",
    "international": "needs APHA's written permission (SC-090.L, SC-090.P)",
}

# Ordered longest-first so "Championship" is reported as itself rather than as
# "Champion" with a stray suffix. The word boundary already keeps "National"
# from matching inside "International"; the ordering is for the pair that
# genuinely nests.
_RESERVED_WORD_RE = re.compile(
    r"\b(championship|champion|international|national|world)s?\b",
    re.IGNORECASE,
)


def application_window(show, as_of):
    """SC-090.C/D — how long is left to apply for approval, and at what cost.

    `basis` is which date the count runs to, and it is reported rather than
    folded away because the two answers differ by weeks. SC-090.C measures
    against "the show or contest entry deadline or show date, whichever comes
    first"; a show with no entry deadline on file can only be counted from its
    first day, which is the *later* of the two and therefore the optimistic
    answer. Callers say so — see `validate_show_schedule`.

    Returns None for a show with no start date. The database does not allow that
    shape; a half-built object in a test does.
    """
    start = getattr(show, "start_date", None)
    if start is None or as_of is None:
        return None

    closes = getattr(show, "entry_deadline", None)
    if closes is not None and closes < start:
        basis, basis_date = "entry_deadline", closes
    else:
        basis, basis_date = "start_date", start

    days = (basis_date - as_of).days
    if days >= APPLICATION_STANDARD_DAYS:
        band = "standard"
    elif days >= APPLICATION_LATE_DAYS:
        band = "late"
    elif days >= APPLICATION_CLOSED_DAYS:
        band = "late_second"
    else:
        band = "closed"

    return {
        "basis": basis,
        "basis_date": basis_date,
        "standard_deadline": basis_date - timedelta(days=APPLICATION_STANDARD_DAYS),
        "days_remaining": days,
        "band": band,
    }


def show_name_reservations(name):
    """Reserved words in a show's name, as {word: why}. Empty is the usual answer."""
    found: dict[str, str] = {}
    for match in _RESERVED_WORD_RE.finditer(name or ""):
        word = re.sub(r"s$", "", match.group(0).lower())
        reason = RESERVED_SHOW_WORDS.get(word)
        if reason and word not in found:
            found[word] = reason
    return found


# ── SC-095: the minimum a show must offer ────────────────────────────────────
#
# SC-095.A is conditional on the size of the judge panel, which is the one hard
# fact in it: a show with three or more judges must offer two Open halter
# classes — Junior (2 and under) and Senior (3 and over) — and four performance
# contests, or it is not approved.
#
# Everything *else* about it is inference. "Open division" is not a column: the
# app holds a per-show discipline (Halter) and a per-show bracket, and at a real
# APHA show the Open halter classes are bracketed by **age** ("Yearling", "Four
# Year & Older") while Amateur and Youth carry their names in the bracket. So
# Open is read as the absence of another division's name, and the age split is
# read out of the class name and its bracket together.
#
# Which is why almost none of this is reported as a finding. `show_minimums`
# returns what it found and the panel prints it for somebody to read; only the
# two failures that survive every reading of the rule are raised as warnings.

SHOW_MINIMUM_JUDGE_PANEL = 3
MINIMUM_OPEN_HALTER_CLASSES = 2
MINIMUM_PERFORMANCE_CONTESTS = 4

# A class carrying any of these is some other division's, not the Open division.
# Solid Paint-Bred is in the list for the same reason as Amateur: SC-325 gives it
# its own division, and SC-095.A asks specifically about Open.
_NOT_OPEN_RE = re.compile(
    r"\b(amateur|youth|novice|walk[- ]?trot|lead[- ]?line|futurity|"
    r"solid[- ]paint|spb)\b",
    re.IGNORECASE,
)

# SC-095.A.1.a — "Junior, 2 and Under". Age words only: "Fillies" and "Colts &
# Geldings" are sexes, and a gelding is any age.
_JUNIOR_HALTER_RE = re.compile(
    r"\b(weanling|yearling|two[- ]year|2[- ]year|"
    r"2\s*(&|and)\s*under|two\s*(&|and)\s*under)\b",
    re.IGNORECASE,
)

# SC-095.A.1.b — "Senior, 3 and Over".
_SENIOR_HALTER_RE = re.compile(
    r"\b(three[- ]year|3[- ]year|four[- ]year|4[- ]year|aged|"
    r"[34]\s*(&|and)\s*(over|older)|three\s*(&|and)\s*(over|older))\b",
    re.IGNORECASE,
)


def _class_text(cls):
    """The class name and its bracket, together.

    Both halves carry the answer and neither carries it reliably alone: at a real
    show "Yearling Stallions" sits in a bracket called "Yearling", but "Amateur
    Stallions All Ages" says Amateur in the name and in the bracket, and a
    "Grand & Reserve" class says its division only in the bracket.
    """
    parts = [getattr(cls, "class_name", None) or ""]
    division = getattr(cls, "division", None)
    if division is not None:
        parts.append(getattr(division, "name", None) or "")
    return " ".join(parts)


def _is_halter(cls):
    """Whether the classifier routed this class to a halter discipline.

    Matched on the substring so "Performance Halter" and "Halter — Group" come
    with it. They are not the classes SC-095.A.1 asks for, but they are halter,
    and counting them as *performance* contests would inflate the only number
    that can produce a finding.
    """
    discipline = getattr(cls, "discipline", None)
    name = getattr(discipline, "name", None) or ""
    return "halter" in name.lower()


def show_minimums(show, classes):
    """SC-095.A — what a 3-or-more-judge show has to offer to be approved.

    Reports rather than judges. `open_halter_unclassified` is the honest part:
    a Grand & Reserve Champion class is Open halter with no age in it, and the
    app saying "no Junior halter found" over a schedule that plainly has one is
    how an office learns to stop reading the panel.

    `performance_upper_bound` is every class the classifier did **not** route to
    a halter discipline. It is an upper bound and named as one: SC-190.A defines
    what counts as a performance contest and has not been supplied, so the only
    safe use of this number is noticing when it is below four — a show short of
    four under the broadest possible reading is short under every reading.
    """
    judges = list(getattr(show, "judges", None) or [])
    exemption = sc095_clinic_exemption(show)
    junior, senior, unclassified = [], [], []
    performance = 0

    for cls in classes or []:
        if not _is_halter(cls):
            performance += 1
            continue
        text = _class_text(cls)
        if _NOT_OPEN_RE.search(text):
            continue
        name = getattr(cls, "class_name", None) or "(unnamed class)"
        if _JUNIOR_HALTER_RE.search(text):
            junior.append(name)
        elif _SENIOR_HALTER_RE.search(text):
            senior.append(name)
        else:
            unclassified.append(name)

    return {
        "judge_count": len(judges),
        "applies": len(judges) >= SHOW_MINIMUM_JUDGE_PANEL and exemption is None,
        "exempt_reason": exemption,
        "required_performance": MINIMUM_PERFORMANCE_CONTESTS,
        "open_junior_halter": junior,
        "open_senior_halter": senior,
        "open_halter_unclassified": unclassified,
        "performance_upper_bound": performance,
    }


# ── SC-100 and SC-105: what kind of show, and how many judges ────────────────
#
# The categories and their judge limits are **data** (`show_categories`,
# migration 124): they are the association's own taxonomy, they have to render as
# a picker in show setup, and APHA revises them. What lives here is the part of
# those rules the app cannot check at all, reported as text against whichever
# category the show chose — so that nobody meets a requirement for the first time
# in a rejection letter.

SC095_CLINIC_EXEMPT_CATEGORY = "two_judge"

CATEGORY_UNCHECKED_REQUIREMENTS = {
    "single_judge": [
        "A clinic may run alongside the show with the official judge as "
        "clinician, but not when the show is held in conjunction with an approved "
        "Paint-O-Rama, and the clinician must be approved by APHA (SC-100.A.1).",
    ],
    "two_judge": [
        "One show must finish before another starts, unless the two run in "
        "separate arenas (SC-105.C.4), and both must be at the same location "
        "(SC-105.C.7).",
        "A clinician serving alongside the show must be approved by APHA, and the "
        "show may not be held in conjunction with an approved Paint-O-Rama "
        "(SC-105.C.2).",
    ],
    "paint_o_rama": [
        "Must be sponsored and operated by an official APHA Regional Club "
        "(SC-105.D.1). Recognized livestock shows and state fairs may hold one a "
        "year with up to four judges without that sponsorship (SC-105.D.3.a.2).",
        "A regional club may hold two Paint-O-Ramas a year, or four if its state, "
        "province or territory is in Zone 10 (SC-105.D.3.a). The sponsorship may "
        "not be sold or assigned to another club (SC-105.D.3.b), and a club may "
        "not host one outside its own state or province except by co-sponsoring "
        "with a club there (SC-105.D.3.c).",
    ],
    "zone_show": [
        "One Zone Show per zone per year, coordinated and sponsored by a Zone "
        "Coordinating Committee drawn from the zone's clubs (SC-105.E.1, "
        "SC-105.E.3).",
    ],
}

# SC-105.B.3 and SC-105.B.4 — true of every multiple-judge show whatever its
# category, and both already the way this app works. Stated on the panel so the
# office can see the app is not quietly doing something else with the cards.
MULTIPLE_JUDGE_NOTES = [
    "Each judge works independently, with no consultation during judging — except "
    "over whether a disqualification or a 5- or 3-point penalty occurred, and then "
    "only with a scribe, show manager, ring steward or other designated person "
    "present (SC-105.B.4).",
    "An entry is an entry under every judge, and show fees are assessed "
    "accordingly (SC-105.B.3).",
]


def _show_days(show):
    """How many days the show runs, inclusive. None when it cannot be told."""
    start = getattr(show, "start_date", None)
    end = getattr(show, "end_date", None)
    if start is None or end is None:
        return None
    return (end - start).days + 1


def sc095_clinic_exemption(show):
    """SC-105.C.3 — a two-judge show offered with a clinic is not required to
    offer SC-095's minimum classes, pending APHA approval.

    This can genuinely fire, even though SC-095 only bites at three or more
    judges, because SC-105.C.1 limits a two-judge show to two judges **in the
    arena at any given time** rather than two judges on the show. A show rotating
    three judges through a two-judge arena is categorised `two_judge` and counts
    three here.
    """
    category = getattr(show, "show_category", None)
    if getattr(category, "code", None) != SC095_CLINIC_EXEMPT_CATEGORY:
        return None
    if not getattr(show, "offers_clinic", False):
        return None
    return (
        "A two-judge show offered with a clinic is not required to offer the "
        "SC-095 minimum classes, pending APHA approval (SC-105.C.3)."
    )


def category_requirements(show):
    """The SC-100/SC-105 requirements the app cannot check, for this show.

    Returned as text against the chosen category rather than raised as findings,
    because every one of them is about APHA's calendar or its club registry. A
    finding the office can never clear is one they learn to scroll past.
    """
    category = getattr(show, "show_category", None)
    code = getattr(category, "code", None)
    notes = list(CATEGORY_UNCHECKED_REQUIREMENTS.get(code, []))
    if code and code != "single_judge":
        notes.extend(MULTIPLE_JUDGE_NOTES)
    return notes


class APHARules(DefaultRules):
    code = "APHA"

    def required_published_places(self, cls) -> int:
        """SC-110.I. Seven, under every judge, before a class is posted.

        The scribe screen has warned about *interior* gaps since the publish gate
        went in — 1, 2, 4 with 3 missing. It says nothing about a card that stops
        short, so places 1-3 on a class of twenty passed clean, and that is the
        shape a half-entered card actually has.
        """
        return PUBLISHED_PLACES

    def ties_must_be_broken(self, cls) -> bool:
        """AM-115.B.2 and the pattern class procedures: ties are the judge's call.

        Every scored class in the rule book says the same thing — equal scores are
        broken at the judge's discretion — so a tie is not a result APHA will take.

        Scored classes only. A `placement` class tie is one the scribe ticked
        deliberately, recording a decision the judge already made on paper; a
        `pattern` or `time` tie is one the app *derived* from two equal numbers,
        and nobody has been asked about it.
        """
        return getattr(cls, "score_type", None) in ("pattern", "time")

    def validate_show_schedule(self, show, classes, context=None):
        """SC-090 — what has to be true before APHA will approve the show.

        Read-only and almost entirely warnings. Nothing here refuses anything:
        the application goes to APHA on paper, the approved-judge list is theirs,
        and the app cannot see a show bill in the post. The single error is a
        show that has run out of time to apply at all, which is not advice.

        **The APHA show number is treated as the approval.** APHA assigns one when
        the show is approved and the results export already refuses without it, so
        a number on file is the strongest evidence this app can hold — and the
        deadline ladder becomes history the moment it appears. The cost of being
        wrong is one nag at an office that has been approved but has not typed the
        number in yet, and the fix for that is the field they already have.
        """
        context = context or {}
        as_of = context.get("as_of") or date.today()
        issues: list[dict[str, Any]] = []

        if not (getattr(show, "apha_show_number", None) or "").strip():
            issues.extend(self._check_application_window(show, as_of))

        issues.extend(self._check_show_category(show))
        issues.extend(self._check_class_list(show, classes, as_of))
        issues.extend(self._check_show_minimums(show, classes, context))
        issues.extend(self._check_show_name(show))
        issues.extend(self._check_judge_carding(show))
        return issues

    def _check_application_window(self, show, as_of):
        """SC-090.C/D — the application ladder, for a show with no number yet."""
        issues = [self._issue(
            "warning",
            "APHA_SHOW_NUMBER_MISSING",
            "No APHA show number on file. APHA assigns one when the show is "
            "approved, so this show reads as not yet approved — and the results "
            "export needs it.",
        )]

        window = application_window(show, as_of)
        if window is None:
            return issues

        if window["basis"] == "entry_deadline":
            basis_label = "the entry deadline"
            caveat = ""
        else:
            basis_label = "the first day of the show"
            caveat = (
                " Counted from the show date because no entry deadline is set: "
                "SC-090.C measures from the entry deadline where that comes "
                "first, so the real cutoff may be earlier than this."
            )

        issues.append(self._issue(
            "error" if window["band"] == "closed" else "warning",
            "APHA_APPLICATION_DEADLINE",
            f"Approval application due {window['standard_deadline']} — 90 days "
            f"before {window['basis_date']} ({basis_label}). "
            f"{APPLICATION_BAND_NOTES[window['band']]}{caveat}",
        ))
        return issues

    def _check_show_category(self, show):
        """SC-100 / SC-105 — the show's category, and the panel it may carry.

        Two different claims, and the category says which one is being made.
        SC-105.D.2 and SC-105.E.2 bound how many judges a Paint-O-Rama or Zone
        Show may *have*, so an over-count there is the rule. SC-100.A and
        SC-105.C.1 bound how many may judge **in the arena at any given time**,
        which the app does not model at all — a show rotating three judges through
        a two-judge arena is legal, so the count is a reason to check the category
        rather than a finding about the rule.
        """
        category = getattr(show, "show_category", None)
        if category is None:
            return [self._issue(
                "warning",
                "APHA_SHOW_CATEGORY_NOT_SET",
                "The show does not say which kind of APHA show it is — "
                "single-judge, two-judge, Paint-O-Rama or Zone Show (SC-100, "
                "SC-105). The judge panel it may carry follows from that, and so "
                "does the class schedule it has to offer.",
            )]

        issues = []
        name = getattr(category, "name", None) or "This category"
        rule = getattr(category, "rule_reference", None) or "SC-105"
        basis = getattr(category, "judge_limit_basis", None) or "total"
        smallest = getattr(category, "min_judges", None)
        largest = getattr(category, "max_judges", None)
        judges = len(list(getattr(show, "judges", None) or []))

        # Skipped entirely at zero: a show still being built has no panel, and
        # `APHA_JUDGES_NOT_ASSIGNED` already says so once.
        if judges:
            if largest is not None and judges > largest:
                if basis == "in_arena":
                    issues.append(self._issue(
                        "warning",
                        "APHA_CATEGORY_JUDGE_COUNT_UNEXPECTED",
                        f"{name} allows {largest} judge{'' if largest == 1 else 's'} "
                        f"in the arena at any given time ({rule}), and {judges} are "
                        "assigned. The app records assignments rather than who is in "
                        "the arena when, so this is a reason to check the category, "
                        "not a rule it can tell you was broken.",
                    ))
                else:
                    issues.append(self._issue(
                        "warning",
                        "APHA_CATEGORY_JUDGE_LIMIT_EXCEEDED",
                        f"{name} is limited to {largest} judges ({rule}). "
                        f"{judges} are assigned.",
                    ))
            elif smallest is not None and judges < smallest:
                issues.append(self._issue(
                    "warning",
                    "APHA_CATEGORY_JUDGE_COUNT_SHORT",
                    f"{name} carries at least {smallest} "
                    f"judge{'' if smallest == 1 else 's'} ({rule}), and "
                    f"{judges} {'is' if judges == 1 else 'are'} assigned.",
                ))

        smallest_days = getattr(category, "min_days", None)
        days = _show_days(show)
        if smallest_days is not None and days is not None and days < smallest_days:
            issues.append(self._issue(
                "warning",
                "APHA_CATEGORY_TOO_SHORT",
                f"{name} runs {smallest_days} or more consecutive days ({rule}). "
                f"This show runs {days}.",
            ))
        return issues

    def _check_show_minimums(self, show, classes, context):
        """SC-095.A — the classes a 3-or-more-judge show must offer.

        Three findings, and every one of them is a shortfall that survives any
        reading of the rule. Everything the app is merely *guessing* at goes back
        on the payload as a list for a human to read instead: see `show_minimums`
        for why Open division and the halter age split are inference rather than
        columns.
        """
        minimums = context.get("minimums") or show_minimums(show, classes)
        if not minimums["applies"]:
            # Under three judges SC-095.A does not apply at all, and a show still
            # being built has no panel yet. Neither is a finding.
            return []

        issues = []
        junior = minimums["open_junior_halter"]
        senior = minimums["open_senior_halter"]
        unknown = minimums["open_halter_unclassified"]
        judges = minimums["judge_count"]

        if not junior and not senior and not unknown:
            issues.append(self._issue(
                "warning",
                "APHA_MINIMUM_HALTER_MISSING",
                f"{judges} judges, so SC-095.A applies: the show must offer Open "
                "halter for stallions, mares and geldings — Junior (2 and under) "
                "and Senior (3 and over). No Open halter class was found.",
            ))
        elif not unknown and (not junior or not senior):
            # Only when every Open halter class was understood. One the app could
            # not place is exactly the case where it should not be claiming a gap.
            missing = "Junior (2 and under)" if not junior else "Senior (3 and over)"
            issues.append(self._issue(
                "warning",
                "APHA_MINIMUM_HALTER_AGE_GAP",
                f"{judges} judges, so SC-095.A applies: no Open {missing} halter "
                "class was found. Both age splits must be offered.",
            ))

        found = minimums["performance_upper_bound"]
        if found < MINIMUM_PERFORMANCE_CONTESTS:
            noun = "class is" if found == 1 else "classes are"
            issues.append(self._issue(
                "warning",
                "APHA_MINIMUM_PERFORMANCE_SHORT",
                f"{judges} judges, so SC-095.A applies: four performance contests "
                f"are required (SC-190.A). Only {found} {noun} not halter on this "
                "schedule, so the show is short of four however performance "
                "contests are counted.",
            ))
        return issues

    def _check_class_list(self, show, classes, as_of):
        """SC-090.E/F — approval waits on the class list, and it stops being a
        private matter 30 days out."""
        issues = []
        if not classes:
            issues.append(self._issue(
                "warning",
                "APHA_CLASS_LIST_EMPTY",
                "No classes on the schedule. APHA does not grant approval until "
                "the show bill or premium list reaches them (SC-090.E).",
            ))

        start = getattr(show, "start_date", None)
        if start is None:
            return issues

        days = (start - as_of).days
        if 0 <= days < CLASS_LIST_NOTICE_DAYS:
            issues.append(self._issue(
                "warning",
                "APHA_CLASS_LIST_NOTICE",
                f"The show starts in {days} day{'' if days == 1 else 's'}. Class "
                "list changes this close need written notification to APHA "
                "(SC-090.E) — amend the schedule here and tell APHA separately, "
                "because nothing in this app sends that notice.",
            ))
        return issues

    def _check_show_name(self, show):
        """SC-090.L and SC-090.P — words APHA keeps for its own shows."""
        reserved = show_name_reservations(getattr(show, "name", None))
        if not reserved:
            return []
        listed = "; ".join(f'"{word}" is {why}' for word, why in reserved.items())
        return [self._issue(
            "warning",
            "APHA_SHOW_NAME_RESERVED",
            f"The show name uses words APHA reserves: {listed}. Confirm APHA "
            "sponsorship or written permission before applying.",
        )]

    def _check_judge_carding(self, show):
        """SC-090.B — judges are selected from APHA's current approved list.

        This reports a gap in the app's *own* records and never claims a judge is
        unapproved: what it reads is `judge_associations`, which is what somebody
        typed into the judge registry. The reverse holds too — a carding recorded
        here does not make a judge approved. Only APHA's list does that, and the
        app does not hold it.
        """
        assignments = list(getattr(show, "judges", None) or [])
        if not assignments:
            return [self._issue(
                "warning",
                "APHA_JUDGES_NOT_ASSIGNED",
                "No judge assigned. Judges are selected from APHA's current "
                "approved list (SC-090.B), and the approval application is priced "
                "per judge.",
            )]

        issues = []
        for assignment in assignments:
            judge = getattr(assignment, "judge", None)
            if judge is None:
                continue
            codes = {
                (getattr(a, "code", None) or "").upper()
                for a in (getattr(judge, "associations", None) or [])
            }
            if "APHA" in codes:
                continue
            name = " ".join(
                part for part in (
                    getattr(judge, "first_name", None),
                    getattr(judge, "last_name", None),
                ) if part
            ) or "This judge"
            issues.append(self._issue(
                "warning",
                "APHA_JUDGE_NOT_CARDED",
                f"{name} has no APHA carding recorded in the judge registry. "
                "SC-090.B requires judges from APHA's current approved list, and "
                "the app holds the registry rather than that list.",
            ))
        return issues

    def validate_entry(self, entry, show, cls, context=None):
        if not self.entry_is_active(entry):
            return []

        context = context or {}
        issues: list[dict[str, Any]] = []

        # How many horses somebody may show is not a question about the division.
        # SC-185.F caps the exhibitor across the whole show whether they are
        # riding Open or Youth, so this runs before the division is looked at —
        # and therefore also on entries that name no division at all.
        issues.extend(self._check_horse_caps(entry, cls, context))

        division = (getattr(entry, "apha_division", None) or "").strip().upper()
        if not division:
            # Which division an entry belongs in is not derivable from the class
            # alone — the same class is run for Open, Amateur and Youth — so
            # nothing below it has anything to check against.
            return issues

        if division not in DIVISIONS:
            # Caught here rather than left to the CHECK constraint, which would
            # surface as an IntegrityError on commit — a 409 naming nothing, from
            # a request whose other entries may already be valid.
            issues.append(self._issue(
                "error",
                "APHA_DIVISION_UNKNOWN",
                f"{division} is not an APHA division.",
                class_id=getattr(cls, "id", None),
            ))
            return issues

        issues.extend(self._check_solid_paint_bred(entry, cls, division))
        issues.extend(self._check_relationship_to_owner(entry, cls, division))
        issues.extend(self._check_novice_eligibility(entry, cls, division))
        issues.extend(self._check_walk_trot_shared_horse(entry, cls, context, division))
        return issues

    # ── How many horses one exhibitor may show ───────────────────────────────

    def _discipline_of(self, context, class_id):
        return (context.get("apha_disciplines") or {}).get(class_id)

    def _other_entries(self, context, entry):
        """Every other live entry at this show, as the context supplied them.

        Excludes the entry being validated by id, so re-validating an existing
        entry on PATCH does not count it against its own cap. A brand-new entry
        has no id yet and matches nothing, which is the same answer.
        """
        entry_id = getattr(entry, "id", None)
        return [
            e for e in (context.get("apha_entries") or [])
            if e.id != entry_id
        ]

    def _horses_in_events(self, context, entry, events):
        """Distinct horses this exhibitor already has entered in those events."""
        exhibitor_id = getattr(entry, "exhibitor_id", None)
        return {
            e.horse_id
            for e in self._other_entries(context, entry)
            if e.exhibitor_id == exhibitor_id
            and e.horse_id is not None
            and self._discipline_of(context, e.class_id) in events
        }

    def _check_horse_caps(self, entry, cls, context):
        """SC-185.F and SC-185.F.1 — how many horses one exhibitor may show.

        Counted in **distinct horses across the show**, not entries in this
        class: the rule caps how many horses somebody may bring to an event, and
        six classes on one horse is one horse. Silently skipped when the context
        carries no disciplines, which is every non-APHA show and any caller that
        has not built one — a cap that guesses at the discipline would refuse
        entries for the wrong reason.
        """
        discipline = self._discipline_of(context, getattr(cls, "id", None))
        horse_id = getattr(entry, "horse_id", None)
        if discipline is None or horse_id is None:
            return []

        if discipline in TWO_HORSE_EVENTS:
            events, cap, what = {discipline}, MAX_TWO_HORSE_EVENT_HORSES, discipline
        elif discipline in INDIVIDUAL_WORKING_EVENTS:
            events, cap, what = (
                INDIVIDUAL_WORKING_EVENTS,
                MAX_INDIVIDUAL_WORKING_HORSES,
                "individual working events",
            )
        else:
            return []

        horses = self._horses_in_events(context, entry, events)
        horses.add(horse_id)
        if len(horses) <= cap:
            return []
        return [self._issue(
            "error",
            "APHA_HORSE_LIMIT_EXCEEDED",
            f"An exhibitor may show at most {cap} horses in {what} at one show "
            f"(APHA SC-185.F). This would be {len(horses)}.",
            class_id=getattr(cls, "id", None),
            horse_id=horse_id,
            exhibitor_id=getattr(entry, "exhibitor_id", None),
        )]

    def _check_walk_trot_shared_horse(self, entry, cls, context, division):
        """AM-300.H — one horse, one Amateur Walk-Trot exhibitor, per event.

        "A horse may not be shown by more than one exhibitor in the same event in
        the Amateur Walk-Trot division (all age classes) at the same horse show."

        A different shape from every other limit here: it is per **horse** and
        crosses exhibitors, where the rest are per exhibitor. Scoped to the
        event — the same horse may legitimately carry one Walk-Trot exhibitor in
        Trail and another in Western Pleasure.
        """
        if division != "AMATEUR_WALK_TROT":
            return []
        discipline = self._discipline_of(context, getattr(cls, "id", None))
        horse_id = getattr(entry, "horse_id", None)
        if discipline is None or horse_id is None:
            return []

        exhibitor_id = getattr(entry, "exhibitor_id", None)
        clash = next(
            (
                e for e in self._other_entries(context, entry)
                if e.horse_id == horse_id
                and e.exhibitor_id != exhibitor_id
                and (e.apha_division or "").upper() == "AMATEUR_WALK_TROT"
                and self._discipline_of(context, e.class_id) == discipline
            ),
            None,
        )
        if clash is None:
            return []
        horse = getattr(entry, "horse", None)
        return [self._issue(
            "error",
            "APHA_WALK_TROT_HORSE_SHARED",
            f"{getattr(horse, 'name', None) or 'This horse'} is already shown in "
            f"{discipline} by another Amateur Walk-Trot exhibitor at this show. "
            "One horse, one Walk-Trot exhibitor per event (APHA AM-300.H).",
            class_id=getattr(cls, "id", None),
            horse_id=horse_id,
        )]

    def _check_solid_paint_bred(self, entry, cls, division):
        """SC-325.A.1 — a Solid Paint-Bred horse may not enter Open classes.

        The Regular Registry and the Solid Paint-Bred Registry compete against
        each other only where the show says so; a Solid Paint-Bred horse has its
        own division and entering it in Open is an ineligible entry, not a
        preference.
        """
        if division != "OPEN":
            return []
        horse = getattr(entry, "horse", None)
        if horse is None or not getattr(horse, "is_solid_paint_bred", False):
            return []
        return [self._issue(
            "error",
            "APHA_SOLID_PAINT_BRED_OPEN",
            f"{getattr(horse, 'name', None) or 'This horse'} is Solid Paint-Bred and "
            "may not enter Open division classes (APHA SC-325.A.1).",
            class_id=getattr(cls, "id", None),
            horse_id=getattr(horse, "id", None),
        )]

    def _check_relationship_to_owner(self, entry, cls, division):
        """Amateur, Novice Amateur, Youth and Novice Youth all place ownership
        conditions on the exhibitor, so the entry has to state the relationship.

        Whitespace does not count as an answer: the field is free text on a form
        somebody tabs through, and a blank-looking value that satisfies the check
        is worse than no value at all.
        """
        if division not in RELATIONSHIP_REQUIRED_DIVISIONS:
            return []
        if (getattr(entry, "relationship_to_owner", None) or "").strip():
            return []
        return [self._issue(
            "error",
            "APHA_RELATIONSHIP_REQUIRED",
            f"{DIVISION_LABELS.get(division, division)} division entries must state "
            "the exhibitor's relationship to the horse's owner.",
            class_id=getattr(cls, "id", None),
        )]

    def _check_novice_eligibility(self, entry, cls, division):
        """AM-205, YP-255.A.1 — the Novice divisions need a declaration.

        Not a check. Novice eligibility turns on points and prize money the app
        does not hold, and the rule book is explicit that the responsibility is
        the exhibitor's and the burden of proof belongs to whoever protests. What
        the app can do is make somebody say it and record that they did.

        Read off the entry's own `attestations` collection rather than the
        database, so an entry assembled in memory validates before it is flushed
        — the same reason `relationship_to_owner` is read off the entry.
        """
        if division not in ATTESTATION_REQUIRED_DIVISIONS:
            return []
        kinds = {
            getattr(a, "kind", None)
            for a in (getattr(entry, "attestations", None) or [])
        }
        if "novice_eligibility" in kinds:
            return []
        return [self._issue(
            "error",
            "APHA_NOVICE_ELIGIBILITY_REQUIRED",
            f"{DIVISION_LABELS.get(division, division)} entries need a declaration "
            "that the exhibitor is within APHA's point and earnings limits for the "
            "division.",
            class_id=getattr(cls, "id", None),
        )]
