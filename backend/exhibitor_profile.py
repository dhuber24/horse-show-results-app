"""Is this exhibitor's profile complete enough to enter a show?

The first step of registration. Somebody entering their first show used to
reach a stall picker before the office knew their telephone number, their date
of birth or who to ring if they came off in the arena -- all of which the show
needs and none of which anybody goes back to fill in once the entry is taken.

**What blocks and what only prompts is a deliberate split**, and it follows the
same reasoning as health paperwork: refuse only what nobody at the desk can
produce for you.

* *Blocking* is the exhibitor's own contact details plus one horse. Every one
  is a fact only they hold, all of it is typed in a minute, and a show office
  with none of it has nothing to work with. The date of birth is on the list
  because the youth divisions are decided by it (YP-075) and a missing one is
  found out at the gate.
* *Advisory* is association memberships. A membership number is a claim the
  desk verifies against a card (`show_verifications`), so requiring one here
  would gate the entry on something the app cannot check and the exhibitor can
  buy at the counter. It is asked for, prominently, and never refused over.

The advisory membership item is omitted entirely when the show has no breed or
club affiliation to hold one against -- an Open show with no clubs is not
waiting on anybody's card, and an item that can never be ticked is one people
learn to scroll past.
"""
from typing import Iterable, Optional


def _blank(value) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def profile_checklist(
    exhibitor,
    horse_count: int,
    associations: Iterable[tuple] = (),
    registered_association_ids: Optional[set] = None,
) -> list[dict]:
    """One row per thing the exhibitor is asked for.

    `associations` is `(association_id, code)` pairs for the bodies this show
    runs under -- the breed body it is approved by and any clubs sanctioning it.
    Empty means the membership row is not shown at all.
    """
    address_missing = [
        label
        for label, value in (
            ("street address", exhibitor.address),
            ("city", exhibitor.city),
            ("state", exhibitor.state),
            ("ZIP", exhibitor.zip),
        )
        if _blank(value)
    ]
    emergency_missing = [
        label
        for label, value in (
            ("name", exhibitor.emergency_contact_name),
            ("phone", exhibitor.emergency_contact_phone),
        )
        if _blank(value)
    ]

    items: list[dict] = [
        {
            "key": "full_name",
            "label": "Your name",
            "complete": not _blank(exhibitor.full_name),
            "blocking": True,
            "hint": "The name you are entered and announced under.",
        },
        {
            "key": "date_of_birth",
            "label": "Date of birth",
            "complete": exhibitor.date_of_birth is not None,
            "blocking": True,
            # Not idle curiosity, and worth saying so on the form: an exhibitor
            # asked for a birthday with no reason given is one who types
            # anything.
            "hint": "Youth and amateur divisions are decided by age.",
        },
        {
            "key": "phone",
            "label": "Phone number",
            "complete": not _blank(exhibitor.phone),
            "blocking": True,
            "hint": "How the show office reaches you about your entry.",
        },
        {
            "key": "address",
            "label": "Mailing address",
            "complete": not address_missing,
            "blocking": True,
            "hint": (
                "Missing " + ", ".join(address_missing)
                if address_missing
                else "Where awards and association paperwork are sent."
            ),
        },
        {
            "key": "emergency_contact",
            "label": "Emergency contact",
            "complete": not emergency_missing,
            "blocking": True,
            "hint": (
                "Missing " + ", ".join(emergency_missing)
                if emergency_missing
                # Both or neither, the same rule the desk's own emergency
                # contact endpoint enforces: a name with no number still reads
                # as missing everywhere it is checked.
                else "Who the show rings if something happens to you."
            ),
        },
        {
            "key": "horses",
            "label": "At least one horse",
            "complete": horse_count > 0,
            "blocking": True,
            "hint": "You enter classes on a horse from your profile.",
        },
    ]

    assoc_list = [(aid, code) for aid, code in associations if code]
    if assoc_list:
        held = registered_association_ids or set()
        outstanding = [code for aid, code in assoc_list if aid not in held]
        items.append(
            {
                "key": "memberships",
                "label": "Association memberships",
                "complete": not outstanding,
                # Never blocking. See the module docstring: the desk verifies a
                # card, and one can be bought at the counter.
                "blocking": False,
                "hint": (
                    "Add your number for " + ", ".join(outstanding)
                    if outstanding
                    else "On file for every association this show runs under."
                ),
            }
        )

    return items


def missing_blocking(checklist: Iterable[dict]) -> list[str]:
    """The labels of the blocking items that are not done."""
    return [i["label"] for i in checklist if i["blocking"] and not i["complete"]]


def profile_complete(checklist: Iterable[dict]) -> bool:
    return not missing_blocking(checklist)
