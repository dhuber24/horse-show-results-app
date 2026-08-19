from fastapi import APIRouter, Depends, HTTPException, Header, Request, UploadFile, File, Form
from fastapi.responses import Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from typing import Any, Optional
from datetime import date, timedelta
from uuid import UUID

from database import get_db
from dependencies import require_authenticated, safe_uuid
from extraction import extract_horse_document, extraction_available
from models import DocumentExtraction, Horse, HorseDocument, Exhibitor
from schemas import DocumentExtractionOut, HorseDocumentOut

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

VALID_DOC_TYPES = {'COGGINS', 'VACCINATION', 'HEALTH_CERTIFICATE', 'REGISTRATION'}


# --- Health paperwork evaluation --------------------------------------------
# One implementation, shared by the show-office health flags and desk checklist
# (routers/show_office.py), exhibitor self-registration
# (routers/show_registration.py), and the horse card. These used to carry
# separate copies of the same `any()` expression, which is how they drifted
# from each other.
#
# This **classifies**; it does not gate. Coggins standing used to be a hard stop
# on entry, and no longer is - see the module docstring in
# `routers/show_office.py` for why the block became a flag.
#
# Three documents are evaluated, but only against what a show says it wants
# (migration 097). Coggins is universal; a Certificate of Veterinary Inspection
# follows from crossing a state line and vaccination rules come from the venue.
# A flat "no CVI on file" flag would light up every in-state horse at every
# show, and staff would stop reading the panel - so the show states its rules
# and this answers against them.

HEALTH_VALID = "valid"
HEALTH_MISSING = "missing"
HEALTH_UNDATED = "undated"
HEALTH_EXPIRED = "expired"

# The Coggins-only names this module used to export. Kept as aliases because
# they read better at the Coggins-specific call sites that remain.
COGGINS_VALID = HEALTH_VALID
COGGINS_MISSING = HEALTH_MISSING
COGGINS_UNDATED = HEALTH_UNDATED
COGGINS_EXPIRED = HEALTH_EXPIRED

HEALTH_DOCUMENT_TYPES = ("COGGINS", "HEALTH_CERTIFICATE", "VACCINATION")

HEALTH_LABELS = {
    "COGGINS": "Coggins Test (EIA)",
    "HEALTH_CERTIFICATE": "Health Certificate (CVI)",
    "VACCINATION": "Vaccination Records",
}

# The four outcomes, phrased per document for a horse entered in a specific
# show. Written out rather than generated from a template: this is the copy a
# secretary reads while deciding who to telephone, and each document goes wrong
# in its own way. Deliberately date-free - the caller sends `expiry_date`
# alongside so a screen can say "expired Mar 3" without this module guessing at
# a locale or a platform-specific strftime.
HEALTH_SHOW_MESSAGES = {
    "COGGINS": {
        HEALTH_VALID: "Coggins valid through the show",
        HEALTH_MISSING: "No Coggins on file — needed before the show",
        HEALTH_UNDATED: "Coggins on file has no expiration date — needed before the show",
        HEALTH_EXPIRED: "Coggins does not cover the show dates — needs renewing",
    },
    "HEALTH_CERTIFICATE": {
        HEALTH_VALID: "Health certificate valid through the show",
        HEALTH_MISSING: "No health certificate on file — needed before the show",
        HEALTH_UNDATED: "Health certificate on file is undated — needed before the show",
        HEALTH_EXPIRED: "Health certificate will be out of date by the show — needs reissuing",
    },
    "VACCINATION": {
        HEALTH_VALID: "Vaccinations current through the show",
        HEALTH_MISSING: "No vaccination record on file — needed before the show",
        HEALTH_UNDATED: "Vaccination record on file is undated — needed before the show",
        HEALTH_EXPIRED: "Vaccinations will be out of date by the show — needs boosting",
    },
}


# What a screen says when the horse is covered because the office was handed
# the paper, rather than because a document is on file. Deliberately different
# wording from the on-file case: the app is *not* holding this document, and the
# next show — which has not seen it — will flag the horse again.
HEALTH_ATTESTED_MESSAGES = {
    "COGGINS": "Coggins inspected at the show office — valid through the show",
    "HEALTH_CERTIFICATE": "Health certificate inspected at the show office — valid through the show",
    "VACCINATION": "Vaccination record inspected at the show office — current through the show",
}


