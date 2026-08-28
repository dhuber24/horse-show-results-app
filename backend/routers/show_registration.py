"""Exhibitor self-registration for a published show.

Registration is two steps, in order:

1. **Sign up for the show** (`/signup`). Creates the `show_entries` row — the
   show-level record that carries the back number — and captures what the show
   office needs to run the grounds: stalls, bags of shavings, camping. Those
   are quantities against the show's own `show_fees` catalog, so the exhibitor
   only ever sees what the secretary configured, at the secretary's prices.

2. **Enter classes** (`POST /`). Requires a completed sign-up: an exhibitor
   whose `show_entries.registered_at` is NULL is turned away with a 409 rather
   than silently having a shell row created for them. That ordering is the
   point — the office wants stall counts *before* it has a ring full of horses.

Each class entry creates one `entries` row per (class, horse) pair and runs the
same association validation as the secretary entry path.

Health paperwork does **not** gate any of this. A horse whose Coggins is
missing, undated, or lapsed by the show's last day is entered like any other and
shows up on the screen — and on the show office's health flags — as something to
sort out before shipping in.

The exhibitor is derived from the authenticated user — never trusted from the
request body — so a logged-in EXHIBITOR can only register themselves.

Once a show flips out of PUBLISHED (ACTIVE / COMPLETED / DRAFT), these
endpoints return 403 and the secretary must add late entries through the admin
flow.
"""
from datetime import date
from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, union
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from billing import (
    build_bill,
    early_rate_is_open,
    fee_rate_cents,
    class_sanction_cents,
    office_charge_total_cents,
    reservable_fees,
    sanction_rates,
)
from database import get_db
from dependencies import INTERNAL_API_KEY, require_authenticated, safe_uuid
from models import (
    Class,
    ClassAssociation,
    Entry,
    Exhibitor,
    ExhibitorHorse,
    Futurity,
    FuturityClass,
    FuturityEntry,
    Horse,
    Result,
    Show,
    ShowEntry,
    ShowEntryReservation,
    ShowFee,
)
from routers.futurities import load_billable_futurities, missing_horse_details
from routers.horse_documents import health_by_horse
from routers.shows import get_aqha_association_id
from rules import get_rules
from schemas import EntryOut
import standard_classes

router = APIRouter(prefix="/shows/{show_id}/register", tags=["Show Registration"])


# ── Request / response schemas ────────────────────────────────────────────────

class ShowRegistrationItem(BaseModel):
    class_id: UUID
    horse_id: UUID
    apha_division: Optional[str] = Field(default=None, max_length=40)
    relationship_to_owner: Optional[str] = Field(default=None, max_length=200)


class ShowRegistrationCreate(BaseModel):
    entries: list[ShowRegistrationItem] = Field(min_length=1)


class FeeBreakdownItem(BaseModel):
    class_id: UUID
    class_number: str
    class_name: str
    fee_cents: int
    sanction_cents: int = 0


class ShowRegistrationResult(BaseModel):
    show_entry_id: UUID
    created_entries: list[EntryOut]
    fee_breakdown: list[FeeBreakdownItem]
    subtotal_fee_cents: int
    sanction_total_cents: int = 0
    office_charge_total_cents: int = 0
    total_fee_cents: int


def _class_sanction_cents(show: Show, class_: Class) -> int:
    """The club sanction fees one entry in this class owes.

    Thin wrapper over `billing.class_sanction_cents` so this router keeps
    quoting the number the bill will actually charge rather than deriving a
    second one. It re-reads `sanction_rates` per call, which is fine for the
    handful of callers here; `build_bill` hoists it out of its loop.
    """
    return class_sanction_cents(class_, sanction_rates(show))


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _load_exhibitor_for_user(user_id: UUID, db: AsyncSession) -> Exhibitor:
    result = await db.execute(
        select(Exhibitor)
        .options(selectinload(Exhibitor.registrations))
        .where(Exhibitor.user_id == user_id)
    )
    exhibitor = result.scalar_one_or_none()
    if not exhibitor:
        raise HTTPException(403, "Only exhibitors can self-register for a show")
    return exhibitor


async def _load_published_show_or_403(show_id: UUID, db: AsyncSession) -> Show:
    result = await db.execute(
        select(Show)
        .options(
            selectinload(Show.show_type),
            # Needed by _class_sanction_cents: the per-class rate is read
            # off the show's club sanctioning rows.
            selectinload(Show.sanctioning),
            # Read by `billing.charge_lines` off the Show row, the same way
            # `office_charge_cents` is: the show's own per-horse and per-judge
            # charges, and the panel size they multiply by.
            selectinload(Show.fees),
            selectinload(Show.judges),
        )
        .where(Show.id == show_id)
    )
    show = result.scalar_one_or_none()
    if not show:
        raise HTTPException(404, "Show not found")
    if show.status != "PUBLISHED":
        raise HTTPException(
            403,
            "Self-registration is only available while the show is open for "
            f"registration (current status: {show.status}). "
            "Contact the show secretary to be added.",
        )
    return show


