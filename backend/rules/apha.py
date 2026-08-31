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

    def validate_entry(self, entry, show, cls, context=None):
        if not self.entry_is_active(entry):
            return []

        division = (getattr(entry, "apha_division", None) or "").strip().upper()
        if not division:
            # No division named. Which division an entry belongs in is not
            # derivable from the class alone — the same class is run for Open,
            # Amateur and Youth — so there is nothing here to check against.
            return []

        if division not in DIVISIONS:
            # Caught here rather than left to the CHECK constraint, which would
            # surface as an IntegrityError on commit — a 409 naming nothing, from
            # a request whose other entries may already be valid.
            return [self._issue(
                "error",
                "APHA_DIVISION_UNKNOWN",
                f"{division} is not an APHA division.",
                class_id=getattr(cls, "id", None),
            )]

        issues: list[dict[str, Any]] = []
        issues.extend(self._check_solid_paint_bred(entry, cls, division))
        issues.extend(self._check_relationship_to_owner(entry, cls, division))
        issues.extend(self._check_novice_eligibility(entry, cls, division))
        return issues

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
