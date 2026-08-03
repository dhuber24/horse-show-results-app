"""Seed demo people: 5 trainers, 10 exhibitors, and 10 horses.

Creates full login accounts (User + linked Exhibitor / Trainer row, per the
sharp edges in CLAUDE.md), one horse per exhibitor with that exhibitor as
owner, and a randomly-but-deterministically assigned trainer on each horse.

Every seeded account shares the password in SEED_PASSWORD below.

Idempotent: rows are keyed by email (people) and registered name (horses), so
re-running skips anything already present.

Run inside the backend container (it has the deps and DATABASE_URL):

    docker cp scripts/seed_demo_people.py horse-show-results-app-backend-1:/tmp/seed_demo_people.py
    docker exec -w /app -e PYTHONPATH=/app horse-show-results-app-backend-1 \
        python /tmp/seed_demo_people.py
"""

import asyncio
import random
import sys
from datetime import date

import bcrypt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models import (
    Association,
    Breed,
    Exhibitor,
    ExhibitorHorse,
    ExhibitorRegistration,
    Horse,
    HorseColor,
    HorseRegistration,
    Trainer,
    TrainerRegistration,
    User,
)

SEED_PASSWORD = "12345678"

# Deterministic trainer assignment so re-runs and fresh databases agree.
RNG_SEED = 20260801


TRAINERS = [
    {
        "first_name": "Marla",
        "last_name": "Vandenberg",
        "email": "marla.vandenberg@example.com",
        "private_phone": "(507) 555-0142",
        "phone": "(507) 555-0143",
        "business_name": "Vandenberg Performance Horses",
        "city": "Owatonna",
        "state": "MN",
        "website": "https://vandenbergperformance.example.com",
        "bio": "Ranch riding and western pleasure programs for youth and amateur riders. AQHA Professional Horseman since 2011.",
        "social_facebook": "vandenbergperformance",
        "social_instagram": "vandenberg_performance",
        "is_public": True,
        "safesport_completed_at": date(2026, 2, 14),
        "background_check_expires_at": date(2027, 2, 14),
        "has_liability_insurance": True,
        "registrations": [("AQHA", "T1140832", "professional", date(2026, 12, 31))],
    },
    {
        "first_name": "Colton",
        "last_name": "Reyes",
        "email": "colton.reyes@example.com",
        "private_phone": "(605) 555-0188",
        "phone": None,
        "business_name": "Reyes Ranch Horses",
        "city": "Brookings",
        "state": "SD",
        "website": None,
        "bio": "Started colts and ranch versatility horses. Small barn, hands-on program.",
        "social_facebook": None,
        "social_instagram": "reyesranchhorses",
        "is_public": True,
        "safesport_completed_at": date(2025, 11, 3),
        "background_check_expires_at": date(2026, 11, 3),
        "has_liability_insurance": True,
        "registrations": [("AQHA", "T1177401", "professional", date(2026, 12, 31))],
    },
    {
        "first_name": "Priya",
        "last_name": "Nakamura",
        "email": "priya.nakamura@example.com",
        "private_phone": "(715) 555-0119",
        "phone": "(715) 555-0120",
        "business_name": "Stillwater Show Stable",
        "city": "Hudson",
        "state": "WI",
        "website": "https://stillwatershowstable.example.com",
        "bio": "All-around show barn focused on horsemanship, showmanship, and trail.",
        "social_facebook": "stillwatershowstable",
        "social_instagram": "stillwater_show",
        "social_tiktok": "stillwatershow",
        "is_public": True,
        "safesport_completed_at": date(2026, 1, 22),
        "background_check_expires_at": date(2027, 1, 22),
        "has_liability_insurance": True,
        "registrations": [
            ("APHA", "T0448219", "professional", date(2026, 12, 31)),
            ("NSBA", "N228104", "general", date(2026, 12, 31)),
        ],
    },
    {
        "first_name": "Dale",
        "last_name": "Ostrander",
        "email": "dale.ostrander@example.com",
        "private_phone": "(701) 555-0166",
        "phone": None,
        "business_name": None,
        "city": "Jamestown",
        "state": "ND",
        "website": None,
        "bio": None,
        "social_facebook": None,
        "social_instagram": None,
        "is_public": False,
        "safesport_completed_at": None,
        "background_check_expires_at": None,
        "has_liability_insurance": False,
        "registrations": [("AQHA", "T1093556", "non_pro", None)],
    },
    {
        "first_name": "Bethany",
        "last_name": "Kroll",
        "email": "bethany.kroll@example.com",
        "private_phone": "(319) 555-0173",
        "phone": "(319) 555-0174",
        "business_name": "Kroll Show Horses",
        "city": "Cedar Falls",
        "state": "IA",
        "website": "https://krollshowhorses.example.com",
        "bio": "Western pleasure and hunter under saddle. Coaching youth and amateurs at breed and open shows.",
        "social_facebook": "krollshowhorses",
        "social_instagram": "kroll_show_horses",
        "is_public": True,
        "safesport_completed_at": date(2026, 3, 8),
        "background_check_expires_at": date(2027, 3, 8),
        "has_liability_insurance": True,
        "registrations": [
            ("AQHA", "T1201884", "professional", date(2026, 12, 31)),
            ("NSBA", "N231770", "general", date(2026, 12, 31)),
        ],
    },
]


