from fastapi import APIRouter, Depends, HTTPException, Header, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Optional
from datetime import date
from uuid import UUID

from database import get_db
from dependencies import require_authenticated, safe_uuid
from models import Exhibitor, ExhibitorDocument, ShowType
from schemas import ExhibitorDocumentOut, ExhibitorDocumentUpdate

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

VALID_DOC_TYPES = {'MEMBERSHIP_CARD', 'AMATEUR_CARD', 'YOUTH_CARD', 'MEDICAL', 'IDENTIFICATION', 'OTHER'}


def _detect_mime(data: bytes) -> str | None:
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


router = APIRouter(prefix="/exhibitors", tags=["ExhibitorDocuments"])


async def _check_access(exhibitor_id: UUID, user_id: str, role: str, db: AsyncSession):
    """Raises 403 if the user is not ADMIN and the exhibitor is not their own profile."""
    if role == 'ADMIN':
        return
    result = await db.execute(select(Exhibitor).where(Exhibitor.id == exhibitor_id))
    exhibitor = result.scalar_one_or_none()
    if not exhibitor or str(exhibitor.user_id) != user_id:
        raise HTTPException(403, "You can only manage documents for your own profile")


@router.get("/{exhibitor_id}/documents", response_model=list[ExhibitorDocumentOut])
async def list_exhibitor_documents(
    exhibitor_id: UUID,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _check_access(exhibitor_id, user_id, x_user_role, db)
    result = await db.execute(
        select(ExhibitorDocument)
        .where(ExhibitorDocument.exhibitor_id == exhibitor_id)
        .options(selectinload(ExhibitorDocument.show_type))
        .order_by(ExhibitorDocument.document_type, ExhibitorDocument.created_at)
    )
    return result.scalars().all()


async def _resolve_show_type(show_type_id: UUID, db: AsyncSession) -> ShowType:
    st = await db.get(ShowType, show_type_id)
    if not st:
        raise HTTPException(400, "Unknown association")
    return st


@router.post("/{exhibitor_id}/documents", response_model=ExhibitorDocumentOut, status_code=201)
async def upload_exhibitor_document(
    exhibitor_id: UUID,
    file: UploadFile = File(...),
    document_type: str = Form(...),
    issue_date: Optional[str] = Form(None),
    expiry_date: Optional[str] = Form(None),
    show_type_id: Optional[str] = Form(None),
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if document_type not in VALID_DOC_TYPES:
        raise HTTPException(400, f"Invalid document type. Must be one of: {', '.join(sorted(VALID_DOC_TYPES))}")

    await _check_access(exhibitor_id, user_id, x_user_role, db)

    show_type: Optional[ShowType] = None
    if show_type_id:
        st_uuid = safe_uuid(show_type_id)
        if not st_uuid:
            raise HTTPException(400, "Invalid association id")
        show_type = await _resolve_show_type(st_uuid, db)

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "File too large (max 10 MB)")

    mime = _detect_mime(content)
    if mime is None:
        raise HTTPException(400, "Unsupported file type. Upload a PDF or image (JPEG, PNG, WebP, TIFF).")

    doc = ExhibitorDocument(
        exhibitor_id=exhibitor_id,
        document_type=document_type,
        original_filename=file.filename or 'document',
        file_data=content,
        mime_type=mime,
        file_size=len(content),
        issue_date=date.fromisoformat(issue_date) if issue_date else None,
        expiry_date=date.fromisoformat(expiry_date) if expiry_date else None,
        show_type_id=show_type.id if show_type else None,
        uploaded_by_user_id=UUID(user_id),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc, attribute_names=['show_type'])
    return doc


@router.patch("/{exhibitor_id}/documents/{doc_id}", response_model=ExhibitorDocumentOut)
async def update_exhibitor_document(
    exhibitor_id: UUID,
    doc_id: UUID,
    body: ExhibitorDocumentUpdate,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _check_access(exhibitor_id, user_id, x_user_role, db)

    result = await db.execute(
        select(ExhibitorDocument)
        .where(
            ExhibitorDocument.id == doc_id,
            ExhibitorDocument.exhibitor_id == exhibitor_id,
        )
        .options(selectinload(ExhibitorDocument.show_type))
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")

    if body.clear_show_type:
        doc.show_type_id = None
    elif body.show_type_id is not None:
        await _resolve_show_type(body.show_type_id, db)
        doc.show_type_id = body.show_type_id

    if body.clear_issue_date:
        doc.issue_date = None
    elif body.issue_date is not None:
        doc.issue_date = body.issue_date

    if body.clear_expiry_date:
        doc.expiry_date = None
    elif body.expiry_date is not None:
        doc.expiry_date = body.expiry_date

    await db.commit()
    await db.refresh(doc, attribute_names=['show_type'])
    return doc


@router.get("/{exhibitor_id}/documents/{doc_id}/download")
async def download_exhibitor_document(
    exhibitor_id: UUID,
    doc_id: UUID,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _check_access(exhibitor_id, user_id, x_user_role, db)

    result = await db.execute(
        select(ExhibitorDocument).where(
            ExhibitorDocument.id == doc_id,
            ExhibitorDocument.exhibitor_id == exhibitor_id,
        )
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


@router.delete("/{exhibitor_id}/documents/{doc_id}", status_code=204)
async def delete_exhibitor_document(
    exhibitor_id: UUID,
    doc_id: UUID,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _check_access(exhibitor_id, user_id, x_user_role, db)

    result = await db.execute(
        select(ExhibitorDocument).where(
            ExhibitorDocument.id == doc_id,
            ExhibitorDocument.exhibitor_id == exhibitor_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")

    await db.delete(doc)
    await db.commit()
