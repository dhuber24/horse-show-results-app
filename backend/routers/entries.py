from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from uuid import UUID

from backnumbers import back_numbers_for_show, resolve_back_number, sort_key
from database import get_db
from dependencies import require_admin_or_show_admin
from models import (
    Class,
    ClassAssociation,
    CogginsOverrideAudit,
    Entry,
    Exhibitor,
    ExhibitorHorse,
    Horse,
    Show,
)
from horse_eligibility import effective_relationship
from schemas import CogginsOverrideAuditOut, EntryCreate, EntryUpdate, EntryOut
from routers.shows import _assert_show_access, get_aqha_association_id
from rules import get_rules
from rules.apha import divisions_for_bracket
from apha_context import apha_entry_context
from attestations import build_attestations
import standard_classes

router = APIRouter(prefix="/shows/{show_id}/classes/{class_id}/entries", tags=["Entries"])


async def _get_class_or_404(show_id: UUID, class_id: UUID, db: AsyncSession):
    result = await db.execute(
        select(Class)
        .options(
            selectinload(Class.associations).selectinload(ClassAssociation.show_type),
            # The bracket, which is what says which APHA division this class is
            # run for. Eager-loaded because `create_entry` reads it to fill a
            # division the desk left blank, and a lazy relationship in an async
            # request is a MissingGreenlet rather than a slow query.
            selectinload(Class.division),
        )
        .where(Class.id == class_id)
    )
    class_ = result.scalar_one_or_none()
    if not class_ or class_.show_id != show_id:
        raise HTTPException(404, "Class not found")
    return class_


async def _get_show_or_404(show_id: UUID, db: AsyncSession):
    result = await db.execute(
        select(Show)
        .options(selectinload(Show.show_type))
        .where(Show.id == show_id)
    )
    show = result.scalar_one_or_none()
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _get_horse_or_404(horse_id: UUID, db: AsyncSession):
    result = await db.execute(
        select(Horse)
        .options(selectinload(Horse.registrations))
        .where(Horse.id == horse_id)
    )
    horse = result.scalar_one_or_none()
    if not horse:
        raise HTTPException(404, "Horse not found")
    return horse


async def _get_exhibitor_or_404(exhibitor_id: UUID, db: AsyncSession):
    result = await db.execute(
        select(Exhibitor)
        .options(selectinload(Exhibitor.registrations))
        .where(Exhibitor.id == exhibitor_id)
    )
    exhibitor = result.scalar_one_or_none()
    if not exhibitor:
        raise HTTPException(404, "Exhibitor not found")
    return exhibitor


def _aqha_class_code(show: Show, class_: Class) -> str | None:
    for assoc in class_.associations or []:
        if assoc.show_type_id == show.show_type_id or (assoc.show_type and assoc.show_type.code == "AQHA"):
            return assoc.association_class_code
    return None


async def _association_validation_context(show: Show, class_: Class, db: AsyncSession):
    context = {}
    if show.show_type and show.show_type.code == "AQHA":
        aqha_code = _aqha_class_code(show, class_)
        context["aqha_show_type_id"] = show.show_type_id
        context["aqha_association_id"] = await get_aqha_association_id(db)
        context["aqha_class_code"] = aqha_code
        context["aqha_class"] = await standard_classes.lookup(db, "AQHA", aqha_code)
    if show.show_type and show.show_type.code == "APHA":
        # The horse caps and the Walk-Trot shared-horse rule are about the
        # exhibitor’s *other* entries at this show, which one entry cannot
        # answer. Built once per request; see `apha_context`.
        context.update(await apha_entry_context(show.id, db))
    return context


def _raise_for_validation_errors(issues: list[dict]) -> None:
    errors = [issue for issue in issues if issue.get("severity") == "error"]
    if errors:
        raise HTTPException(
            422,
            {
                "code": "ASSOCIATION_VALIDATION_FAILED",
                "message": "Entry fails association validation",
                "issues": issues,
            },
        )


