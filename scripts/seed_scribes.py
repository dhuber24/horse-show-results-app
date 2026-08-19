"""Seed SCRIBE login accounts and assign them to the existing shows.

Additive counterpart to `seed_test_shows.py`, which reuses staff accounts by
email but never creates them. Migration 093 renamed SCOREKEEPER to SCRIBE and
no account in the database held the old role, so there was nobody to walk the
score-entry path with — this creates them.

Two accounts, because the interesting states are different:

    user@scribe.com   — assigned to every show. This is the one to log in as.
                        The backend hides DRAFT shows from scribes, so they see
                        the ACTIVE and PUBLISHED ones.
    scribe2@test.com  — deliberately assigned to nothing, so the "you haven't
                        been assigned to any shows yet" empty state on /scribe
                        can be checked without unpicking the first account.

Note that show assignment controls *visibility*, not permission:
`require_admin_or_scribe` checks the role alone, so an assigned show is what a
scribe can find, not the limit of what they could score.

Idempotent: accounts are keyed by email and assignments by (show, user), so
re-running adds only what is missing. Non-destructive — unlike
`seed_test_shows.py`, this deletes nothing.

Run inside the backend container (it has the deps and DATABASE_URL):

    docker cp scripts/seed_scribes.py horse-show-results-app-backend-1:/tmp/seed_scribes.py
    docker exec -w /app -e PYTHONPATH=/app horse-show-results-app-backend-1 \
        python /tmp/seed_scribes.py
"""

import asyncio
import sys

import bcrypt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models import Show, ShowScribe, User

# Same password as the other seed scripts, so the test cast shares one login.
SEED_PASSWORD = "12345678"

# (email, first_name, last_name, assign_to_shows)
SCRIBES = [
    ("user@scribe.com", "Show", "Scribe", True),
    ("scribe2@test.com", "Second", "Scribe", False),
]


async def _user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(
        select(User).where(func.lower(User.email) == email.lower())
    )
    return result.scalar_one_or_none()


async def seed(db: AsyncSession) -> None:
    hashed = bcrypt.hashpw(SEED_PASSWORD.encode(), bcrypt.gensalt()).decode()

    shows = (await db.execute(select(Show).order_by(Show.start_date))).scalars().all()
    if not shows:
        print("! no shows found — run seed_test_shows.py first")

    for email, first_name, last_name, assign in SCRIBES:
        user = await _user_by_email(db, email)

        if user is None:
            # full_name is derived from first/last by a mapper event, so it is
            # deliberately not passed here.
            user = User(
                email=email,
                first_name=first_name,
                last_name=last_name,
                role="SCRIBE",
                hashed_password=hashed,
                is_approved=True,
            )
            db.add(user)
            await db.flush()
            print(f"created  {email} ({user.full_name}) role=SCRIBE")
        elif user.role != "SCRIBE":
            # An account left on the pre-093 role would fail the check
            # constraint on any later write; move it rather than skipping it.
            print(f"repoint  {email} role={user.role} -> SCRIBE")
            user.role = "SCRIBE"
            await db.flush()
        else:
            print(f"exists   {email} ({user.full_name})")

        if not assign:
            print("         (intentionally unassigned — empty-state fixture)")
            continue

        for show in shows:
            already = await db.execute(
                select(ShowScribe).where(
                    ShowScribe.show_id == show.id,
                    ShowScribe.user_id == user.id,
                )
            )
            if already.scalar_one_or_none():
                print(f"         already assigned to {show.name}")
                continue
            db.add(ShowScribe(show_id=show.id, user_id=user.id))
            print(f"         assigned to {show.name} [{show.status}]")

    await db.commit()
    print(f"\nAll seeded scribe accounts use password: {SEED_PASSWORD}")


async def main() -> None:
    async with AsyncSessionLocal() as db:
        await seed(db)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(1)
