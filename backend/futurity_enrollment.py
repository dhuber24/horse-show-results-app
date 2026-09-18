"""Keeping a futurity enrollment and its class entries in step with each other.

A futurity enrollment is a horse nominated into a programme; the classes it is
judged in are ordinary `classes` entered through ordinary `entries`. Those were
two entirely independent facts, and that is the gap this module closes — in both
directions, because it went wrong in both.

**An enrollment with no futurity class was billable and unreachable.** The
office fee is charged per enrollment (`billing.futurity_lines`), so a horse
nominated and never entered in any of the futurity's classes owed money for a
programme it was not in, and the only screen that could take it back off was the
futurity's own — the desk, where the rest of that exhibitor's money is worked,
could link out to it and nothing more.

**And a class entry carried no nomination.** Scratching the last futurity class
left the enrollment behind, still charging, with nothing on the desk to say why.

So the rule now runs the way the side pot rule does, and is deliberately the
same shape (`side_pot_membership`): **enrolling enters the classes in the same
press, and scratching the last of them releases the enrollment.** Two things
about that shape are load-bearing, and both are borrowed.

**The classes ride on the enrollment request.** A refusal the person at the
counter cannot immediately satisfy is one they route around — here by entering
the class on the desk, walking back to the futurity screen and enrolling — so
`POST .../entries` takes `class_ids` and books them inside the same transaction.

**The release is read after the delete is flushed.** It decides on the horse's
*remaining* entries, and an unflushed delete still counts the scratched class,
so nothing would ever be released.

Where it differs from a side pot is the key: a pot's membership hangs off the
`show_entries` row, so one buy-in covers the exhibitor. A futurity nominates a
**horse**, so everything here is per (futurity, horse) — one exhibitor may have
two horses in the same futurity, and scratching one horse's last class must not
take the other's nomination with it.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import Class, Entry, Futurity, FuturityEntry, ShowEntry


async def load_show_futurities(show_id: UUID, db: AsyncSession) -> list[Futurity]:
    """Every futurity at this show, with its classes and its enrollments.

    Both relationships are loaded explicitly rather than left to lazy IO: an
    unloaded relationship read in an async request is a `MissingGreenlet` 500.
    """
    result = await db.execute(
        select(Futurity)
        .where(Futurity.show_id == show_id)
        .options(
            selectinload(Futurity.futurity_classes),
            selectinload(Futurity.entries),
        )
    )
    return list(result.scalars().all())


def class_ids_of(futurity: Futurity) -> set[UUID]:
    """The classes this futurity is judged in."""
    return {fc.class_id for fc in futurity.futurity_classes}


def futurities_covering_class(
    futurities: list[Futurity], class_id: UUID
) -> list[Futurity]:
    """The futurities that judge this class, in name order for stable messages."""
    covering = [f for f in futurities if class_id in class_ids_of(f)]
    return sorted(covering, key=lambda f: (f.name or "").lower())


def enrollments_to_release(
    futurities: list[Futurity],
    horse_id: UUID,
    scratched_class_id: UUID,
    remaining_class_ids: set[UUID],
) -> list[tuple[Futurity, FuturityEntry]]:
    """The nominations left with no class behind them after a scratch.

    Narrowed the same three ways `side_pot_membership.pots_to_release` is, for
    the same reasons:

    * **Only futurities that judged the scratched class.** A nomination in some
      other programme is not this deletion's business.
    * **Only where nothing of that futurity is left.** One nomination covers
      every class the futurity names, so scratching one of four leaves the other
      three behind it. `remaining_class_ids` is this *horse's* whole remaining
      entry list at the show.
    * **Only this horse's nomination.** Two horses of one exhibitor in the same
      futurity are two enrollments, and scratching one horse's last class says
      nothing at all about the other.
    """
    out: list[tuple[Futurity, FuturityEntry]] = []
    for futurity in futurities_covering_class(futurities, scratched_class_id):
        if class_ids_of(futurity) & remaining_class_ids:
            continue
        for enrollment in futurity.entries:
            if enrollment.horse_id == horse_id:
                out.append((futurity, enrollment))
    return out


async def release_scratched_enrollments(
    show_id: UUID,
    exhibitor_id: UUID,
    horse_id: UUID | None,
    scratched_class_id: UUID,
    db: AsyncSession,
) -> list[Futurity]:
    """Clear the nominations a just-deleted entry was the last thing backing.

    **Call this after the entry is deleted and flushed**, never before — see the
    module docstring. Both deletion doors call it, the way both call
    `release_scratched_pots`: a rule only the office's door honoured would mean
    an enrollment that survives or not depending on who pressed the button.

    Returns the futurities somebody was taken out of, so the caller can say so.
    """
    if horse_id is None:
        return []
    futurities = await load_show_futurities(show_id, db)
    if not futurities:
        return []

    # The horse's remaining entries at this show. Scoped to the exhibitor as
    # well, because a horse two people show is two entry lists and only this
    # one's nomination is in question.
    remaining = set(
        (
            await db.execute(
                select(Entry.class_id)
                .join(Class, Class.id == Entry.class_id)
                .where(
                    Class.show_id == show_id,
                    Entry.exhibitor_id == exhibitor_id,
                    Entry.horse_id == horse_id,
                )
            )
        )
        .scalars()
        .all()
    )

    released: list[Futurity] = []
    for futurity, enrollment in enrollments_to_release(
        futurities, horse_id, scratched_class_id, remaining
    ):
        await db.delete(enrollment)
        # Kept off the loaded futurity too, so anything reading these later in
        # the same request sees what the commit is about to make true.
        if enrollment in futurity.entries:
            futurity.entries.remove(enrollment)
        released.append(futurity)
    return released


async def assert_classes_enterable(
    futurity: Futurity,
    class_ids: list[UUID],
    db: AsyncSession,
) -> list[Class]:
    """Check the classes an enrollment is booking belong to this futurity.

    Raises `ValueError`. Checked rather than trusted, the same rule a side pot
    opt-in follows: a class outside the futurity would be an entry the exhibitor
    never asked for, booked as a side effect of nominating a horse.
    """
    if not class_ids:
        raise ValueError(
            "Pick at least one of this futurity's classes — a nomination with "
            "no class entered owes the office fee and is judged in nothing."
        )
    allowed = class_ids_of(futurity)
    unknown = [cid for cid in class_ids if cid not in allowed]
    if unknown:
        raise ValueError("Those classes are not part of this futurity.")
    rows = (
        await db.execute(select(Class).where(Class.id.in_(set(class_ids))))
    ).scalars().all()
    return list(rows)


async def entered_class_ids(
    show_entry: ShowEntry, horse_id: UUID, class_ids: set[UUID], db: AsyncSession
) -> set[UUID]:
    """Which of `class_ids` this horse is already entered in at this show.

    So enrolling a horse that is already in some of the futurity's classes adds
    the missing ones rather than refusing the whole press as a duplicate.
    """
    if not class_ids:
        return set()
    rows = (
        await db.execute(
            select(Entry.class_id).where(
                Entry.exhibitor_id == show_entry.exhibitor_id,
                Entry.horse_id == horse_id,
                Entry.class_id.in_(class_ids),
            )
        )
    ).scalars().all()
    return set(rows)