EXHIBITORS = [
    {
        "first_name": "Hannah",
        "last_name": "Wexler",
        "email": "hannah.wexler@example.com",
        "date_of_birth": date(2009, 4, 17),
        "phone": "(507) 555-0201",
        "address": "1284 Elm Creek Rd",
        "city": "Faribault",
        "state": "MN",
        "zip": "55021",
        "emergency_contact_name": "Renee Wexler",
        "emergency_contact_phone": "(507) 555-0202",
        "parent_guardian_name": "Renee Wexler",
        "parent_guardian_phone": "(507) 555-0202",
        "registrations": [("AQHA", "8841027")],
    },
    {
        "first_name": "Owen",
        "last_name": "Brandt",
        "email": "owen.brandt@example.com",
        "date_of_birth": date(2007, 9, 2),
        "phone": "(605) 555-0210",
        "address": "77 County Road 14",
        "city": "Volga",
        "state": "SD",
        "zip": "57071",
        "emergency_contact_name": "Trish Brandt",
        "emergency_contact_phone": "(605) 555-0211",
        "parent_guardian_name": "Trish Brandt",
        "parent_guardian_phone": "(605) 555-0211",
        "registrations": [("AQHA", "8790554")],
    },
    {
        "first_name": "Sofia",
        "last_name": "Delgado",
        "email": "sofia.delgado@example.com",
        "date_of_birth": date(1991, 6, 30),
        "phone": "(715) 555-0222",
        "address": "3902 Birchwood Ln",
        "city": "River Falls",
        "state": "WI",
        "zip": "54022",
        "emergency_contact_name": "Marco Delgado",
        "emergency_contact_phone": "(715) 555-0223",
        "amateur_card_number": "A4471902",
        "amateur_card_expiry": date(2026, 12, 31),
        "registrations": [("APHA", "0339184"), ("NSBA", "228611")],
    },
    {
        "first_name": "Grant",
        "last_name": "Halvorsen",
        "email": "grant.halvorsen@example.com",
        "date_of_birth": date(1984, 1, 12),
        "phone": "(701) 555-0234",
        "address": "615 Prairie View Dr",
        "city": "Valley City",
        "state": "ND",
        "zip": "58072",
        "emergency_contact_name": "Kayla Halvorsen",
        "emergency_contact_phone": "(701) 555-0235",
        "amateur_card_number": "A4388120",
        "amateur_card_expiry": date(2026, 12, 31),
        "registrations": [("AQHA", "8612447")],
    },
    {
        "first_name": "Emily",
        "last_name": "Stroud",
        "email": "emily.stroud@example.com",
        "date_of_birth": date(2012, 11, 8),
        "phone": "(319) 555-0246",
        "address": "228 Maple St",
        "city": "Waverly",
        "state": "IA",
        "zip": "50677",
        "emergency_contact_name": "Doug Stroud",
        "emergency_contact_phone": "(319) 555-0247",
        "parent_guardian_name": "Doug Stroud",
        "parent_guardian_phone": "(319) 555-0247",
        "registrations": [("AQHA", "8903318")],
    },
    {
        "first_name": "Marcus",
        "last_name": "Ferriday",
        "email": "marcus.ferriday@example.com",
        "date_of_birth": date(1978, 3, 25),
        "phone": "(507) 555-0258",
        "address": "9040 State Highway 60",
        "city": "Kenyon",
        "state": "MN",
        "zip": "55946",
        "emergency_contact_name": "Lorna Ferriday",
        "emergency_contact_phone": "(507) 555-0259",
        "amateur_card_number": "A4102778",
        "amateur_card_expiry": date(2026, 12, 31),
        "registrations": [("AQHA", "8410992")],
    },
    {
        "first_name": "Jocelyn",
        "last_name": "Abernathy",
        "email": "jocelyn.abernathy@example.com",
        "date_of_birth": date(2005, 7, 19),
        "phone": "(608) 555-0261",
        "address": "412 Dunn Ridge Rd",
        "city": "Mount Horeb",
        "state": "WI",
        "zip": "53572",
        "emergency_contact_name": "Paul Abernathy",
        "emergency_contact_phone": "(608) 555-0262",
        "amateur_card_number": "A4520063",
        "amateur_card_expiry": date(2026, 12, 31),
        "registrations": [("APHA", "0351776")],
    },
    {
        "first_name": "Tyler",
        "last_name": "Okonkwo",
        "email": "tyler.okonkwo@example.com",
        "date_of_birth": date(2010, 2, 5),
        "phone": "(612) 555-0273",
        "address": "1607 Ravine Pkwy",
        "city": "Northfield",
        "state": "MN",
        "zip": "55057",
        "emergency_contact_name": "Adaeze Okonkwo",
        "emergency_contact_phone": "(612) 555-0274",
        "parent_guardian_name": "Adaeze Okonkwo",
        "parent_guardian_phone": "(612) 555-0274",
        "registrations": [("AQHA", "8875213")],
    },
    {
        "first_name": "Rachel",
        "last_name": "Lindqvist",
        "email": "rachel.lindqvist@example.com",
        "date_of_birth": date(1996, 10, 14),
        "phone": "(605) 555-0285",
        "address": "5518 Cottonwood Ave",
        "city": "Sioux Falls",
        "state": "SD",
        "zip": "57108",
        "emergency_contact_name": "Britta Lindqvist",
        "emergency_contact_phone": "(605) 555-0286",
        "amateur_card_number": "A4609411",
        "amateur_card_expiry": date(2026, 12, 31),
        "registrations": [("AQHA", "8722860"), ("NSBA", "230145")],
    },
    {
        "first_name": "Caleb",
        "last_name": "Ruthford",
        "email": "caleb.ruthford@example.com",
        "date_of_birth": date(2008, 12, 21),
        "phone": "(319) 555-0297",
        "address": "88 Sandstone Trail",
        "city": "Independence",
        "state": "IA",
        "zip": "50644",
        "emergency_contact_name": "Melanie Ruthford",
        "emergency_contact_phone": "(319) 555-0298",
        "parent_guardian_name": "Melanie Ruthford",
        "parent_guardian_phone": "(319) 555-0298",
        "registrations": [("APHA", "0347902")],
    },
]


