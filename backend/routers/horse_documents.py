from fastapi import APIRouter, Depends, HTTPException, Header, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from datetime import date
from uuid import UUID

from database import get_db
from dependencies import require_authenticated, safe_uuid
from models import Horse, HorseDocument, Exhibitor
from schemas import HorseDocumentOut

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

VALID_DOC_TYPES = {'COGGINS', 'VACCINATION', 'HEALTH_CERTIFICATE', 'REGISTRATION'}


# --- Coggins evaluation -----------------------------------------------------
# One implementation, shared by the secretary entry path (routers/entries.py)
# and exhibitor self-registration (routers/show_registration.py). These used to
# carry separate copies of the same `any()` expression, which is how they drifted
# from the readiness flags on the exhibitor's horse card.

COGGINS_VALID = "valid"
COGGINS_MISSING = "missing"
COGGINS_UNDATED = "undated"
COGGINS_EXPIRED = "expired"

COGGINS_MESSAGES = {
    COGGINS_MISSING: "No Coggins on file for this horse",
    COGGINS_UNDATED: (
        "The Coggins on file has no expiration date recorded. Re-upload it with "
        "the expiration date from the test."
    ),
    COGGINS_EXPIRED: "The Coggins on file has expired",
}


def coggins_status(expiry_dates: list[Optional[date]], today: Optional[date] = None) -> str:
    """Classify a horse's Coggins paperwork from the expiry dates on file.

    A Coggins clears a horse for entry only when it carries an expiration date
    that has not passed. An undated row is deliberately **not** valid: with no
    date there is nothing to verify, and a horse whose paperwork cannot be
    verified should not be quietly entered. Show staff who have physically
    inspected the document override the block via `skip_coggins_check` on the
    entry endpoint — that is the intended escape hatch when the record is thin
    but the paper is good.
    """
    if not expiry_dates:
        return COGGINS_MISSING
    today = today or date.today()
    if any(d is not None and d >= today for d in expiry_dates):
        return COGGINS_VALID
    # Report the undated case ahead of the expired one: it names the fixable
    # data problem, where "expired" would send the exhibitor after a new test
    # they may not actually need.
    if any(d is None for d in expiry_dates):
        return COGGINS_UNDATED
    return COGGINS_EXPIRED


async def load_coggins_expiries(
    horse_ids: list[UUID], db: AsyncSession
) -> dict[UUID, list[Optional[date]]]:
    """Coggins expiry dates per horse, keyed by horse id.

    Every requested id gets an entry so callers can tell "no documents" apart
    from "horse not asked about" without a second lookup.
    """
    expiries: dict[UUID, list[Optional[date]]] = {hid: [] for hid in horse_ids}
    if not horse_ids:
        return expiries
    result = await db.execute(
        select(HorseDocument.horse_id, HorseDocument.expiry_date).where(
            HorseDocument.horse_id.in_(horse_ids),
            HorseDocument.document_type == "COGGINS",
        )
    )
    for horse_id, expiry_date in result.all():
        expiries.setdefault(horse_id, []).append(expiry_date)
    return expiries


async def get_coggins_status(horse_id: UUID, db: AsyncSession) -> str:
    """This horse's Coggins standing, as one of the COGGINS_* constants."""
    expiries = await load_coggins_expiries([horse_id], db)
    return coggins_status(expiries.get(horse_id, []))


def coggins_error(status: str) -> HTTPException:
    """The 422 raised for a horse that fails the gate.

    The error `code` stays `COGGINS_EXPIRED` across all outcomes because the
    entry form and the self-registration screen branch on it; the message
    carries the distinction between missing, undated, and expired.
    """
    return HTTPException(
        422, {"code": "COGGINS_EXPIRED", "message": COGGINS_MESSAGES[status]}
    )


async def assert_coggins_valid(horse_id: UUID, db: AsyncSession) -> None:
    """Raise 422 unless the horse holds an unexpired, dated Coggins."""
    status = await get_coggins_status(horse_id, db)
    if status != COGGINS_VALID:
        raise coggins_error(status)


def _detect_mime(data: bytes) -> str | None:
    """Return the MIME type based on magic bytes, ignoring the client-supplied Content-Type."""
    if data[:4] == b'%PDF':
        return 'application/pdf'
    if data[:3] == b'\xff\xd8\xff':
        return 'image/jpeg'
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'image/png'
    if data[:4] == b'RIFF' and len(data) >= 12 and data[8:12] == b'WEBP':
        return 'image/webp'
    if data[:4] in (b'II*\x00', b'MM\x00*'):
        return 'image/tiff'
    return None