class HealthRequirement:
    """One health document a show requires, and how long it stays good.

    `valid_days` is counted from the document's issue date and is only a
    fallback: a document that carries its own expiry date is judged on that.
    It is None for Coggins on purpose - how long a negative test is good for is
    a state rule (twelve months in most, six in some) and this app does not know
    which state the horse is standing in. A Coggins must therefore carry its own
    expiry date, which is exactly the behaviour that predates this class.
    """

    __slots__ = ("document_type", "label", "valid_days", "notes")

    def __init__(self, document_type: str, valid_days: Optional[int] = None,
                 notes: Optional[str] = None) -> None:
        self.document_type = document_type
        self.label = HEALTH_LABELS[document_type]
        self.valid_days = valid_days
        self.notes = notes


# Which show column carries each document's validity window, and what to fall
# back on for a show row that predates migration 097.
_VALIDITY_WINDOWS = {
    "HEALTH_CERTIFICATE": ("health_certificate_valid_days", 30),
    "VACCINATION": ("vaccination_valid_days", 365),
}


def requirement_for(show, document_type: str) -> "HealthRequirement":
    """This show's rule for one document, whether or not it requires it.

    Separate from `health_requirements` because the office can sign off on a
    paper the show does not ask for — someone hands over a health certificate
    at an in-state show and there is no reason to refuse to record it. The
    validity window still has to come from the show, or the sign-off would be
    held against a different rule than the flag beside it.
    """
    if document_type == "COGGINS":
        return HealthRequirement("COGGINS")
    attribute, fallback = _VALIDITY_WINDOWS[document_type]
    notes = getattr(show, "vaccination_notes", None) if document_type == "VACCINATION" else None
    return HealthRequirement(document_type, getattr(show, attribute, fallback), notes)


def health_requirements(show) -> list["HealthRequirement"]:
    """What this show asks for, in the order the office checks it."""
    required = []
    if getattr(show, "requires_coggins", True):
        required.append("COGGINS")
    if getattr(show, "requires_health_certificate", False):
        required.append("HEALTH_CERTIFICATE")
    if getattr(show, "requires_vaccination", False):
        required.append("VACCINATION")
    return [requirement_for(show, document_type) for document_type in required]


def effective_expiry(
    issue_date: Optional[date], expiry_date: Optional[date], valid_days: Optional[int]
) -> Optional[date]:
    """The day this document stops covering the horse, or None if it cannot say.

    An expiry printed on the document always wins. Otherwise the show's window
    is counted from the issue date, because that is how these papers are
    actually written - a CVI is "issued within 30 days", not "expires on".
    """
    if expiry_date is not None:
        return expiry_date
    if issue_date is not None and valid_days:
        return issue_date + timedelta(days=valid_days)
    return None


def health_status(expiry_dates: list[Optional[date]], as_of: Optional[date] = None) -> str:
    """Classify one kind of paperwork from the effective expiry dates on file.

    A document covers a horse only when it carries a date that has not passed.
    An undated row is deliberately **not** valid: with no date there is nothing
    to verify.

    `as_of` is the day the paperwork has to be good for. It defaults to today -
    right for "is this horse's record in order now?" on the profile - but the
    show office passes the **last day of the show**, because a Coggins that
    lapses the week before the show is the exact case staff need to chase, and
    evaluating it against today would call it valid until it was too late.
    """
    if not expiry_dates:
        return HEALTH_MISSING
    as_of = as_of or date.today()
    if any(d is not None and d >= as_of for d in expiry_dates):
        return HEALTH_VALID
    # Report the undated case ahead of the expired one: it names the fixable
    # data problem, where "expired" would send the exhibitor after a new test
    # they may not actually need.
    if any(d is None for d in expiry_dates):
        return HEALTH_UNDATED
    return HEALTH_EXPIRED


def coggins_status(expiry_dates: list[Optional[date]], as_of: Optional[date] = None) -> str:
    """This horse's Coggins standing. The Coggins-shaped door onto
    `health_status`, kept because several call sites only ever ask about it."""
    return health_status(expiry_dates, as_of)


