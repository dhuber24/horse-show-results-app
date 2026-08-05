from fastapi import APIRouter, Depends, HTTPException, Header, Request, UploadFile, File, Form
from fastapi.responses import Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from typing import Any, Optional
from datetime import date
from uuid import UUID

from database import get_db
from dependencies import require_authenticated, safe_uuid
from extraction import extract_horse_document, extraction_available
from models import DocumentExtraction, Horse, HorseDocument, Exhibitor
from schemas import DocumentExtractionOut, HorseDocumentOut

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


async def _analyze_and_record(
    file: UploadFile,
    horse_id: Optional[UUID],
    user_id: str,
    db: AsyncSession,
) -> DocumentExtractionOut:
    """Read a document, record the read, and hand back the suggestion.

    Shared by both analyze endpoints. `horse_id` is None when the document is
    read before its horse exists (the add-a-horse wizard); it gets filled in
    when the queued document is finally saved.

    Always returns a result the uploader can act on rather than raising for a
    failed read. A model that is unavailable, unconfigured, or defeated by a bad
    scan just means the form gets filled in by hand, which is how it worked
    before extraction existed — turning that into an error would break upload
    for everyone the moment the extraction service had a bad day.
    """
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "File too large (max 10 MB)")

    mime = _detect_mime(content)
    if mime is None:
        raise HTTPException(400, "Unsupported file type. Upload a PDF or image (JPEG, PNG, WebP, TIFF).")

    filename = file.filename or 'document'
    result = await extract_horse_document(content, mime, filename)

    record = DocumentExtraction(
        horse_id=horse_id,
        original_filename=filename,
        mime_type=mime,
        file_size=len(content),
        status=result.status,
        error_message=result.error_message,
        extracted=result.fields or None,
        model=result.model,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        requested_by_user_id=safe_uuid(user_id),
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    fields = dict(result.fields)
    return DocumentExtractionOut(
        extraction_id=record.id,
        status=result.status,
        message=result.error_message,
        fields=fields,
        low_confidence_fields=fields.get('low_confidence_fields') or [],
        notes=fields.get('notes'),
    )


@router.post("/{horse_id}/documents/analyze", response_model=DocumentExtractionOut)
async def analyze_horse_document(
    horse_id: UUID,
    file: UploadFile = File(...),
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Read a document for an existing horse, without saving anything.

    Gated on the same permission as upload, not the (broader) view permission:
    this reads the contents of a file being added to someone's horse, so whoever
    can call it should already be allowed to add documents there.
    """
    horse = await db.get(Horse, horse_id)
    if not horse:
        raise HTTPException(404, "Horse not found")
    await _assert_can_manage(horse, user_id, x_user_role, db)

    return await _analyze_and_record(file, horse_id, user_id, db)


def _overridden_fields(suggested: dict[str, Any], saved: dict[str, Any]) -> list[str]:
    """Which of the model's suggestions the human changed before saving.

    Only compares fields the form actually offers. A suggestion of None that the
    human filled in counts as an override — that is the undated-Coggins case,
    and it is the most useful thing in here to be able to count later.
    """
    return sorted(
        key for key, value in saved.items()
        if (suggested.get(key) or None) != (value or None)
    )


@router.post("/{horse_id}/documents", response_model=HorseDocumentOut, status_code=201)
async def upload_horse_document(
    horse_id: UUID,
    file: UploadFile = File(...),
    document_type: str = Form(...),
    issue_date: Optional[str] = Form(None),
    expiry_date: Optional[str] = Form(None),
    extraction_id: Optional[str] = Form(None),
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

    # Link the extraction in the same transaction as the document it describes,
    # so a saved document can never be missing the record of where its dates
    # came from.
    # Every bad-extraction_id path is ignored rather than rejected: unparseable,
    # unknown, belonging to another horse, or already claimed by a document. The
    # document is what the user asked for and provenance is bookkeeping, so a
    # stale id left in a tab must not be the reason someone can't file their
    # paperwork. Note this deliberately does NOT use `safe_uuid` — that raises
    # 400 on a malformed id, which is right for an id the request is *about* and
    # wrong for one that only annotates it.
    extraction = None
    if extraction_id:
        try:
            extraction_uuid = UUID(extraction_id)
        except (ValueError, AttributeError):
            extraction_uuid = None
        if extraction_uuid is not None:
            extraction = await db.get(DocumentExtraction, extraction_uuid)
            # A NULL horse_id means the read happened before the horse existed
            # (add-a-horse wizard) — that one gets claimed and attached here.
            # Anything already claimed, or belonging to a different horse, is
            # dropped.
            if extraction and (
                extraction.document_id is not None
                or (extraction.horse_id is not None and extraction.horse_id != horse_id)
            ):
                extraction = None

    if extraction is not None:
        await db.flush()  # assigns doc.id
        saved = {
            'document_type': document_type,
            'issue_date': doc.issue_date.isoformat() if doc.issue_date else None,
            'expiry_date': doc.expiry_date.isoformat() if doc.expiry_date else None,
        }
        extraction.horse_id = horse_id  # no-op unless the read predated the horse
        extraction.document_id = doc.id
        extraction.accepted = saved
        extraction.overridden_fields = _overridden_fields(extraction.extracted or {}, saved)
        extraction.linked_at = func.now()

    await db.commit()
    await db.refresh(doc)
    return doc


@router.get("/documents/extraction-status")
async def document_extraction_status(
    user_id: str = Depends(require_authenticated),
):
    """Whether the upload form should offer to read documents at all."""
    return {"available": extraction_available()}


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


# --- Reading a document before its horse exists ------------------------------
# The add-a-horse wizard stages documents in the browser and saves them only
# after the horse is created, so the horse-scoped endpoint above cannot serve
# it — there is no horse to authorize against yet.

def _extraction_rate_key(request: Request) -> str:
    """Rate-limit per user, not per IP.

    Every request reaches the backend from the Next.js server, so the client
    address is the same for everyone and an IP-keyed limit would be a global
    cap — one busy user would lock out the rest. The user id is attached
    server-side by `getAuthHeaders()` and cannot be set by the browser.
    """
    return request.headers.get("x-user-id") or get_remote_address(request)


_extraction_limiter = Limiter(key_func=_extraction_rate_key)

documents_router = APIRouter(prefix="/documents", tags=["HorseDocuments"])


@documents_router.post("/analyze", response_model=DocumentExtractionOut)
@_extraction_limiter.limit("20/minute")
async def analyze_unattached_document(
    request: Request,
    file: UploadFile = File(...),
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Read a document that is not attached to a horse yet.

    Authentication is the only gate available here: with no horse there is
    nothing to check ownership against. That is a genuinely weaker check than
    the horse-scoped endpoint, so the exposure is worth stating plainly — a
    signed-in user can read any file they already hold. They learn nothing
    about anyone else's data, and the resulting row is written with a NULL
    `horse_id` until a save attaches it, but it does spend model tokens, which
    is why it is rate limited.
    """
    return await _analyze_and_record(file, None, user_id, db)
