"""The show's own uploaded documents -- today, its show bill.

The app has always generated the show bill from the show's own classes, judges
and fees, and that remains the default and the recommendation: a generated bill
cannot fall out of date with the schedule it describes, and a stale PDF is worse
than none because people trust the copy they printed.

What this adds is the other option, for the shows that had it already. A club's
show bill is usually a designed document -- sponsor logos, the club's wording,
the entry blank on the back -- laid out and sent to the printer before anything
is keyed in here. Refusing the upload never made those shows use the generated
bill; it made them e-mail a PDF this app never saw.

Two rules keep the hazard where it can be seen:

  * **The choice and the file are separate facts.** `shows.showbill_source` may
    only read 'uploaded' while a SHOWBILL row exists, enforced here because a
    CHECK cannot see another table. Deleting the document resets the column in
    the same transaction, and `GET` reports `effective_source` beside `source`
    so no reader can be handed an empty frame.
  * **An uploaded bill never hides the app's own data.** Show Details goes on
    rendering the generated document below the show's facts, because that is the
    price list `GET /shows/{id}/fees/public` charges from, and the class schedule
    stays one link away. The show decides what the *button* shows.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import require_admin_or_show_admin, safe_uuid
from models import Show, ShowDocument
from routers.shows import _assert_show_access
from schemas import ShowbillOut, ShowbillSourceUpdate

router = APIRouter(prefix="/shows/{show_id}", tags=["Show Documents"])

SHOWBILL = "SHOWBILL"

# A show bill is a multi-page printed document. 10 MB matches the horse-document
# limit -- the same scanner produces both, and a second number to remember buys
# nothing.
MAX_SHOWBILL_BYTES = 10 * 1024 * 1024


def _detect_mime(data: bytes) -> str | None:
    """The type from the magic bytes, ignoring the client's Content-Type.

    Same list and same reasoning as `horse_documents._detect_mime`: what the
    browser claims a file is has no bearing on what it is, and this one is
    served back to anonymous readers.
    """
    if data[:4] == b"%PDF":
        return "application/pdf"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and len(data) >= 12 and data[8:12] == b"WEBP":
        return "image/webp"
    return None


async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _load_showbill_meta(show_id: UUID, db: AsyncSession):
    """The SHOWBILL row without its bytes.

    Columns by name rather than `select(ShowDocument)`, because the entity form
    would pull a multi-megabyte BYTEA through every metadata read -- including
    the one the public show bill page makes on each load.
    """
    result = await db.execute(
        select(
            ShowDocument.id,
            ShowDocument.document_type,
            ShowDocument.original_filename,
            ShowDocument.mime_type,
            ShowDocument.file_size,
            ShowDocument.created_at,
        ).where(
            ShowDocument.show_id == show_id,
            ShowDocument.document_type == SHOWBILL,
        )
    )
    return result.mappings().one_or_none()


def _showbill_payload(show: Show, document) -> dict:
    # `effective_source` is the one a renderer should read. The two part company
    # only if a document goes missing without the DELETE below resetting the
    # column, and a page trusting `source` alone would then draw an empty frame.
    effective = "uploaded" if (show.showbill_source == "uploaded" and document) else "generated"
    return {
        "source": show.showbill_source,
        "effective_source": effective,
        "document": dict(document) if document else None,
    }


@router.get("/showbill-document", response_model=ShowbillOut)
async def get_showbill_document(show_id: UUID, db: AsyncSession = Depends(get_db)):
    """What the Show Bill button will open. Public -- so is the bill.

    Not gated on show status the way `GET /shows/{id}/fees/public` is: this
    answers which of two documents to draw, the staff setup screen needs it while
    the show is still DRAFT, and the answer names a file rather than quoting a
    price.
    """
    show = await _get_show_or_404(show_id, db)
    document = await _load_showbill_meta(show_id, db)
    return _showbill_payload(show, document)


@router.get("/showbill-document/file")
async def download_showbill_document(
    show_id: UUID,
    download: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """The uploaded show bill itself. Public, like the page it renders in.

    Served whatever `showbill_source` currently says. A show that uploaded a bill
    and then switched back to the generated one has not made the file secret --
    and the setup screen has to be able to preview a document before committing
    the show to it.
    """
    await _get_show_or_404(show_id, db)
    result = await db.execute(
        select(ShowDocument).where(
            ShowDocument.show_id == show_id,
            ShowDocument.document_type == SHOWBILL,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "This show has no uploaded show bill")

    safe_name = doc.original_filename.replace('"', "_")
    disposition = "attachment" if download else "inline"
    return Response(
        content=doc.file_data,
        media_type=doc.mime_type,
        headers={
            "Content-Disposition": f'{disposition}; filename="{safe_name}"',
            # A show bill is a public notice, read far more often than it
            # changes -- but a replaced one has to reach the people deciding
            # whether to enter. Short rather than long.
            "Cache-Control": "public, max-age=300",
        },
    )


@router.post(
    "/showbill-document",
    response_model=ShowbillOut,
    status_code=201,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def upload_showbill_document(
    show_id: UUID,
    file: UploadFile = File(...),
    document_type: str = Form(SHOWBILL),
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Put the show's own bill on file. Replaces any previous one.

    Uploading does **not** switch the show over to it. That is a second,
    deliberate press on `PUT /showbill-source`, so a manager comparing their PDF
    against the generated bill can look at it without every exhibitor's Show Bill
    button changing underneath them mid-comparison.
    """
    if document_type != SHOWBILL:
        raise HTTPException(400, f"Invalid document type. Must be {SHOWBILL}.")

    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)

    content = await file.read()
    if not content:
        raise HTTPException(400, "That file is empty.")
    if len(content) > MAX_SHOWBILL_BYTES:
        raise HTTPException(400, "File too large (max 10 MB)")

    mime = _detect_mime(content)
    if mime is None:
        raise HTTPException(
            400,
            "Unsupported file type. Upload the show bill as a PDF, or as a JPEG, "
            "PNG or WebP image.",
        )

    # One show bill per show -- replace rather than append. There is no history
    # worth keeping here, and two rows would leave every reader picking one.
    existing = await db.execute(
        select(ShowDocument).where(
            ShowDocument.show_id == show_id,
            ShowDocument.document_type == SHOWBILL,
        )
    )
    for old in existing.scalars().all():
        await db.delete(old)
    await db.flush()

    doc = ShowDocument(
        show_id=show_id,
        document_type=SHOWBILL,
        original_filename=file.filename or "show-bill",
        file_data=content,
        mime_type=mime,
        file_size=len(content),
        uploaded_by_user_id=safe_uuid(x_user_id),
    )
    db.add(doc)
    await db.commit()

    show = await _get_show_or_404(show_id, db)
    return _showbill_payload(show, await _load_showbill_meta(show_id, db))