# One horse per exhibitor, in the same order as EXHIBITORS above.
HORSES = [
    {
        "name": "Sheza Lopin Asset",
        "barn_name": "Piper",
        "sire_name": "Lopin For Chocolate",
        "dam_name": "Sheza Certain Asset",
        "foaling_date": date(2018, 4, 3),
        "sex": "Mare",
        "breed": "American Quarter Horse",
        "color": "Sorrel",
        "registration": ("AQHA", "X0771204"),
    },
    {
        "name": "Hot Rod Investment",
        "barn_name": "Rowdy",
        "sire_name": "Investin On Ice",
        "dam_name": "Hot Rod Rosie",
        "foaling_date": date(2016, 5, 18),
        "sex": "Gelding",
        "breed": "American Quarter Horse",
        "color": "Bay",
        "registration": ("AQHA", "X0688431"),
    },
    {
        "name": "Painted In Chrome",
        "barn_name": "Chrome",
        "sire_name": "A Certain Chrome",
        "dam_name": "Painted Sundance",
        "foaling_date": date(2017, 3, 27),
        "sex": "Gelding",
        "breed": "American Paint Horse",
        "color": "Tobiano",
        "registration": ("APHA", "P0912447"),
    },
    {
        "name": "Docs Prairie Cash",
        "barn_name": "Cash",
        "sire_name": "Cash In My Chex",
        "dam_name": "Docs Prairie Rose",
        "foaling_date": date(2014, 6, 9),
        "sex": "Gelding",
        "breed": "American Quarter Horse",
        "color": "Buckskin",
        "registration": ("AQHA", "X0540118"),
    },
    {
        "name": "Simply Irresistable",
        "barn_name": "Sissy",
        "sire_name": "Simply Invited",
        "dam_name": "Irresistably Blue",
        "foaling_date": date(2019, 2, 22),
        "sex": "Mare",
        "breed": "American Quarter Horse",
        "color": "Bay Roan",
        "registration": ("AQHA", "X0803996"),
    },
    {
        "name": "Gunnin For Chocolate",
        "barn_name": "Gunner",
        "sire_name": "Colonels Smoking Gun",
        "dam_name": "Chocolate Chip Chex",
        "foaling_date": date(2013, 4, 30),
        "sex": "Gelding",
        "breed": "American Quarter Horse",
        "color": "Palomino",
        "registration": ("AQHA", "X0491725"),
    },
    {
        "name": "Solid Gold Rumor",
        "barn_name": "Rumor",
        "sire_name": "Only Gold Rumors",
        "dam_name": "Solid As She Goes",
        "foaling_date": date(2018, 5, 11),
        "sex": "Mare",
        "breed": "American Paint Horse",
        "color": "Chestnut",
        "is_solid_paint_bred": True,
        "registration": ("APHA", "P0944013"),
    },
    {
        "name": "Zippos Blue Ribbon",
        "barn_name": "Zip",
        "sire_name": "Zippos Mr Good Bar",
        "dam_name": "Blue Ribbon Belle",
        "foaling_date": date(2015, 3, 14),
        "sex": "Gelding",
        "breed": "American Quarter Horse",
        "color": "Black",
        "registration": ("AQHA", "X0602558"),
    },
    {
        "name": "Frosted Little Lena",
        "barn_name": "Frost",
        "sire_name": "Smart Little Lena",
        "dam_name": "Frosted Dun It",
        "foaling_date": date(2017, 6, 6),
        "sex": "Mare",
        "breed": "American Quarter Horse",
        "color": "Red Dun",
        "registration": ("AQHA", "X0715380"),
    },
    {
        "name": "Dressed To Impress",
        "barn_name": "Dapper",
        "sire_name": "Impressive Dresser",
        "dam_name": "Dressed In Overo",
        "foaling_date": date(2016, 4, 25),
        "sex": "Gelding",
        "breed": "American Paint Horse",
        "color": "Overo",
        "registration": ("APHA", "P0887661"),
    },
]


