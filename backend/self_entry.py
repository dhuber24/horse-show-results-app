"""What an exhibitor may do for themselves at a show, and until when.

Self-registration used to close the moment a show went ACTIVE: from then on
every added class and every scratch went through the show office, which at a
running show means somebody walking to the office window to drop a Sunday class
their horse is too tired for. So the exhibitor's two class doors --
`POST /shows/{id}/register` and `DELETE /shows/{id}/register/entries/{id}` --
stay open while the show is under way wherever the show office says they may
(below), and this module is what keeps them from reaching into classes the ring
has already dealt with.

**A class is completed once the gate has finished it or its results are
posted.** Either is enough: a gate steward marks a class done as the last horse
leaves the arena, and a show that does not run the gate screen still posts its
results. After that, the exhibitor cannot scratch from it -- a scratch then is
not a change of plan but a change to a class that has been judged, and only the
show office may make one (the desk's delete takes any entry, as it always has).
An entry that already has a placing or a score on a judge's card is refused on
the same grounds even before the class is marked finished: that horse has shown.

**Entering closes earlier than scratching.** A class under way cannot be entered
from a phone -- the horses are in the ring or going in order -- so the gate is
where a late entry to it is sorted out, and the office enters it if the judge
will take it. Scratching from a class under way stays open until it is finished,
because a horse that has not gone yet can still be pulled.

**Two of the cut-offs are the show office's to answer, for every show**
(migration 159), on setup Step 1 and before the show can be published:

* **The last day to sign up online** (`shows.entry_deadline`, inclusive). After
  it, somebody not yet signed up is signed up by the office at the desk. It
  closes *new* sign-ups only -- a sign-up is the one thing it names, and
  somebody already signed up keeps their registration to amend until the show
  starts, as before. Unanswered, sign-up stays open until the show starts.
* **How late classes may be entered and scratched** (`shows.self_entry_closes`):
  until each class starts (`class_start`, the rules above, while the show runs
  too) or until the show starts (`show_start`, after which every class change
  is the office's). Unanswered reads as `class_start`, which is what every show
  did before the question was asked.

"The show starts" is the status turning ACTIVE, the same moment the self-cancel
window reads it as (`cancellations.SELF_CANCEL_STATUSES`) -- not the calendar,
because the office opens the show on the morning it runs.

Pure functions against plain attributes, like the merge module's decisions, so
the rules are pinned by tests without a database.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

# The show statuses in which an exhibitor may enter and scratch their own
# classes, at a show whose classes stay open until each one starts. Signing up
# for the show, stalls, horses and back numbers stay PUBLISHED-only: by the time
# a show is running the stall chart is drawn and the numbers are on backs, and
# somebody not yet signed up is sent to the office.
SELF_ENTRY_STATUSES = frozenset({"PUBLISHED", "ACTIVE"})

# The answers to "how late may exhibitors enter and scratch their own classes"
# (`shows.self_entry_closes`, migration 159). Mirrors the column's CHECK.
CLASS_START = "class_start"
SHOW_START = "show_start"
SELF_ENTRY_CLOSES = (CLASS_START, SHOW_START)


def self_entry_statuses(closes: Optional[str]) -> frozenset:
    """The statuses in which this show's class doors are open.

    Unanswered is `class_start`: what every show did before the question.
    """
    return frozenset({"PUBLISHED"}) if closes == SHOW_START else SELF_ENTRY_STATUSES


def class_entry_open(status: Optional[str], closes: Optional[str]) -> bool:
    """Whether an exhibitor may enter or scratch their own classes at all now.

    The per-class rules below still apply on top: this is the show's door, they
    are each class's.
    """
    return status in self_entry_statuses(closes)


def signup_open(
    status: Optional[str], entry_deadline: Optional[date], as_of: Optional[date] = None
) -> bool:
    """Whether somebody not yet signed up may still sign up online.

    **Inclusive of the deadline day** -- "entries close the 15th" takes an entry
    on the 15th, the same reading the self-cancel cut-off gives its deadline.
    Measured against today, like that cut-off, in the server's calendar.
    """
    if status != "PUBLISHED":
        return False
    if entry_deadline is None:
        return True
    return (as_of or date.today()) <= entry_deadline


def registration_window(show, as_of: Optional[date] = None) -> dict:
    """What the screens print about the two cut-offs, and whether each is open.

    `signup_open` and `class_entry_open` are the only fields that decide
    anything; the rest is so a screen can say when and why without recomputing
    the rule and drifting from it.
    """
    return {
        "signup_open": signup_open(show.status, show.entry_deadline, as_of),
        "signup_deadline": show.entry_deadline,
        "class_entry_open": class_entry_open(show.status, show.self_entry_closes),
        "class_entry_closes": show.self_entry_closes or CLASS_START,
        "answered": bool(show.entry_deadline and show.self_entry_closes),
    }


def signup_closed_refusal(show) -> dict:
    """The 403 for a new sign-up after the deadline."""
    # "After", because the deadline day itself was still open.
    closed = (
        f"Online sign-up for this show closed after {show.entry_deadline:%B} "
        f"{show.entry_deadline.day}."
        if show.entry_deadline is not None
        else "Online sign-up for this show has closed."
    )
    return {
        "code": "SIGNUP_CLOSED",
        "message": f"{closed} The show office can still sign you up, so send them a message.",
    }


def class_entry_closed_refusal() -> dict:
    """The 403 for a class entry or scratch once this show's class doors shut."""
    return {
        "code": "CLASS_ENTRY_CLOSED",
        "message": (
            "The show is under way, and from its first day the show office makes "
            "every class change. Ask at the office to enter or scratch a class."
        ),
    }


