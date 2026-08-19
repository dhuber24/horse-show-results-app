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
    if exhibitor is not None:
        signature_result = await db.execute(
            select(ShowWaiverSignature).where(
                ShowWaiverSignature.exhibitor_id == exhibitor.id,
                ShowWaiverSignature.waiver_id.in_([w.id for w in waivers]),
            )
        )
        signatures = {sig.waiver_id: sig for sig in signature_result.scalars().all()}

    return [
        ShowWaiverForExhibitorOut(
            **ShowWaiverOut.model_validate(waiver).model_dump(),
            signature=(
                WaiverSignatureOut.model_validate(signatures[waiver.id])
                if waiver.id in signatures
                else None
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
    waiver = ShowWaiver(
        show_id=show_id,
        title=body.title.strip(),
        body=body.body,
        is_required=body.is_required,
        sort_order=body.sort_order,
    )
    db.add(waiver)
    await db.commit()
    await db.refresh(waiver)
    return waiver


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
    if body.sort_order is not None:
        waiver.sort_order = body.sort_order

    await db.commit()
    await db.refresh(waiver)
    return waiver


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