@router.get("/", response_model=list[EntryOut])
async def list_entries(show_id: UUID, class_id: UUID, db: AsyncSession = Depends(get_db)):
    """Entries in a class, with the back number actually assigned to each
    exhibitor.

    The number lives on `show_entries`, not on the entry row — see
    `backend/backnumbers.py`. Returning the raw `Entry.back_number` here left
    every consumer of this endpoint (the public class page, the scribe
    form, the admin entry list) showing a dash for exhibitors who very much had
    a back number.
    """
    await _get_class_or_404(show_id, class_id, db)
    result = await db.execute(select(Entry).where(Entry.class_id == class_id))
    entries = list(result.scalars().all())

    by_exhibitor = await back_numbers_for_show(show_id, db)
    out = [
        EntryOut.model_validate(entry, from_attributes=True).model_copy(
            update={"back_number": resolve_back_number(entry, by_exhibitor)}
        )
        for entry in entries
    ]
    # Ordering moved out of SQL for the same reason: sorting by a column that
    # is always NULL is not an ordering.
    out.sort(key=lambda e: sort_key(e.back_number))
    return out


@router.post("/", response_model=EntryOut, status_code=201, dependencies=[Depends(require_admin_or_show_admin)])
async def create_entry(
    show_id: UUID,
    class_id: UUID,
    body: EntryCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Add an entry on behalf of an exhibitor.

    Health paperwork is **not** checked here. A horse with a missing, undated,
    or lapsed Coggins is entered like any other and turns up on this show's
    health flags (`GET /shows/{show_id}/health-flags`) for the office to chase
    before the show. Refusing the entry never made the horse compliant; it only
    meant the office found out at the desk instead of in advance.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)
    class_ = await _get_class_or_404(show_id, class_id, db)
    if class_.status == "CLOSED":
        raise HTTPException(400, "This class is closed and is not accepting entries")
    horse = await _get_horse_or_404(body.horse_id, db)
    exhibitor = await _get_exhibitor_or_404(body.exhibitor_id, db)

    # The APHA division checks that used to sit here are in `rules/apha.py` now,
    # and run below through `rules.validate_entry` like every other association
    # rule. They were only ever enforced on this endpoint, so the exhibitor's own
    # class registration — which has always gone through the rules engine — was
    # validated against an empty APHA rule set.

    # Pattern classes (showmanship/horsemanship/trail) can have the same
    # exhibitor entered on multiple horses; rail classes cannot.
    if class_.score_type != "pattern":
        existing_exhibitor_entry = await db.execute(
            select(Entry.id).where(
                Entry.class_id == class_id,
                Entry.exhibitor_id == body.exhibitor_id,
            ).limit(1)
        )
        if existing_exhibitor_entry.scalar_one_or_none():
            raise HTTPException(409, "This exhibitor is already entered in this class.")

    payload = body.model_dump()
    attestation_kinds = payload.pop("attestations", [])
    # How the exhibitor is entitled to show this horse (AM-300.E, YP-015),
    # filled in rather than asked for again. Derived from ownership where it can
    # be and read off `exhibitor_horses` where it cannot -- the same two sources
    # the exhibitor's own registration uses, because a relationship that only
    # one of the two doors fills in is a compliance sheet that disagrees with
    # itself depending on who keyed the entry. Anything the desk actually typed
    # wins over both.
    # Which APHA division this class is run for, filled in when the desk did not
    # say. The exhibitor's own form no longer asks at all -- the class answers it
    # -- so a desk entry left blank would otherwise be the only entry at the show
    # with no division on it, and the compliance sheet would report a gap that
    # depends on who keyed it. Anything the desk actually chose still wins:
    # this is the staff door, and an override is the reason it has a picker.
    if not payload.get("apha_division"):
        named = divisions_for_bracket(
            class_.division.name if class_.division else None, class_.class_name
        )
        if named and len(named) == 1:
            payload["apha_division"] = named[0]

    if not payload.get("relationship_to_owner"):
        link = await db.execute(
            select(ExhibitorHorse.relationship_to_owner).where(
                ExhibitorHorse.exhibitor_id == body.exhibitor_id,
                ExhibitorHorse.horse_id == body.horse_id,
            )
        )
        payload["relationship_to_owner"] = effective_relationship(
            horse, body.exhibitor_id, link.scalar_one_or_none()
        )
    entry = Entry(class_id=class_id, **payload)
    entry.class_ = class_
    entry.horse = horse
    entry.exhibitor = exhibitor
    # Assigned before validation so the rules engine can read a declaration off
    # an entry that has not been flushed yet, and before commit so the cascade
    # writes them. The statement text comes from the rules module, never from the
    # request — a caller able to compose it could attest to anything it liked.
    entry.attestations = await build_attestations(attestation_kinds, x_user_id, db)
    rules = get_rules(show.show_type.code if show.show_type else None)
    issues = rules.validate_entry(
        entry,
        show,
        class_,
        await _association_validation_context(show, class_, db),
    )
    _raise_for_validation_errors(issues)

    db.add(entry)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        msg = str(exc.orig) if exc.orig is not None else ""
        if "entries_class_horse_uniq" in msg:
            raise HTTPException(409, "This horse is already entered in this class.")
        raise HTTPException(409, "Entry conflicts with an existing entry in this class.")
    await db.refresh(entry)
    return entry


