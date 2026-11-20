"""The show's patterns -- on file, and assigned to the classes that run them.

Migration 120 recorded *when* a class's pattern went up at the in-gate and
deliberately did not store the pattern, because a second copy could disagree
with the one posted there. Migration 146 reverses that half for the reason 127
reversed it for the show bill: shows already publish their patterns ahead --
e-mailed, pinned to a club page, photographed round the barn aisle -- and
refusing the upload did not prevent a second copy. It only made it one the
office could not replace and an exhibitor could not find from their class.

So the hazard is managed rather than dismissed:

  * **One current file per pattern.** A judge who changes a pattern has it
    replaced in place (`PUT /{id}/file`): the classes stay attached, and
    `file_uploaded_at` moves. There is never a superseded copy to open here.
  * **The replacement time rides on every read**, and the exhibitor's page
    says the pattern at the in-gate is the official one.
  * **An upload is not a posting.** `classes.pattern_posted_at` is still set
    from the gate screen when the judge puts it up, and nothing here touches it.

A class runs one pattern and a pattern often runs a dozen classes (one
showmanship pattern across every division), so the assignment is keyed on the
class and set from the class's side: `PUT /assignments` points one class -- or a
whole discipline's worth -- at a pattern, or at none. Attaching is optional; a
pattern on file with no class is still on the exhibitor's list.

Reads are public, like the show bill and the schedule they hang off: a pattern
is read at the rail on a phone, by people who never signed in. Writes are the
show office's -- ADMIN, or a secretary or manager assigned to the show.
"""

import asyncio
import logging
import re
from typing import Optional
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from slowapi import Limiter
from slowapi.util import get_remote_address

from database import get_db
from dependencies import require_admin_or_show_admin, safe_uuid
from extraction.patterns import numbered, pattern_file, read_patterns
from models import Class, Discipline, Division, Show, ShowPattern, ShowPatternClass
from routers.show_documents import _detect_mime
from routers.shows import _assert_show_access
from schemas import ShowPatternAssignment, ShowPatternOut, ShowPatternReadOut, ShowPatternUpdate
from show_companies import PATTERN_READING, require_show_feature

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/shows/{show_id}/patterns", tags=["Show Patterns"])


def _rate_key(request: Request) -> str:
    """Per user: every request comes through the Next.js server, so an IP key
    would be one limit for everybody (`show_bill_imports._rate_key`)."""
    return request.headers.get("x-user-id") or get_remote_address(request)


_limiter = Limiter(key_func=_rate_key)

# The same limit as a show bill and a horse document: the same phones and
# scanners produce all three, and a second number to remember buys nothing.
MAX_PATTERN_BYTES = 10 * 1024 * 1024
MAX_NAME_CHARS = 200
MAX_NOTES_CHARS = 2000

_EXTENSIONS = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

# Everything a reader needs except the bytes. A list of a dozen patterns must
# not pull a dozen photographs through memory; the download endpoint is the one
# place that asks for `file_data`.
_META_COLUMNS = (
    ShowPattern.id,
    ShowPattern.show_id,
    ShowPattern.name,
    ShowPattern.notes,
    ShowPattern.original_filename,
    ShowPattern.mime_type,
    ShowPattern.file_size,
    ShowPattern.created_at,
    ShowPattern.file_uploaded_at,
)


# ── Rules, kept pure so they are pinned without a database ─────────────────────

def normalize_name(raw: Optional[str]) -> Optional[str]:
    """A pattern's name as it will be printed: one line, single-spaced.

    None when nothing is left, which the caller turns into "needs a name" --
    a pattern with a blank name is one nobody can find on the list.
    """
    if raw is None:
        return None
    collapsed = " ".join(raw.split())
    return collapsed or None


def name_key(name: str) -> str:
    """What two names are compared on. Matches the migration's unique index,
    `lower(btrim(name))`, for any name `normalize_name` has already cleaned."""
    return " ".join(name.split()).lower()


def normalize_notes(raw: Optional[str]) -> Optional[str]:
    """Notes keep their line breaks -- "Walk-trot riders trot the lope" is often
    a list -- but lose the blank edges, and nothing typed is no notes."""
    if raw is None:
        return None
    stripped = raw.replace("\r\n", "\n").strip()
    return stripped or None


