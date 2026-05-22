from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile, Form
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from database import get_db
from dependencies import require_authenticated, safe_uuid
from models import Trainer, TrainerDocument
from schemas import TrainerDocumentOut

MAX_HEADSHOT_BYTES = 5 * 1024 * 1024  # 5 MB — headshots are small

VALID_DOC_TYPES = {"HEADSHOT"}


def _detect_image_mime(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and len(data) >= 12 and data[8:12] == b"WEBP":
        return "image/webp"
    return None


router = APIRouter(prefix="/trainers", tags=["TrainerDocuments"])


async def _load_trainer_for_management(
    trainer_id: UUID, user_id: str, role: str, db: AsyncSession
) -> Trainer:
    trainer = await db.get(Trainer, trainer_id)
    if not trainer:
        raise HTTPException(404, "Trainer not found")
    if role == "ADMIN":
        return trainer
    if str(trainer.user_id) != user_id:
        raise HTTPException(403, "You can only manage your own trainer profile")
    return trainer


@router.get("/{trainer_id}/documents", response_model=list[TrainerDocumentOut])
async def list_trainer_documents(
    trainer_id: UUID,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _load_trainer_for_management(trainer_id, user_id, x_user_role, db)
    result = await db.execute(
        select(TrainerDocument)
        .where(TrainerDocument.trainer_id == trainer_id)
        .order_by(TrainerDocument.created_at)
    )
    return result.scalars().all()


@router.post(
    "/{trainer_id}/documents",
    response_model=TrainerDocumentOut,
    status_code=201,
)
async def upload_trainer_document(
    trainer_id: UUID,
    file: UploadFile = File(...),
    document_type: str = Form(...),
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    if document_type not in VALID_DOC_TYPES:
        raise HTTPException(
            400, f"Invalid document type. Must be one of: {', '.join(sorted(VALID_DOC_TYPES))}"
        )

    await _load_trainer_for_management(trainer_id, user_id, x_user_role, db)

    content = await file.read()
    if len(content) > MAX_HEADSHOT_BYTES:
        raise HTTPException(400, "File too large (max 5 MB)")

    mime = _detect_image_mime(content)
    if mime is None:
        raise HTTPException(400, "Unsupported file type. Upload a JPEG, PNG, or WebP image.")

    # One headshot per trainer — replace any existing row.
    existing = await db.execute(
        select(TrainerDocument).where(
            TrainerDocument.trainer_id == trainer_id,
            TrainerDocument.document_type == document_type,
        )
    )
    for doc in existing.scalars().all():
        await db.delete(doc)

    doc = TrainerDocument(
        trainer_id=trainer_id,
        document_type=document_type,
        original_filename=file.filename or "headshot",
        file_data=content,
        mime_type=mime,
        file_size=len(content),
        uploaded_by_user_id=safe_uuid(user_id),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.get("/{trainer_id}/documents/{doc_id}/download")
async def download_trainer_document(
    trainer_id: UUID,
    doc_id: UUID,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _load_trainer_for_management(trainer_id, user_id, x_user_role, db)

    result = await db.execute(
        select(TrainerDocument).where(
            TrainerDocument.id == doc_id,
            TrainerDocument.trainer_id == trainer_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")

    safe_name = doc.original_filename.replace('"', "_")
    return Response(
        content=doc.file_data,
        media_type=doc.mime_type,
        headers={"Content-Disposition": f'inline; filename="{safe_name}"'},
    )


@router.delete("/{trainer_id}/documents/{doc_id}", status_code=204)
async def delete_trainer_document(
    trainer_id: UUID,
    doc_id: UUID,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    await _load_trainer_for_management(trainer_id, user_id, x_user_role, db)

    result = await db.execute(
        select(TrainerDocument).where(
            TrainerDocument.id == doc_id,
            TrainerDocument.trainer_id == trainer_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")

    await db.delete(doc)
    await db.commit()


@router.get("/me/headshot")
async def get_my_headshot(
    user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    # Self-only preview — works regardless of is_public so the trainer can
    # check their headshot before turning the ad-facing flag on.
    trainer_uuid = safe_uuid(user_id)
    result = await db.execute(select(Trainer).where(Trainer.user_id == trainer_uuid))
    trainer = result.scalar_one_or_none()
    if not trainer:
        raise HTTPException(404, "Trainer profile not found")

    doc_result = await db.execute(
        select(TrainerDocument).where(
            TrainerDocument.trainer_id == trainer.id,
            TrainerDocument.document_type == "HEADSHOT",
        )
    )
    doc = doc_result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Headshot not set")

    return Response(content=doc.file_data, media_type=doc.mime_type)


# ── Public headshot endpoint (no auth) ─────────────────────────────────────────
# Returns the trainer's headshot only when the trainer's profile is marked public.
# Used by ad/listing surfaces; unauthenticated to keep image rendering simple.

@router.get("/{trainer_id}/headshot")
async def public_trainer_headshot(trainer_id: UUID, db: AsyncSession = Depends(get_db)):
    trainer = await db.get(Trainer, trainer_id)
    if not trainer or not trainer.is_public:
        raise HTTPException(404, "Headshot not available")

    result = await db.execute(
        select(TrainerDocument).where(
            TrainerDocument.trainer_id == trainer_id,
            TrainerDocument.document_type == "HEADSHOT",
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Headshot not available")

    return Response(
        content=doc.file_data,
        media_type=doc.mime_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )
