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


# Divisions whose eligibility turns on who owns the horse, so the entry has to
# say how the exhibitor is related to that owner. Open and Solid Paint-Bred are
# absent on purpose: eligibility there is a property of the horse's registry,
# and nobody's relationship to the owner changes it.
RELATIONSHIP_REQUIRED_DIVISIONS = frozenset({
    "AMATEUR",
    "NOVICE_AMATEUR",
    "YOUTH",
    "NOVICE_YOUTH",
})


class APHARules(DefaultRules):
    code = "APHA"

    def validate_entry(self, entry, show, cls, context=None):
        if not self.entry_is_active(entry):
            return []

        division = (getattr(entry, "apha_division", None) or "").strip().upper()
        if not division:
            # No division named. Which division an entry belongs in is not
            # derivable from the class alone — the same class is run for Open,
            # Amateur and Youth — so there is nothing here to check against.
            return []

        issues: list[dict[str, Any]] = []
        issues.extend(self._check_solid_paint_bred(entry, cls, division))
        issues.extend(self._check_relationship_to_owner(entry, cls, division))
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
            f"{division.replace('_', ' ').title()} division entries must state the "
            "exhibitor's relationship to the horse's owner.",
            class_id=getattr(cls, "id", None),
        )]
