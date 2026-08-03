"""Seed a valid Coggins (EIA) document for every demo horse.

Entry creation and exhibitor self-registration both hard-require a current
Coggins on file (`_assert_coggins` in routers/show_registration.py, and the same
check inline in routers/entries.py), so seeded horses cannot be entered in
anything until they have one.

`horse_documents.file_data` is a NOT NULL BYTEA and the upload endpoint sniffs
the MIME type from magic bytes rather than trusting the client, so this writes a
genuinely valid one-page PDF per horse — a placeholder blob would store fine but
fail to render when the document is opened.

Idempotent: a horse that already has any COGGINS row is left alone.

Run inside the backend container:

    docker cp scripts/seed_demo_horse_documents.py \
        horse-show-results-app-backend-1:/tmp/seed_demo_horse_documents.py
    docker exec -w /app -e PYTHONPATH=/app horse-show-results-app-backend-1 \
        python /tmp/seed_demo_horse_documents.py
"""

import asyncio
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models import Exhibitor, Horse, HorseDocument, User

# Coggins tests are good for 12 months; issue these part-way through so they are
# comfortably current but not suspiciously fresh.
ISSUED_DAYS_AGO = 90
VALID_DAYS = 365

# Horses are matched to the demo exhibitors by their owner's email domain, so
# this never touches horses that were not created by seed_demo_people.py.
SEED_EMAIL_DOMAIN = "@example.com"

UPLOADER_EMAIL = "admin@horseshow.com"


def _pdf_escape(value: str) -> str:
    return value.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def build_coggins_pdf(horse_name: str, owner_name: str, issued: date, expires: date) -> bytes:
    """A minimal but structurally valid single-page PDF.

    Written by hand rather than pulled from a library: the repo has no PDF
    dependency and this only needs to open, not to look like a real lab form.
    """
    lines = [
        "COGGINS TEST (EIA) - LABORATORY REPORT",
        "",
        "*** SAMPLE DOCUMENT - DEMO DATA, NOT A REAL TEST RESULT ***",
        "",
        f"Horse:      {horse_name}",
        f"Owner:      {owner_name}",
        f"Test date:  {issued.isoformat()}",
        f"Expires:    {expires.isoformat()}",
        "Result:     NEGATIVE",
    ]

    text_ops = ["BT", "/F1 12 Tf", "72 720 Td", "16 TL"]
    for line in lines:
        text_ops.append(f"({_pdf_escape(line)}) Tj T*")
    text_ops.append("ET")
    stream = "\n".join(text_ops).encode("latin-1")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"

    xref_offset = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n"
    ).encode()

    return bytes(out)


async def seed(db: AsyncSession) -> None:
    uploader = (
        await db.execute(select(User).where(func.lower(User.email) == UPLOADER_EMAIL))
    ).scalar_one_or_none()

    horses = (await db.execute(
        select(Horse)
        .join(Exhibitor, Exhibitor.id == Horse.owner_exhibitor_id)
        .join(User, User.id == Exhibitor.user_id)
        .where(func.lower(User.email).like(f"%{SEED_EMAIL_DOMAIN}"))
        .order_by(Horse.name)
    )).scalars().all()

    issued = date.today() - timedelta(days=ISSUED_DAYS_AGO)
    expires = issued + timedelta(days=VALID_DAYS)

    created = 0
    skipped = []
    for horse in horses:
        existing = (await db.execute(
            select(HorseDocument.id).where(
                HorseDocument.horse_id == horse.id,
                HorseDocument.document_type == "COGGINS",
            )
        )).first()
        if existing:
            skipped.append(horse.name)
            continue

        pdf = build_coggins_pdf(
            horse.name, horse.owner_name or "Owner", issued, expires
        )
        db.add(HorseDocument(
            horse_id=horse.id,
            document_type="COGGINS",
            original_filename=f"coggins-{horse.name.lower().replace(' ', '-')}.pdf",
            file_data=pdf,
            mime_type="application/pdf",
            file_size=len(pdf),
            issue_date=issued,
            expiry_date=expires,
            uploaded_by_user_id=uploader.id if uploader else None,
        ))
        created += 1
        print(f"  {horse.name:<26} issued {issued} expires {expires} ({len(pdf)} bytes)")

    await db.commit()

    print(f"\nCreated {created} Coggins documents (valid through {expires}).")
    if skipped:
        print(f"Skipped (already had one): {', '.join(skipped)}")


async def main() -> None:
    async with AsyncSessionLocal() as db:
        await seed(db)


if __name__ == "__main__":
    asyncio.run(main())
