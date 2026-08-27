"""Signed entry blanks, liability releases, and venue rules (migration 099).

The paperwork a show office checks at the counter was two thirds modelled.
Registration papers, membership cards, and health documents all point at
something this app stores. The signed entry blank pointed at nothing at all:
there was no table, no column, and no way for a show to say it wanted one.

Two shapes, because a waiver is written once by the show and signed many times
by exhibitors:

  * The show writes them. Free text, because a liability release comes from the
    venue's insurer or the fair board and this app has no business supplying the
    words. `is_required` separates what an exhibitor cannot compete without from
    a rule the show wants read but does not chase.

  * Exhibitors sign them, by either of two routes that produce the same fact. An
    exhibitor types their name here, or hands a paper blank across the counter
    and staff record it with `on_paper` set. A show that runs entirely on paper
    is one where every signature row has that flag, and the desk's outstanding
    count still works.

`signed_name` is the one value in this file the backend does not derive. Every
other sign-off in the app reads its value off the record precisely so a caller
cannot attest to something nobody has on file — but a signature is a claim a
person makes, not a fact already stored, and there is nothing to read it from.

Minors sign through a parent or guardian, which is not a footnote at a horse
show: youth classes are a third of a typical schedule, and a release signed by a
twelve-year-old is not a release.

Since migration 109 a waiver may be scoped to one futurity. The release printed
on a futurity entry form is a waiver in every sense this file already models
one, but it is not asked of the whole show — so `futurity_id` narrows *who is
asked* rather than adding a second signature mechanism. NULL is the original
meaning and what every pre-109 row carries: everyone at the show.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import require_admin_or_show_admin, require_authenticated, safe_uuid
from models import (
    Class,
    Entry,
    Exhibitor,
    Futurity,
    FuturityEntry,
    Show,
    ShowEntry,
    ShowWaiver,
    ShowWaiverSignature,
    User,
)
from routers.shows import _assert_show_access
from schemas import (
    ShowWaiverCreate,
    ShowWaiverForExhibitorOut,
    ShowWaiverOut,
    ShowWaiverUpdate,
    StaffWaiverSignatureCreate,
    WaiverSignatureCreate,
    WaiverSignatureOut,
)

router = APIRouter(prefix="/shows/{show_id}", tags=["Show Waivers"])


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _get_waiver_or_404(show_id: UUID, waiver_id: UUID, db: AsyncSession) -> ShowWaiver:
    waiver = await db.get(ShowWaiver, waiver_id)
    if not waiver or waiver.show_id != show_id:
        raise HTTPException(404, "Waiver not found")
    return waiver


async def _assert_futurity_on_show(
    show_id: UUID, futurity_id: Optional[UUID], db: AsyncSession
) -> None:
    """A waiver may only be scoped to a futurity of its own show.

    Without this, a caller could point a release at another show's programme and
    produce a waiver nobody at either show is ever asked to sign.
    """
    if futurity_id is None:
        return
    futurity = await db.get(Futurity, futurity_id)
    if futurity is None or futurity.show_id != show_id:
        raise HTTPException(422, "That futurity does not belong to this show.")


async def _waiver_out(waiver: ShowWaiver, db: AsyncSession) -> ShowWaiverOut:
    """Serialize one waiver with its futurity's name filled in.

    Read with a query rather than through `ShowWaiver.futurity`, which is a lazy
    relationship: touching it inside an async request is lazy IO and raises
    MissingGreenlet. Without this the create and patch responses would come back
    with `futurity_name: null` on a waiver that plainly has one, and a caller
    that renders the response instead of re-reading the list would show a
    futurity release with no futurity against it.
    """
    out = ShowWaiverOut.model_validate(waiver)
    if waiver.futurity_id is not None:
        name = (
            await db.execute(
                select(Futurity.name).where(Futurity.id == waiver.futurity_id)
            )
        ).scalars().first()
        out.futurity_name = name
    return out


async def _futurity_names(show_id: UUID, db: AsyncSession) -> dict[UUID, str]:
    """Names for the show's futurities, in one query.

    Read here rather than through `ShowWaiver.futurity`, which is a lazy
    relationship: touching it inside an async request is lazy IO and raises
    MissingGreenlet.
    """
    rows = await db.execute(
        select(Futurity.id, Futurity.name).where(Futurity.show_id == show_id)
    )
    return {row[0]: row[1] for row in rows}


async def _enrolled_futurity_ids(
    show_id: UUID, exhibitor_id: UUID, db: AsyncSession
) -> set[UUID]:
    """Which of the show's futurities this exhibitor has a horse in."""
    rows = await db.execute(
        select(FuturityEntry.futurity_id)
        .join(Futurity, Futurity.id == FuturityEntry.futurity_id)
        .join(ShowEntry, ShowEntry.id == FuturityEntry.show_entry_id)
        .where(Futurity.show_id == show_id, ShowEntry.exhibitor_id == exhibitor_id)
        .distinct()
    )
    return {row[0] for row in rows}