async def _exhibitor_horse_ids(exhibitor_id: UUID, db: AsyncSession) -> set[UUID]:
    """Horses on this exhibitor's profile — matches the /my-horses endpoint (created or linked).

    Intentionally excludes horses that only have owner_exhibitor_id set: those are
    invisible to the exhibitor in their profile UI and cannot be managed there, so they
    should not appear in the self-registration picker either. Use ExhibitorHorse to
    explicitly grant an exhibitor access to a horse they didn't create.
    """
    from_created = select(Horse.id).where(Horse.created_by_exhibitor_id == exhibitor_id)
    from_link = (
        select(Horse.id)
        .join(ExhibitorHorse, ExhibitorHorse.horse_id == Horse.id)
        .where(ExhibitorHorse.exhibitor_id == exhibitor_id)
    )
    combined = union(from_created, from_link).subquery()
    result = await db.execute(select(combined.c.id))
    return {row[0] for row in result.all()}


async def _load_show_entry(
    show_id: UUID, exhibitor_id: UUID, db: AsyncSession
) -> Optional[ShowEntry]:
    result = await db.execute(
        select(ShowEntry)
        .options(selectinload(ShowEntry.reservations).selectinload(ShowEntryReservation.show_fee))
        .where(ShowEntry.show_id == show_id, ShowEntry.exhibitor_id == exhibitor_id)
    )
    return result.scalar_one_or_none()


async def _load_reservable_fees(show_id: UUID, db: AsyncSession) -> list[ShowFee]:
    result = await db.execute(
        select(ShowFee).where(ShowFee.show_id == show_id).order_by(ShowFee.sort_order, ShowFee.label)
    )
    return reservable_fees(result.scalars().all())


def _fee_options_out(fees: list[ShowFee], show_entry: Optional[ShowEntry]) -> list[dict]:
    """The reservable fees, each priced for *this* exhibitor.

    `rate_cents` is what they will actually be charged, and is the only number
    the sign-up screen should multiply by a quantity — quoting `amount_cents`
    while `build_bill` charges the early rate is exactly the disagreement
    billing.py exists to prevent.

    Two rates can be in play at once on the same screen: a line they already
    booked keeps the rate it was booked at, while a line they have not booked
    is quoted at today's. `early_rate_open` is the second of those, so the
    screen can nudge someone to reserve before the deadline.
    """
    booked_on = {
        r.show_fee_id: r.reserved_at for r in (show_entry.reservations if show_entry else []) or []
    }
    return [
        {
            "id": str(f.id),
            "code": f.code,
            "label": f.label,
            "unit": f.unit,
            "amount_cents": f.amount_cents,
            "rate_cents": fee_rate_cents(f, booked_on.get(f.id)),
            "early_amount_cents": f.early_amount_cents,
            "early_deadline": f.early_deadline,
            "early_rate_open": early_rate_is_open(f),
            "notes": f.notes,
        }
        for f in fees
    ]


def _signup_out(show_entry: Optional[ShowEntry]) -> Optional[dict]:
    if show_entry is None or show_entry.registered_at is None:
        return None
    return {
        "show_entry_id": str(show_entry.id),
        "registered_at": show_entry.registered_at,
        "back_number": show_entry.back_number,
        # What they asked for, which is not always what they hold — the office
        # can renumber. The screen shows both when they differ.
        "preferred_back_number": show_entry.preferred_back_number,
        "arrival_date": show_entry.arrival_date,
        "departure_date": show_entry.departure_date,
        "notes": show_entry.registration_notes,
        "reservations": [
            {
                "show_fee_id": str(r.show_fee_id),
                "quantity": r.quantity,
            }
            for r in (show_entry.reservations or [])
            if r.quantity > 0
        ],
    }


def _aqha_class_code(show: Show, class_: Class) -> str | None:
    for assoc in class_.associations or []:
        if assoc.show_type_id == show.show_type_id or (
            assoc.show_type and assoc.show_type.code == "AQHA"
        ):
            return assoc.association_class_code
    return None


async def _association_validation_context(show: Show, class_: Class, db: AsyncSession):
    context: dict = {}
    if show.show_type and show.show_type.code == "AQHA":
        aqha_code = _aqha_class_code(show, class_)
        context["aqha_show_type_id"] = show.show_type_id
        context["aqha_association_id"] = await get_aqha_association_id(db)
        context["aqha_class_code"] = aqha_code
        context["aqha_class"] = await standard_classes.lookup(db, "AQHA", aqha_code)
    return context


# ── Sign-up ───────────────────────────────────────────────────────────────────

class ReservationItem(BaseModel):
    show_fee_id: UUID
    quantity: int = Field(ge=0, le=999)