@router.patch("/{entry_id}", response_model=EntryOut, dependencies=[Depends(require_admin_or_show_admin)])
async def update_entry(
    show_id: UUID, class_id: UUID, entry_id: UUID,
    body: EntryUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)
    result = await db.execute(
        select(Entry)
        .options(
            selectinload(Entry.class_).selectinload(Class.associations).selectinload(ClassAssociation.show_type),
            selectinload(Entry.horse).selectinload(Horse.registrations),
            selectinload(Entry.exhibitor).selectinload(Exhibitor.registrations),
        )
        .where(Entry.id == entry_id)
    )
    entry = result.scalar_one_or_none()
    if not entry or entry.class_id != class_id:
        raise HTTPException(404, "Entry not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(entry, k, v)
    class_ = entry.class_
    rules = get_rules(show.show_type.code if show.show_type else None)
    issues = rules.validate_entry(
        entry,
        show,
        class_,
        await _association_validation_context(show, class_, db),
    )
    _raise_for_validation_errors(issues)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=204, dependencies=[Depends(require_admin_or_show_admin)])
async def delete_entry(
    show_id: UUID, class_id: UUID, entry_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    entry = await db.get(Entry, entry_id)
    if not entry or entry.class_id != class_id:
        raise HTTPException(404, "Entry not found")
    await db.delete(entry)
    await db.commit()


# Historical, and read-only for good. Nothing writes `coggins_override_audit`
# any more: an override only means something while there is a block to override,
# and entry no longer checks health paperwork. The rows already written describe
# real bypasses of the old gate, so they stay readable rather than being dropped
# — an audit trail that disappears when the rule changes was never an audit
# trail. Kept in this module because create_entry is what used to write them.
coggins_audit_router = APIRouter(prefix="/shows/{show_id}", tags=["Entries"])


@coggins_audit_router.get(
    "/coggins-overrides",
    response_model=list[CogginsOverrideAuditOut],
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def list_coggins_overrides(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Every effective Coggins bypass recorded for this show, newest first.

    Only ever returns rows from before the entry gate became a flag; the list is
    empty for any show run since.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    result = await db.execute(
        select(CogginsOverrideAudit)
        .where(CogginsOverrideAudit.show_id == show_id)
        .order_by(CogginsOverrideAudit.created_at.desc())
    )
    return result.scalars().all()