def class_completed(cls) -> bool:
    """The gate has finished this class, or its results are posted."""
    return cls.gate_status == "done" or cls.results_published_at is not None


def class_under_way(cls) -> bool:
    """In the ring now: started at the gate and not yet finished."""
    return cls.gate_status == "in_progress" and not class_completed(cls)


def _label(cls) -> str:
    return f"Class {cls.class_number} ({cls.class_name})"


def entry_refusal(cls) -> Optional[dict]:
    """Why an exhibitor may not enter this class themselves, or None."""
    if class_completed(cls):
        return {
            "code": "CLASS_COMPLETED",
            "message": f"{_label(cls)} has already been run.",
        }
    if class_under_way(cls):
        return {
            "code": "CLASS_UNDER_WAY",
            "message": (
                f"{_label(cls)} is already under way. Ask at the in-gate or the "
                "show office about a late entry."
            ),
        }
    return None


def scratch_refusal(cls, has_result: bool) -> Optional[dict]:
    """Why an exhibitor may not scratch themselves from this class, or None."""
    if class_completed(cls):
        return {
            "code": "CLASS_COMPLETED",
            "message": (
                f"{_label(cls)} is finished, so only the show office can take "
                "you out of it now."
            ),
        }
    if has_result:
        return {
            "code": "RESULT_RECORDED",
            "message": (
                f"A result is already recorded for this entry in {_label(cls)}, "
                "so only the show office can take you out of it now."
            ),
        }
    return None


def unnominated(covering_futurities, show_entry_id, horse_id) -> list:
    """The futurities judging a class that this horse is not nominated in.

    A futurity class carries no price of its own -- the nomination prices it --
    so an entry with no nomination behind it is billed nothing. Before the show
    the exhibitor nominates on the futurity step; once it is running that step is
    closed and a nomination is the office's to take, so a live show's class door
    refuses a futurity class the horse is not nominated in rather than creating
    an entry the desk would have to chase. Satisfied by a nomination in any one
    of the covering futurities, the way a side pot is.
    """
    if not covering_futurities:
        return []
    for futurity in covering_futurities:
        for enrollment in futurity.entries:
            if enrollment.show_entry_id == show_entry_id and enrollment.horse_id == horse_id:
                return []
    return list(covering_futurities)