class ShowSignupBody(BaseModel):
    reservations: list[ReservationItem] = Field(default_factory=list)
    arrival_date: Optional[date] = None
    departure_date: Optional[date] = None
    notes: Optional[str] = Field(default=None, max_length=1000)


@router.get("/signup")
async def get_signup(
    show_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """The sign-up screen: what this show offers, and what the caller booked.

    `signup` is null until they complete it, which is also what the class
    registration screen keys off to decide whether to let them in.
    """
    show = await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(safe_uuid(user_id), db)
    show_entry = await _load_show_entry(show_id, exhibitor.id, db)
    fees = await _load_reservable_fees(show_id, db)

    return {
        "show": {
            "id": str(show.id),
            "name": show.name,
            "status": show.status,
            "start_date": show.start_date,
            "end_date": show.end_date,
            "office_charge_cents": show.office_charge_cents,
            "office_charge_basis": show.office_charge_basis,
            "shavings_ban_outside": show.shavings_ban_outside,
        },
        "exhibitor": {"id": str(exhibitor.id), "full_name": exhibitor.full_name},
        "fee_options": _fee_options_out(fees, show_entry),
        "signup": _signup_out(show_entry),
    }


@router.put("/signup")
async def save_signup(
    show_id: UUID,
    body: ShowSignupBody,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Complete or amend show sign-up.

    Idempotent by design — the exhibitor can come back and change their stall
    count while the show is still PUBLISHED, and the same call handles both the
    first sign-up and every edit after it. The body is the complete booking, so
    a fee the exhibitor removed disappears instead of lingering at its old
    quantity.

    Lines they still want are updated in place rather than deleted and
    recreated, because `reserved_at` is what decides whether they get the
    fee's early rate. Recreating the row would re-date it, so an exhibitor who
    reserved stalls in April would silently lose their early rate the moment
    they came back in July to change their arrival date.
    """
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")

    show = await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(safe_uuid(x_user_id), db)

    if body.arrival_date and body.departure_date and body.departure_date < body.arrival_date:
        raise HTTPException(400, "Departure date cannot be before the arrival date")

    fees_by_id = {f.id: f for f in await _load_reservable_fees(show_id, db)}
    for item in body.reservations:
        if item.show_fee_id not in fees_by_id:
            raise HTTPException(400, "One or more selected options are not offered by this show")

    show_entry = await _load_show_entry(show_id, exhibitor.id, db)
    if show_entry is None:
        show_entry = ShowEntry(show_id=show_id, exhibitor_id=exhibitor.id)
        # Initialize the collection before the flush makes the row persistent:
        # assigning to it afterwards would ask SQLAlchemy to diff against a
        # collection it has never loaded, which is a lazy load in an async
        # session (MissingGreenlet). The loaded path is safe because
        # _load_show_entry selectinloads it.
        show_entry.reservations = []
        db.add(show_entry)
        await db.flush()

    show_entry.registered_at = show_entry.registered_at or func.now()
    show_entry.arrival_date = body.arrival_date
    show_entry.departure_date = body.departure_date
    show_entry.registration_notes = body.notes

    wanted = {
        item.show_fee_id: item.quantity for item in body.reservations if item.quantity > 0
    }
    existing_by_fee = {r.show_fee_id: r for r in (show_entry.reservations or [])}
    for fee_id, quantity in wanted.items():
        row = existing_by_fee.get(fee_id)
        if row is None:
            # Set here rather than left to the column default: an unset
            # server-default column comes back expired after the INSERT, and
            # reading it below would be a lazy load in an async session.
            show_entry.reservations.append(
                ShowEntryReservation(
                    show_fee_id=fee_id, quantity=quantity, reserved_at=date.today()
                )
            )
        else:
            row.quantity = quantity
    for fee_id, row in existing_by_fee.items():
        if fee_id not in wanted:
            # delete-orphan on the relationship turns this into a DELETE.
            show_entry.reservations.remove(row)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "You have already signed up for this show")

    show_entry = await _load_show_entry(show_id, exhibitor.id, db)
    reservation_total = sum(
        fee_rate_cents(fees_by_id[r.show_fee_id], r.reserved_at) * r.quantity
        for r in (show_entry.reservations or [])
        if r.show_fee_id in fees_by_id
    )
    return {
        "signup": _signup_out(show_entry),
        "reservation_total_cents": reservation_total,
    }


# ── Back number ──────────────────────────────────────────────

class BackNumberRequestBody(BaseModel):
    """`null` clears the request. Bounded because a back number is worn on a
    person's back — four digits is already generous for a cloth number."""

    preferred_back_number: Optional[int] = Field(default=None, ge=1, le=9999)


def _back_number_taken(wanted: int) -> HTTPException:
    return HTTPException(
        409,
        {
            "code": "BACK_NUMBER_TAKEN",
            "message": (
                f"Back number {wanted} is already taken at this show. "
                "Pick a different one."
            ),
        },
    )


@router.put("/back-number")
async def request_back_number(
    show_id: UUID,
    body: BackNumberRequestBody,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Ask for a back number, and get it when nothing else at the show holds it.

    This grants outright rather than queueing a request for the office to
    approve. A number nobody else wants is not a decision anyone needs to make,
    and a "preference" that still leaves the exhibitor waiting on a secretary
    is the workflow this replaces, with an extra table. The office keeps every
    power it had: the desk can renumber anyone, and `preferred_back_number`
    survives that so staff can still see what was asked for.

    Only while the show is PUBLISHED. `_load_published_show_or_403` closes this
    the moment the show goes ACTIVE, which is the right boundary — by then
    numbers are printed, hanging on backs, and written on the judge's cards.

    Clearing (`null`) drops the *wish*, never the number already issued. Giving
    a number back is not something anyone asks for at a horse show, and
    releasing an assignment the office may have made independently would be a
    surprising thing for an empty text box to do.
    """
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")

    show = await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(safe_uuid(x_user_id), db)

    show_entry = await _load_show_entry(show.id, exhibitor.id, db)
    if show_entry is None or show_entry.registered_at is None:
        raise HTTPException(
            409,
            {
                "code": "SHOW_SIGNUP_REQUIRED",
                "message": (
                    "Sign up for this show before choosing a back number."
                ),
            },
        )

    wanted = body.preferred_back_number

    if wanted is not None and wanted != show_entry.back_number:
        # Checked before writing so the common collision gets a message naming
        # the number, rather than an IntegrityError we can only report vaguely.
        # The constraint is still what makes it safe — see the except below.
        clash = await db.execute(
            select(ShowEntry.id).where(
                ShowEntry.show_id == show.id,
                ShowEntry.back_number == wanted,
                ShowEntry.id != show_entry.id,
            )
        )
        if clash.first() is not None:
            raise _back_number_taken(wanted)

    show_entry.preferred_back_number = wanted
    if wanted is not None:
        show_entry.back_number = wanted

    try:
        await db.commit()
    except IntegrityError:
        # Two exhibitors asking for the same free number in the same instant.
        # The unique constraint on (show_id, back_number) is the real guard,
        # and this is it firing. Only reachable when a number was written:
        # clearing the wish touches no constrained column.
        await db.rollback()
        raise _back_number_taken(wanted) from None

    show_entry = await _load_show_entry(show.id, exhibitor.id, db)
    return {"signup": _signup_out(show_entry)}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/preview")
async def preview_registration(
    show_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Return the published-show classes the caller can register for, along
    with the horses on their exhibitor profile and existing entries.

    The frontend uses this to render the registration form: a horse picker per
    class, with already-entered (class, horse) combinations preselected.
    """
    show = await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(safe_uuid(user_id), db)

    classes_result = await db.execute(
        select(Class)
        .options(
            selectinload(Class.associations).selectinload(ClassAssociation.show_type)
        )
        .where(Class.show_id == show_id, Class.status != "CLOSED")
        .order_by(Class.class_date, Class.sort_order.nullslast(), Class.class_number)
    )
    classes = classes_result.scalars().all()

    horse_ids = await _exhibitor_horse_ids(exhibitor.id, db)
    horses: list[Horse] = []
    # Advisory only. This used to decide whether the horse could be entered at
    # all; it now tells the exhibitor what to sort out before they ship in, and
    # the same evaluation reaches the show office through the desk and
    # `GET /shows/{id}/health-flags` so staff can chase it. Shared with the
    # office so the two can never disagree about a horse — same documents, same
    # requirements, same deadline.
    health_by_horse_id: dict[UUID, list[dict]] = {}
    if horse_ids:
        horses_result = await db.execute(
            select(Horse).where(Horse.id.in_(horse_ids)).order_by(Horse.name)
        )
        horses = horses_result.scalars().all()
        health_by_horse_id = await health_by_horse(list(horse_ids), show, db)

    # `class_` and `horse` come along because `build_bill` reads both. The
    # screen's entered-class table *is* the bill's class lines, so the fee shown
    # beside a class is the fee the office will collect. Not filtered to open
    # classes: a class that closed after the entry went in is still owed for,
    # and dropping it here would quietly shrink the total.
    existing_result = await db.execute(
        select(Entry)
        .join(Class, Entry.class_id == Class.id)
        .options(selectinload(Entry.class_), selectinload(Entry.horse))
        .where(Class.show_id == show_id, Entry.exhibitor_id == exhibitor.id)
    )
    existing = existing_result.scalars().all()

    show_entry = await _load_show_entry(show_id, exhibitor.id, db)

    return {
        # Null until show sign-up is done. The screen reads this to send the
        # exhibitor to sign-up first rather than letting them fill in a class
        # picker the POST would reject.
        "signup": _signup_out(show_entry),
        "show": {
            "id": str(show.id),
            "name": show.name,
            "status": show.status,
            "start_date": show.start_date,
            "end_date": show.end_date,
            "show_type_code": show.show_type.code if show.show_type else None,
            "office_charge_cents": show.office_charge_cents,
            "office_charge_basis": show.office_charge_basis,
        },
        "exhibitor": {
            "id": str(exhibitor.id),
            "full_name": exhibitor.full_name,
        },
        "classes": [
            {
                "id": str(c.id),
                "class_number": c.class_number,
                "class_name": c.class_name,
                "class_date": c.class_date,
                # The screen needs this to know where a second horse is
                # allowed: a pattern class is judged run by run, so one
                # exhibitor may show two horses in it. Everything else is
                # once per exhibitor and the POST enforces that.
                "score_type": c.score_type,
                "entry_fee_cents": c.entry_fee_cents,
                # Which clubs sanction this class, and what that adds to the
                # entry — not every class at a sanctioned show carries a
                # sanction fee (migration 113).
                "sanctioning_codes": [
                    row.association.code
                    for row in (c.sanctioning or [])
                    if row.association is not None
                ],
                "sanction_cents": _class_sanction_cents(show, c),
            }
            for c in classes
        ],
        # `health` is a warning, never a gate: every horse on the profile can be
        # entered. The show office sees the same flags and follows up.
        "horses": [
            {
                "id": str(h.id),
                "name": h.name,
                # Only meaningful at an APHA show, where a Solid Paint-Bred
                # horse may not go in an Open division class — the same guard
                # the desk's entry form applies, so the two forms refuse the
                # same combination rather than one of them finding out later.
                "is_solid_paint_bred": h.is_solid_paint_bred,
                # `file_snapshot` is the desk's staleness bookkeeping and
                # means nothing to an exhibitor. The staff endpoints drop it via
                # their response_model; this one has none, so it is dropped here.
                "health": [
                    {k: v for k, v in check.items() if k != "file_snapshot"}
                    for check in health_by_horse_id.get(h.id, [])
                ],
            }
            for h in horses
        ],
        # Which (class, horse) pairs are already taken. Display comes from
        # `bill.class_lines`; this list is what the pickers filter against.
        "existing_entries": [
            {
                "id": str(e.id),
                "class_id": str(e.class_id),
                "horse_id": str(e.horse_id) if e.horse_id else None,
            }
            for e in existing
        ],
        # What this show costs so far, straight from `billing.build_bill` — the
        # same call behind the My Shows bill and the office's account screen.
        # Entries commit one at a time now, so there is always a real bill to
        # quote; the batch form this replaced had to add the fees up in the
        # browser, which is the disagreement billing.py exists to prevent.
        "bill": build_bill(
            show,
            existing,
            show_entry.reservations if show_entry else [],
            await load_billable_futurities(
                show_id, [show_entry.id] if show_entry else [], db
            ),
        ),
    }


@router.post("/", response_model=ShowRegistrationResult, status_code=201)
async def register_for_show(
    show_id: UUID,
    body: ShowRegistrationCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")

    user_uuid = safe_uuid(x_user_id)
    show = await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(user_uuid, db)

    # Verify each horse belongs to this exhibitor before we touch the DB.
    requested_horse_ids = {item.horse_id for item in body.entries}
    allowed_horse_ids = await _exhibitor_horse_ids(exhibitor.id, db)
    not_yours = requested_horse_ids - allowed_horse_ids
    if not_yours:
        raise HTTPException(
            403,
            "One or more horses are not on your profile. Add them to your "
            "profile first before registering.",
        )

    # Resolve classes once, with association data for validation rules.
    requested_class_ids = {item.class_id for item in body.entries}
    classes_result = await db.execute(
        select(Class)
        .options(
            selectinload(Class.associations).selectinload(ClassAssociation.show_type)
        )
        .where(Class.id.in_(requested_class_ids))
    )
    classes_by_id = {c.id: c for c in classes_result.scalars().all()}
    for class_id in requested_class_ids:
        cls = classes_by_id.get(class_id)
        if not cls or cls.show_id != show_id:
            raise HTTPException(400, "One or more classes do not belong to this show")
        if cls.status == "CLOSED":
            raise HTTPException(
                400,
                f"Class {cls.class_number} ({cls.class_name}) is closed and not "
                "accepting entries.",
            )

    # Sign-up comes first. A missing (or unfinished) show_entries row means the
    # office has no stall/shavings/camping numbers for this exhibitor, so we
    # refuse rather than quietly creating the shell row this used to create.
    show_entry = await _load_show_entry(show_id, exhibitor.id, db)
    if show_entry is None or show_entry.registered_at is None:
        raise HTTPException(
            409,
            {
                "code": "SHOW_SIGNUP_REQUIRED",
                "message": (
                    "Sign up for this show before entering classes — the office "
                    "needs your stall, shavings, and camping numbers first."
                ),
            },
        )

    # Eager-load horse registration data once per requested horse so the rules
    # engine can read it without lazy loads.
    horses_result = await db.execute(
        select(Horse)
        .options(selectinload(Horse.registrations))
        .where(Horse.id.in_(requested_horse_ids))
    )
    horses_by_id = {h.id: h for h in horses_result.scalars().all()}

    rules = get_rules(show.show_type.code if show.show_type else None)

    # Pull all of this exhibitor's existing entries for the requested classes
    # so we can pre-check "exhibitor already in this non-pattern class" rules
    # and reject duplicates inside the submitted batch too.
    existing_entries_result = await db.execute(
        select(Entry.class_id).where(
            Entry.exhibitor_id == exhibitor.id,
            Entry.class_id.in_(requested_class_ids),
        )
    )
    existing_non_pattern_classes: set[UUID] = {
        cid for (cid,) in existing_entries_result.all()
        if classes_by_id[cid].score_type != "pattern"
    }
    batch_non_pattern_classes: set[UUID] = set()

    created: list[Entry] = []
    fee_breakdown: list[FeeBreakdownItem] = []
    subtotal = 0
    sanction_total = 0
    horses_charged: set[UUID] = set()

    for item in body.entries:
        cls = classes_by_id[item.class_id]
        horse = horses_by_id.get(item.horse_id)
        if not horse:
            raise HTTPException(404, "Horse not found")

        if cls.score_type != "pattern":
            if cls.id in existing_non_pattern_classes or cls.id in batch_non_pattern_classes:
                raise HTTPException(
                    409,
                    f"You can only enter class {cls.class_number} "
                    f"({cls.class_name}) once.",
                )
            batch_non_pattern_classes.add(cls.id)

        entry = Entry(
            class_id=item.class_id,
            exhibitor_id=exhibitor.id,
            horse_id=item.horse_id,
            # Explicit, not left to the column default: that default is applied
            # at flush, and validate_entry runs before this is ever flushed. An
            # unset status reads as None and short-circuits every association
            # rule, silently skipping validation.
            status="ENTERED",
            apha_division=item.apha_division,
            relationship_to_owner=item.relationship_to_owner,
        )
        # Wire relationships so validate_entry can read them without lazy loads.
        entry.class_ = cls
        entry.horse = horse
        entry.exhibitor = exhibitor

        issues = rules.validate_entry(
            entry,
            show,
            cls,
            await _association_validation_context(show, cls, db),
        )
        errors = [i for i in issues if i.get("severity") == "error"]
        if errors:
            raise HTTPException(
                422,
                {
                    "code": "ASSOCIATION_VALIDATION_FAILED",
                    "message": (
                        f"Entry for class {cls.class_number} ({cls.class_name}) "
                        "fails validation"
                    ),
                    "issues": issues,
                },
            )

        db.add(entry)
        created.append(entry)
        sanction_cents = _class_sanction_cents(show, cls)
        fee_breakdown.append(
            FeeBreakdownItem(
                class_id=cls.id,
                class_number=cls.class_number,
                class_name=cls.class_name,
                fee_cents=cls.entry_fee_cents,
                sanction_cents=sanction_cents,
            )
        )
        subtotal += cls.entry_fee_cents
        sanction_total += sanction_cents
        horses_charged.add(item.horse_id)

    office_charge_total = office_charge_total_cents(show, len(horses_charged), bool(created))
    total_fee = subtotal + sanction_total + office_charge_total

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        msg = str(exc.orig) if exc.orig is not None else ""
        if "entries_class_horse_uniq" in msg:
            raise HTTPException(
                409,
                "One of the selected horses is already entered in that class.",
            )
        raise HTTPException(
            409,
            "One or more selections conflict with an existing entry.",
        )

    for entry in created:
        await db.refresh(entry)

    return ShowRegistrationResult(
        show_entry_id=show_entry.id,
        created_entries=[EntryOut.model_validate(e) for e in created],
        fee_breakdown=fee_breakdown,
        subtotal_fee_cents=subtotal,
        sanction_total_cents=sanction_total,
        office_charge_total_cents=office_charge_total,
        total_fee_cents=total_fee,
    )


@router.delete("/entries/{entry_id}", status_code=204)
async def withdraw_entry(
    show_id: UUID,
    entry_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Exhibitor-self withdraw of a single entry.

    Allowed while the show is PUBLISHED and the calling user owns the entry's
    exhibitor profile. Blocked once a result has been recorded — at that point
    the secretary handles edits through the admin flow.
    """
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")

    await _load_published_show_or_403(show_id, db)  # asserts PUBLISHED status
    exhibitor = await _load_exhibitor_for_user(safe_uuid(x_user_id), db)

    entry_result = await db.execute(
        select(Entry)
        .options(selectinload(Entry.class_))
        .where(Entry.id == entry_id)
    )
    entry = entry_result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Entry not found")
    if entry.exhibitor_id != exhibitor.id:
        raise HTTPException(403, "You can only withdraw your own entries")
    if not entry.class_ or entry.class_.show_id != show_id:
        raise HTTPException(404, "Entry not found in this show")

    # Defensive: results shouldn't exist during PUBLISHED, but if a class was
    # scored before being reverted, refuse to silently wipe historical results.
    result_exists = await db.execute(
        select(Result.id).where(Result.entry_id == entry_id).limit(1)
    )
    if result_exists.scalar_one_or_none():
        raise HTTPException(
            409,
            "This entry already has a result recorded and cannot be withdrawn. "
            "Contact the show secretary.",
        )

    await db.delete(entry)
    await db.commit()


# ── Futurities, exhibitor side ────────────────────────────────────────────────
#
# The office manages a futurity at /admin/shows/{id}/futurities. These three
# endpoints are the exhibitor's own door into the same tables: which futurities
# the show runs, which of their horses are in one, and enrolling or withdrawing
# a horse they own.
#
# Deliberately narrower than the staff endpoints. An exhibitor may only enroll a
# horse on their own profile, only against their own `show_entries` row, and
# only while the show is PUBLISHED — after that the numbers are printed and the
# office takes over, exactly as with class entries.


async def _load_futurity_for_show(show_id: UUID, futurity_id: UUID, db: AsyncSession):
    result = await db.execute(
        select(Futurity)
        .where(Futurity.id == futurity_id, Futurity.show_id == show_id)
        .options(
            selectinload(Futurity.fee_tiers),
            selectinload(Futurity.membership_options),
            selectinload(Futurity.futurity_classes),
        )
    )
    futurity = result.scalar_one_or_none()
    if not futurity:
        raise HTTPException(404, "Futurity not found")
    return futurity


@router.get("/futurities")
async def list_futurities_for_exhibitor(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The show's futurities, with the caller's own enrollments marked.

    Not status-gated on read: somebody who entered while the show was PUBLISHED
    still needs to see what they entered once it goes ACTIVE. Writing is gated
    below.
    """
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    exhibitor = await _load_exhibitor_for_user(safe_uuid(x_user_id), db)
    show_entry = await _load_show_entry(show_id, exhibitor.id, db)

    futurities = (
        await db.execute(
            select(Futurity)
            .where(Futurity.show_id == show_id)
            .options(
                selectinload(Futurity.fee_tiers),
                selectinload(Futurity.membership_options),
                selectinload(Futurity.futurity_classes).selectinload(FuturityClass.class_),
            )
            .order_by(Futurity.created_at)
        )
    ).scalars().all()
    if not futurities:
        return []

    mine = []
    if show_entry is not None:
        mine = (
            await db.execute(
                select(FuturityEntry)
                .where(
                    FuturityEntry.show_entry_id == show_entry.id,
                    FuturityEntry.futurity_id.in_([f.id for f in futurities]),
                )
                .options(
                    selectinload(FuturityEntry.horse),
                    selectinload(FuturityEntry.fee_tier),
                    selectinload(FuturityEntry.membership_option),
                )
            )
        ).scalars().all()

    by_futurity: dict[UUID, list] = {}
    for enrollment in mine:
        by_futurity.setdefault(enrollment.futurity_id, []).append(enrollment)

    today = date.today()
    return [
        {
            "id": str(f.id),
            "name": f.name,
            "description": f.description,
            "entry_deadline": f.entry_deadline,
            "entry_deadline_time": (
                f.entry_deadline_time.isoformat() if f.entry_deadline_time else None
            ),
            "entry_deadline_timezone": f.entry_deadline_timezone,
            "late_fee_cents": f.late_fee_cents,
            "office_fee_member_cents": f.office_fee_member_cents,
            "office_fee_nonmember_cents": f.office_fee_nonmember_cents,
            # The words on the entry form. An exhibitor entering here is filling
            # in the same form the show prints, so it has to say the same things
            # — which categories exist, what is won, what happens to the money.
            "entry_instructions": f.entry_instructions,
            "award_notice": f.award_notice,
            "rules_notice": f.rules_notice,
            "refund_policy": f.refund_policy,
            "requires_horse_pedigree": f.requires_horse_pedigree,
            # Quoted, so the screen can warn before someone enters rather than
            # after the bill arrives. What an existing enrollment is actually
            # charged is settled by its own `entered_at`.
            "is_past_deadline": f.entry_deadline is not None and today > f.entry_deadline,
            "classes": [
                {
                    "class_id": str(fc.class_id),
                    "class_number": fc.class_.class_number if fc.class_ else None,
                    "class_name": fc.class_.class_name if fc.class_ else None,
                }
                for fc in f.futurity_classes
                if fc.class_ is not None
            ],
            "fee_tiers": [
                {
                    "id": str(t.id),
                    "name": t.name,
                    "description": t.description,
                    "amount_cents": t.amount_cents,
                }
                for t in sorted(f.fee_tiers, key=lambda t: (t.sort_order, t.name))
            ],
            "membership_options": [
                {
                    "id": str(m.id),
                    "name": m.name,
                    "description": m.description,
                    "amount_cents": m.amount_cents,
                }
                for m in sorted(
                    f.membership_options, key=lambda m: (m.sort_order, m.name)
                )
            ],
            "my_entries": [
                {
                    "id": str(e.id),
                    "horse_id": str(e.horse_id) if e.horse_id else None,
                    "horse_name": e.horse.name if e.horse else None,
                    "fee_tier_id": str(e.fee_tier_id) if e.fee_tier_id else None,
                    "fee_tier_name": e.fee_tier.name if e.fee_tier else None,
                    "membership_option_id": (
                        str(e.membership_option_id) if e.membership_option_id else None
                    ),
                    "membership_option_name": (
                        e.membership_option.name if e.membership_option else None
                    ),
                    "is_member": e.is_member,
                    "shown_by_name": e.shown_by_name,
                    "entered_at": e.entered_at,
                }
                for e in by_futurity.get(f.id, [])
            ],
        }
        for f in futurities
    ]


class FuturityEnrollRequest(BaseModel):
    futurity_id: UUID
    horse_id: UUID
    fee_tier_id: Optional[UUID] = None
    membership_option_id: Optional[UUID] = None
    is_member: bool = False
    shown_by_name: Optional[str] = None


@router.post("/futurities", status_code=201)
async def enroll_in_futurity(
    show_id: UUID,
    body: FuturityEnrollRequest,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Enroll one of the caller's own horses in a futurity."""
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")

    await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(safe_uuid(x_user_id), db)

    show_entry = await _load_show_entry(show_id, exhibitor.id, db)
    # Same rule as class self-registration: sign-up is what creates the roster
    # row a back number, a pot entry and now a futurity entry all hang off.
    if show_entry is None or show_entry.registered_at is None:
        raise HTTPException(409, "SHOW_SIGNUP_REQUIRED")

    futurity = await _load_futurity_for_show(show_id, body.futurity_id, db)

    if body.horse_id not in await _exhibitor_horse_ids(exhibitor.id, db):
        raise HTTPException(403, "You can only enter a horse on your own profile")

    if futurity.fee_tiers:
        if body.fee_tier_id is None:
            raise HTTPException(422, "Pick an entry category.")
        if not any(t.id == body.fee_tier_id for t in futurity.fee_tiers):
            raise HTTPException(422, "That category does not belong to this futurity.")

    if body.membership_option_id is not None and not any(
        m.id == body.membership_option_id for m in futurity.membership_options
    ):
        raise HTTPException(422, "That membership does not belong to this futurity.")

    # The entry form asks for foaling date, sire and dam, and a futurity judged
    # in age divisions cannot do without them. Refused here and only here: the
    # values live on a horse record this caller owns and can fix in a minute,
    # where the office taking a paper entry across the counter has no such
    # option and gets the same shortfall reported as a flag instead.
    horse = await db.get(Horse, body.horse_id)
    missing = missing_horse_details(futurity, horse)
    if missing:
        raise HTTPException(
            422,
            f"This futurity needs the horse's {', '.join(missing)}. Add "
            "it on the horse's profile, then enter.",
        )

    clash = (
        await db.execute(
            select(FuturityEntry.id).where(
                FuturityEntry.futurity_id == futurity.id,
                FuturityEntry.horse_id == body.horse_id,
            )
        )
    ).scalars().first()
    if clash:
        raise HTTPException(409, "That horse is already entered in this futurity.")

    enrollment = FuturityEntry(
        futurity_id=futurity.id,
        show_entry_id=show_entry.id,
        horse_id=body.horse_id,
        fee_tier_id=body.fee_tier_id,
        membership_option_id=body.membership_option_id,
        is_member=body.is_member,
        shown_by_name=(body.shown_by_name or "").strip() or None,
        entered_at=date.today(),
    )
    db.add(enrollment)
    await db.commit()
    return {"id": str(enrollment.id)}


@router.delete("/futurities/{entry_id}", status_code=204)
async def withdraw_from_futurity(
    show_id: UUID,
    entry_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Withdraw one of the caller's own futurity enrollments."""
    if not INTERNAL_API_KEY or x_api_key != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")

    await _load_published_show_or_403(show_id, db)
    exhibitor = await _load_exhibitor_for_user(safe_uuid(x_user_id), db)
    show_entry = await _load_show_entry(show_id, exhibitor.id, db)
    if show_entry is None:
        raise HTTPException(404, "Futurity entry not found")

    enrollment = await db.get(FuturityEntry, entry_id)
    if enrollment is None or enrollment.show_entry_id != show_entry.id:
        raise HTTPException(404, "Futurity entry not found")

    await db.delete(enrollment)
    await db.commit()