def name_from_filename(filename: Optional[str]) -> Optional[str]:
    """A name to fall back on when the upload did not carry one.

    'Showmanship_Pattern-2.pdf' -> 'Showmanship Pattern 2'. The upload form
    prefills the same guess (`nameFromFilename` in `lib/patterns.ts`), so this
    only decides for an API caller that sent no name at all.
    """
    if not filename:
        return None
    base = re.split(r"[\\/]", filename)[-1]
    stem = base.rsplit(".", 1)[0] if "." in base else base
    name = normalize_name(re.sub(r"[_\-]+", " ", stem))
    return name[:MAX_NAME_CHARS] if name else None


def validate_upload(content: bytes) -> str:
    """The file's MIME type, read off its bytes -- or a 400 saying why not."""
    if not content:
        raise HTTPException(400, "That file is empty.")
    if len(content) > MAX_PATTERN_BYTES:
        raise HTTPException(400, "File too large (max 10 MB).")
    mime = _detect_mime(content)
    if mime is None:
        raise HTTPException(
            400,
            "Unsupported file type. Upload the pattern as a PDF, or as a JPEG, "
            "PNG or WebP image -- a photo of a hand-drawn pattern is fine.",
        )
    return mime


def plan_assignment(
    class_ids: set[UUID],
    pattern_id: Optional[UUID],
    current: dict[UUID, UUID],
) -> tuple[set[UUID], set[UUID]]:
    """How to point `class_ids` at `pattern_id` (None: at no pattern).

    `current` maps each of those classes that has a pattern to it. Returns
    `(clear, add)`: the classes whose row must go, and the classes that need a
    row for `pattern_id`. A class already on the pattern asked for is in
    neither -- rewriting it would re-date `assigned_at` for a class nobody
    changed, and a discipline-wide "set all" usually repeats most of its rows.
    """
    if pattern_id is None:
        return {c for c in class_ids if c in current}, set()
    clear = {c for c in class_ids if c in current and current[c] != pattern_id}
    add = {c for c in class_ids if current.get(c) != pattern_id}
    return clear, add


def plan_read(
    found: list[dict],
    class_ids: list[UUID],
    assigned: set[UUID],
    names_on_file: set[str],
) -> tuple[list[tuple[str, int, int, list[UUID]]], int]:
    """What a read pattern file adds to the show: each pattern's name, pages
    and the classes to attach, and how many classes it named that already had
    a pattern.

    `found` is `extraction.patterns.clean_patterns`' list, its classes indexes
    into `class_ids`. **A class the office already attached keeps its
    pattern** -- the read files new patterns and fills the gaps, and never
    undoes somebody's choice. A name already on file is numbered, since names
    are unique per show.
    """
    taken = {name_key(n) for n in names_on_file}
    plan: list[tuple[str, int, int, list[UUID]]] = []
    kept = 0
    for p in found:
        name = numbered(normalize_name(p["name"]) or "Pattern", taken)
        taken.add(name_key(name))
        attach = []
        for i in p["classes"]:
            if class_ids[i] in assigned:
                kept += 1
            else:
                attach.append(class_ids[i])
        plan.append((name, p["first_page"], p["last_page"], attach))
    return plan, kept


def pattern_sort_key(name: str, first_position: Optional[int]) -> tuple:
    """Patterns in the order their first class runs, so the list reads like the
    schedule. A pattern running no class yet goes last, alphabetically."""
    return (first_position is None, first_position or 0, name.lower())


def download_filename(name: str, mime_type: str) -> str:
    """Saved as the pattern's name, not the uploader's: "Trail Pattern.jpg"
    is findable in a Downloads folder, "IMG_4431.jpg" is not."""
    return f"{name}{_EXTENSIONS.get(mime_type, '')}"


def content_disposition(disposition: str, filename: str) -> str:
    """A Content-Disposition header that survives any name.

    Headers go out as latin-1, so a name with an en dash or an accent would 500
    the download if it were written in raw. The plain `filename` is an ASCII
    fallback; `filename*` carries the real name for every current browser.
    """
    fallback = filename.encode("ascii", "ignore").decode("ascii")
    fallback = re.sub(r'[\x00-\x1f\x7f"\\]', "_", fallback).strip() or "pattern"
    return f"{disposition}; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


# ── Reads ─────────────────────────────────────────────────────────────────────