@router.delete(
    "/showbill-document",
    response_model=ShowbillOut,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def delete_showbill_document(
    show_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Remove the uploaded bill, and put the show back on the generated one.

    Both in the same transaction. Leaving `showbill_source` at 'uploaded' with
    nothing to render is the exact failure the pair rule exists to prevent, and
    "delete the file, then remember to change the setting" is not a sequence to
    hand somebody mid-way through setting up a show.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)

    result = await db.execute(
        select(ShowDocument).where(
            ShowDocument.show_id == show_id,
            ShowDocument.document_type == SHOWBILL,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "This show has no uploaded show bill")

    await db.delete(doc)
    show.showbill_source = "generated"
    await db.commit()

    return _showbill_payload(show, None)


@router.put(
    "/showbill-source",
    response_model=ShowbillOut,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def set_showbill_source(
    show_id: UUID,
    body: ShowbillSourceUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Choose which show bill the button opens.

    Its own endpoint rather than a field on `ShowUpdate`: the check is about
    another table, and the show edit form posts the whole show back on every
    save, so a field there would be re-asserted by screens that know nothing
    about this choice.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    show = await _get_show_or_404(show_id, db)

    document = await _load_showbill_meta(show_id, db)
    if body.source == "uploaded" and not document:
        raise HTTPException(
            422,
            "Upload a show bill first. Pointing the Show Bill button at a file "
            "that is not on record would give exhibitors a blank page.",
        )

    show.showbill_source = body.source
    await db.commit()
    return _showbill_payload(show, document)
