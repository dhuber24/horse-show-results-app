"""Loading an association's published class-code list.

The associations reissue their approved-class list every year and somebody has
to get it into the app. That used to be two command-line scripts and a CSV
checked into the repo, which meant the person who owns the relationship with
APHA could not do it.

Two endpoints, on purpose. `preview` parses and diffs and writes nothing;
`apply` takes the same file back plus the retirements the admin ticked. The
file is re-uploaded rather than parked in server-side state, so there is no
half-finished import to expire, and the diff the admin approved is the diff
that gets applied because it is recomputed from the same bytes.

Nothing is updated in place. A changed row closes its version and opens a new
one, and a retirement only closes -- see migration 114 for why.
"""
from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Header, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import require_admin, safe_uuid
from imports.class_codes import (
    PDF_PARSERS,
    ParseError,
    ParsedClass,
    duplicate_codes,
    parse_upload,
)
from models import (
    AssociationClassImport,
    AssociationStandardClass,
    AssociationStandardClassVersion,
    ShowType,
    User,
)
from schemas import (
    AssociationClassImportOut,
    StandardClassCatalogOut,
    StandardClassChangeOut,
    StandardClassImportPreviewOut,
    StandardClassImportResultOut,
    StandardClassRowOut,
)
import standard_classes

router = APIRouter(
    prefix="/standard-class-imports",
    tags=["Standard Class Imports"],
    dependencies=[Depends(require_admin)],
)

#: Class lists are text. Ten megabytes is far past any of them and still small
#: enough that a mis-picked file fails fast instead of filling a worker.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

#: Which show types own a class-code catalog. Clubs do not: an NSBA-sanctioned
#: show runs APHA or AQHA classes under APHA or AQHA codes.
CATALOG_SHOW_TYPE_CODES = ("APHA", "AQHA", "ApHC", "FQHR")


async def _get_show_type(db: AsyncSession, show_type_id: UUID) -> ShowType:
    show_type = await db.get(ShowType, show_type_id)
    if not show_type:
        raise HTTPException(404, "Show type not found")
    return show_type


async def _read_upload(file: UploadFile) -> bytes:
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "That file is larger than 10 MB.")
    if not data:
        raise HTTPException(400, "The uploaded file is empty.")
    return data


def _parse(file: UploadFile, data: bytes, show_type: ShowType):
    try:
        result = parse_upload(file.filename or "", data, show_type.code)
    except ParseError as exc:
        raise HTTPException(422, str(exc)) from exc

    dupes = duplicate_codes(result.classes)
    if dupes:
        shown = ", ".join(dupes[:10])
        more = f" (and {len(dupes) - 10} more)" if len(dupes) > 10 else ""
        raise HTTPException(
            422,
            f"The file lists the same code more than once: {shown}{more}. "
            "The catalog holds one entry per code, so this needs fixing in the "
            "file first.",
        )
    return result


def _row(obj) -> StandardClassRowOut:
    return StandardClassRowOut(
        code=obj.code,
        name=obj.name,
        division=obj.division,
        sort_order=obj.sort_order or 0,
        notes=getattr(obj, "notes", None),
    )


def _differing_fields(current, incoming: ParsedClass) -> list[str]:
    fields: list[str] = []
    if (current.name or "").strip() != incoming.name.strip():
        fields.append("name")
    if (current.division or "").strip() != incoming.division.strip():
        fields.append("division")
    if (current.sort_order or 0) != incoming.sort_order:
        fields.append("sort_order")
    return fields


async def _current_by_code(db: AsyncSession, show_type_id: UUID) -> dict[str, object]:
    rows = await standard_classes.list_classes(db, show_type_id)
    return {row.code: row for row in rows}


def _diff(current: dict, parsed: list[ParsedClass]):
    added, changed, unchanged = [], [], 0
    for item in parsed:
        existing = current.get(item.code)
        if existing is None:
            added.append(item)
            continue
        fields = _differing_fields(existing, item)
        if fields:
            changed.append((existing, item, fields))
        else:
            unchanged += 1
    incoming_codes = {c.code for c in parsed}
    retired = [row for code, row in current.items() if code not in incoming_codes]
    retired.sort(key=lambda r: (r.division, r.sort_order or 0, r.code))
    return added, changed, retired, unchanged


