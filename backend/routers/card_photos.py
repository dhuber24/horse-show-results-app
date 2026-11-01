"""Photos of the judge's card, attached to the class (migration 177).

The scribe types the total the judge called and the app ranks the class; the
card itself -- every maneuver, penalty and note in the judge's own hand -- stays
on paper. Exhibitors want to read it the way they read the pattern before the
class, so the scribe photographs it from the scribe screen and the photo hangs
off the class, read on the class's results page.

  * **Writes are the scribe's** -- anybody who may enter the results they sit
    beside (`require_scoring_access`: ADMIN, SCRIBE, or the show's own office)
    -- at a show on GaitDesk Pro (`CARD_PHOTOS`), and are refused at a show
    frozen by an unpaid renewal. Reads are not gated on the plan: a photo can
    only have been taken at a show that had it.
  * **Reads are public once the class is posted**, and show staff's before. The
    card is the placings: a photo up before the class is posted would post it
    before the scribe did. Until then a public reader gets an empty list and a
    404 for the file, as though there were none -- what the results list does.
  * **A photo is never replaced in place.** A blurry one is removed and another
    taken, so an id always names the same bytes and the file is served with a
    long private cache: a phone at the rail opening the same card twice should
    not fetch it twice on show-grounds signal.

The browser shrinks a photo and saves it again as a JPEG before it is sent
(`shrinkPhoto` in `lib/card-photos.ts`), which keeps a card to a few hundred KB
and leaves the phone's location data behind. The limit here is the pattern's,
for whatever arrives without going through it.
"""

from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import safe_uuid
from models import ClassCardPhoto, ShowJudge
from routers.results import _get_class_or_404, _is_show_staff, _validate_judge
from routers.show_documents import _detect_mime
from routers.show_patterns import MAX_PATTERN_BYTES, content_disposition
from schemas import ClassCardPhotoOut
from show_access import require_scoring_access
from show_companies import CARD_PHOTOS, refuse_frozen_show, require_show_feature

router = APIRouter(
    prefix="/shows/{show_id}/classes/{class_id}/card-photos", tags=["Card Photos"]
)

# The pattern's limit, which is the show bill's and a horse document's: the
# same phones take all of them.
MAX_PHOTO_BYTES = MAX_PATTERN_BYTES

_EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

_META_COLUMNS = (
    ClassCardPhoto.id,
    ClassCardPhoto.class_id,
    ClassCardPhoto.judge_id,
    ClassCardPhoto.mime_type,
    ClassCardPhoto.file_size,
    ClassCardPhoto.created_at,
)


# ── Rules, kept pure so they are pinned without a database ─────────────────────

def visible_to(is_staff: bool, results_published_at) -> bool:
    """Whether a reader may see a class's card photos: show staff always,
    everybody else once the class is posted."""
    return is_staff or results_published_at is not None


def validate_photo(content: bytes) -> str:
    """The photo's MIME type, read off its bytes -- or a 400 saying why not.

    Images only, unlike a pattern: the class page shows the card where it is
    read, and a PDF is a download, not a picture.
    """
    if not content:
        raise HTTPException(400, "That photo is empty.")
    if len(content) > MAX_PHOTO_BYTES:
        raise HTTPException(400, "Photo too large (max 10 MB).")
    mime = _detect_mime(content)
    if mime not in _EXTENSIONS:
        raise HTTPException(400, "Upload the card as a photo -- a JPEG, PNG or WebP image.")
    return mime


def photo_filename(class_number: Optional[str], mime_type: str) -> str:
    """Saved as the class's card, not the camera roll's "IMG_4431.jpg"."""
    stem = f"Class {class_number} judge's card" if class_number else "Judge's card"
    return f"{stem}{_EXTENSIONS.get(mime_type, '')}"


# ── Reads ─────────────────────────────────────────────────────────────────────

