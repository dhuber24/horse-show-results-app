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
