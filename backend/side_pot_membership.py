"""Which side pots a class obliges its entrants to be in, and joining them.

A side pot bundles classes: buying in once covers every class the pot names,
and the pool is settled against those classes' placings. Until now being in a
pot was purely elective — the desk ticked people in afterwards and the exhibitor
could not join one at all — so a show running a jackpot over its ranch riding
classes had no way to say that the buy-in *is* part of entering them. This
module is that rule: an entry in a class a pot covers requires membership of the
pot, both entry doors enforce it, and both entry forms offer the opt-in in the
same press so nothing is refused that the person in front of the screen cannot
immediately satisfy.

Three things are deliberate, and each of them is the difference between a rule
the office can work with and one they route around.

**At least one pot, never all of them.** A class named by two open pots has been
bundled two ways — a $25 jackpot and a $100 jackpot over the same classes is a
real thing a show does — and demanding both buy-ins for one entry would charge
somebody twice for a choice the show meant them to make. Where only one pot
covers the class, which is the ordinary case, the two readings are the same.

**A settled pot is never required.** `POST .../side-pots/{id}/entries` refuses
to add anybody to a pot whose payouts are already written, so a class in a
settled pot would be a class nobody could enter by any route — a refusal with
nothing at the show able to clear it. Late entries into a class whose pot has
already paid out are exactly the case, and they go in without it.

**Membership is per show entry, not per class entry.** `side_pot_entries` hangs
off `show_entries`, so joining is one buy-in however many of the pot's classes
somebody enters, and a second entry in another of its classes asks for nothing.

**And it is given up the same way it is taken.** Scratching the last class an
exhibitor holds in a pot releases the buy-in (`release_scratched_pots`), because
buying in is now a consequence of entering rather than a decision of its own —
and nothing is paid until the show settles, so there is no collected money to
strand. Without it the desk would bill a jackpot to somebody who is not in one,
and the only way back would be the pot's own screen.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Class, Entry, ShowEntry, SidePot, SidePotEntry

# A pot that is no longer taking buy-ins cannot be a condition of entering.
# Only `open` obliges: `settled` has its payouts written and the pot's own
# endpoint refuses to add to it, and a show that has `closed` a pot has stopped
# asking for buy-ins whether or not the row still accepts one. Either way the
# class stays enterable, which is the point — a requirement nothing at the show
# can satisfy is worse than no requirement.
OPEN_POT_STATUSES = ("open",)


async def load_show_pots(show_id: UUID, db: AsyncSession) -> list[SidePot]:
    """Every pot at this show, with its classes and its entries.

    `SidePot.pot_classes` and `.pot_entries` are both `lazy="selectin"`, so one
    query brings what this module reads and no caller has to remember a loader
    option — the same reasoning that made `Class.sanctioning` eager.
    """
    result = await db.execute(select(SidePot).where(SidePot.show_id == show_id))
    return list(result.scalars().all())


def pots_covering_class(pots: list[SidePot], class_id: UUID) -> list[SidePot]:
    """The open pots that bundle this class, in name order for stable messages."""
    covering = [
        pot
        for pot in pots
        if pot.status in OPEN_POT_STATUSES
        and any(pc.class_id == class_id for pc in pot.pot_classes)
    ]
    return sorted(covering, key=lambda p: (p.name or "").lower())


def joined_pot_ids(pots: list[SidePot], show_entry_id: UUID | None) -> set[UUID]:
    """The pots this show entry has already bought into.

    Read off the pots already in hand rather than queried per class: the desk
    adds several entries in a row and the answer does not change between them.
    """
    if show_entry_id is None:
        return set()
    return {
        pot.id
        for pot in pots
        for entry in pot.pot_entries
        if entry.show_entry_id == show_entry_id
    }


def billed_pots(pots: list[SidePot], show_entry_id: UUID | None) -> list[SidePot]:
    """The pots to charge this show entry a buy-in for, for `billing.build_bill`.

    Every pot they are in, **not** only the open ones. `OPEN_POT_STATUSES`
    answers whether a pot can oblige somebody to buy in; it says nothing about
    whether a buy-in already taken is owed. A pot settled on the Saturday still
    charges the people who were in it — its payouts were funded by exactly that
    money.
    """
    joined = joined_pot_ids(pots, show_entry_id)
    return [pot for pot in pots if pot.id in joined]


def pot_bill_index(pots: list[SidePot]) -> dict[UUID, list[SidePot]]:
    """Every show entry's billed pots, keyed by show entry.

    For the Financials rollup, which builds an account per exhibitor and would
    otherwise call `billed_pots` once each over the same list.
    """
    index: dict[UUID, list[SidePot]] = {}
    for pot in pots:
        for entry in pot.pot_entries:
            index.setdefault(entry.show_entry_id, []).append(pot)
    return index


def unmet_pots(
    pots: list[SidePot],
    class_id: UUID,
    show_entry_id: UUID | None,
    also_joining: set[UUID] | None = None,
) -> list[SidePot]:
    """The pots this class needs and this exhibitor is in none of.

    Empty means the entry may proceed — either no open pot covers the class, or
    one of the covering pots is already bought into. `also_joining` is the
    opt-in arriving with the request itself, so a class and its buy-in can be
    settled in one press rather than one refusal followed by a second call.
    """
    covering = pots_covering_class(pots, class_id)
    if not covering:
        return []
    joined = joined_pot_ids(pots, show_entry_id) | (also_joining or set())
    if any(pot.id in joined for pot in covering):
        return []
    return covering


def requirement_detail(cls, covering: list[SidePot]) -> dict:
    """The 409 body, naming the pots and their buy-ins.

    Names them because "this class needs a side pot" is not something anybody
    can act on: which pot, and what it costs, is the whole of the decision. The
    ids ride along so a form can offer the choice rather than make the caller
    look them up.
    """
    return {
        "code": "SIDE_POT_REQUIRED",
        "message": (
            f"Class {cls.class_number} ({cls.class_name}) is part of "
            + _pot_phrase(covering)
            + ". Entering it means buying into "
            + ("it" if len(covering) == 1 else "one of them")
            + "."
        ),
        "class_id": str(cls.id),
        "side_pots": [
            {
                "id": str(pot.id),
                "name": pot.name,
                "entry_fee_cents": pot.entry_fee_cents,
            }
            for pot in covering
        ],
    }


def _pot_phrase(covering: list[SidePot]) -> str:
    named = ", ".join(f"{pot.name} (${pot.entry_fee_cents / 100:.2f} buy-in)" for pot in covering)
    if len(covering) == 1:
        return f"the {named}"
    return f"these side pots: {named}"


def assert_pots_joinable(
    pots: list[SidePot], pot_ids: set[UUID], class_ids: set[UUID]
) -> list[SidePot]:
    """Check an opt-in arriving on an entry request, and return those pots.

    Two things are refused rather than ignored. A pot id that is not this
    show's, or is not open, because silently dropping it would take the money
    and leave the entry unbacked. And a pot that covers none of the classes
    being entered: the opt-in exists to satisfy this rule, and a buy-in for
    something nobody is entering is a charge the exhibitor never chose — they
    join those from the desk or the pot's own screen.
    """
    by_id = {pot.id: pot for pot in pots if pot.status in OPEN_POT_STATUSES}
    chosen = []
    for pot_id in pot_ids:
        pot = by_id.get(pot_id)
        if pot is None:
            raise ValueError("That side pot is not open for entries at this show")
        if not any(pc.class_id in class_ids for pc in pot.pot_classes):
            raise ValueError(
                f"The {pot.name} pot does not cover any of the classes being entered"
            )
        chosen.append(pot)
    return chosen


def pots_to_release(
    pots: list[SidePot],
    show_entry_id: UUID,
    scratched_class_id: UUID,
    remaining_class_ids: set[UUID],
) -> list[SidePot]:
    """The buy-ins left with nothing behind them after a class is scratched.

    Entering a pot's class is what buys somebody in, so scratching their last
    class in that pot takes them back out again. Nothing at a horse show is paid
    until the end — pot money settles with the show bill — so there is no
    collected payment to strand, and leaving the row would bill somebody a
    buy-in for a jackpot they are no longer in.

    Three things narrow it, and each is a way to avoid clearing a row somebody
    meant to keep:

    * **Only pots that bundled the scratched class.** A buy-in in some other pot
      is not this deletion's business — including a legacy one with no entries
      behind it, which predates the rule and is the office's to judge.
    * **Only where nothing of that pot is left.** One buy-in covers every class
      the pot names, so scratching one of six leaves the other five backing it.
      The remaining classes are the exhibitor's *whole* entry list at this show,
      which is what makes a second horse in a pattern class count.
    * **Only an `open` pot.** A settled pot's buy-in funds a pool whose payouts
      are already written, and a closed one has been frozen deliberately;
      clearing either would change money that has been settled or stopped.
    """
    return [
        pot
        for pot in pots_covering_class(pots, scratched_class_id)
        if any(entry.show_entry_id == show_entry_id for entry in pot.pot_entries)
        and not any(pc.class_id in remaining_class_ids for pc in pot.pot_classes)
    ]


async def release_pots(
    show_entry_id: UUID, pots: list[SidePot], db: AsyncSession
) -> list[SidePotEntry]:
    """Take this show entry back out of each pot. The mirror of `join_pots`.

    Async where `join_pots` is not, because `AsyncSession.delete` is a
    coroutine. Left in the caller's transaction for the same reason the join is:
    the scratch and the buy-in it releases land together or not at all.
    """
    removed: list[SidePotEntry] = []
    for pot in pots:
        for row in [e for e in pot.pot_entries if e.show_entry_id == show_entry_id]:
            await db.delete(row)
            # Kept off the loaded pot too, so anything reading these afterwards
            # in the same request sees what the commit is about to make true.
            pot.pot_entries.remove(row)
            removed.append(row)
    return removed


async def release_scratched_pots(
    show_id: UUID, exhibitor_id: UUID, scratched_class_id: UUID, db: AsyncSession
) -> list[SidePot]:
    """Clear the buy-ins a just-deleted entry was the last thing backing.

    **Call this after the entry is deleted and flushed**, never before: it reads
    the exhibitor's remaining entries to decide, and an unflushed delete would
    leave the scratched class still counting as one of them — so nothing would
    ever be released.

    Both deletion doors call it, the same way both entry doors buy in. A rule
    only one door honours would mean a buy-in that survives or not depending on
    whether the exhibitor or the office pressed the button.
    """
    pots = await load_show_pots(show_id, db)
    if not pots:
        return []

    show_entry = (
        await db.execute(
            select(ShowEntry).where(
                ShowEntry.show_id == show_id, ShowEntry.exhibitor_id == exhibitor_id
            )
        )
    ).scalar_one_or_none()
    if show_entry is None:
        return []

    remaining = set(
        (
            await db.execute(
                select(Entry.class_id)
                .join(Class, Class.id == Entry.class_id)
                .where(Class.show_id == show_id, Entry.exhibitor_id == exhibitor_id)
            )
        )
        .scalars()
        .all()
    )

    releasing = pots_to_release(pots, show_entry.id, scratched_class_id, remaining)
    await release_pots(show_entry.id, releasing, db)
    return releasing


def join_pots(show_entry_id: UUID, pots: list[SidePot], db: AsyncSession) -> list[SidePotEntry]:
    """Buy this show entry into each pot, skipping any it is already in.

    Added to the caller's transaction and not committed here: the buy-in and the
    entry that obliged it land together or not at all. Idempotent because both
    entry doors may pass the same pot twice — the exhibitor form sends it with
    each class in a batch, and two classes in one pot is still one buy-in.

    `paid=True` for the reason the pot's own endpoint defaults it that way: pot
    money settles with the exhibitor's show bill, so being in the pot is what
    owing the buy-in means, and a pot whose rows all read unpaid has a $0 pool.
    """
    created: list[SidePotEntry] = []
    for pot in pots:
        if any(entry.show_entry_id == show_entry_id for entry in pot.pot_entries):
            continue
        row = SidePotEntry(side_pot_id=pot.id, show_entry_id=show_entry_id, paid=True)
        db.add(row)
        # Kept on the loaded pot so a batch entering two of its classes does not
        # try to buy in twice before anything is flushed.
        pot.pot_entries.append(row)
        created.append(row)
    return created