@router.get("/{show_type_id}", response_model=StandardClassCatalogOut)
async def get_catalog(show_type_id: UUID, db: AsyncSession = Depends(get_db)):
    """What the catalog holds now, and when it was last loaded."""
    show_type = await _get_show_type(db, show_type_id)
    active = await db.execute(
        select(func.count())
        .select_from(AssociationStandardClass)
        .where(AssociationStandardClass.show_type_id == show_type_id)
    )
    divisions = await standard_classes.list_divisions(db, show_type_id)
    last = await _recent_imports(db, show_type_id, limit=1)
    return StandardClassCatalogOut(
        show_type_id=show_type_id,
        show_type_code=show_type.code,
        active_count=active.scalar_one(),
        divisions=divisions,
        pdf_supported=show_type.code.upper() in PDF_PARSERS,
        last_import=last[0] if last else None,
    )


async def _recent_imports(
    db: AsyncSession, show_type_id: UUID | None = None, limit: int = 20
) -> list[AssociationClassImportOut]:
    stmt = (
        select(AssociationClassImport, ShowType.code, User.full_name)
        .join(ShowType, ShowType.id == AssociationClassImport.show_type_id)
        .outerjoin(User, User.id == AssociationClassImport.uploaded_by)
        .order_by(AssociationClassImport.uploaded_at.desc())
        .limit(limit)
    )
    if show_type_id is not None:
        stmt = stmt.where(AssociationClassImport.show_type_id == show_type_id)
    rows = (await db.execute(stmt)).all()
    return [
        AssociationClassImportOut(
            id=imp.id,
            show_type_id=imp.show_type_id,
            show_type_code=code,
            filename=imp.filename,
            source_year=imp.source_year,
            uploaded_at=imp.uploaded_at,
            uploaded_by_name=uploader,
            added_count=imp.added_count,
            changed_count=imp.changed_count,
            retired_count=imp.retired_count,
            unchanged_count=imp.unchanged_count,
        )
        for imp, code, uploader in rows
    ]


@router.get("/{show_type_id}/history", response_model=list[AssociationClassImportOut])
async def list_imports(show_type_id: UUID, db: AsyncSession = Depends(get_db)):
    await _get_show_type(db, show_type_id)
    return await _recent_imports(db, show_type_id)