async def _exhibitor_for_user(user_id: str, db: AsyncSession) -> Exhibitor:
    result = await db.execute(
        select(Exhibitor).where(Exhibitor.user_id == safe_uuid(user_id))
    )
    exhibitor = result.scalar_one_or_none()
    if not exhibitor:
        raise HTTPException(403, "Only exhibitors sign a show's waivers")
    return exhibitor


async def _assert_exhibitor_on_roster(
    show_id: UUID, exhibitor_id: UUID, db: AsyncSession
) -> None:
    """Signed up, or entered by staff — either way they are competing here.

    Same rule as the rest of the desk: a show's office deals with the paperwork
    of the people at that show, and nobody else's.
    """
    show_entry = await db.execute(
        select(ShowEntry.id)
        .where(ShowEntry.show_id == show_id, ShowEntry.exhibitor_id == exhibitor_id)
        .limit(1)
    )
    if show_entry.scalar_one_or_none():
        return

    entry = await db.execute(
        select(Entry.id)
        .join(Class, Entry.class_id == Class.id)
        .where(Class.show_id == show_id, Entry.exhibitor_id == exhibitor_id)
        .limit(1)
    )
    if entry.scalar_one_or_none():
        return

    raise HTTPException(403, "That exhibitor is not registered for this show")


async def _load_signature(
    waiver_id: UUID, exhibitor_id: UUID, db: AsyncSession
) -> Optional[ShowWaiverSignature]:
    result = await db.execute(
        select(ShowWaiverSignature).where(
            ShowWaiverSignature.waiver_id == waiver_id,
            ShowWaiverSignature.exhibitor_id == exhibitor_id,
        )
    )
    return result.scalar_one_or_none()


async def _sign(
    waiver: ShowWaiver,
    exhibitor_id: UUID,
    body: WaiverSignatureCreate,
    on_paper: bool,
    actor: Optional[User],
    db: AsyncSession,
) -> ShowWaiverSignature:
    """Record a signature, replacing any earlier one on the same waiver.

    Re-signing overwrites rather than stacking rows, for the same reason a
    verification does: a correction is the current state of the paperwork, not a
    second signature. `uq_show_waiver_signatures` is the backstop for two staff
    members recording the same blank at once.
    """
    signature = await _load_signature(waiver.id, exhibitor_id, db)
    if signature is None:
        signature = ShowWaiverSignature(waiver_id=waiver.id, exhibitor_id=exhibitor_id)
        db.add(signature)

    signature.signed_name = body.signed_name.strip()
    signature.signed_by_guardian = body.signed_by_guardian
    signature.guardian_relationship = (
        (body.guardian_relationship or "").strip() or None if body.signed_by_guardian else None
    )
    signature.on_paper = on_paper
    signature.recorded_by = actor.id if actor else None
    signature.recorded_by_name = actor.full_name if actor else None

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "That waiver was just signed by someone else. Reload to see it.")
    await db.refresh(signature)
    return signature


# ── What the show asks for ────────────────────────────────────────────────────


