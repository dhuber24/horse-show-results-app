"""Cancelling a show registration, and who is allowed to.

An exhibitor may call off their own registration while the show is still a
fortnight away. Inside that window the answer is the show office, because by
then the entries are in the program, the stall chart is drawn and the class
sheets may already be printed -- somebody has to decide what happens to the
stall and the money, and that somebody is not the person leaving.

Two things live here so that the router, the desk and the screens cannot
disagree about either:

* **Who is on the roster.** `registered_at IS NOT NULL AND cancelled_at IS NULL`.
  Cancelling marks the row rather than deleting it (migration 126), so every
  reader that used to ask "is `registered_at` set?" is now asking half a
  question -- a cancelled registration would still answer yes.
* **The window.** Measured against *today*, unlike health paperwork, which is
  judged as of the show's last day. The two are asking opposite questions: a
  Coggins has to be good on the day the horse is on the grounds, while a
  cancellation is about how much notice the office is getting right now.
"""
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import func


#: How much notice an exhibitor has to give to cancel without the office.
#: Two weeks, counted back from the show's first day.
CANCELLATION_NOTICE_DAYS = 14


def is_on_roster(show_entry) -> bool:
    """Whether this `show_entries` row is a live registration.

    A NULL `registered_at` is the shell row a secretary creates while adding a
    late entry by hand; a set `cancelled_at` is a registration that has been
    called off. Neither is somebody the show is expecting.
    """
    if show_entry is None:
        return False
    return show_entry.registered_at is not None and show_entry.cancelled_at is None


def is_cancelled(show_entry) -> bool:
    return show_entry is not None and show_entry.cancelled_at is not None


def self_cancel_deadline(start_date: Optional[date]) -> Optional[date]:
    """The last day an exhibitor may cancel their own registration.

    None when the show has no start date, which is not a date anything can be
    counted back from -- callers treat that as "ask the office".
    """
    if start_date is None:
        return None
    return start_date - timedelta(days=CANCELLATION_NOTICE_DAYS)


def may_self_cancel(start_date: Optional[date], as_of: Optional[date] = None) -> bool:
    """Whether the exhibitor is still outside the notice window.

    Inclusive of the deadline day itself: "at least two weeks before the show"
    is met by cancelling exactly fourteen days out, and an off-by-one here is
    somebody being told to telephone the show office on the last day they were
    entitled to press the button.
    """
    deadline = self_cancel_deadline(start_date)
    if deadline is None:
        return False
    return (as_of or date.today()) <= deadline


def cancellation_window(start_date: Optional[date], as_of: Optional[date] = None) -> dict:
    """What the screens print beside the cancel control.

    `self_service` is the only field that decides anything; the rest is so a
    screen can say *why* without recomputing the rule and drifting from it.
    """
    today = as_of or date.today()
    deadline = self_cancel_deadline(start_date)
    return {
        "notice_days": CANCELLATION_NOTICE_DAYS,
        "deadline": deadline,
        "self_service": may_self_cancel(start_date, today),
        "days_until_show": (start_date - today).days if start_date else None,
    }


class CancellationBlocked(Exception):
    """Something hangs off this registration that a cancellation must not erase.

    Raised rather than returned so neither caller can forget to check it. The
    router turns it into a 409 with `code` on it; the message is written for the
    person reading the screen, staff or exhibitor.
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


async def cancel_registration(show_entry, show_id, cancelled_by_user_id, reason, db):
    """Call off a registration: drop what it booked, keep the record of it.

    One implementation for both doors — the exhibitor cancelling their own
    outside the notice window, and the show office cancelling from the desk
    inside it. The *permission* differs between the two and is decided by the
    callers; what a cancellation actually does must not.

    What goes: class entries, stall/shavings/camping reservations, futurity
    enrollments and side pot buy-ins. All four are things the show would
    otherwise still be holding for somebody who is not coming, and all four are
    priced, so leaving any of them would bill a cancelled exhibitor.

    What stays: the `show_entries` row, its back number, and every
    `show_payments` row hanging off it. Deleting the row would cascade the
    payments away, and money that moved is not undone by an exhibitor changing
    their plans — what is left is a bill of nothing against whatever was paid,
    which reads as a credit on the office's own screen and is exactly the
    prompt to refund it.

    Refuses outright once a placing or a pot payout exists: at that point the
    exhibitor did not cancel, they competed, and the answer is the secretary's
    to work out rather than a button's.
    """
    from sqlalchemy import select

    from models import Class, Entry, FuturityEntry, Result, SidePotPayout

    payout = await db.execute(
        select(SidePotPayout.id).where(SidePotPayout.show_entry_id == show_entry.id).limit(1)
    )
    if payout.scalar_one_or_none():
        raise CancellationBlocked(
            "SIDE_POT_SETTLED",
            "This exhibitor has been paid out of a settled side pot and cannot "
            "be cancelled. The show secretary handles it from here.",
        )

    entries_result = await db.execute(
        select(Entry)
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id, Entry.exhibitor_id == show_entry.exhibitor_id)
    )
    entries = list(entries_result.scalars().all())

    if entries:
        scored = await db.execute(
            select(Result.id)
            .where(Result.entry_id.in_([e.id for e in entries]))
            .limit(1)
        )
        if scored.scalar_one_or_none():
            raise CancellationBlocked(
                "RESULTS_RECORDED",
                "A placing has already been recorded against one of these "
                "entries, so the registration cannot be cancelled. Contact the "
                "show secretary.",
            )

    # `await db.delete(...)` rather than the sync call: cascading to
    # `entry_attestations` and de-associating `results` are relationship loads,
    # and an unawaited one inside an async session is a MissingGreenlet.
    for entry in entries:
        await db.delete(entry)

    futurity_result = await db.execute(
        select(FuturityEntry).where(FuturityEntry.show_entry_id == show_entry.id)
    )
    for futurity_entry in futurity_result.scalars().all():
        await db.delete(futurity_entry)

    # Through the relationships rather than a bulk DELETE: both are
    # delete-orphan collections on the row we are keeping, and clearing them is
    # what tells the identity map the objects are gone.
    show_entry.reservations.clear()
    show_entry.side_pot_entries.clear()

    show_entry.cancelled_at = func.now()
    show_entry.cancelled_by_user_id = cancelled_by_user_id
    show_entry.cancellation_reason = (reason or "").strip() or None

    await db.commit()