async def _get_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def _load_patterns(
    show_id: UUID, db: AsyncSession, only: Optional[UUID] = None
) -> list[dict]:
    """The show's patterns with their classes, in schedule order. No bytes."""
    query = select(*_META_COLUMNS).where(ShowPattern.show_id == show_id)
    if only is not None:
        query = query.where(ShowPattern.id == only)
    rows = (await db.execute(query)).mappings().all()
    patterns = {row["id"]: {**dict(row), "classes": []} for row in rows}
    if not patterns:
        return []

    # `Class.show_id` as well as the pattern: the router keeps the two on one
    # show, and a row that somehow was not must not print another show's class.
    assigned = await db.execute(
        select(
            ShowPatternClass.pattern_id,
            Class.id,
            Class.class_number,
            Class.class_name,
            Class.class_date,
        )
        .join(Class, Class.id == ShowPatternClass.class_id)
        .where(ShowPatternClass.pattern_id.in_(patterns.keys()))
        .where(Class.show_id == show_id)
        .order_by(Class.class_date, Class.sort_order.nullslast(), Class.class_number)
    )
    first_position: dict[UUID, int] = {}
    for position, (pattern_id, class_id, number, class_name, day) in enumerate(assigned.all()):
        patterns[pattern_id]["classes"].append(
            {"id": class_id, "class_number": number, "class_name": class_name, "class_date": day}
        )
        first_position.setdefault(pattern_id, position)

    return sorted(
        patterns.values(),
        key=lambda p: pattern_sort_key(p["name"], first_position.get(p["id"])),
    )


async def _load_one(show_id: UUID, pattern_id: UUID, db: AsyncSession) -> dict:
    loaded = await _load_patterns(show_id, db, only=pattern_id)
    if not loaded:
        raise HTTPException(404, "Pattern not found")
    return loaded[0]


async def _assert_pattern_exists(show_id: UUID, pattern_id: UUID, db: AsyncSession) -> None:
    found = await db.execute(
        select(ShowPattern.id).where(
            ShowPattern.id == pattern_id, ShowPattern.show_id == show_id
        )
    )
    if found.scalar_one_or_none() is None:
        raise HTTPException(404, "Pattern not found")


async def _assert_name_free(
    show_id: UUID, name: str, db: AsyncSession, exclude: Optional[UUID] = None
) -> None:
    query = select(ShowPattern.id).where(
        ShowPattern.show_id == show_id,
        func.lower(func.btrim(ShowPattern.name)) == name_key(name),
    )
    if exclude is not None:
        query = query.where(ShowPattern.id != exclude)
    if (await db.execute(query)).first():
        raise HTTPException(409, _name_taken(name))


def _name_taken(name: str) -> str:
    return (
        f"A pattern called “{name}” is already on file for this show. "
        "Replace its file instead, or give this one a different name."
    )


def _checked_name(raw: Optional[str], fallback: Optional[str] = None) -> str:
    name = normalize_name(raw) or fallback
    if not name:
        raise HTTPException(422, "A pattern needs a name -- it is what exhibitors look for.")
    if len(name) > MAX_NAME_CHARS:
        raise HTTPException(422, f"Keep the name to {MAX_NAME_CHARS} characters.")
    return name


def _checked_notes(raw: Optional[str]) -> Optional[str]:
    notes = normalize_notes(raw)
    if notes and len(notes) > MAX_NOTES_CHARS:
        raise HTTPException(422, f"Keep the notes to {MAX_NOTES_CHARS} characters.")
    return notes


@router.get("", response_model=list[ShowPatternOut])
async def list_patterns(show_id: UUID, db: AsyncSession = Depends(get_db)):
    """Every pattern on file for the show, with the classes each one runs.

    Public, and not gated on show status, for the reason the show bill is not:
    it names files rather than quoting prices, and the office's own screen
    needs it while the show is still being set up.
    """
    await _get_show_or_404(show_id, db)
    return await _load_patterns(show_id, db)