def latest_expiry(expiry_dates: list[Optional[date]]) -> Optional[date]:
    """The furthest-out expiry on file, or None when nothing is dated.

    Paired with the status so a screen can name the date it is complaining
    about; on its own it says nothing about whether the horse is covered.
    """
    dated = [d for d in expiry_dates if d is not None]
    return max(dated) if dated else None


async def load_health_documents(
    horse_ids: list[UUID], document_types: list[str], db: AsyncSession
) -> dict[UUID, dict[str, list[tuple[Optional[date], Optional[date]]]]]:
    """Issue/expiry pairs per horse per document type.

    Every requested id gets an entry so callers can tell "no documents" apart
    from "horse not asked about" without a second lookup. One query for all the
    types a show requires, rather than one per type - the desk asks about every
    horse on the grounds at once.
    """
    loaded: dict[UUID, dict[str, list[tuple[Optional[date], Optional[date]]]]] = {
        hid: {doc_type: [] for doc_type in document_types} for hid in horse_ids
    }
    if not horse_ids or not document_types:
        return loaded
    result = await db.execute(
        select(
            HorseDocument.horse_id,
            HorseDocument.document_type,
            HorseDocument.issue_date,
            HorseDocument.expiry_date,
        ).where(
            HorseDocument.horse_id.in_(horse_ids),
            HorseDocument.document_type.in_(document_types),
        )
    )
    for horse_id, document_type, issue_date, expiry_date in result.all():
        by_type = loaded.setdefault(horse_id, {doc_type: [] for doc_type in document_types})
        by_type.setdefault(document_type, []).append((issue_date, expiry_date))
    return loaded


def document_health(
    requirement: HealthRequirement,
    documents: list[tuple[Optional[date], Optional[date]]],
    as_of: Optional[date] = None,
) -> dict:
    """One horse's standing on one document, in the shape every screen renders.

    Shared so the exhibitor's registration screen and the show office's flag
    list can never disagree about a horse - they are looking at the same
    paperwork and, when `as_of` is the show's last day, at the same deadline.
    """
    expiries = [
        effective_expiry(issue_date, expiry_date, requirement.valid_days)
        for issue_date, expiry_date in documents
    ]
    status = health_status(expiries, as_of)
    expiry = latest_expiry(expiries)
    return {
        "code": requirement.document_type,
        "label": requirement.label,
        "status": status,
        "message": HEALTH_SHOW_MESSAGES[requirement.document_type][status],
        "expiry_date": expiry,
        # Flipped by `attested_health` when the office signed off on paper.
        "attested": False,
        # What the *documents on file* said, carried along so a later overlay
        # cannot be mistaken for it. `attested_health` copies this through
        # untouched, which is what keeps the sign-off from snapshotting its own
        # effect and reading back stale the instant it is written.
        "file_snapshot": f"{status}:{expiry.isoformat() if expiry else 'none'}",
        "notes": requirement.notes,
    }


def health_snapshot(check: dict) -> str:
    """What a physical inspection was signed off against, as one string.

    The office attests to a *situation*, not to a row: "I saw a Coggins good
    through May 2027", or "I saw a paper the app has never been shown". Both are
    recordable, which is the point — an exhibitor handing over a physical
    Coggins at the counter is the ordinary case, and a sign-off that required an
    upload would fail exactly there.

    Comparing this snapshot against a freshly derived one is what makes the
    check go stale: upload, replace, or let a document lapse and what the office
    signed no longer describes what is on file.

    Always taken from the **documents on file**, never from the overlay in
    `attested_health`. Snapshotting a value the sign-off itself produces would
    have the two chasing each other in a circle: the check would read back stale
    the instant it was written, and staleness would stop meaning "the file
    changed under me".
    """
    carried = check.get("file_snapshot")
    if carried is not None:
        return carried
    expiry = check.get("expiry_date")
    return f"{check['status']}:{expiry.isoformat() if expiry else 'none'}"


