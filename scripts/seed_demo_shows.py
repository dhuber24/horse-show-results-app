"""Seed demo shows: 3 venues and 3 shows (AQHA, APHA, OPEN).

Each show is built out far enough to be genuinely usable, not just a shell row:
venue, rings, disciplines (riding styles), divisions (age/skill brackets), the
`discipline_divisions` memberships the composite FK on `classes` requires, a
class schedule, judges, lodging/class fees, staff assignments, and club
sanctioning drawn randomly from NSBA / WSCA.

AQHA and APHA classes carry a `class_associations` row with a real code looked
up from `aqha_standard_classes` / `apha_standard_classes` — the script aborts if
a code is not in the catalog rather than inventing one. AQHA entry validation
(`backend/rules/aqha.py`) hard-requires that code, so an AQHA show without it
cannot take entries at all.

Dates are relative to the run date so the ACTIVE show always spans today (the
`PUBLISHED -> ACTIVE` guard in routers/shows.py requires today to be in range).

Idempotent: shows are keyed by name and venues by (name, city), so re-running
skips anything already present.

Run inside the backend container:

    docker cp scripts/seed_demo_shows.py horse-show-results-app-backend-1:/tmp/seed_demo_shows.py
    docker exec -w /app -e PYTHONPATH=/app horse-show-results-app-backend-1 \
        python /tmp/seed_demo_shows.py
"""

import asyncio
import random
import sys
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models import (
    AphaStandardClass,
    AqhaStandardClass,
    Association,
    Class,
    ClassAssociation,
    Discipline,
    Division,
    Judge,
    Ring,
    Show,
    ShowFee,
    ShowJudge,
    ShowManager,
    ShowSanctioning,
    ShowSecretary,
    ShowType,
    User,
    Venue,
    discipline_divisions,
)

RNG_SEED = 20260801

# Staff assigned to every seeded show, by email. Missing accounts are skipped.
SECRETARY_EMAIL = "secretary@test.com"
MANAGER_EMAIL = "manager@test.com"
CREATOR_EMAIL = "admin@horseshow.com"


VENUES = [
    {
        "name": "Cannon Valley Equestrian Center",
        "address": "12480 Highway 19 Blvd",
        "city": "Cannon Falls",
        "state": "MN",
    },
    {
        "name": "Prairie Rose Arena",
        "address": "3355 22nd Ave S",
        "city": "Brookings",
        "state": "SD",
    },
    {
        "name": "Black Hawk County Fairgrounds",
        "address": "1015 W Airline Hwy",
        "city": "Waverly",
        "state": "IA",
    },
]


# (discipline, score_type, [(bracket, class_name, association_class_code | None)])
AQHA_SCHEDULE = [
    ("Performance Halter", "placement", [
        ("Open", "Open Performance Halter Mares", "175000"),
        ("Open", "Open Performance Halter Geldings", "177000"),
        ("Youth 14-18", "Youth Performance Halter Mares", "475000"),
    ]),
    ("Showmanship", "pattern", [
        ("Amateur", "Amateur Showmanship at Halter", "212000"),
        ("Select (50+)", "Select Showmanship at Halter", "212800"),
        ("Youth 14-18", "Youth Showmanship at Halter", "412000"),
    ]),
    ("Western Pleasure", "placement", [
        ("Open", "Open Western Pleasure", "142000"),
        ("Amateur", "Amateur Western Pleasure", "242000"),
        ("Select (50+)", "Select Western Pleasure", "242800"),
        ("Youth 14-18", "Youth Western Pleasure", "442000"),
    ]),
    ("Western Horsemanship", "pattern", [
        ("Amateur", "Amateur Western Horsemanship", "240000"),
        ("Youth 14-18", "Youth Western Horsemanship", "440000"),
    ]),
    ("Trail", "pattern", [
        ("Open", "Open Trail", "138000"),
        ("Amateur", "Amateur Trail", "238000"),
        ("Youth 14-18", "Youth Trail", "438000"),
    ]),
    ("Ranch Riding", "pattern", [
        ("Open", "Open Ranch Riding", "143000"),
        ("Amateur", "Amateur Ranch Riding", "243000"),
        ("Select (50+)", "Select Ranch Riding", "243800"),
    ]),
    ("Hunter Under Saddle", "placement", [
        ("Open", "Open Hunter Under Saddle", "144000"),
        ("Amateur", "Amateur Hunter Under Saddle", "244000"),
        ("Youth 14-18", "Youth Hunter Under Saddle", "444000"),
    ]),
]