async def _lookup(db: AsyncSession, model, column, values: set[str]) -> dict[str, object]:
    if not values:
        return {}
    rows = (await db.execute(select(model).where(column.in_(values)))).scalars().all()
    return {getattr(r, column.key): r for r in rows}


async def seed(db: AsyncSession) -> None:
    hashed = bcrypt.hashpw(SEED_PASSWORD.encode(), bcrypt.gensalt()).decode()

    associations = await _lookup(
        db,
        Association,
        Association.code,
        {code for t in TRAINERS for code, *_ in t["registrations"]}
        | {code for e in EXHIBITORS for code, *_ in e["registrations"]}
        | {h["registration"][0] for h in HORSES},
    )
    breeds = await _lookup(db, Breed, Breed.name, {h["breed"] for h in HORSES})
    colors = await _lookup(db, HorseColor, HorseColor.name, {h["color"] for h in HORSES})

    missing: list[str] = []
    for label, wanted, found in (
        (
            "association",
            {code for t in TRAINERS for code, *_ in t["registrations"]}
            | {code for e in EXHIBITORS for code, *_ in e["registrations"]}
            | {h["registration"][0] for h in HORSES},
            associations,
        ),
        ("breed", {h["breed"] for h in HORSES}, breeds),
        ("color", {h["color"] for h in HORSES}, colors),
    ):
        for name in sorted(wanted - set(found)):
            missing.append(f"{label}: {name}")
    if missing:
        sys.exit("Missing lookup rows — seed those first:\n  " + "\n  ".join(missing))

    created = {"trainers": 0, "exhibitors": 0, "horses": 0, "skipped": []}

    # --- Trainers -----------------------------------------------------------
    trainer_rows: list[Trainer] = []
    for spec in TRAINERS:
        existing_user = (
            await db.execute(select(User).where(func.lower(User.email) == spec["email"]))
        ).scalar_one_or_none()
        if existing_user:
            trainer = (
                await db.execute(select(Trainer).where(Trainer.user_id == existing_user.id))
            ).scalar_one_or_none()
            if trainer:
                trainer_rows.append(trainer)
                created["skipped"].append(f"trainer {spec['email']}")
                continue

        user = existing_user or User(
            email=spec["email"],
            first_name=spec["first_name"],
            last_name=spec["last_name"],
            role="TRAINER",
            hashed_password=hashed,
            is_approved=True,
        )
        if not existing_user:
            db.add(user)
            await db.flush()

        trainer = Trainer(
            user_id=user.id,
            first_name=spec["first_name"],
            last_name=spec["last_name"],
            private_phone=spec["private_phone"],
            phone=spec["phone"],
            email=spec["email"],
            business_name=spec["business_name"],
            city=spec["city"],
            state=spec["state"],
            country="US",
            website=spec["website"],
            bio=spec["bio"],
            social_facebook=spec.get("social_facebook"),
            social_instagram=spec.get("social_instagram"),
            social_tiktok=spec.get("social_tiktok"),
            is_public=spec["is_public"],
            safesport_completed_at=spec["safesport_completed_at"],
            background_check_expires_at=spec["background_check_expires_at"],
            has_liability_insurance=spec["has_liability_insurance"],
        )
        db.add(trainer)
        await db.flush()

        for code, number, status, expires_at in spec["registrations"]:
            db.add(TrainerRegistration(
                trainer_id=trainer.id,
                association_id=associations[code].id,
                member_number=number,
                status=status,
                expires_at=expires_at,
            ))

        trainer_rows.append(trainer)
        created["trainers"] += 1

    # --- Exhibitors ---------------------------------------------------------
    exhibitor_rows: list[Exhibitor] = []
    for spec in EXHIBITORS:
        existing_user = (
            await db.execute(select(User).where(func.lower(User.email) == spec["email"]))
        ).scalar_one_or_none()
        if existing_user:
            exhibitor = (
                await db.execute(select(Exhibitor).where(Exhibitor.user_id == existing_user.id))
            ).scalar_one_or_none()
            if exhibitor:
                exhibitor_rows.append(exhibitor)
                created["skipped"].append(f"exhibitor {spec['email']}")
                continue

        full_name = f"{spec['first_name']} {spec['last_name']}"
        user = existing_user or User(
            email=spec["email"],
            first_name=spec["first_name"],
            last_name=spec["last_name"],
            role="EXHIBITOR",
            hashed_password=hashed,
            is_approved=True,
        )
        if not existing_user:
            db.add(user)
            await db.flush()

        exhibitor = Exhibitor(
            user_id=user.id,
            full_name=full_name,
            date_of_birth=spec["date_of_birth"],
            phone=spec["phone"],
            address=spec["address"],
            city=spec["city"],
            state=spec["state"],
            zip=spec["zip"],
            emergency_contact_name=spec["emergency_contact_name"],
            emergency_contact_phone=spec["emergency_contact_phone"],
            parent_guardian_name=spec.get("parent_guardian_name"),
            parent_guardian_phone=spec.get("parent_guardian_phone"),
            amateur_card_number=spec.get("amateur_card_number"),
            amateur_card_expiry=spec.get("amateur_card_expiry"),
        )
        db.add(exhibitor)
        await db.flush()

        for code, number in spec["registrations"]:
            db.add(ExhibitorRegistration(
                exhibitor_id=exhibitor.id,
                association_id=associations[code].id,
                member_number=number,
            ))

        exhibitor_rows.append(exhibitor)
        created["exhibitors"] += 1

    # --- Horses -------------------------------------------------------------
    rng = random.Random(RNG_SEED)
    for spec, exhibitor in zip(HORSES, exhibitor_rows):
        trainer = rng.choice(trainer_rows)

        existing_horse = (
            await db.execute(
                select(Horse).where(
                    Horse.name == spec["name"],
                    Horse.owner_exhibitor_id == exhibitor.id,
                )
            )
        ).scalar_one_or_none()
        if existing_horse:
            created["skipped"].append(f"horse {spec['name']}")
            continue

        horse = Horse(
            name=spec["name"],
            barn_name=spec["barn_name"],
            owner_exhibitor_id=exhibitor.id,
            created_by_exhibitor_id=exhibitor.id,
            owner_name=exhibitor.full_name,
            trainer_id=trainer.id,
            trainer_name=trainer.name,
            sire_name=spec["sire_name"],
            dam_name=spec["dam_name"],
            foaling_date=spec["foaling_date"],
            sex=spec["sex"],
            breed_id=breeds[spec["breed"]].id,
            color_id=colors[spec["color"]].id,
            is_solid_paint_bred=spec.get("is_solid_paint_bred", False),
        )
        db.add(horse)
        await db.flush()

        code, number = spec["registration"]
        db.add(HorseRegistration(
            horse_id=horse.id,
            association_id=associations[code].id,
            registration_number=number,
        ))
        db.add(ExhibitorHorse(exhibitor_id=exhibitor.id, horse_id=horse.id))

        created["horses"] += 1
        print(f"  {spec['name']:<26} owner={exhibitor.full_name:<22} trainer={trainer.name}")

    await db.commit()

    print(
        f"\nCreated: {created['trainers']} trainers, "
        f"{created['exhibitors']} exhibitors, {created['horses']} horses."
    )
    if created["skipped"]:
        print(f"Skipped (already present): {len(created['skipped'])}")
        for item in created["skipped"]:
            print(f"  {item}")
    print(f"\nAll seeded accounts use password: {SEED_PASSWORD}")


async def main() -> None:
    async with AsyncSessionLocal() as db:
        await seed(db)


if __name__ == "__main__":
    asyncio.run(main())