def attested_health(
    check: dict, attested_expiry: Optional[date], as_of: Optional[date] = None
) -> dict:
    """Fold the office's own inspection into a horse's standing on one document.

    A secretary who has just held a valid negative Coggins in their hands should
    not still be told to go and find it. Until this existed the flag chased
    paperwork the office already had, which is the fastest way to teach staff to
    stop reading a panel.

    Only applied when the documents on file do not already cover the horse, and
    only when the date read off the paper actually covers the show. Recording an
    inspection of an illegible or genuinely lapsed document leaves the horse
    flagged, which is the honest outcome — "I looked at this" and "this is
    valid" are different claims, and collapsing them would let one click clear a
    flag on a test that expired years ago.

    The result is marked `attested` so no screen can imply the app is holding a
    scan it has never been shown.
    """
    if check["status"] == HEALTH_VALID or attested_expiry is None:
        return check
    as_of = as_of or date.today()
    if attested_expiry < as_of:
        return check
    return {
        **check,
        "status": HEALTH_VALID,
        "message": HEALTH_ATTESTED_MESSAGES[check["code"]],
        "expiry_date": attested_expiry,
        "attested": True,
    }


async def load_health_attestations(
    show_id, horse_ids: list[UUID], db: AsyncSession
) -> dict[tuple[UUID, str], date]:
    """Expiry dates this show's office read off paper, per (horse, document).

    Scoped to the one show on purpose, like every other verification: this is
    *this* office attesting it saw the paper, not a property of the horse. A
    horse whose Coggins only ever existed on paper is flagged again at the next
    show, correctly, because that show has not seen it.

    Imported lazily to keep the model import graph one-way — `show_office`
    already imports this module.
    """
    if not horse_ids:
        return {}
    from models import ShowVerification

    result = await db.execute(
        select(
            ShowVerification.horse_id,
            ShowVerification.document_type,
            ShowVerification.attested_expiry,
        ).where(
            ShowVerification.show_id == show_id,
            ShowVerification.kind == "horse_health_document",
            ShowVerification.horse_id.in_(horse_ids),
            ShowVerification.attested_expiry.isnot(None),
        )
    )
    return {
        (horse_id, document_type): attested_expiry
        for horse_id, document_type, attested_expiry in result.all()
    }


def paperwork_deadline(show) -> date:
    """The day a horse's health papers have to still be good for at this show.

    The last day, not the first: a Coggins that lapses on the Saturday of a
    Friday-to-Sunday show does not cover the horse for the whole time it is on
    the grounds. Lives here, with the evaluation it feeds, so the exhibitor's
    registration screen and the show office cannot end up judging the same
    paperwork against two different deadlines.
    """
    return show.end_date or show.start_date


async def health_by_horse(
    horse_ids: list[UUID], show, db: AsyncSession
) -> dict[UUID, list[dict]]:
    """Every health check this show requires, per horse, judged against its
    deadline. A show that requires nothing gets empty lists, not an empty dict -
    callers index by horse id either way.
    """
    requirements = health_requirements(show)
    if not horse_ids:
        return {}
    if not requirements:
        return {horse_id: [] for horse_id in horse_ids}

    documents = await load_health_documents(
        horse_ids, [r.document_type for r in requirements], db
    )
    attestations = await load_health_attestations(show.id, horse_ids, db)
    deadline = paperwork_deadline(show)
    return {
        horse_id: [
            attested_health(
                document_health(
                    requirement,
                    documents.get(horse_id, {}).get(requirement.document_type, []),
                    deadline,
                ),
                attestations.get((horse_id, requirement.document_type)),
                deadline,
            )
            for requirement in requirements
        ]
        for horse_id in horse_ids
    }


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
    inline: bool = False,
    user_id: str = Depends(require_authenticated),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The document itself.

    `inline` serves it for display rather than for saving, which is what the
    registration desk wants: an exhibitor who left the folder at home has still
    uploaded the paper, and staff need to *look* at it beside the sign-off
    checkbox rather than download a copy onto the office laptop. Same bytes,
    same access rules, different Content-Disposition.
    """
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
    disposition = "inline" if inline else "attachment"
    return Response(
        content=doc.file_data,
        media_type=doc.mime_type,
        headers={"Content-Disposition": f'{disposition}; filename="{safe_name}"'},
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