APHA_SCHEDULE = [
    ("Color", "placement", [
        ("Amateur", "Amateur Color Class", "ATCC"),
    ]),
    ("Showmanship", "pattern", [
        ("Amateur", "Amateur Showmanship All Ages", "ASH1"),
        ("Youth 14-18", "Youth Showmanship 18 & Under", "YSH1"),
        ("Youth 13 & Under", "Youth Showmanship 13 & Under", "YSH2"),
    ]),
    ("Western Pleasure", "placement", [
        ("Open", "Western Pleasure All Ages", "WP1"),
        ("Amateur", "Amateur Western Pleasure All Ages", "AWP1"),
        ("Youth 14-18", "Youth Western Pleasure 18 & Under", "YWP1"),
        ("Youth 13 & Under", "Youth Western Pleasure 13 & Under", "YWP2"),
    ]),
    ("Western Horsemanship", "pattern", [
        ("Amateur", "Amateur Western Horsemanship All Ages", "AH1"),
        ("Youth 14-18", "Youth Western Horsemanship 18 & Under", "YH1"),
    ]),
    ("Trail", "pattern", [
        ("Open", "Trail All Ages", "TRL1"),
        ("Amateur", "Amateur Trail All Ages", "AT1"),
        ("Youth 14-18", "Youth Trail 18 & Under", "YT1"),
    ]),
    ("Ranch Trail", "pattern", [
        ("Open", "Ranch Trail All Ages", "RT1"),
        ("Amateur", "Amateur Ranch Trail All Ages", "ART1"),
    ]),
    # No APHA catalog code attached — exercises the un-coded path and gives the
    # show a timed event. Secretaries can attach codes via the Classes page.
    ("Barrel Racing", "time", [
        ("Open", "Open Barrel Racing", None),
        ("Youth 14-18", "Youth Barrel Racing", None),
    ]),
]


OPEN_SCHEDULE = [
    ("Halter", "placement", [
        ("Open", "Open Halter", None),
        ("Youth", "Youth Halter", None),
    ]),
    ("Showmanship", "pattern", [
        ("Open", "Open Showmanship", None),
        ("Youth", "Youth Showmanship", None),
        ("10 & Under", "10 & Under Showmanship", None),
    ]),
    ("Western Pleasure", "placement", [
        ("Open", "Open Western Pleasure", None),
        ("Youth", "Youth Western Pleasure", None),
        ("Walk-Trot", "Walk-Trot Western Pleasure", None),
    ]),
    ("Western Horsemanship", "pattern", [
        ("Open", "Open Western Horsemanship", None),
        ("Youth", "Youth Western Horsemanship", None),
        ("10 & Under", "10 & Under Western Horsemanship", None),
    ]),
    ("Trail", "pattern", [
        ("Open", "Open Trail", None),
        ("Walk-Trot", "Walk-Trot Trail", None),
    ]),
    ("Barrel Racing", "time", [
        ("Open", "Open Barrel Racing", None),
        ("Youth", "Youth Barrel Racing", None),
        ("10 & Under", "10 & Under Barrel Racing", None),
    ]),
    ("Pole Bending", "time", [
        ("Open", "Open Pole Bending", None),
        ("Youth", "Youth Pole Bending", None),
    ]),
]