@router.get("/waivers", response_model=list[ShowWaiverForExhibitorOut])
async def list_waivers(
    show_id: UUID,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """The show's waivers, with the caller's own signature attached if they have
    one. Readable by any signed-in user: someone deciding whether to enter is
    entitled to read what they would be agreeing to, and staff need the same
    list to see what they are asking for.
    """
    await _get_show_or_404(show_id, db)
    result = await db.execute(
        select(ShowWaiver).where(ShowWaiver.show_id == show_id).order_by(ShowWaiver.sort_order)
    )
    waivers = list(result.scalars().all())
    if not waivers:
        return []

    exhibitor_result = await db.execute(
        select(Exhibitor).where(Exhibitor.user_id == safe_uuid(user_id))
    )
    exhibitor = exhibitor_result.scalar_one_or_none()
    signatures: dict[UUID, ShowWaiverSignature] = {}
    enrolled: set[UUID] = set()
    if exhibitor is not None:
        signature_result = await db.execute(
            select(ShowWaiverSignature).where(
                ShowWaiverSignature.exhibitor_id == exhibitor.id,
                ShowWaiverSignature.waiver_id.in_([w.id for w in waivers]),
            )
        )
        signatures = {sig.waiver_id: sig for sig in signature_result.scalars().all()}
        if any(w.futurity_id is not None for w in waivers):
            enrolled = await _enrolled_futurity_ids(show_id, exhibitor.id, db)

    names = (
        await _futurity_names(show_id, db)
        if any(w.futurity_id is not None for w in waivers)
        else {}
    )

    return [
        ShowWaiverForExhibitorOut(
            **ShowWaiverOut.model_validate(waiver).model_dump(
                exclude={"futurity_name"}
            ),
            futurity_name=names.get(waiver.futurity_id),
            signature=(
                WaiverSignatureOut.model_validate(signatures[waiver.id])
                if waiver.id in signatures
                else None
            ),
            # A futurity release is only asked of that futurity's entrants.
            # Still returned to everybody: somebody deciding whether to enter is
            # entitled to read what they would be agreeing to.
            applies_to_me=(
                waiver.futurity_id is None or waiver.futurity_id in enrolled
            ),
        )
        for waiver in waivers
    ]


@router.post(
    "/waivers",
    response_model=ShowWaiverOut,
    status_code=201,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def create_waiver(
    show_id: UUID,
    body: ShowWaiverCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    await _assert_futurity_on_show(show_id, body.futurity_id, db)
    waiver = ShowWaiver(
        show_id=show_id,
        title=body.title.strip(),
        body=body.body,
        is_required=body.is_required,
        futurity_id=body.futurity_id,
        sort_order=body.sort_order,
    )
    db.add(waiver)
    await db.commit()
    await db.refresh(waiver)
    return await _waiver_out(waiver, db)


@router.patch(
    "/waivers/{waiver_id}",
    response_model=ShowWaiverOut,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def update_waiver(
    show_id: UUID,
    waiver_id: UUID,
    body: ShowWaiverUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Edit the wording or the sort order.

    Existing signatures are deliberately left alone. A show fixing a typo must
    not invalidate what a hundred people already signed, and the app has no way
    to tell a typo from a change of terms — that judgement, and the decision to
    re-collect, belongs to the office. Deleting and re-creating the waiver is
    the honest way to ask everyone again.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    waiver = await _get_waiver_or_404(show_id, waiver_id, db)

    if body.title is not None:
        waiver.title = body.title.strip()
    if body.body is not None:
        waiver.body = body.body
    if body.is_required is not None:
        waiver.is_required = body.is_required
    if "futurity_id" in body.model_fields_set:
        # In `model_fields_set` rather than a None check, so a release can be
        # widened back to the whole show by sending null — an unsent field and
        # an explicit null mean different things here.
        await _assert_futurity_on_show(show_id, body.futurity_id, db)
        waiver.futurity_id = body.futurity_id
    if body.sort_order is not None:
        waiver.sort_order = body.sort_order

    await db.commit()
    await db.refresh(waiver)
    return await _waiver_out(waiver, db)


@router.delete(
    "/waivers/{waiver_id}",
    status_code=204,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def delete_waiver(
    show_id: UUID,
    waiver_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Remove a waiver and every signature on it. The signatures go because they
    are agreement to *this* text — kept without it they would attest to nothing.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    waiver = await _get_waiver_or_404(show_id, waiver_id, db)
    await db.delete(waiver)
    await db.commit()


# ── Signing ───────────────────────────────────────────────────────────────────


@router.post(
    "/waivers/{waiver_id}/signature",
    response_model=WaiverSignatureOut,
    status_code=201,
)
async def sign_waiver(
    show_id: UUID,
    waiver_id: UUID,
    body: WaiverSignatureCreate,
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """The exhibitor signs for themselves.

    Not gated on show status. A waiver signed at sign-up and a waiver signed
    from the truck on the morning of the show are the same signature, and the
    show that stops accepting them at the door is the one whose office ends up
    with a clipboard and no record.
    """
    waiver = await _get_waiver_or_404(show_id, waiver_id, db)
    exhibitor = await _exhibitor_for_user(user_id, db)
    await _assert_exhibitor_on_roster(show_id, exhibitor.id, db)
    return await _sign(waiver, exhibitor.id, body, on_paper=False, actor=None, db=db)


# A futurity-scoped waiver is not gated on being enrolled. Somebody who signs
# the release and then enters is in the ordinary order the paper form runs in,
# and a signature that arrives early is not a problem the app needs to solve.


@router.post(
    "/exhibitors/{exhibitor_id}/waivers/{waiver_id}/signature",
    response_model=WaiverSignatureOut,
    status_code=201,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def record_paper_signature(
    show_id: UUID,
    exhibitor_id: UUID,
    waiver_id: UUID,
    body: StaffWaiverSignatureCreate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Staff record a blank signed on paper at the counter.

    `on_paper` is set here rather than accepted from the caller, so the two
    routes into this table stay honest about which one a row came through.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    waiver = await _get_waiver_or_404(show_id, waiver_id, db)
    await _assert_exhibitor_on_roster(show_id, exhibitor_id, db)
    actor = await db.get(User, safe_uuid(x_user_id))
    return await _sign(waiver, exhibitor_id, body, on_paper=True, actor=actor, db=db)


@router.delete(
    "/exhibitors/{exhibitor_id}/waivers/{waiver_id}/signature",
    status_code=204,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def delete_signature(
    show_id: UUID,
    exhibitor_id: UUID,
    waiver_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Undo a signature recorded against the wrong person."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_waiver_or_404(show_id, waiver_id, db)
    signature = await _load_signature(waiver_id, exhibitor_id, db)
    if signature is None:
        raise HTTPException(404, "No signature on file for that exhibitor")
    await db.delete(signature)
    await db.commit()