async def _load_photos(class_id: UUID, db: AsyncSession, only: Optional[UUID] = None) -> list[dict]:
    """A class's photos, in the panel's running order and then as taken. No bytes.

    Ordered the way the results list orders its cards, so a reader walking the
    photos meets the judges in the order the class page's columns name them.
    """
    query = (
        select(*_META_COLUMNS)
        .outerjoin(ShowJudge, ClassCardPhoto.judge_id == ShowJudge.id)
        .where(ClassCardPhoto.class_id == class_id)
        .order_by(
            ShowJudge.sort_order.nulls_first(),
            ShowJudge.created_at.nulls_first(),
            ClassCardPhoto.created_at,
        )
    )
    if only is not None:
        query = query.where(ClassCardPhoto.id == only)
    return [dict(row) for row in (await db.execute(query)).mappings().all()]


@router.get("", response_model=list[ClassCardPhotoOut])
async def list_card_photos(
    show_id: UUID,
    class_id: UUID,
    x_api_key: Optional[str] = Header(None),
    x_user_role: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """The photos of a class's cards. Empty to the public until it is posted."""
    class_ = await _get_class_or_404(show_id, class_id, db)
    if not visible_to(_is_show_staff(x_api_key, x_user_role), class_.results_published_at):
        return []
    return await _load_photos(class_id, db)


@router.get("/{photo_id}/file")
async def card_photo_file(
    show_id: UUID,
    class_id: UUID,
    photo_id: UUID,
    x_api_key: Optional[str] = Header(None),
    x_user_role: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """The photo itself, shown in the page. A 404 to the public until the
    class is posted, the same answer as a photo that is not there."""
    class_ = await _get_class_or_404(show_id, class_id, db)
    if not visible_to(_is_show_staff(x_api_key, x_user_role), class_.results_published_at):
        raise HTTPException(404, "Photo not found")

    row = (
        await db.execute(
            select(ClassCardPhoto.mime_type, ClassCardPhoto.file_data).where(
                ClassCardPhoto.id == photo_id, ClassCardPhoto.class_id == class_id
            )
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(404, "Photo not found")

    mime_type, data = row
    return Response(
        content=data,
        media_type=mime_type,
        headers={
            "Content-Disposition": content_disposition(
                "inline", photo_filename(class_.class_number, mime_type)
            ),
            # An id always names the same bytes, so this may be kept. Private,
            # because before the class is posted it is a staff-only answer.
            "Cache-Control": "private, max-age=86400",
        },
    )


# ── Writes: the scribe ────────────────────────────────────────────────────────

@router.post(
    "",
    response_model=ClassCardPhotoOut,
    status_code=201,
    dependencies=[
        Depends(require_scoring_access),
        Depends(refuse_frozen_show),
        Depends(require_show_feature(CARD_PHOTOS)),
    ],
)
async def add_card_photo(
    show_id: UUID,
    class_id: UUID,
    file: UploadFile = File(...),
    judge_id: Optional[str] = Form(None),
    x_user_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Attach a photo of a judge's card. `judge_id` is whose card, by the
    show's assignment; leave it off for the unattributed card."""
    await _get_class_or_404(show_id, class_id, db)
    judge = safe_uuid(judge_id) if judge_id else None
    await _validate_judge(show_id, judge, db)

    # One byte past the limit is enough to know it is over.
    content = await file.read(MAX_PHOTO_BYTES + 1)
    mime = validate_photo(content)

    photo_id = uuid4()
    db.add(
        ClassCardPhoto(
            id=photo_id,
            class_id=class_id,
            judge_id=judge,
            file_data=content,
            mime_type=mime,
            file_size=len(content),
            uploaded_by_user_id=safe_uuid(x_user_id) if x_user_id else None,
        )
    )
    await db.commit()
    return (await _load_photos(class_id, db, only=photo_id))[0]


@router.delete(
    "/{photo_id}",
    status_code=204,
    dependencies=[
        Depends(require_scoring_access),
        Depends(refuse_frozen_show),
        Depends(require_show_feature(CARD_PHOTOS)),
    ],
)
async def remove_card_photo(
    show_id: UUID,
    class_id: UUID,
    photo_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Take a photo off the class -- a blurry one, or the wrong card."""
    await _get_class_or_404(show_id, class_id, db)
    result = await db.execute(
        delete(ClassCardPhoto).where(
            ClassCardPhoto.id == photo_id, ClassCardPhoto.class_id == class_id
        )
    )
    if result.rowcount == 0:
        raise HTTPException(404, "Photo not found")
    await db.commit()
    return Response(status_code=204)