SHOWS = [
    {
        "name": "Cannon Valley Quarter Horse Classic",
        "show_type": "AQHA",
        "venue": "Cannon Valley Equestrian Center",
        "status": "PUBLISHED",
        "start_offset": 45,
        "days": 3,
        "aqha_show_number": "2026-114872",
        "aqha_approval_status": "APPROVED",
        "aqha_approval_submitted_offset": -60,
        "aqha_approval_notes": "Approved for 3 judges over 3 days. Split combined youth classes.",
        "shavings_ban_outside": True,
        "entry_fee_cents": 4500,
        "rings": ["Main Arena", "Warm-Up Arena"],
        "schedule": AQHA_SCHEDULE,
        "judges": [
            ("Sandra", "Whitcomb", "sandra.whitcomb@example.com", "(806) 555-0311"),
            ("Ray", "Hollingsworth", "ray.hollingsworth@example.com", "(940) 555-0322"),
        ],
        "fees": [
            ("office_charge", "Office charge", 4500, "per_horse", None),
            ("stall", "Stall (per stall, whole show)", 12000, "per_stall", None),
            ("shavings", "Shavings", 900, "per_bag", "Outside shavings are not permitted."),
            ("camping", "Camping", 4000, "per_night", "Includes electric hookup."),
            ("standard_class", "Standard class fee", 4500, "per_entry", None),
            ("jackpot", "Jackpot class fee", 7500, "per_entry", None),
        ],
    },
    {
        "name": "Prairie Rose Paint Horse Spectacular",
        "show_type": "APHA",
        "venue": "Prairie Rose Arena",
        "status": "ACTIVE",
        "start_offset": -1,
        "days": 3,
        "apha_show_number": "26-4471",
        "shavings_ban_outside": False,
        "entry_fee_cents": 3500,
        "rings": ["Coliseum", "Outdoor Arena"],
        "schedule": APHA_SCHEDULE,
        "judges": [
            ("Denise", "Marchetti", "denise.marchetti@example.com", "(512) 555-0344"),
            ("Curtis", "Blayne", "curtis.blayne@example.com", "(405) 555-0355"),
        ],
        "fees": [
            ("office_charge", "Office charge", 3000, "per_exhibitor", None),
            ("stall", "Stall (per stall, whole show)", 10000, "per_stall", None),
            ("shavings", "Shavings", 800, "per_bag", None),
            ("camping", "Camping", 3500, "per_night", "Dry camping only; no hookups."),
            ("standard_class", "Standard class fee", 3500, "per_entry", None),
            ("jackpot", "Jackpot class fee", 6000, "per_entry", None),
        ],
    },
    {
        "name": "Black Hawk Fall Open Classic",
        "show_type": "OPEN",
        "venue": "Black Hawk County Fairgrounds",
        "status": "PUBLISHED",
        "start_offset": 80,
        "days": 2,
        "shavings_ban_outside": False,
        "entry_fee_cents": 2000,
        "rings": ["Show Arena"],
        "schedule": OPEN_SCHEDULE,
        "judges": [
            ("Tonya", "Beaulieu", "tonya.beaulieu@example.com", "(319) 555-0366"),
        ],
        "fees": [
            ("office_charge", "Office charge", 1500, "per_exhibitor", None),
            ("stall", "Stall (per stall, whole show)", 6000, "per_stall", None),
            ("shavings", "Shavings", 700, "per_bag", None),
            ("camping", "Camping", 2500, "per_night", "Includes electric hookup."),
            ("standard_class", "Standard class fee", 2000, "per_entry", None),
        ],
    },
]

# Shuffled and dealt one per show rather than drawn independently: an
# independent draw can hand all three shows the same pair, which makes for poor
# demo data. Dealing guarantees every show carries sanctioning, both bodies
# appear, and the single/dual-club cases are all represented — the randomness is
# in which show gets which.
SANCTIONING_OPTIONS = [["NSBA"], ["WSCA"], ["NSBA", "WSCA"]]
SANCTION_FEE_CENTS = {"NSBA": 300, "WSCA": 200}


