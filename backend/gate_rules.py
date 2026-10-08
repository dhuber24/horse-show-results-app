"""The in-gate's rules: who is ready, what may start, and what a start closes.

Kept out of `routers/gate.py` so they can be tested without a database, the
same shape as `self_entry.py`.

**Ready is worked out, never stored.** A class that has not started is ready
when somebody is checked in and every rider is checked in or a no-show. It
used to be written to `classes.gate_status` by the check-in endpoint, which was
the only thing that recomputed it -- so a rider the office added to a ready
class left it reading ready, and a scratch of the one rider still to check in
left it pending. About twenty places add or scratch an entry; deriving it on
read is the only way all of them are right. The column still holds `ready` on
older rows, and every reader treats it as not started.

**Classes run in order.** Only a ring's on-deck class -- the first one on the
day not yet started -- may start, and the gate cannot change the order. The
steward may check riders in for any class that has not started.

**A start closes the classes ahead of it.** Classes often run together in one
ring (two age divisions judged as one go), so a start may instead be
*concurrent*: it leaves the classes in the ring running, and the next ordinary
start closes the whole group. Nothing records the group -- it is simply the
classes in progress in the ring.

Every function takes the ring's day (a *lane*) **already in running order**,
which is how the router queries it; nothing here sorts.
"""
from dataclasses import dataclass
from typing import Iterable, Optional, Sequence

NOT_STARTED = ("pending", "ready")


def started(cls) -> bool:
    """In the ring or done. `ready` on an older row is not started."""
    return cls.gate_status not in NOT_STARTED


@dataclass(frozen=True)
class Tally:
    """Where a class's riders stand at the gate. Scratched entries are not riders."""

    entries: int = 0
    checked_in: int = 0
    no_show: int = 0

    @property
    def waiting(self) -> int:
        return self.entries - self.checked_in - self.no_show


def tally(entries: Iterable) -> Tally:
    live = [e for e in entries if e.status != "WITHDRAWN"]
    no_show = sum(1 for e in live if e.gate_no_show)
    checked_in = sum(1 for e in live if e.gate_checked_in and not e.gate_no_show)
    return Tally(entries=len(live), checked_in=checked_in, no_show=no_show)


def is_ready(t: Tally) -> bool:
    """Every rider is checked in or a no-show, and somebody is there to ride."""
    return t.checked_in > 0 and t.waiting == 0


def nothing_to_run(t: Tally) -> bool:
    """No riders, or every one a no-show. Only skipping clears such a class."""
    return t.checked_in == 0 and t.waiting == 0


def gate_status(stored: str, t: Tally) -> str:
    """A class's gate status as the gate screen shows it: the stored one once
    the class has started, ready or pending -- derived -- before then."""
    if stored not in NOT_STARTED:
        return stored
    return "ready" if is_ready(t) else "pending"


def lane(classes: Iterable, cls) -> list:
    """The classes on `cls`'s day in its ring, in the order handed over."""
    return [c for c in classes if c.class_date == cls.class_date and c.ring_id == cls.ring_id]


def on_deck(lane_: Sequence):
    """The first class in the lane not yet started, or None."""
    return next((c for c in lane_ if not started(c)), None)


def _ahead(lane_: Sequence, cls) -> list:
    ids = [c.id for c in lane_]
    return list(lane_[: ids.index(cls.id)]) if cls.id in ids else []


def _behind(lane_: Sequence, cls) -> list:
    ids = [c.id for c in lane_]
    return list(lane_[ids.index(cls.id) + 1 :]) if cls.id in ids else []


def in_ring(lane_: Sequence) -> list:
    return [c for c in lane_ if c.gate_status == "in_progress"]


def _label(cls) -> str:
    return f"#{cls.class_number} {cls.class_name}"


def check_in_refusal(cls) -> Optional[str]:
    """Why a rider's check-in or no-show may not change, or None.

    Open for every class not yet started, not only the one on deck. Once a
    class is in the ring the gate is finished with it: a rider the office adds
    late goes straight into the class without checking in.
    """
    if started(cls):
        return "Check-in is closed — this class has already started or finished."
    return None


def reset_refusal(cls) -> Optional[str]:
    """Clearing every check-in is for a class that has not started."""
    if started(cls):
        return "This class has already started. Undo the start or reopen it first."
    return None


def transition_refusal(cls, target: str, lane_: Sequence, t: Tally, concurrent: bool = False) -> Optional[str]:
    """Why the gate may not move `cls` to `target`, or None.

    `t` is the class's own tally. What each move means depends on where the
    class is now:

    * not started -> in_progress: **start**. Only the on-deck class, only once
      ready, and a concurrent start needs something in the ring to run with.
    * done -> in_progress: **reopen**. Refused once a later class in the ring
      has finished, which would put the ring's history out of order; a later
      class still in the ring is fine -- the two then run together.
    * not started -> done: **skip**. Only the on-deck class, and only with
      nobody to ride it. Skipping marks a class completed, which shuts out late
      entries, so a class further down the day cannot be skipped early.
    * in_progress -> pending/ready: **undo start**. Refused once a later class
      in the ring has started.
    """
    current = cls.gate_status

    if target == "in_progress":
        if current == "in_progress":
            return None
        if current == "done":
            later = next((c for c in _behind(lane_, cls) if c.gate_status == "done"), None)
            if later is not None:
                return f"{_label(later)} has already finished after this class, so it cannot be reopened."
            return None
        deck = on_deck(lane_)
        if deck is not None and deck.id != cls.id:
            return f"Classes run in order — {_label(deck)} is next in this ring."
        if nothing_to_run(t):
            return "Nobody is here to ride this class. Skip it instead."
        if not is_ready(t):
            return "Check in or mark a no-show for every rider before starting this class."
        if concurrent and not in_ring(_ahead(lane_, cls)):
            return "No class is in the ring to run this one with."
        return None

    if target == "done":
        if started(cls):
            return None
        deck = on_deck(lane_)
        if deck is not None and deck.id != cls.id:
            return f"Classes run in order — only {_label(deck)}, next in this ring, can be skipped."
        if not nothing_to_run(t):
            return "Riders are checked in for this class. Start it rather than skipping it."
        return None

    # pending / ready: back to not started.
    if current == "done":
        return "This class has finished. Reopen it instead."
    if current == "in_progress":
        later = next((c for c in _behind(lane_, cls) if started(c)), None)
        if later is not None:
            return f"{_label(later)} has already started after this class, so this start cannot be undone."
    return None


def closed_by_start(cls, lane_: Sequence, concurrent: bool) -> list:
    """The classes an ordinary start of `cls` finishes: every class in the ring
    ahead of it that is still in progress -- the one class before it, or the
    whole group that ran together. A concurrent start finishes none of them."""
    if concurrent:
        return []
    return in_ring(_ahead(lane_, cls))
