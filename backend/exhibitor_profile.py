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
* *Blocking for a minor* is a parent or guardian, name and telephone both --
  the same both-or-neither rule as the emergency contact. Somebody under 18 on
  the show's first day cannot sign for themselves, and the office needs an
  adult to ring who is answerable for them. The row only exists once a date of
  birth says the exhibitor is a minor: an adult is never asked, and an
  exhibitor with no date of birth is already stopped on that row.
* *Advisory* is association memberships. A membership number is a claim the
  desk verifies against a card (`show_verifications`), so requiring one here
  would gate the entry on something the app cannot check and the exhibitor can
  buy at the counter. It is asked for, prominently, and never refused over.

The advisory membership item is omitted entirely when the show has no breed or
club affiliation to hold one against -- an Open show with no clubs is not
waiting on anybody's card, and an item that can never be ticked is one people
learn to scroll past.

Every row carries a `step`, because the registration wizard asks these in two
sittings rather than one: `details` is the person, `horses` is the animals they
brought. The split is what the screens render against, and it is here rather
than in the frontend so a step cannot go green over an item the backend is
still refusing on -- `missing_blocking` reads the same rows either way.

`exhibitor` here is whatever the show holds -- a `ShowExhibitorView` from
`registration_profile.py` on every registration path, so a date of birth
corrected for one show is judged as corrected there and nowhere else. The
function reads attributes only, and cannot tell the two apart.
"""
from datetime import date, datetime
from typing import Iterable, Optional

#: The wizard steps these rows are asked across, in order. `details` is the
#: exhibitor themselves; `horses` is what they are bringing. A caller that does
#: not care about the split can ignore the field entirely -- nothing about
#: blocking depends on it.
STEP_DETAILS = "details"
STEP_HORSES = "horses"

#: Under this age on the show's first day, a parent or guardian is required.
ADULT_AGE = 18


def _blank(value) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _as_date(value) -> Optional[date]:
    """A date of birth as a `date`, whatever shape the record holds it in."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def age_on(date_of_birth, as_of: date) -> Optional[int]:
    """Whole years old on `as_of` -- a person's real age, birthday and all.

    Not `youth_age()` (YP-075's age on 1 January) and not a horse's calendar
    age: whether somebody is a minor is a fact about the day, and a seventeen
    year old who turns eighteen the week before the show signs for themselves.
    """
    born = _as_date(date_of_birth)
    if born is None:
        return None
    years = as_of.year - born.year
    if (as_of.month, as_of.day) < (born.month, born.day):
        years -= 1
    return years


def is_minor(date_of_birth, as_of: Optional[date] = None) -> bool:
    """Under 18 on `as_of` (today when omitted). False when the date is unknown."""
    age = age_on(date_of_birth, as_of or date.today())
    return age is not None and age < ADULT_AGE


def profile_checklist(
    exhibitor,
    horse_count: int,
    associations: Iterable[tuple] = (),
    registered_association_ids: Optional[set] = None,
    as_of: Optional[date] = None,
) -> list[dict]:
    """One row per thing the exhibitor is asked for.

    `associations` is `(association_id, code)` pairs for the bodies this show
    runs under -- the breed body it is approved by and any clubs sanctioning it.
    Empty means the membership row is not shown at all.

    `as_of` is the day a minor is judged on: the show's first day on every
    registration path, since that is when somebody has to be answerable for
    them. Today when omitted.
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
            "step": STEP_DETAILS,
            "label": "Your name",
            "complete": not _blank(exhibitor.full_name),
            "blocking": True,
            "hint": "The name you are entered and announced under.",
        },
        {
            "key": "date_of_birth",
            "step": STEP_DETAILS,
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
            "step": STEP_DETAILS,
            "label": "Phone number",
            "complete": not _blank(exhibitor.phone),
            "blocking": True,
            "hint": "How the show office reaches you about your entry.",
        },
        {
            "key": "address",
            "step": STEP_DETAILS,
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
            "step": STEP_DETAILS,
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
    ]

    if is_minor(exhibitor.date_of_birth, as_of):
        guardian_missing = [
            label
            for label, value in (
                ("name", getattr(exhibitor, "parent_guardian_name", None)),
                ("phone", getattr(exhibitor, "parent_guardian_phone", None)),
            )
            if _blank(value)
        ]
        items.append(
            {
                "key": "parent_guardian",
                "step": STEP_DETAILS,
                "label": "Parent / guardian",
                "complete": not guardian_missing,
                "blocking": True,
                "hint": (
                    "Missing " + ", ".join(guardian_missing)
                    if guardian_missing
                    else "The adult answerable for you at the show."
                ),
            }
        )

    items += [
        {
            "key": "horses",
            "step": STEP_HORSES,
            "label": "At least one horse",
            "complete": horse_count > 0,
            "blocking": True,
            "hint": "You enter classes on a horse listed on this registration.",
        },
    ]

    assoc_list = [(aid, code) for aid, code in associations if code]
    if assoc_list:
        held = registered_association_ids or set()
        outstanding = [code for aid, code in assoc_list if aid not in held]
        items.append(
            {
                "key": "memberships",
                # The exhibitor's own card, so it is asked alongside their
                # details rather than with the horses. A *horse's* registration
                # with the same association is a different fact and is checked
                # on the horses step.
                "step": STEP_DETAILS,
                "label": "Association memberships",
                "complete": not outstanding,
                # Never blocking. See the module docstring: the desk verifies a
                # card, and one can be bought at the counter.
                "blocking": False,
                "hint": (
                    # Ends with a full stop like every other hint: the screen
                    # runs a sentence on after it, and without one the line
                    # read "...APHA, WSCA, MNSPHC Optional - cards are checked".
                    "Add your number for " + ", ".join(outstanding) + "."
                    if outstanding
                    else "On file for every association this show runs under."
                ),
            }
        )

    return items


def missing_blocking(checklist: Iterable[dict], step: Optional[str] = None) -> list[str]:
    """The labels of the blocking items that are not done.

    `step` narrows to one wizard step, which is what lets the screen say "you
    still owe a phone number" on step one without also complaining about a
    horse two steps away. Unnarrowed it is the whole list, and that is what
    `PUT /signup` refuses on -- finishing one step is not finishing the
    profile.
    """
    return [
        i["label"]
        for i in checklist
        if i["blocking"]
        and not i["complete"]
        and (step is None or i.get("step") == step)
    ]


def profile_complete(checklist: Iterable[dict], step: Optional[str] = None) -> bool:
    return not missing_blocking(checklist, step)