async def _verify_class_codes(db: AsyncSession) -> None:
    """Fail before writing anything if a hard-coded catalog code is unknown."""
    wanted = {"AQHA": set(), "APHA": set()}
    for show in SHOWS:
        table = show["show_type"]
        if table not in wanted:
            continue
        for _discipline, _score_type, picks in show["schedule"]:
            for _bracket, _name, code in picks:
                if code:
                    wanted[table].add(code)

    missing: list[str] = []
    if wanted["AQHA"]:
        found = set(
            (await db.execute(
                select(AqhaStandardClass.code).where(AqhaStandardClass.code.in_(wanted["AQHA"]))
            )).scalars().all()
        )
        missing += [f"AQHA {c}" for c in sorted(wanted["AQHA"] - found)]
    if wanted["APHA"]:
        found = set(
            (await db.execute(
                select(AphaStandardClass.code).where(AphaStandardClass.code.in_(wanted["APHA"]))
            )).scalars().all()
        )
        missing += [f"APHA {c}" for c in sorted(wanted["APHA"] - found)]

    if missing:
        sys.exit(
            "Class codes not found in the standard-class catalogs:\n  "
            + "\n  ".join(missing)
            + "\nSeed the catalogs first (see database/seeds/README.md)."
        )


async def seed(db: AsyncSession) -> None:
    await _verify_class_codes(db)

    show_types = {
        st.code: st for st in (await db.execute(select(ShowType))).scalars().all()
    }
    associations = {
        a.code: a for a in (await db.execute(select(Association))).scalars().all()
    }

    async def _user(email: str) -> User | None:
        return (
            await db.execute(select(User).where(func.lower(User.email) == email))
        ).scalar_one_or_none()

    secretary = await _user(SECRETARY_EMAIL)
    manager = await _user(MANAGER_EMAIL)
    creator = await _user(CREATOR_EMAIL)

    today = date.today()
    created = {"venues": 0, "shows": 0, "classes": 0, "skipped": []}

    # --- Venues -------------------------------------------------------------
    venues: dict[str, Venue] = {}
    for spec in VENUES:
        venue = (
            await db.execute(
                select(Venue).where(Venue.name == spec["name"], Venue.city == spec["city"])
            )
        ).scalar_one_or_none()
        if venue:
            created["skipped"].append(f"venue {spec['name']}")
        else:
            venue = Venue(
                name=spec["name"],
                address=spec["address"],
                city=spec["city"],
                state=spec["state"],
                created_by_user_id=creator.id if creator else None,
            )
            db.add(venue)
            await db.flush()
            created["venues"] += 1
        venues[spec["name"]] = venue

    # --- Shows --------------------------------------------------------------
    rng = random.Random(RNG_SEED)
    sanctioning_deal = list(SANCTIONING_OPTIONS)
    rng.shuffle(sanctioning_deal)

    for show_index, spec in enumerate(SHOWS):
        clubs = sanctioning_deal[show_index % len(sanctioning_deal)]

        existing = (
            await db.execute(select(Show).where(Show.name == spec["name"]))
        ).scalar_one_or_none()
        if existing:
            created["skipped"].append(f"show {spec['name']}")
            continue

        start = today + timedelta(days=spec["start_offset"])
        end = start + timedelta(days=spec["days"] - 1)
        submitted_offset = spec.get("aqha_approval_submitted_offset")

        show = Show(
            name=spec["name"],
            venue_id=venues[spec["venue"]].id,
            show_type_id=show_types[spec["show_type"]].id,
            start_date=start,
            end_date=end,
            status=spec["status"],
            apha_show_number=spec.get("apha_show_number"),
            aqha_show_number=spec.get("aqha_show_number"),
            aqha_approval_status=spec.get("aqha_approval_status", "NOT_SUBMITTED"),
            aqha_approval_submitted_at=(
                today + timedelta(days=submitted_offset) if submitted_offset else None
            ),
            aqha_approval_notes=spec.get("aqha_approval_notes"),
            shavings_ban_outside=spec["shavings_ban_outside"],
            created_by_user_id=creator.id if creator else None,
        )
        db.add(show)
        await db.flush()

        # Staff
        if secretary:
            db.add(ShowSecretary(show_id=show.id, user_id=secretary.id))
        if manager:
            db.add(ShowManager(show_id=show.id, user_id=manager.id))

        # Club sanctioning
        for code in clubs:
            db.add(ShowSanctioning(
                show_id=show.id,
                association_id=associations[code].id,
                per_class_fee_cents=SANCTION_FEE_CENTS[code],
            ))

        # Judges — the person goes in the registry once and is assigned to each
        # show that hires them, so the same judge at two shows is one row.
        for i, (first, last, email, phone) in enumerate(spec["judges"]):
            judge = (await db.execute(
                select(Judge).where(func.lower(Judge.email) == email.lower())
            )).scalar_one_or_none()
            if not judge:
                judge = Judge(first_name=first, last_name=last, email=email, phone=phone)
                db.add(judge)
                await db.flush()
            db.add(ShowJudge(show_id=show.id, judge_id=judge.id, sort_order=i))

        # Fees
        for i, (code, label, cents, unit, notes) in enumerate(spec["fees"]):
            db.add(ShowFee(
                show_id=show.id,
                code=code,
                label=label,
                amount_cents=cents,
                unit=unit,
                notes=notes,
                sort_order=i,
            ))

        # Rings
        rings = []
        for i, ring_name in enumerate(spec["rings"]):
            ring = Ring(show_id=show.id, name=ring_name, sort_order=i)
            db.add(ring)
            rings.append(ring)
        await db.flush()

        # Disciplines, divisions, and the memberships the composite FK needs
        disciplines: dict[str, Discipline] = {}
        divisions: dict[str, Division] = {}
        memberships: set[tuple] = set()

        for i, (name, score_type, _picks) in enumerate(spec["schedule"]):
            discipline = Discipline(
                show_id=show.id, name=name, sort_order=i, default_score_type=score_type
            )
            db.add(discipline)
            disciplines[name] = discipline

        bracket_order: list[str] = []
        for _name, _score_type, picks in spec["schedule"]:
            for bracket, _class_name, _code in picks:
                if bracket not in bracket_order:
                    bracket_order.append(bracket)
        for i, bracket in enumerate(bracket_order):
            division = Division(show_id=show.id, name=bracket, sort_order=i)
            db.add(division)
            divisions[bracket] = division
        await db.flush()

        for name, _score_type, picks in spec["schedule"]:
            for bracket, _class_name, _code in picks:
                pair = (disciplines[name].id, divisions[bracket].id)
                if pair not in memberships:
                    memberships.add(pair)
        if memberships:
            await db.execute(
                discipline_divisions.insert(),
                [{"discipline_id": d, "division_id": v} for d, v in sorted(memberships, key=str)],
            )

        # Classes — numbered sequentially, spread across show days and rings
        class_number = 1
        for d_index, (name, score_type, picks) in enumerate(spec["schedule"]):
            ring = rings[d_index % len(rings)]
            class_date = start + timedelta(days=d_index % spec["days"])
            for bracket, class_name, code in picks:
                cls = Class(
                    show_id=show.id,
                    ring_id=ring.id,
                    discipline_id=disciplines[name].id,
                    division_id=divisions[bracket].id,
                    class_number=str(class_number),
                    class_name=class_name,
                    class_date=class_date,
                    status="OPEN",
                    score_type=score_type,
                    entry_fee_cents=spec["entry_fee_cents"],
                    sort_order=class_number,
                )
                db.add(cls)
                await db.flush()

                if code:
                    db.add(ClassAssociation(
                        class_id=cls.id,
                        show_type_id=show_types[spec["show_type"]].id,
                        association_class_code=code,
                    ))

                class_number += 1
                created["classes"] += 1

        created["shows"] += 1
        print(
            f"  {spec['name']}\n"
            f"    {spec['show_type']} | {spec['status']} | {start} - {end} | {spec['venue']}\n"
            f"    sanctioning: {', '.join(clubs)} | rings: {len(rings)} | "
            f"classes: {class_number - 1} | judges: {len(spec['judges'])}"
        )

    await db.commit()

    print(
        f"\nCreated: {created['venues']} venues, {created['shows']} shows, "
        f"{created['classes']} classes."
    )
    if created["skipped"]:
        print(f"Skipped (already present): {len(created['skipped'])}")
        for item in created["skipped"]:
            print(f"  {item}")


async def main() -> None:
    async with AsyncSessionLocal() as db:
        await seed(db)


if __name__ == "__main__":
    asyncio.run(main())