@router.get("/{pattern_id}/file")
async def download_pattern(
    show_id: UUID,
    pattern_id: UUID,
    download: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """The pattern itself. Public, like the list it is opened from."""
    result = await db.execute(
        select(ShowPattern.name, ShowPattern.mime_type, ShowPattern.file_data).where(
            ShowPattern.id == pattern_id, ShowPattern.show_id == show_id
        )
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(404, "Pattern not found")

    name, mime_type, data = row
    return Response(
        content=data,
        media_type=mime_type,
        headers={
            "Content-Disposition": content_disposition(
                "attachment" if download else "inline", download_filename(name, mime_type)
            ),
            # Revalidate every time. A judge can change a pattern an hour before
            # the class, and a phone holding Thursday's copy is exactly the
            # second-copy hazard this table was argued against with.
            "Cache-Control": "no-cache",
        },
    )


# ── Writes: the show office ──────────────────────────────────────────────────

@router.post(
    "",
    response_model=ShowPatternOut,
    status_code=201,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def upload_pattern(
    show_id: UUID,
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Put a pattern on file. Assigning it to classes is a second press."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)

    content = await file.read()
    mime = validate_upload(content)
    clean_name = _checked_name(name, fallback=name_from_filename(file.filename) or "Pattern")
    clean_notes = _checked_notes(notes)
    await _assert_name_free(show_id, clean_name, db)

    pattern_id = uuid4()
    db.add(
        ShowPattern(
            id=pattern_id,
            show_id=show_id,
            name=clean_name,
            notes=clean_notes,
            original_filename=file.filename or "pattern",
            file_data=content,
            mime_type=mime,
            file_size=len(content),
            uploaded_by_user_id=safe_uuid(x_user_id),
        )
    )
    try:
        await db.commit()
    except IntegrityError:
        # Two uploads with one name at the same moment -- the index caught what
        # the check above could not.
        await db.rollback()
        raise HTTPException(409, _name_taken(clean_name))

    return await _load_one(show_id, pattern_id, db)


@router.post(
    "/read",
    response_model=ShowPatternReadOut,
    status_code=201,
    dependencies=[
        Depends(require_admin_or_show_admin),
        Depends(require_show_feature(PATTERN_READING)),
    ],
)
@_limiter.limit("20/hour")
async def read_patterns_file(
    request: Request,
    show_id: UUID,
    file: UploadFile = File(...),
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Read an uploaded pattern file -- one pattern or the whole book -- and
    put each pattern in it on file, attached to the classes that run it
    (GaitDesk Pro). Each is saved as `POST ""` would save it, cut to its own
    pages; the classes it is given are those its heading names that have no
    pattern yet (`plan_read`). Takes a minute or two: the read is one model
    call, made while the request waits.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _get_show_or_404(show_id, db)
    content = await file.read()
    mime = validate_upload(content)

    classes = (
        await db.execute(
            select(
                Class.id,
                Class.class_number,
                Class.class_name,
                Discipline.name.label("discipline"),
                Division.name.label("division"),
            )
            .outerjoin(Discipline, Discipline.id == Class.discipline_id)
            .outerjoin(Division, Division.id == Class.division_id)
            .where(Class.show_id == show_id)
            .order_by(Class.class_date, Class.sort_order.nullslast(), Class.class_number)
        )
    ).mappings().all()
    # The database session is not held across the read, which takes minutes.
    await db.commit()

    result = await read_patterns(content, mime, file.filename or "patterns", [dict(c) for c in classes])
    if not result.succeeded:
        raise HTTPException(502 if result.status == "failed" else 422, result.error_message)
    found = result.fields["patterns"]
    if not found:
        raise HTTPException(
            422, "No patterns were found in that file. Add it as a single pattern below instead."
        )

    names_on_file = set((await db.execute(select(ShowPattern.name).where(ShowPattern.show_id == show_id))).scalars())
    assigned = set(
        (
            await db.execute(
                select(ShowPatternClass.class_id)
                .join(Class, Class.id == ShowPatternClass.class_id)
                .where(Class.show_id == show_id)
            )
        ).scalars()
    )
    plan, kept = plan_read(found, [c["id"] for c in classes], assigned, names_on_file)

    added: list[UUID] = []
    attached = 0
    stem = (file.filename or "patterns").rsplit(".", 1)[0]
    for name, first, last, class_ids in plan:
        data = await asyncio.to_thread(pattern_file, content, mime, first, last)
        if data is None:
            continue
        pages = f"p{first}" if first == last else f"pp{first}-{last}"
        pattern_id = uuid4()
        db.add(
            ShowPattern(
                id=pattern_id,
                show_id=show_id,
                name=name,
                # Where it came from ("Patterns p6.pdf"); an image is its own file.
                original_filename=f"{stem} {pages}.pdf" if mime == "application/pdf" else (file.filename or "pattern"),
                file_data=data,
                mime_type=mime,
                file_size=len(data),
                uploaded_by_user_id=safe_uuid(x_user_id),
            )
        )
        await db.flush()
        for class_id in class_ids:
            db.add(ShowPatternClass(class_id=class_id, pattern_id=pattern_id))
        attached += len(class_ids)
        added.append(pattern_id)

    try:
        await db.commit()
    except IntegrityError:
        # A pattern of the same name, or an attachment to the same class, made
        # by somebody else while the file was being read.
        await db.rollback()
        raise HTTPException(
            409, "The patterns changed while that file was being read. Reload and try again."
        )
    logger.info(
        "pattern reading: show %s, %s patterns, %s classes, %s in / %s out tokens (%s)",
        show_id, len(added), attached, result.input_tokens, result.output_tokens, result.model,
    )
    return ShowPatternReadOut(
        patterns=await _load_patterns(show_id, db), added=added, assigned=attached, kept=kept
    )


@router.patch(
    "/{pattern_id}",
    response_model=ShowPatternOut,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def update_pattern(
    show_id: UUID,
    pattern_id: UUID,
    body: ShowPatternUpdate,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Rename a pattern or change its notes. Leaves the file and its date alone."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _assert_pattern_exists(show_id, pattern_id, db)

    values: dict = {}
    if "name" in body.model_fields_set:
        values["name"] = _checked_name(body.name)
        await _assert_name_free(show_id, values["name"], db, exclude=pattern_id)
    if "notes" in body.model_fields_set:
        values["notes"] = _checked_notes(body.notes)

    if values:
        await db.execute(
            update(ShowPattern).where(ShowPattern.id == pattern_id).values(**values)
        )
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(409, _name_taken(values.get("name", "")))

    return await _load_one(show_id, pattern_id, db)


@router.put(
    "/{pattern_id}/file",
    response_model=ShowPatternOut,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def replace_pattern_file(
    show_id: UUID,
    pattern_id: UUID,
    file: UploadFile = File(...),
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Replace the file -- the judge changed the pattern.

    The row, its name and its classes stay; `file_uploaded_at` moves, and that
    date is what tells anybody who read the old one that it changed. Deleting
    and re-uploading would lose the class assignments and look like a new
    pattern rather than a changed one.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    await _assert_pattern_exists(show_id, pattern_id, db)

    content = await file.read()
    mime = validate_upload(content)
    await db.execute(
        update(ShowPattern)
        .where(ShowPattern.id == pattern_id)
        .values(
            file_data=content,
            mime_type=mime,
            file_size=len(content),
            original_filename=file.filename or "pattern",
            uploaded_by_user_id=safe_uuid(x_user_id),
            file_uploaded_at=func.now(),
        )
    )
    await db.commit()
    return await _load_one(show_id, pattern_id, db)


@router.put(
    "/assignments",
    response_model=list[ShowPatternOut],
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def assign_classes(
    show_id: UUID,
    body: ShowPatternAssignment,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Point classes at a pattern, or at none.

    One class from its row on the class list, or every class in a discipline
    from the group's "set all". A class runs one pattern, so this replaces
    whatever each class ran before. Returns **every** pattern, because the ones
    these classes left have changed too.
    """
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    if body.pattern_id is not None:
        await _assert_pattern_exists(show_id, body.pattern_id, db)

    wanted = set(body.class_ids)
    found = set(
        (
            await db.execute(
                select(Class.id).where(Class.show_id == show_id, Class.id.in_(wanted))
            )
        )
        .scalars()
        .all()
    )
    missing = wanted - found
    if missing:
        raise HTTPException(422, f"{len(missing)} of those classes are not in this show.")

    current = dict(
        (
            await db.execute(
                select(ShowPatternClass.class_id, ShowPatternClass.pattern_id).where(
                    ShowPatternClass.class_id.in_(wanted)
                )
            )
        ).all()
    )
    clear, add = plan_assignment(wanted, body.pattern_id, current)

    if clear:
        await db.execute(delete(ShowPatternClass).where(ShowPatternClass.class_id.in_(clear)))
    for class_id in add:
        db.add(ShowPatternClass(class_id=class_id, pattern_id=body.pattern_id))

    try:
        await db.commit()
    except IntegrityError:
        # Two people setting the same class at once; the key caught it.
        await db.rollback()
        raise HTTPException(
            409, "Somebody changed that class at the same moment. Reload and try again."
        )

    return await _load_patterns(show_id, db)


@router.delete(
    "/{pattern_id}",
    status_code=204,
    dependencies=[Depends(require_admin_or_show_admin)],
)
async def delete_pattern(
    show_id: UUID,
    pattern_id: UUID,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Take a pattern off file. Its classes go back to having none."""
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    result = await db.execute(
        delete(ShowPattern).where(
            ShowPattern.id == pattern_id, ShowPattern.show_id == show_id
        )
    )
    if result.rowcount == 0:
        raise HTTPException(404, "Pattern not found")
    await db.commit()
    return Response(status_code=204)