@router.post("/{show_type_id}/preview", response_model=StandardClassImportPreviewOut)
async def preview_import(
    show_type_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Parse the file and diff it against the catalog. Writes nothing."""
    show_type = await _get_show_type(db, show_type_id)
    data = await _read_upload(file)
    parsed = _parse(file, data, show_type)

    current = await _current_by_code(db, show_type_id)
    added, changed, retired, unchanged = _diff(current, parsed.classes)

    return StandardClassImportPreviewOut(
        show_type_id=show_type_id,
        show_type_code=show_type.code,
        filename=file.filename or "",
        parsed_count=len(parsed.classes),
        unchanged_count=unchanged,
        added=[_row(item) for item in added],
        changed=[
            StandardClassChangeOut(
                code=existing.code,
                before=_row(existing),
                after=_row(incoming),
                fields=fields,
            )
            for existing, incoming, fields in changed
        ],
        retired=[_row(row) for row in retired],
        warnings=parsed.warnings,
        skipped=parsed.skipped[:50],
    )


@router.post("/{show_type_id}/apply", response_model=StandardClassImportResultOut)
async def apply_import(
    show_type_id: UUID,
    file: UploadFile = File(...),
    retire_codes: str = Form(default=""),
    source_year: str = Form(default=""),
    x_user_id: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Apply the file.

    `retire_codes` is the comma-separated list the admin ticked. A code missing
    from the file but *not* ticked is left alone: the file is this year's
    approved list, not a statement that last year's codes never existed, and a
    show that ran under one still has to render its program.
    """
    show_type = await _get_show_type(db, show_type_id)
    data = await _read_upload(file)
    parsed = _parse(file, data, show_type)

    year = None
    if source_year.strip():
        if not source_year.strip().isdigit():
            raise HTTPException(400, "Source year must be a year, e.g. 2026.")
        year = int(source_year.strip())

    current = await _current_by_code(db, show_type_id)
    added, changed, retired, unchanged = _diff(current, parsed.classes)

    requested = {c.strip() for c in retire_codes.split(",") if c.strip()}
    retirable = {row.code for row in retired}
    unknown = requested - retirable
    if unknown:
        # The catalog moved between preview and apply, so the diff on screen is
        # not the diff being applied. Refusing beats retiring something the
        # admin never saw.
        raise HTTPException(
            409,
            "These codes are no longer missing from the catalog: "
            f"{', '.join(sorted(unknown))}. Preview the file again.",
        )
    to_retire = [row for row in retired if row.code in requested]

    today = date.today()
    record = AssociationClassImport(
        show_type_id=show_type_id,
        filename=file.filename or "",
        source_year=year,
        uploaded_by=safe_uuid(x_user_id),
        added_count=len(added),
        changed_count=len(changed),
        retired_count=len(to_retire),
        unchanged_count=unchanged,
    )
    db.add(record)
    await db.flush()

    for item in added:
        db.add(
            AssociationStandardClassVersion(
                show_type_id=show_type_id,
                code=item.code,
                name=item.name,
                division=item.division,
                sort_order=item.sort_order,
                source_year=year,
                notes=item.notes,
                effective_date=today,
                import_id=record.id,
            )
        )

    # Close then open, in that order: the partial unique index allows one open
    # version per code, so opening first would fail.
    for existing, incoming, _fields in changed:
        await _close(db, show_type_id, existing.code, today)
        db.add(
            AssociationStandardClassVersion(
                show_type_id=show_type_id,
                code=incoming.code,
                name=incoming.name,
                division=incoming.division,
                sort_order=incoming.sort_order,
                source_year=year,
                notes=incoming.notes,
                effective_date=today,
                import_id=record.id,
            )
        )

    for row in to_retire:
        await _close(db, show_type_id, row.code, today)

    await db.commit()

    active = await db.execute(
        select(func.count())
        .select_from(AssociationStandardClass)
        .where(AssociationStandardClass.show_type_id == show_type_id)
    )
    return StandardClassImportResultOut(
        import_id=record.id,
        show_type_code=show_type.code,
        added_count=len(added),
        changed_count=len(changed),
        retired_count=len(to_retire),
        unchanged_count=unchanged,
        active_count=active.scalar_one(),
    )


async def _close(db: AsyncSession, show_type_id: UUID, code: str, on: date) -> None:
    """Close the open version of one code.

    `inactive_date` is clamped to the version's own `effective_date` so a row
    opened and superseded on the same day does not violate the date check.
    """
    version = (
        await db.execute(
            select(AssociationStandardClassVersion)
            .where(AssociationStandardClassVersion.show_type_id == show_type_id)
            .where(AssociationStandardClassVersion.code == code)
            .where(AssociationStandardClassVersion.inactive_date.is_(None))
        )
    ).scalars().first()
    if version is None:
        return
    version.inactive_date = max(on, version.effective_date)


@router.get("/{show_type_id}/history/{code}", response_model=list[StandardClassRowOut])
async def class_history(
    show_type_id: UUID, code: str, db: AsyncSession = Depends(get_db)
):
    """Every version of one code, oldest first — including retired ones."""
    await _get_show_type(db, show_type_id)
    rows = (
        await db.execute(
            select(AssociationStandardClassVersion)
            .where(AssociationStandardClassVersion.show_type_id == show_type_id)
            .where(AssociationStandardClassVersion.code == code)
            .order_by(AssociationStandardClassVersion.effective_date)
        )
    ).scalars().all()
    return [_row(row) for row in rows]
