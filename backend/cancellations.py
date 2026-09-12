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


def registration_blocker(
    *,
    paid_out: bool,
    in_settled_pot: bool,
    competed: bool,
    has_payments: bool = False,
    action: str = "cancelled",
) -> Optional[CancellationBlocked]:
    """Why this registration may not be cancelled or removed, or None if it may.

    Shared by cancelling and removing, which differ in exactly one fact: a
    cancellation keeps the row, so the payments on it survive and are no
    reason to refuse, while a removal deletes the row and would take them with
    it. So only the removal passes `has_payments`. `action` is the word the
    message uses, since an exhibitor cancelling their own registration reads
    these too.

    A settled pot is refused whether or not it paid this exhibitor anything.
    Settling is irreversible and every pot endpoint enforces it; clearing an
    entry out of one here would change the pool of a pot whose payouts are
    already written against the old one.
    """
    if paid_out:
        return CancellationBlocked(
            "SIDE_POT_SETTLED",
            "This exhibitor has been paid out of a settled side pot, so the "
            f"registration cannot be {action}. The show secretary handles it "
            "from here.",
        )
    if in_settled_pot:
        return CancellationBlocked(
            "SIDE_POT_SETTLED",
            "This exhibitor is in a side pot that has already been settled, so "
            f"the registration cannot be {action}.",
        )
    if competed:
        return CancellationBlocked(
            "RESULTS_RECORDED",
            "A placing has already been recorded against one of these entries, "
            f"so the registration cannot be {action}. Contact the show "
            "secretary.",
        )
    if has_payments:
        return CancellationBlocked(
            "PAYMENTS_RECORDED",
            "This exhibitor has payments recorded at this show, and removing "
            "the registration would delete them. Cancel it instead — that drops "
            "their classes and stalls and keeps the payments on their account "
            "to refund.",
        )
    return None


async def _drop_bookings(show_entry, show_id, db, *, removing: bool) -> None:
    """Refuse if the registration has competed; otherwise drop what it booked.

    What goes: class entries, stall/shavings/camping reservations, futurity
    enrollments and side pot buy-ins. All four are things the show would
    otherwise still be holding for somebody who is not coming, and all four are
    priced, so leaving any of them would bill somebody who is not there.

    The caller decides what happens to the `show_entries` row afterwards and
    commits. `show_entry` must arrive with `reservations`, `side_pot_entries`
    (and `payments`, when `removing`) eager-loaded.
    """
    from sqlalchemy import select

    from models import Class, Entry, FuturityEntry, Result, SidePot, SidePotEntry, SidePotPayout

    payout = await db.execute(
        select(SidePotPayout.id).where(SidePotPayout.show_entry_id == show_entry.id).limit(1)
    )
    settled_pot = await db.execute(
        select(SidePotEntry.id)
        .join(SidePot, SidePot.id == SidePotEntry.side_pot_id)
        .where(SidePotEntry.show_entry_id == show_entry.id, SidePot.status == "settled")
        .limit(1)
    )

    entries_result = await db.execute(
        select(Entry)
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id, Entry.exhibitor_id == show_entry.exhibitor_id)
    )
    entries = list(entries_result.scalars().all())

    competed = False
    if entries:
        scored = await db.execute(
            select(Result.id)
            .where(Result.entry_id.in_([e.id for e in entries]))
            .limit(1)
        )
        competed = scored.scalar_one_or_none() is not None

    blocker = registration_blocker(
        paid_out=payout.scalar_one_or_none() is not None,
        in_settled_pot=settled_pot.scalar_one_or_none() is not None,
        competed=competed,
        has_payments=bool(show_entry.payments) if removing else False,
        action="removed" if removing else "cancelled",
    )
    if blocker:
        raise blocker

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
    # delete-orphan collections on the row, and clearing them is what tells the
    # identity map the objects are gone.
    show_entry.reservations.clear()
    show_entry.side_pot_entries.clear()


async def cancel_registration(show_entry, show_id, cancelled_by_user_id, reason, db):
    """Call off a registration: drop what it booked, keep the record of it.

    One implementation for both doors — the exhibitor cancelling their own
    outside the notice window, and the show office cancelling from the desk
    inside it. The *permission* differs between the two and is decided by the
    callers; what a cancellation actually does must not.

    What stays: the `show_entries` row, its back number, and every
    `show_payments` row hanging off it. Deleting the row would cascade the
    payments away, and money that moved is not undone by an exhibitor changing
    their plans — what is left is a bill of nothing against whatever was paid,
    which reads as a credit on the office's own screen and is exactly the
    prompt to refund it.

    Refuses outright once a placing or a settled pot exists: at that point the
    exhibitor did not cancel, they competed, and the answer is the secretary's
    to work out rather than a button's.
    """
    await _drop_bookings(show_entry, show_id, db, removing=False)

    show_entry.cancelled_at = func.now()
    show_entry.cancelled_by_user_id = cancelled_by_user_id
    show_entry.cancellation_reason = (reason or "").strip() or None

    await db.commit()


async def remove_registration(show_entry, show_id, db):
    """Take somebody off the show entirely, however they got on it.

    The office's delete, beside the cancel. Cancelling is for a registration
    that was real and whose money has to be settled; this is for one the show
    wants gone — a duplicate, a test sign-up, somebody entered under the wrong
    person, a sign-up nobody paid for that the office would rather not carry as
    a cancelled row. It used to refuse anyone who had signed themselves up, so
    the office had no way to remove a self-registration at all.

    Everything the registration booked goes (see `_drop_bookings`) and then the
    row itself. **Refused while payments are on it**, because the row cascades
    to `show_payments` and a refund is a negative payment, never a deletion —
    the answer there is to cancel, which keeps the money on their account.
    Refused on a placing or a settled pot for the same reason a cancellation is.
    """
    await _drop_bookings(show_entry, show_id, db, removing=True)
    await db.delete(show_entry)
    await db.commit()
