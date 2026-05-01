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


async def _check_access(horse: Horse, user_id: str, role: str, db: AsyncSession):
    """Raises 403 if the user is not ADMIN and doesn't own this horse."""
    if role == 'ADMIN':
        return
    result = await db.execute(select(Exhibitor).where(Exhibitor.user_id == safe_uuid(user_id)))
    exhibitor = result.scalar_one_or_none()
    if not exhibitor or horse.owner_exhibitor_id != exhibitor.id:
        raise HTTPException(403, "You can only manage documents for your own horses")


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
    await _check_access(horse, user_id, x_user_role, db)

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
    await _check_access(horse, user_id, x_user_role, db)

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
    await _check_access(horse, user_id, x_user_role, db)

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
    await _check_access(horse, user_id, x_user_role, db)

    result = await db.execute(
        select(HorseDocument).where(HorseDocument.id == doc_id, HorseDocument.horse_id == horse_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")

    await db.delete(doc)
    await db.commit()
