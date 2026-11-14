"""Setting a show up from its own printed show bill.

Upload the bill, wait while the model reads it, confirm the show's name, type
and dates, press Create: the show is made as a DRAFT and every doubt about the
read is a check on its setup step (migration 187). The reading lives in
`extraction/showbill.py`, the matching and the creating in `showbill_import.py`,
the checks in `showbill_checks.py`; this router is the doors onto them.

Show-office tier only (ADMIN, SHOW_MANAGER, SHOW_SECRETARY) -- the roles that
can create a show at `/admin/shows/new` today. An import belongs to whoever
uploaded it: it holds a file they chose to share with this screen and nobody
else, and the review is theirs to finish.

**And a paid feature** (migration 142): every door but `/availability` also
requires `showbill_import` to be switched on for a show company the caller
works for -- an ADMIN always has it. The review and the Create are gated as
well as the upload, so a company whose subscription is turned off mid-review
cannot finish a show it has stopped paying for; the rows stay, and a review
picks up where it was left if the feature comes back on.
"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import require_admin_or_show_admin, safe_uuid
from extraction import extraction_available
from models import ShowBillImport
from routers.show_documents import MAX_SHOWBILL_BYTES, _detect_mime
from schemas import ShowBillImportOut, ShowBillImportStart
from show_companies import SHOWBILL_IMPORT, enabled_features, require_feature
from showbill_import import (
    INTERRUPTED_MESSAGE,
    STATUS_FAILED,
    STATUS_PENDING,
    STATUS_SUCCEEDED,
    create_show_from_read,
    effective_status,
    resolve_read,
    start_read,
)

router = APIRouter(
    prefix="/show-bill-imports",
    tags=["Show Bill Imports"],
    dependencies=[Depends(require_admin_or_show_admin)],
)


def _rate_key(request: Request) -> str:
    """Per user, not per IP -- every request arrives from the Next.js server, so
    the client address is the same for everyone and an IP-keyed limit would be a
    global cap: one busy user would lock out the rest. The user id is attached
    server-side by `getAuthHeaders()` and cannot be set by the browser."""
    return request.headers.get("x-user-id") or get_remote_address(request)


_limiter = Limiter(key_func=_rate_key)

# Every door onto an import except `/availability`, which is what a screen asks
# before it knows whether to offer the feature at all.
_PAID = [Depends(require_feature(SHOWBILL_IMPORT))]

# Columns every read of the row needs, without the file itself.
_META = (
    ShowBillImport.id,
    ShowBillImport.created_by_user_id,
    ShowBillImport.status,
    ShowBillImport.error_message,
    ShowBillImport.original_filename,
    ShowBillImport.created_at,
    ShowBillImport.completed_at,
    ShowBillImport.show_id,
)


def _status_and_message(row, now: datetime) -> tuple[str, str | None]:
    status = effective_status(row.status, row.created_at, now)
    if status == STATUS_FAILED and row.status == STATUS_PENDING:
        return status, INTERRUPTED_MESSAGE
    return status, row.error_message


@router.get("/availability")
async def import_availability(
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Whether the server can read a bill at all (`available`), and whether the
    caller's show company has paid for it (`enabled`), so the screen can say
    which up front rather than after somebody has chosen a file."""
    features = await enabled_features(db, safe_uuid(x_user_id), x_user_role)
    return {"available": extraction_available(), "enabled": SHOWBILL_IMPORT in features}


@router.get("/", response_model=list[ShowBillImportOut], dependencies=_PAID)
async def list_my_imports(
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The caller's recent reads -- a read takes minutes, and somebody who
    wandered off while it ran needs a way back to their review."""
    rows = (
        await db.execute(
            select(*_META)
            .where(ShowBillImport.created_by_user_id == safe_uuid(x_user_id))
            .order_by(ShowBillImport.created_at.desc())
            .limit(10)
        )
    ).all()
    now = datetime.now(timezone.utc)
    out = []
    for row in rows:
        status, message = _status_and_message(row, now)
        out.append(
            ShowBillImportOut(
                id=row.id,
                status=status,
                message=message,
                original_filename=row.original_filename,
                created_at=row.created_at,
                completed_at=row.completed_at,
                show_id=row.show_id,
            )
        )
    return out


@router.post("/", response_model=ShowBillImportOut, status_code=202, dependencies=_PAID)
@_limiter.limit("10/hour")
async def upload_show_bill(
    request: Request,
    file: UploadFile = File(...),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Take the file and start reading it. Answers at once with a `pending` row.

    Rate limited because every read spends model tokens on a document tens of
    pages long. Ten an hour is far more than one show needs and far less than
    a runaway retry loop would spend.
    """
    if not extraction_available():
        raise HTTPException(503, "Reading show bills is not configured on this server. Set the show up by hand.")

    content = await file.read()
    if not content:
        raise HTTPException(400, "That file is empty.")
    if len(content) > MAX_SHOWBILL_BYTES:
        raise HTTPException(400, "File too large (max 10 MB). Try the class schedule pages on their own.")
    mime = _detect_mime(content)
    if mime is None:
        raise HTTPException(400, "Upload the show bill as a PDF, or as a JPEG, PNG or WebP image.")

    row = ShowBillImport(
        created_by_user_id=safe_uuid(x_user_id),
        original_filename=file.filename or "show-bill",
        mime_type=mime,
        file_size=len(content),
        file_data=content,
        status=STATUS_PENDING,
    )
    db.add(row)
    await db.commit()
    start_read(row.id)
    return ShowBillImportOut(
        id=row.id,
        status=STATUS_PENDING,
        original_filename=row.original_filename,
        created_at=row.created_at,
    )


@router.get("/{import_id}", response_model=ShowBillImportOut, dependencies=_PAID)
async def get_import(
    import_id: UUID,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Poll a read; once it has succeeded, the draft the review screen edits."""
    row = (
        await db.execute(
            select(*_META, ShowBillImport.extracted).where(ShowBillImport.id == import_id)
        )
    ).one_or_none()
    if row is None or (x_user_role != "ADMIN" and row.created_by_user_id != safe_uuid(x_user_id)):
        raise HTTPException(404, "Show bill import not found")

    status, message = _status_and_message(row, datetime.now(timezone.utc))
    out = ShowBillImportOut(
        id=row.id,
        status=status,
        message=message,
        original_filename=row.original_filename,
        created_at=row.created_at,
        completed_at=row.completed_at,
        show_id=row.show_id,
    )
    if status != STATUS_SUCCEEDED or not row.extracted:
        return out

    out.extracted = row.extracted
    out.resolved, _rows = await resolve_read(db, row.extracted)
    return out


@router.post("/{import_id}/create-show", status_code=201, dependencies=_PAID)
async def create_show_from_bill(
    import_id: UUID,
    body: ShowBillImportStart,
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Create the show as a DRAFT from the read, in one transaction (migration
    187). Every doubt about what was read is a check on its setup step, and the
    show cannot leave DRAFT until each is answered."""
    show_id = await create_show_from_read(
        import_id,
        body,
        user_id=safe_uuid(x_user_id),
        user_role=x_user_role,
        db=db,
    )
    return {"show_id": str(show_id)}