router = APIRouter(prefix="/horses", tags=["HorseDocuments"])


# Show staff verify health paperwork at the in-gate and at the entry desk, so
# they can read any horse's documents. Scoping this to "horses entered in a show
# you staff" was considered and rejected: the secretary most needs the Coggins
# while *creating* the entry, before any row linking horse to show exists — the
# scoped rule would hide the document at exactly the moment it is needed.
_DOCUMENT_VIEWER_ROLES = {'ADMIN', 'SHOW_SECRETARY', 'SHOW_MANAGER'}


async def _is_owner(horse: Horse, user_id: str, db: AsyncSession) -> bool:
    result = await db.execute(select(Exhibitor).where(Exhibitor.user_id == safe_uuid(user_id)))
    exhibitor = result.scalar_one_or_none()
    return bool(exhibitor and horse.owner_exhibitor_id == exhibitor.id)


async def _assert_can_view(horse: Horse, user_id: str, role: str, db: AsyncSession):
    """Read access: ADMIN, show staff, or the horse's registered owner."""
    if role in _DOCUMENT_VIEWER_ROLES:
        return
    if not await _is_owner(horse, user_id, db):
        raise HTTPException(403, "Not authorized to view this horse's documents")


async def _assert_can_manage(horse: Horse, user_id: str, role: str, db: AsyncSession):
    """Write access: ADMIN or the horse's registered owner only.

    Deliberately narrower than viewing. Show staff read the paperwork to verify
    it; the record itself stays the owner's to maintain, so a secretary cannot
    add or remove documents on someone else's horse.
    """
    if role == 'ADMIN':
        return
    if not await _is_owner(horse, user_id, db):
        raise HTTPException(403, "Only the owner of this horse can manage its documents")


@router.get("/{horse_id}/documents", response_model=list[HorseDocumentOut])
async def list_horse_documents(
    horse_id: UUID,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    horse = await db.get(Horse, horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    await _assert_can_view(horse, user_id, x_user_role, db)

    result = await db.execute(
        select(HorseDocument)
        .where(HorseDocument.horse_id == horse_id)
        .order_by(HorseDocument.document_type, HorseDocument.created_at)
    )
    return result.scalars().all()


@router.post("/{horse_id}/documents", response_model=HorseDocumentOut, status_code=201)
async def upload_horse_document(
    horse_id: UUID,
    file: UploadFile = File(...),
    document_type: str = Form(...),
    issue_date: Optional[str] = Form(None),
    expiry_date: Optional[str] = Form(None),
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if document_type not in VALID_DOC_TYPES:
        raise HTTPException(400, f"Invalid document type. Must be one of: {', '.join(VALID_DOC_TYPES)}")

    horse = await db.get(Horse, horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    await _assert_can_manage(horse, user_id, x_user_role, db)

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "File too large (max 10 MB)")

    mime = _detect_mime(content)
    if mime is None:
        raise HTTPException(400, "Unsupported file type. Upload a PDF or image (JPEG, PNG, WebP, TIFF).")

    doc = HorseDocument(
        horse_id=horse_id,
        document_type=document_type,
        original_filename=file.filename or 'document',
        file_data=content,
        mime_type=mime,
        file_size=len(content),
        issue_date=date.fromisoformat(issue_date) if issue_date else None,
        expiry_date=date.fromisoformat(expiry_date) if expiry_date else None,
        uploaded_by_user_id=UUID(user_id),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.get("/{horse_id}/documents/{doc_id}/download")
async def download_horse_document(
    horse_id: UUID,
    doc_id: UUID,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    horse = await db.get(Horse, horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    await _assert_can_view(horse, user_id, x_user_role, db)

    result = await db.execute(
        select(HorseDocument).where(HorseDocument.id == doc_id, HorseDocument.horse_id == horse_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")

    safe_name = doc.original_filename.replace('"', '_')
    return Response(
        content=doc.file_data,
        media_type=doc.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.delete("/{horse_id}/documents/{doc_id}", status_code=204)
async def delete_horse_document(
    horse_id: UUID,
    doc_id: UUID,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    horse = await db.get(Horse, horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    await _assert_can_manage(horse, user_id, x_user_role, db)

    result = await db.execute(
        select(HorseDocument).where(HorseDocument.id == doc_id, HorseDocument.horse_id == horse_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")

    await db.delete(doc)
    await db.commit()
