"""What an exhibitor may do to their own class entries, and when.

Self-registration used to close the moment a show went ACTIVE: from then on
every added class and every scratch went through the show office, which at a
running show means somebody walking to the office window to drop a Sunday class
their horse is too tired for. So the exhibitor's two class doors --
`POST /shows/{id}/register` and `DELETE /shows/{id}/register/entries/{id}` --
now stay open while the show is under way, and this module is what keeps them
from reaching into classes the ring has already dealt with.

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

Pure functions against plain attributes, like the merge module's decisions, so
the rules are pinned by tests without a database.
"""
from __future__ import annotations

from typing import Optional

# The show statuses in which an exhibitor may enter and scratch their own
# classes. Signing up for the show, stalls, horses and back numbers stay
# PUBLISHED-only: by the time a show is running the stall chart is drawn and the
# numbers are on backs, and somebody not yet signed up is sent to the office.
SELF_ENTRY_STATUSES = frozenset({"PUBLISHED", "ACTIVE"})


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
