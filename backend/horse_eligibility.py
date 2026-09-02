"""What the show will ask about this horse, said while the horse is being picked.

An exhibitor could enter an APHA show on a horse with no APHA registration
number on file and hear nothing about it until the desk asked for the papers.
The registration number is not something the app can verify -- `show_verifications`
exists precisely because only a person at the counter can hold a registration
certificate against the animal in the trailer -- but *whether there is a number
on file at all* is a question the app can answer, and answering it in the
paddock is worth a great deal more than answering it at the gate.

**Flags, never gates**, for the reason health paperwork flags: refusing the
entry would not register the horse. A number can be typed in from the phone in
somebody's hand, and a horse genuinely not registered with the breed body is a
conversation with the show office rather than something this app should decide.
So every finding here is a warning with a destination attached, and nothing
here is wired into a refusal.

Scope is deliberately narrow. This reports what the *show's own associations*
would want -- the breed body it is approved by and the clubs sanctioning it --
and says nothing about whether a number is current, genuine, or describes this
horse, because the app does not know any of those and the desk does.
"""
from typing import Iterable, Optional


def horse_registration_flags(
    horse,
    associations: Iterable[tuple],
    registered_association_ids: Optional[set] = None,
) -> list[dict]:
    """What is missing from this horse's papers for this show, as warnings.

    `associations` is `(association_id, code)` pairs for the bodies the show
    runs under -- the same list the membership checklist item is built from, so
    the exhibitor's card and the horse's papers are judged against one set of
    associations rather than two that can drift.

    `registered_association_ids` lets a caller that has already loaded every
    horse's registrations in one query pass them in; without it the horse's own
    `registrations` relationship is read, which is a lazy load and therefore
    only safe outside an async request.

    Returns an empty list when the show has no affiliation -- an Open show with
    no clubs is not waiting on anybody's papers, and a warning that can never
    be cleared is one people learn to scroll past.
    """
    assoc_list = [(aid, code) for aid, code in associations if code]
    if not assoc_list:
        return []

    if registered_association_ids is None:
        registered_association_ids = {
            r.association_id for r in (getattr(horse, "registrations", None) or [])
        }

    has_any = bool(registered_association_ids)
    flags: list[dict] = []
    for association_id, code in assoc_list:
        if association_id in registered_association_ids:
            continue
        flags.append(
            {
                # Two different situations, and the exhibitor's next move
                # differs: a horse with no papers at all may simply not be
                # registered anywhere, while a horse carrying an AQHA number at
                # an APHA show is one whose owner knows exactly which number is
                # missing. The distinction is in the code rather than in the
                # sentence, because a dual-sanctioned show produces one of these
                # per body and three paragraphs saying nearly the same thing is
                # how people learn to scroll past the panel.
                "code": "HORSE_NOT_REGISTERED" if not has_any else "HORSE_REGISTRATION_MISSING",
                "association_code": code,
                "message": f"No {code} registration number on file.",
            }
        )
    return flags


def registration_codes(registrations: Iterable) -> list[str]:
    """The association codes a horse holds papers with, for display.

    Sorted so a horse's registrations read the same way on every screen, and
    de-duplicated defensively -- `uq_horse_registrations_horse_association`
    already prevents a repeat, but this is also handed rows from a bulk query
    where nothing has enforced that they came from one horse.
    """
    return sorted(
        {
            r.association.code
            for r in registrations
            if getattr(r, "association", None) is not None and r.association.code
        }
    )


# -- How this exhibitor is entitled to show this horse -------------------------
#
# APHA AM-300.E and YP-015 want the relationship to the horse's *owner* on every
# Amateur and Youth entry. Most of the time there is nothing to ask: the
# exhibitor owns the horse, and `horses.owner_exhibitor_id` already says so.
#
# What the app cannot derive is the other case. When somebody else owns the
# horse, no record anywhere says whether that person is your mother, your aunt
# or your neighbour -- `exhibitors` holds contact details and a guardian's name,
# not a family tree -- so that one has to be answered, once, and is stored on
# `exhibitor_horses.relationship_to_owner`.
#
# Do not try to infer the second case from `exhibitors.parent_guardian_name`
# matching `horses.owner_name`. That is a guess at identity from free text and
# then a guess at which parent, and the wrong answer goes onto an entry APHA
# reads as a statement of eligibility.

SELF_RELATIONSHIP = "Self"


def owns_horse(horse, exhibitor_id) -> bool:
    """Whether this exhibitor is the horse's recorded owner.

    `owner_exhibitor_id` rather than `created_by_exhibitor_id`: staff create
    horses for exhibitors and exhibitors create horses they do not own (which
    opens a `horse_access_requests` row rather than attaching them), so who
    typed the record in says nothing about who owns it.
    """
    owner_id = getattr(horse, "owner_exhibitor_id", None)
    return owner_id is not None and exhibitor_id is not None and owner_id == exhibitor_id


def effective_relationship(horse, exhibitor_id, stored=None):
    """The relationship to put on an entry, or None if it must be asked.

    **Stored wins over derived.** A recorded answer is somebody's explicit
    statement about their own eligibility, and a co-owner who wrote down
    something more precise than "Self" should not have it quietly overwritten.
    The derivation only fills a blank -- which is the case for almost every
    entry ever made, because almost everybody shows their own horse.
    """
    value = (stored or "").strip()
    if value:
        return value
    return SELF_RELATIONSHIP if owns_horse(horse, exhibitor_id) else None
