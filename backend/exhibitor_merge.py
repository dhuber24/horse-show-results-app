"""Folding two exhibitor records into one.

The registration desk has been able to put a *person* on a show twice for as
long as it has existed, because an exhibitor record and a person are not the
same thing. An account deleted and made again leaves the old record behind
(`exhibitors.user_id` is ``ON DELETE SET NULL``); an office that types a walk-up
in without finding their profile first makes a second; and since migration 140
the office types people in deliberately, so the commonest duplicate of all is
the one this app creates on purpose — the office's record of somebody, and then
the record that appears when that person finally signs up for themselves.

`DeskClient` has grouped same-name records under one roster entry since the
desk was built, and its note ended "If they are the same person, remove the one
that should not be here." Removal was the only honest thing to offer, because
everything the wrong record holds — entries, a back number, paperwork
sign-offs, a bill — went with it. This module is the other answer: move all of
it onto the record that is staying, then remove what is left.

Two rules shape the whole thing.

**A name is never why a merge happens.** Nothing here decides that two records
are one person; it does what somebody has decided. `merge_candidates` ranks
suggestions and says why each is a suggestion, and the strongest reason it can
offer -- an email address the office wrote down matching the one an account was
opened with -- is still only a reason to ask.

**Nothing is dropped to make the move fit.** Every table that points at an
exhibitor has to land somewhere, and the handful with a uniqueness rule -- one
membership per association, one signature per waiver, one roster row per show --
are folded rather than deleted, so the surviving record ends up holding the
better of the two answers. The one thing a merge genuinely discards is a
duplicate of something the survivor already had.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    Entry,
    Exhibitor,
    ExhibitorCompetitionCard,
    ExhibitorDocument,
    ExhibitorHorse,
    ExhibitorRegistration,
    Horse,
    HorseAccessRequest,
    ShowContactMessage,
    ShowEntry,
    ShowEntryReservation,
    ShowPayment,
    ShowRegistrationDraft,
    ShowVerification,
    ShowWaiverSignature,
    SidePotEntry,
    SidePotPayout,
    User,
)

# Profile columns an office record may hold and an account record may not, or
# the other way about. A merge fills the survivor's blanks and never overwrites
# an answer it already has -- the record somebody chose to keep is the one whose
# details they were looking at.
_PROFILE_FIELDS = (
    "email",
    "phone",
    "address",
    "city",
    "state",
    "zip",
    "date_of_birth",
    "emergency_contact_name",
    "emergency_contact_phone",
    "parent_guardian_name",
    "parent_guardian_phone",
    "apha_member_number",
    "apha_member_expiry",
    "amateur_card_number",
    "amateur_card_expiry",
    "amateur_novice_codes",
    "created_by_user_id",
)


def normalize_name(value: Optional[str]) -> str:
    return " ".join((value or "").split()).lower()


def normalize_email(value: Optional[str]) -> str:
    return (value or "").strip().lower()


# ── The three decisions a merge makes ─────────────────────────────────────────
#
# Pulled out of the statements that carry them out, and written against plain
# attributes rather than mapped rows, so they can be tested without a database.
# Everything else in this module is a move; these are the only places a merge
# chooses between two answers, and they are the places to get wrong.


def is_live(row) -> bool:
    """On the roster: signed up and not cancelled. `cancellations.is_on_roster`,
    restated here only so this module stays importable without it."""
    return row.registered_at is not None and row.cancelled_at is None


def adopt_standing(keep, remove) -> None:
    """The surviving roster row takes the better standing of the two.

    What a roster row answers is whether this person is entered at this show,
    and when one person has two of them, one of the two rows is the answer.

    A **live sign-up wins outright** — over a shell row a secretary opened while
    adding an entry by hand, and over a cancelled one. Somebody who cancelled
    under an old record and signed up again under a new one is entered, and a
    merge that read their cancellation as the surviving answer would take them
    off the stall chart on the strength of a tidy-up.

    A **back number is adopted only where the survivor has none.** The number on
    somebody's back at the show is the one the office issued them, and where
    both rows carry one the office is looking at both and has chosen which
    record to keep — so this does not overrule them.
    """
    if is_live(remove) and not is_live(keep):
        keep.registered_at = remove.registered_at
        keep.cancelled_at = None
        keep.cancelled_by_user_id = None
        keep.cancellation_reason = None
    elif keep.registered_at is None and remove.registered_at is not None:
        keep.registered_at = remove.registered_at

    if keep.back_number is None:
        keep.back_number = remove.back_number
    if keep.preferred_back_number is None:
        keep.preferred_back_number = remove.preferred_back_number
    for field in ("arrival_date", "departure_date", "registration_notes", "stall_request"):
        if getattr(keep, field) is None:
            setattr(keep, field, getattr(remove, field))


def merge_reservation(held, incoming) -> None:
    """Two bookings of one fee become one: add the quantities, keep the earlier date.

    Added rather than one of them chosen, because both were booked — four stalls
    under one record and two under the other is six stalls the show has set
    aside, and picking either number alone is a stall somebody arrives to find
    they have not got.

    `reserved_at` is what selects between a fee's early rate and its standard
    one, so the survivor keeps the **earlier** of the two dates. Repricing an
    April booking at a July date because the office tidied somebody's records is
    the one outcome an early rate exists to promise against.
    """
    held.quantity = (held.quantity or 0) + (incoming.quantity or 0)
    if incoming.reserved_at and (held.reserved_at is None or incoming.reserved_at < held.reserved_at):
        held.reserved_at = incoming.reserved_at


def fill_profile_blanks(keep, remove) -> list[str]:
    """Fill the survivor's empty fields from the record going, and nothing else.

    Never overwrites an answer the survivor already has: the record somebody
    chose to keep is the one whose details they were looking at when they chose
    it. Returns the fields it filled, so a caller can say what it took.
    """
    filled: list[str] = []
    for field in _PROFILE_FIELDS:
        if getattr(keep, field, None) in (None, "") and getattr(remove, field, None) not in (None, ""):
            setattr(keep, field, getattr(remove, field))
            filled.append(field)
    return filled


async def account_email(exhibitor: Exhibitor, db: AsyncSession) -> Optional[str]:
    """The address to judge this record by: the account's, or what the office wrote.

    A linked record's authority is `users.email` -- that is the address somebody
    signs in with. `exhibitors.email` is what a member of staff copied off a
    paper entry blank, which is all there is for a record with no account.
    """
    if exhibitor.user_id is not None:
        user = await db.get(User, exhibitor.user_id)
        if user and user.email:
            return normalize_email(user.email)
    return normalize_email(exhibitor.email) or None


# ── Suggesting a merge ────────────────────────────────────────────────────────


async def merge_candidates(
    exhibitor: Exhibitor,
    db: AsyncSession,
    *,
    limit: int = 10,
) -> list[dict]:
    """Other records that might be this same person, strongest reason first.

    Two reasons, and they are not equally good. An **email** match is the office
    having written down the address somebody later opened an account with, which
    is about as close to evidence as this app gets without asking anybody. A
    **name** match is what the desk has always grouped on and is no evidence at
    all -- there are two Sarah Johnsons at plenty of shows -- but it is the only
    thing available when the office took a name and nothing else, and it is what
    staff standing in front of the person can settle in a second.

    Ranked rather than filtered: a caller showing one suggestion should show the
    email one, and a caller showing a list wants the name ones underneath it.
    """
    email = await account_email(exhibitor, db)
    name_key = normalize_name(exhibitor.full_name)

    conditions = []
    if name_key:
        conditions.append(func.lower(func.btrim(Exhibitor.full_name)) == name_key)
    if email:
        conditions.append(func.lower(Exhibitor.email) == email)
        conditions.append(func.lower(User.email) == email)
    if not conditions:
        return []

    result = await db.execute(
        select(Exhibitor, User)
        .outerjoin(User, User.id == Exhibitor.user_id)
        .where(Exhibitor.id != exhibitor.id, or_(*conditions))
        .limit(limit * 4)
    )

    candidates: list[dict] = []
    for row, user in result.all():
        row_email = normalize_email(user.email if user and user.email else row.email)
        by_email = bool(email) and row_email == email
        by_name = bool(name_key) and normalize_name(row.full_name) == name_key
        if not (by_email or by_name):
            continue
        candidates.append(
            {
                "exhibitor_id": row.id,
                "full_name": row.full_name,
                "email": row_email or None,
                "has_account": row.user_id is not None,
                "office_record": row.user_id is None and row.created_by_user_id is not None,
                "matched_on": "email" if by_email else "name",
                "created_at": row.created_at,
            }
        )

    candidates.sort(key=lambda c: (0 if c["matched_on"] == "email" else 1, c["full_name"].lower()))
    return candidates[:limit]


# ── What a merge would move ───────────────────────────────────────────────────


async def merge_summary(exhibitor_id: UUID, db: AsyncSession) -> dict:
    """What this record is carrying, in the terms the desk talks about.

    Shown before the press, and returned after it, so the confirmation and the
    confirmation-afterwards are the same figures rather than two counts that can
    disagree. Deliberately the things a person would miss -- their classes,
    their number, their horses, their money -- and not a row count per table.
    """
    entries = await db.execute(
        select(func.count()).select_from(Entry).where(Entry.exhibitor_id == exhibitor_id)
    )
    shows = await db.execute(
        select(func.count()).select_from(ShowEntry).where(ShowEntry.exhibitor_id == exhibitor_id)
    )
    horses = await db.execute(
        select(func.count())
        .select_from(ExhibitorHorse)
        .where(ExhibitorHorse.exhibitor_id == exhibitor_id)
    )
    owned = await db.execute(
        select(func.count()).select_from(Horse).where(Horse.owner_exhibitor_id == exhibitor_id)
    )
    memberships = await db.execute(
        select(func.count())
        .select_from(ExhibitorRegistration)
        .where(ExhibitorRegistration.exhibitor_id == exhibitor_id)
    )
    signatures = await db.execute(
        select(func.count())
        .select_from(ShowWaiverSignature)
        .where(ShowWaiverSignature.exhibitor_id == exhibitor_id)
    )
    payments = await db.execute(
        select(func.coalesce(func.sum(ShowPayment.amount_cents), 0))
        .select_from(ShowPayment)
        .join(ShowEntry, ShowEntry.id == ShowPayment.show_entry_id)
        .where(ShowEntry.exhibitor_id == exhibitor_id)
    )
    return {
        "shows": int(shows.scalar_one()),
        "class_entries": int(entries.scalar_one()),
        "horses": int(horses.scalar_one()) + int(owned.scalar_one()),
        "memberships": int(memberships.scalar_one()),
        "signatures": int(signatures.scalar_one()),
        "payments_cents": int(payments.scalar_one() or 0),
    }


# ── Doing it ──────────────────────────────────────────────────────────────────


async def _move_unique_children(
    db: AsyncSession,
    model,
    keys: tuple[str, ...],
    keep_id: UUID,
    remove_id: UUID,
) -> int:
    """Repoint rows at `keep`, dropping the ones it already has an answer for.

    One membership per association, one competition card per division, one
    signature per waiver, one horse per link, one draft per show: in every case
    the duplicate says exactly what the survivor's own row already says, so the
    row that goes is a copy rather than a fact. Returns how many were dropped,
    because a merge that silently discarded something should be able to say so.
    """
    kept = await db.execute(
        select(*[getattr(model, k) for k in keys]).where(model.exhibitor_id == keep_id)
    )
    held = {tuple(row) for row in kept.all()}
    if held:
        incoming = await db.execute(
            select(model.id, *[getattr(model, k) for k in keys]).where(
                model.exhibitor_id == remove_id
            )
        )
        duplicate_ids = [row[0] for row in incoming.all() if tuple(row[1:]) in held]
        if duplicate_ids:
            await db.execute(delete(model).where(model.id.in_(duplicate_ids)))
    else:
        duplicate_ids = []

    await db.execute(
        update(model)
        .where(model.exhibitor_id == remove_id)
        .values(exhibitor_id=keep_id)
        .execution_options(synchronize_session=False)
    )
    return len(duplicate_ids)


async def _fold_show_entry(db: AsyncSession, keep: ShowEntry, remove: ShowEntry) -> None:
    """Two roster rows for one person at one show become one.

    `show_entries` is unique on `(show_id, exhibitor_id)`, so this is the only
    place a merge cannot simply repoint. Everything hanging off the row moves
    across -- reservations, payments, pot buy-ins, futurity nominations -- and
    the survivor takes **the better standing of the two**, because the question
    the roster answers is whether this person is entered, and one of the two
    rows is the answer.

    So a live sign-up beats a shell row a secretary opened, and beats a
    cancelled one: somebody who cancelled under an old record and signed up
    again under a new one is entered. A back number is adopted only where the
    survivor has none -- the number on the person's back at the show is the one
    the office issued them, and if both rows carry one the office is looking at
    both and picked which record to keep.
    """
    # Money first: a payment must never be the thing that fails to move.
    await db.execute(
        update(ShowPayment)
        .where(ShowPayment.show_entry_id == remove.id)
        .values(show_entry_id=keep.id)
        .execution_options(synchronize_session=False)
    )
    await db.execute(
        update(SidePotEntry)
        .where(
            SidePotEntry.show_entry_id == remove.id,
            SidePotEntry.side_pot_id.not_in(
                select(SidePotEntry.side_pot_id).where(SidePotEntry.show_entry_id == keep.id)
            ),
        )
        .values(show_entry_id=keep.id)
        .execution_options(synchronize_session=False)
    )
    await db.execute(delete(SidePotEntry).where(SidePotEntry.show_entry_id == remove.id))
    await db.execute(
        update(SidePotPayout)
        .where(
            SidePotPayout.show_entry_id == remove.id,
            SidePotPayout.side_pot_id.not_in(
                select(SidePotPayout.side_pot_id).where(SidePotPayout.show_entry_id == keep.id)
            ),
        )
        .values(show_entry_id=keep.id)
        .execution_options(synchronize_session=False)
    )
    await db.execute(delete(SidePotPayout).where(SidePotPayout.show_entry_id == remove.id))

    # A futurity nomination is unique on (futurity_id, horse_id), which no
    # change of roster row can break -- the same horse cannot be nominated
    # twice whoever holds it.
    await db.execute(
        update(_futurity_entry_model())
        .where(_futurity_entry_model().show_entry_id == remove.id)
        .values(show_entry_id=keep.id)
        .execution_options(synchronize_session=False)
    )

    await _fold_reservations(db, keep, remove)
    adopt_standing(keep, remove)

    # Clear the number before the delete so the (show_id, back_number) unique
    # index cannot see both rows holding it for the instant in between.
    remove.back_number = None
    await db.flush()
    await db.delete(remove)
    await db.flush()


async def _fold_reservations(db: AsyncSession, keep: ShowEntry, remove: ShowEntry) -> None:
    """Add the quantities together, and keep the earlier booking date.

    `show_entry_reservations` is unique on `(show_entry_id, show_fee_id)`, so
    two rows for the same fee have to become one. They are added rather than one
    of them chosen, because both were booked: four stalls reserved under one
    record and two under the other is six stalls the show has set aside.

    `reserved_at` is what picks between a fee's early rate and its standard one,
    so the surviving row keeps the **earlier** of the two dates. Repricing
    somebody's April booking at a July date because the office tidied their
    records is the one outcome an early rate exists to promise against.
    """
    existing = await db.execute(
        select(ShowEntryReservation).where(ShowEntryReservation.show_entry_id == keep.id)
    )
    by_fee = {row.show_fee_id: row for row in existing.scalars().all()}

    incoming = await db.execute(
        select(ShowEntryReservation).where(ShowEntryReservation.show_entry_id == remove.id)
    )
    for row in incoming.scalars().all():
        held = by_fee.get(row.show_fee_id)
        if held is None:
            row.show_entry_id = keep.id
            continue
        merge_reservation(held, row)
        await db.delete(row)
    await db.flush()


def _futurity_entry_model():
    # Imported lazily: `models` imports cleanly either way, but keeping the
    # futurity tables out of this module's import list makes the dependency
    # obvious at the one place it is used.
    from models import FuturityEntry

    return FuturityEntry


async def merge_exhibitors(
    keep: Exhibitor,
    remove: Exhibitor,
    db: AsyncSession,
) -> dict:
    """Move everything `remove` holds onto `keep`, then delete `remove`.

    Caller-ordered on purpose: which record survives is a decision with
    consequences the app cannot weigh — an account, a longer history, the
    details somebody has just been reading — so the screens recommend and the
    person presses. The one thing that is not left to the caller is the login:
    an account on the record being removed moves to the survivor, because the
    alternative is a merge that quietly leaves somebody unable to sign in to
    their own entries.

    Everything runs in the caller's transaction and the caller commits, so a
    half-moved person is not a state this can leave behind.
    """
    if keep.id == remove.id:
        raise ValueError("An exhibitor cannot be merged into itself.")

    summary = await merge_summary(remove.id, db)

    # ── The roster, show by show ──────────────────────────────────────────────
    keep_rows = await db.execute(select(ShowEntry).where(ShowEntry.exhibitor_id == keep.id))
    keep_by_show = {row.show_id: row for row in keep_rows.scalars().all()}
    remove_rows = await db.execute(select(ShowEntry).where(ShowEntry.exhibitor_id == remove.id))

    shows_folded = 0
    for row in remove_rows.scalars().all():
        held = keep_by_show.get(row.show_id)
        if held is None:
            row.exhibitor_id = keep.id
            keep_by_show[row.show_id] = row
            continue
        await _fold_show_entry(db, held, row)
        shows_folded += 1

    # ── Everything keyed on the exhibitor directly ────────────────────────────
    await db.execute(
        update(Entry)
        .where(Entry.exhibitor_id == remove.id)
        .values(exhibitor_id=keep.id)
        .execution_options(synchronize_session=False)
    )
    await db.execute(
        update(ExhibitorDocument)
        .where(ExhibitorDocument.exhibitor_id == remove.id)
        .values(exhibitor_id=keep.id)
        .execution_options(synchronize_session=False)
    )
    await db.execute(
        update(ShowContactMessage)
        .where(ShowContactMessage.sender_exhibitor_id == remove.id)
        .values(sender_exhibitor_id=keep.id)
        .execution_options(synchronize_session=False)
    )
    for column in (Horse.owner_exhibitor_id, Horse.created_by_exhibitor_id):
        await db.execute(
            update(Horse)
            .where(column == remove.id)
            .values({column.key: keep.id})
            .execution_options(synchronize_session=False)
        )
    for column in (
        HorseAccessRequest.requester_exhibitor_id,
        HorseAccessRequest.approver_exhibitor_id,
    ):
        await db.execute(
            update(HorseAccessRequest)
            .where(column == remove.id)
            .values({column.key: keep.id})
            .execution_options(synchronize_session=False)
        )

    duplicates = 0
    duplicates += await _move_unique_children(db, ExhibitorHorse, ("horse_id",), keep.id, remove.id)
    duplicates += await _move_unique_children(
        db, ExhibitorRegistration, ("association_id",), keep.id, remove.id
    )
    duplicates += await _move_unique_children(
        db, ExhibitorCompetitionCard, ("association_id", "division"), keep.id, remove.id
    )
    duplicates += await _move_unique_children(
        db, ShowWaiverSignature, ("waiver_id",), keep.id, remove.id
    )
    duplicates += await _move_unique_children(
        db, ShowRegistrationDraft, ("show_id",), keep.id, remove.id
    )
    duplicates += await _move_unique_children(
        db, ShowVerification, ("show_id", "kind", "association_id"), keep.id, remove.id
    )

    # ── The profile itself ────────────────────────────────────────────────────
    fill_profile_blanks(keep, remove)

    account_moved = False
    if keep.user_id is None and remove.user_id is not None:
        keep.user_id = remove.user_id
        remove.user_id = None
        account_moved = True
        # A linked record prints the account's name -- `_sync_linked_exhibitor_name`
        # keeps them in step from then on, and the desk should not have to wait
        # for somebody to edit their profile before the two agree.
        user = await db.get(User, keep.user_id)
        if user:
            keep.full_name = f"{user.first_name} {user.last_name}".strip() or keep.full_name

    await db.flush()
    await db.delete(remove)
    await db.flush()

    return {
        "kept_exhibitor_id": keep.id,
        "kept_name": keep.full_name,
        "moved": summary,
        "shows_folded": shows_folded,
        "duplicates_dropped": duplicates,
        "account_moved": account_moved,
    }
