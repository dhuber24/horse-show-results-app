"""Build the MNSPHC Splash of Color & Futurity / Paint-O-Rama & All Breed Show
from the North Star Paint Horse Club's printed show bill.

The bill is a two-day APHA show at Double F Arena in Hinckley, MN carrying both
MNSPHC and WSCA club sanctioning: 172 classes over Saturday and Sunday, four
judges (two of them dual-carded WSCA), a five-rate class fee schedule, three
optional Division Side Pots, and the North Star Futurity — its own ten classes,
three entry categories, and two Hi-Point award divisions.

The printed bill is dated Saturday-Sunday August 22-23 2026, which is in the
past. This script moves it a year on to 2027-08-21/22 -- the Saturday and
Sunday of the same August week, since a year to the day would land the show on
a Sunday and Monday -- and leaves it in DRAFT, which is where a show nobody has
checked over belongs.

Lodging and futurity money does not appear on the printed bill at all: the club
takes stalls and futurity entries on two Cognito forms, and the rates here come
from those.

  Stalls:   https://www.cognitoforms.com/MNSPHC2/_202MNSPHCStallReservationsDoubleFArena
  Futurity: https://www.cognitoforms.com/MNSPHC2/NorthStarFuturityEntryForm

Additive and re-runnable: it deletes only the show it creates (by name) and
rebuilds it, so it can be run alongside seed_test_shows.py / seed_demo_shows.py
without touching their fixtures. Venue and judges are created once and reused.

Run against the configured DATABASE_URL using the backend image:

    docker run --rm \
      -v "$PWD/backend:/app" -v "$PWD/scripts:/scripts" \
      -w /app -e PYTHONPATH=/app -e DATABASE_URL="$DATABASE_URL" \
      horse-show-results-app-backend python /scripts/seed_mnsphc_paint_o_rama.py
"""

import asyncio
import sys
from datetime import date

import bcrypt
from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models import (
    Association,
    Class,
    ClassAssociation,
    Discipline,
    Division,
    Futurity,
    FuturityClass,
    FuturityDivision,
    FuturityDivisionClass,
    FuturityFeeTier,
    Judge,
    Ring,
    Show,
    ShowFee,
    ShowJudge,
    ShowManager,
    ShowSanctioning,
    ShowSecretary,
    ShowType,
    SidePot,
    SidePotClass,
    User,
    Venue,
    discipline_divisions,
    judge_associations,
)
from schemas import DEFAULT_SIDE_POT_PAYOUT_SCHEDULE

# The transcription itself lives next door — see its docstring.
from seed_mnsphc_classes import SATURDAY_CLASSES, SUNDAY_CLASSES

SHOW_NAME = "MNSPHC Splash of Color & Futurity — Paint-O-Rama & All Breed Show"

# The bill reads Saturday August 22 & Sunday August 23, 2026. A year on, the
# same weekend falls here -- and the 2027 calendar happens to reproduce the
# bill's whole logistics week: entries close Wednesday, early arrival is
# Thursday evening, stalls open Friday morning, late departure is Monday.
SATURDAY = date(2027, 8, 21)
SUNDAY = date(2027, 8, 22)

# Futurity entries close 7:00 PM central on the Wednesday before the show; the
# printed form says Wednesday August 19 2026. After it, a $150-per-class late
# fee applies. Both go on the `futurities` row.
FUTURITY_DEADLINE = date(2027, 8, 18)
EARLY_ARRIVAL = date(2027, 8, 19)   # Thursday, after 6pm
STALLS_OPEN = date(2027, 8, 20)     # Friday, 9am
LATE_DEPARTURE = date(2027, 8, 23)  # Monday morning

VENUE = {
    "name": "Double F Arena",
    "address": "35736 Hinckley Rd",
    "city": "Hinckley",
    "state": "MN",
}

# The show is created under the existing admin account and handed to the staff
# the bill names.
ADMIN_EMAIL = "admin@horseshow.com"

# (first, last, role, email). These are test accounts standing in for the real
# people printed on the bill — the addresses are invented and deliberately at
# example.com, which is reserved by RFC 2606 and cannot receive mail, so no
# stray notification can ever reach a real person. Every one shares
# SEED_PASSWORD. Do not carry these into a production database.
STAFF = [
    ("Christina", "Kooiman", "SHOW_SECRETARY", "christina.kooiman@example.com"),
    ("Andriana", "Holst", "SHOW_MANAGER", "andriana.holst@example.com"),
    ("Michelle", "Schlaeger", "SHOW_MANAGER", "michelle.schlaeger@example.com"),
]
SEED_PASSWORD = "12345678"  # matches scripts/seed_demo_people.py

# (first, last, email, [association codes]). Four judges, not six: the bill
# promises "4 APHA Judges each day" and "2 WSCA Judges each day*", and the
# asterisk on two of the four names is what ties those together — Tjosaas and
# Crowley are dual-carded and work both panels. Emails are invented on the same
# terms as STAFF above; judges are registry rows, not login accounts.
JUDGES = [
    ("Leigh Ann", "Skurupey", "leighann.skurupey@example.com", ["APHA"]),
    ("Josh", "Tjosaas", "josh.tjosaas@example.com", ["APHA", "WSCA"]),
    ("Nell", "Tekampe", "nell.tekampe@example.com", ["APHA"]),
    ("Tim", "Crowley", "tim.crowley@example.com", ["APHA", "WSCA"]),
]

# Per-entry class fees, in cents. The bill quotes every rate per judge; these
# are the per-judge rate multiplied out by the panel that scores the class.
FEE_CENTS = {
    "APHA_OPEN": 3600,    # $9 per judge x 4 APHA judges
    "APHA_YOUTH": 2800,   # $7 per judge x 4 APHA judges
    "MNSPHC": 3200,       # $8 per judge x 4 judges
    "WSCA": 1000,         # $5 per judge x 2 WSCA judges
    "LEAD_LINE": 1000,    # $10 per class, flat, APHA and All Breed alike
    # Zero, and deliberately so. A futurity prices its classes off the
    # entrant's category — $75 / $100 / $150 depending on how the horse got
    # there — which a class row cannot know, so the rate lives on the
    # `futurity_fee_tiers` rows built below and is applied per class entered.
    # A non-zero fee here would be charged on top of that.
    "FUTURITY": 0,
    # No entry fee for the Grand & Reserve roll-ups: you qualify into those out
    # of the classes rather than entering them.
    "CHAMPIONSHIP": 0,
}

# Riding styles, in program order, with the scoring the app should default to.
# Names and score types match backend/rules/disciplines.py so this show speaks
# the same vocabulary as the AQHA/APHA importers.
DISCIPLINES = [
    ("Halter", "placement"),
    ("Performance Halter", "placement"),
    ("Color Class", "placement"),
    ("Ranch Conformation", "placement"),
    ("Showmanship", "pattern"),
    ("Hunter Under Saddle", "placement"),
    ("Hunt Seat Equitation", "pattern"),
    ("Western Riding", "pattern"),
    ("Lead Line", "placement"),
    ("In-Hand Trail", "pattern"),
    ("Trail", "pattern"),
    ("Ranch Trail", "pattern"),
    ("Pole Bending", "time"),
    ("Stake Race", "time"),
    ("Barrel Racing", "time"),
    ("Longe Line", "placement"),
    ("Western Pleasure", "placement"),
    ("Western Horsemanship", "pattern"),
    ("Ranch Rail Pleasure", "placement"),
    ("Ranch Pleasure", "placement"),
    ("Ranch Riding", "pattern"),
    ("Reining", "pattern"),
]

# Age / skill brackets, in the order they should list. Three families share the
# table because the bill uses all three: rider brackets (Amateur, Youth ...),
# horse brackets (Yearling, Green Horse ...), and the WSCA rider age splits,
# which are their own scheme and deliberately not folded into the APHA ones.
BRACKETS = [
    "Open",
    "Amateur",
    "Novice Amateur",
    "Youth",
    "Youth 13 & Under",
    "Youth 18 & Under",
    "Novice Youth 18 & Under",
    "Amateur Walk-Trot",
    "Youth Walk-Trot 5-10",
    "Youth Walk-Trot 11-18",
    "Lead Line 3-8",
    "Weanling",
    "Yearling",
    "Two Year Old",
    "Three Year Old",
    "Four Year & Older",
    "3 & 4 Year Old",
    "Junior Horse (5 & Younger)",
    "Senior Horse (6 & Older)",
    "Green Horse",
    "Futurity",
    "Walk-Trot All Ages",
    "Walk-Trot 17 & Under",
    "Walk-Trot 18 & Over",
    "17 & Under",
    "18 & Over",
    "13 & Under",
    "14-17",
    "18-34",
    "35-49",
    "50+",
]

# The show's non-class fee catalog, straight off the bill's "Single Class
# Fees" / "Other" panels. Every per-judge rate is multiplied out by the panel
# it applies to, since an exhibitor pays the product and not the rate.
#
# The office fee is deliberately NOT here: it lives on the show row as
# `office_charge_cents` / `office_charge_basis`, which is what actually bills
# and what the show bill prints. A second copy in show_fees would double-list.
SHOW_FEES = [
    {
        "code": "standard_class",
        "label": "APHA class — Open, Amateur & Novice Amateur",
        "amount_cents": 3600,
        "unit": "per_entry",
        "notes": "$9 per judge x 4 APHA judges.",
    },
    {
        "code": "apha_youth_class",
        "label": "APHA Youth class",
        "amount_cents": 2800,
        "unit": "per_entry",
        "notes": "$7 per judge x 4 APHA judges.",
    },
    {
        "code": "mnsphc_all_breed_class",
        "label": "MNSPHC All Breed class",
        "amount_cents": 3200,
        "unit": "per_entry",
        "notes": "$8 per judge x 4 judges. 50/50 payback at the June show.",
    },
    {
        "code": "wsca_all_breed_class",
        "label": "All Breed WSCA class",
        "amount_cents": 1000,
        "unit": "per_entry",
        "notes": "$5 per judge x 2 WSCA judges. Classes tagged WSCA* are non-qualifying.",
    },
    {
        "code": "lead_line",
        "label": "Youth Lead Line class",
        "amount_cents": 1000,
        "unit": "per_entry",
        "notes": "$10 per class, APHA and All Breed alike.",
    },
    {
        "code": "jackpot",
        "label": "Division Side Pot buy-in",
        "amount_cents": 1000,
        "unit": "per_entry",
        "notes": (
            "Optional, per division, on top of the regular class entry fee. "
            "Run concurrently with the classes in the division. 100% payback; "
            "over-all placing from the combined judges' score sheets."
        ),
    },
    {
        "code": "buckle_challenge",
        "label": "Walk Trot Buckle Challenge",
        "amount_cents": 2000,
        "unit": "flat",
        "notes": "Optional $20 entry.",
    },
    {
        "code": "apha_fee",
        "label": "APHA fee",
        "amount_cents": 1200,
        "unit": "per_class_per_horse",
        "notes": "$3 per judge x 4 APHA judges. APHA classes only.",
    },
    {
        "code": "number_fee",
        "label": "Back number fee",
        "amount_cents": 500,
        "unit": "per_horse",
        "notes": "One-time, all horses. Numbers follow the horse and are kept for both shows.",
    },
    {
        "code": "all_day_open",
        "label": "APHA All Day fee — Open, Amateur & Novice Amateur (one horse)",
        "amount_cents": 18000,
        "unit": "per_horse",
        "notes": (
            "$45 per judge x 4 APHA judges, one horse, APHA classes only. Does not "
            "include APHA fees; All Breed (MNSPHC or WSCA) classes and side pots "
            "are not included."
        ),
    },
    {
        "code": "all_day_youth",
        "label": "APHA All Day fee — Youth (one horse)",
        "amount_cents": 14000,
        "unit": "per_horse",
        "notes": (
            "$35 per judge x 4 APHA judges. If the youth horse crosses over to other "
            "divisions the Open rate of $45 per judge applies."
        ),
    },
    # Futurity money is deliberately NOT here. It used to be six `show_fees`
    # rows — three category rates, a late fee and two office fees — which is a
    # rate card sitting in a table that can only express one number per row.
    # It is a `futurities` row now (migration 107), built at the bottom of this
    # script, and `billing.futurity_charge_cents` applies it per enrollment.
    #
    # ── Lodging, from the stall reservation form ─────────────────────────────
    # None of this is on the printed bill; the club books stalls on its own
    # Cognito form. `unit` is what makes a fee reservable at sign-up, so these
    # are the rows an exhibitor actually books quantities against.
    {
        "code": "stall",
        "label": "Horse stall",
        "amount_cents": 7000,
        "unit": "per_stall",
        "notes": (
            f"ALL HORSES MUST HAVE A STALL. Stalls open 9:00 AM on "
            f"{STALLS_OPEN:%A %B %-d}. Reservations are made on the club's stall "
            "form and are not guaranteed; changes go to Amanda Briggs, "
            "507-261-2981 (text or leave a message)."
        ),
    },
    {
        "code": "tack_stall",
        "label": "Tack stall",
        "amount_cents": 7000,
        "unit": "per_stall",
        "notes": "Same rate as a horse stall.",
    },
    {
        "code": "shavings",
        "label": "Shavings",
        "amount_cents": 1000,
        "unit": "per_bag",
        "notes": (
            "Minimum 2 bags per stall. NO OUTSIDE SHAVINGS ALLOWED. Any and all "
            "shavings reserved are non-refundable and must be paid for even if "
            "not used."
        ),
    },
    {
        # The form sells this as "$60 for the weekend" per hook-up spot, which
        # is what the `per_show` unit means: charged once per spot reserved,
        # however long the show runs (migration 106). It was carried as
        # `per_night` before that unit existed, which billed $120 on a two-day
        # show.
        "code": "hookup",
        "label": "Electrical hook-up (per spot, whole show)",
        "amount_cents": 6000,
        "unit": "per_show",
        "notes": "$60 per spot for the whole show. Spots are requested, not guaranteed.",
    },
    {
        # "Early arrival" is not the app's early-bird rate: that is a discount
        # for booking sooner (early_amount_cents + early_deadline). This is a
        # surcharge for turning up a day sooner, so it is its own fee row.
        "code": "early_arrival_stall",
        "label": "Early arrival — stall",
        "amount_cents": 3500,
        "unit": "per_stall",
        "notes": (
            f"Per horse. Thursday {EARLY_ARRIVAL:%B %-d} after 6:00 PM, instead "
            f"of 9:00 AM {STALLS_OPEN:%A}."
        ),
    },
    {
        "code": "early_arrival_hookup",
        "label": "Early arrival — electrical hook-up",
        "amount_cents": 3000,
        "unit": "per_show",
        "notes": (
            f"Per spot. Thursday {EARLY_ARRIVAL:%B %-d} after 6:00 PM."
        ),
    },
    {
        "code": "late_departure_stall",
        "label": "Late departure — stall",
        "amount_cents": 3500,
        "unit": "per_stall",
        "notes": (
            f"Per stall. Monday {LATE_DEPARTURE:%B %-d} morning departure. "
            "Prior notification is required."
        ),
    },
    {
        "code": "late_departure_hookup",
        "label": "Late departure — electrical hook-up",
        "amount_cents": 3000,
        "unit": "per_show",
        "notes": (
            f"Per spot. Monday {LATE_DEPARTURE:%B %-d} morning departure. "
            "Prior notification is required."
        ),
    },
]

# (name, description, [class numbers]). The bill runs three Division Side
# Pots, and `sum_scores` is the right scoring method for all three: it settles
# "from the combined judge's score sheets", and every bundled class is
# pattern-scored, which is what sum_scores requires.
#
# `any_class` rather than `all_classes` because the classes inside each pot are
# mutually exclusive age splits — a 14-year-old rides class 51 and cannot ride
# 50, 52, 53 or 54, so requiring all of them would make the pot unenterable.
SIDE_POTS = [
    (
        "Showmanship Division Side Pot",
        "All Breed Showmanship, classes 50-54. $10 buy-in on top of the class "
        "entry fee, 100% payback, over-all placing from the combined judges' "
        "score sheets.",
        ["50", "51", "52", "53", "54"],
    ),
    (
        "Walk-Trot Horsemanship Division Side Pot",
        "All Breed WT Western Horsemanship, classes 138-139. $10 buy-in on top "
        "of the class entry fee, 100% payback, over-all placing from the "
        "combined judges' score sheets.",
        ["138", "139"],
    ),
    (
        "Western Horsemanship Division Side Pot",
        "All Breed Western Horsemanship, classes 140-144. $10 buy-in on top of "
        "the class entry fee, 100% payback, over-all placing from the combined "
        "judges' score sheets.",
        ["140", "141", "142", "143", "144"],
    ),
]


# ── The North Star Futurity, from the club's entry form ───────────────────────
#
# The ten lettered classes on the bill are the futurity. Their `entry_fee_cents`
# is zero (see FEE_CENTS above) because the rate is the entrant's category rate,
# applied per class entered by `billing.futurity_charge_cents`.

FUTURITY_NAME = "North Star Futurity"

FUTURITY_DESCRIPTION = (
    "Entry fee is per class and depends on the category the entrant qualifies "
    "for. Breed association rules for crossing over do not apply to the "
    "futurity classes — horses may cross over. An entry paid for a horse that "
    "is not shown is not refunded without veterinary documentation supplied "
    "before the show."
)

# (name, description, amount_cents). The form makes the entrant pick exactly one.
FUTURITY_TIERS = [
    (
        "Category #1",
        "Stallion owner who donated service to the SSA, or mare owner with the "
        "winning bid.",
        7500,
    ),
    (
        "Category #2",
        "Any other get/offspring sired by a stallion whose service sold on the "
        "SSA for the series.",
        10000,
    ),
    ("Category #3", "Not eligible for Category #1 or #2.", 15000),
]

# Hi-Point awards: a saddle and a reserve buckle, points tabulated from three
# classes in each division. `best_of_group` is the 2-Year-Old rule — all three
# pleasure classes may be entered, but only the best-scoring one counts.
#
# `sum_placings` because the app has no points table: lowest total placing wins,
# the same convention side pot standings use.
FUTURITY_DIVISIONS = [
    (
        "Yearling",
        [
            ("C", "counts", None),  # All Breed Yearling Halter
            ("F", "counts", None),  # All Breed Yearling In Hand Trail
            ("H", "counts", None),  # All Breed Yearling Longe Line
        ],
    ),
    (
        "2 Year Old",
        [
            ("D", "counts", None),           # All Breed 2 Year Old Halter
            ("G", "counts", None),           # All Breed 2 YO Walk Trot Trail
            ("E", "best_of_group", "Pleasure"),  # WT Hunter Under Saddle
            ("I", "best_of_group", "Pleasure"),  # WT Western Pleasure
            ("J", "best_of_group", "Pleasure"),  # WT Ranch Pleasure
        ],
    ),
]


async def _one(db: AsyncSession, stmt):
    return (await db.execute(stmt)).scalars().first()


async def _require_user(db: AsyncSession, email: str) -> User:
    user = await _one(db, select(User).where(User.email == email))
    if user is None:
        sys.exit(
            f"No user with email {email!r}. Run scripts/seed_demo_people.py (or "
            f"seed_test_shows.py) first, or edit the *_EMAIL constants."
        )
    return user


async def _get_or_create_staff(db: AsyncSession) -> dict[str, User]:
    """The show's own manager/secretary accounts, keyed by email.

    Every account shares SEED_PASSWORD, and an existing account is reused
    rather than re-hashed — if somebody has changed the password by hand, a
    re-run of this script should not undo that.
    """
    hashed = bcrypt.hashpw(SEED_PASSWORD.encode(), bcrypt.gensalt()).decode()
    staff: dict[str, User] = {}
    for first, last, role, email in STAFF:
        user = await _one(db, select(User).where(User.email == email))
        if user is None:
            user = User(
                email=email,
                first_name=first,
                last_name=last,
                role=role,
                hashed_password=hashed,
                is_approved=True,
            )
            db.add(user)
            await db.flush()
        staff[email] = user
    return staff


async def _get_or_create_venue(db: AsyncSession) -> Venue:
    venue = await _one(db, select(Venue).where(Venue.name == VENUE["name"]))
    if venue is None:
        venue = Venue(**VENUE)
        db.add(venue)
        await db.flush()
    return venue


async def _get_or_create_judges(db: AsyncSession) -> list[Judge]:
    associations = {
        a.code: a
        for a in (await db.execute(select(Association))).scalars().all()
    }
    judges: list[Judge] = []
    for first, last, email, codes in JUDGES:
        judge = await _one(
            db,
            select(Judge).where(Judge.first_name == first, Judge.last_name == last),
        )
        if judge is None:
            judge = Judge(first_name=first, last_name=last, email=email)
            db.add(judge)
            await db.flush()
        elif judge.email is None:
            judge.email = email
        for code in codes:
            association = associations[code]
            already = await db.execute(
                select(judge_associations).where(
                    judge_associations.c.judge_id == judge.id,
                    judge_associations.c.association_id == association.id,
                )
            )
            if already.first() is None:
                await db.execute(
                    insert(judge_associations).values(
                        judge_id=judge.id, association_id=association.id
                    )
                )
        judges.append(judge)
    return judges


def _check_transcription(rows: list[tuple]) -> None:
    """Fail loudly on a transcription slip rather than seeding a broken show."""
    known_disciplines = {name for name, _ in DISCIPLINES}
    known_brackets = set(BRACKETS)
    seen_numbers: set[str] = set()
    for number, _code, name, discipline, bracket, fee_key in rows:
        if number in seen_numbers:
            sys.exit(f"Duplicate class number {number!r}")
        seen_numbers.add(number)
        if discipline not in known_disciplines:
            sys.exit(f"Class {number}: unknown discipline {discipline!r}")
        if bracket not in known_brackets:
            sys.exit(f"Class {number}: unknown bracket {bracket!r}")
        if fee_key not in FEE_CENTS:
            sys.exit(f"Class {number}: unknown fee key {fee_key!r}")
        if not name.strip():
            sys.exit(f"Class {number}: empty name")


async def main() -> None:
    rows = [(SATURDAY, r) for r in SATURDAY_CLASSES] + [
        (SUNDAY, r) for r in SUNDAY_CLASSES
    ]
    _check_transcription([r for _day, r in rows])

    async with AsyncSessionLocal() as db:
        show_type = await _one(db, select(ShowType).where(ShowType.code == "APHA"))
        if show_type is None:
            sys.exit("No APHA show type in show_types.")
        clubs = {}
        for code in ("WSCA", "MNSPHC"):
            row = await _one(db, select(Association).where(Association.code == code))
            if row is None:
                sys.exit(
                    f"No {code} row in associations. Run "
                    f"database/migrate.ps1 — MNSPHC arrives in migration 105."
                )
            clubs[code] = row

        admin = await _require_user(db, ADMIN_EMAIL)
        staff = await _get_or_create_staff(db)

        venue = await _get_or_create_venue(db)
        judges = await _get_or_create_judges(db)

        # Converge rather than accumulate. Classes go first: shows cascade to
        # both classes and divisions, and classes.division_id is ON DELETE
        # RESTRICT, so clearing the children by hand keeps the order honest.
        previous = (
            await db.execute(select(Show.id).where(Show.name == SHOW_NAME))
        ).scalars().all()
        for show_id in previous:
            await db.execute(delete(Class).where(Class.show_id == show_id))
        if previous:
            await db.execute(delete(Show).where(Show.id.in_(previous)))
            await db.flush()

        show = Show(
            name=SHOW_NAME,
            venue_id=venue.id,
            show_type_id=show_type.id,
            start_date=SATURDAY,
            end_date=SUNDAY,
            status="DRAFT",
            # $4 per horse, per judge, all horses -- four judges.
            office_charge_cents=1600,
            office_charge_basis="per_horse",
            # The stall form is unambiguous: NO OUTSIDE SHAVINGS ALLOWED.
            shavings_ban_outside=True,
            created_by_user_id=admin.id,
        )
        db.add(show)
        await db.flush()

        for first, last, role, email in STAFF:
            user = staff[email]
            if role == "SHOW_MANAGER":
                db.add(ShowManager(show_id=show.id, user_id=user.id))
            else:
                db.add(ShowSecretary(show_id=show.id, user_id=user.id))

        # Both clubs are overlays on an APHA show, not second show types.
        # Neither prints a separate sanction fee — the club classes carry their
        # own per-judge entry fee instead ($8 MNSPHC, $5 WSCA), so per_class_fee
        # is zero and the money is on the classes.
        for code in ("MNSPHC", "WSCA"):
            db.add(
                ShowSanctioning(
                    show_id=show.id,
                    association_id=clubs[code].id,
                    per_class_fee_cents=0,
                )
            )
        for order, judge in enumerate(judges, start=1):
            db.add(ShowJudge(show_id=show.id, judge_id=judge.id, sort_order=order))

        ring = Ring(show_id=show.id, name="Main Arena", sort_order=1)
        db.add(ring)

        for order, fee in enumerate(SHOW_FEES, start=1):
            db.add(ShowFee(show_id=show.id, sort_order=order, **fee))

        disciplines: dict[str, Discipline] = {}
        for order, (name, score_type) in enumerate(DISCIPLINES, start=1):
            row = Discipline(
                show_id=show.id,
                name=name,
                sort_order=order,
                default_score_type=score_type,
            )
            db.add(row)
            disciplines[name] = row

        divisions: dict[str, Division] = {}
        for order, name in enumerate(BRACKETS, start=1):
            row = Division(show_id=show.id, name=name, sort_order=order)
            db.add(row)
            divisions[name] = row
        await db.flush()

        # Every (discipline, bracket) pair a class uses has to exist in
        # discipline_divisions first -- classes carries a composite FK onto it.
        pairs = {(r[3], r[4]) for _day, r in rows}
        for discipline_name, bracket_name in sorted(pairs):
            await db.execute(
                insert(discipline_divisions).values(
                    discipline_id=disciplines[discipline_name].id,
                    division_id=divisions[bracket_name].id,
                )
            )

        score_types = dict(DISCIPLINES)
        by_number: dict[str, Class] = {}
        for order, (day, (number, code, name, discipline, bracket, fee_key)) in enumerate(
            rows, start=1
        ):
            row = Class(
                show_id=show.id,
                ring_id=ring.id,
                discipline_id=disciplines[discipline].id,
                division_id=divisions[bracket].id,
                class_number=number,
                class_name=name,
                class_date=day,
                score_type=score_types[discipline],
                entry_fee_cents=FEE_CENTS[fee_key],
                sort_order=order,
            )
            db.add(row)
            by_number[number] = row
            if code:
                row.associations.append(
                    ClassAssociation(
                        show_type_id=show_type.id, association_class_code=code
                    )
                )
        await db.flush()

        for name, description, class_numbers in SIDE_POTS:
            pot = SidePot(
                show_id=show.id,
                name=name,
                description=description,
                entry_fee_cents=1000,
                payback_percent=100,
                scoring_method="sum_scores",
                eligibility_rule="any_class",
                payout_schedule=dict(DEFAULT_SIDE_POT_PAYOUT_SCHEDULE),
            )
            db.add(pot)
            await db.flush()
            for class_number in class_numbers:
                db.add(
                    SidePotClass(
                        side_pot_id=pot.id, class_id=by_number[class_number].id
                    )
                )

        futurity = Futurity(
            show_id=show.id,
            name=FUTURITY_NAME,
            description=FUTURITY_DESCRIPTION,
            entry_deadline=FUTURITY_DEADLINE,
            late_fee_cents=15000,
            office_fee_member_cents=1000,
            office_fee_nonmember_cents=2000,
        )
        db.add(futurity)
        await db.flush()

        for order, (tier_name, tier_description, amount) in enumerate(FUTURITY_TIERS):
            db.add(
                FuturityFeeTier(
                    futurity_id=futurity.id,
                    name=tier_name,
                    description=tier_description,
                    amount_cents=amount,
                    sort_order=order,
                )
            )

        # The lettered classes A-J are the futurity. Matched on "a single
        # letter", not on "not a digit" — the Grand & Reserve pairs are numbered
        # "2-3", "9-10" and so on, which is also not a digit, and folding those
        # into the futurity would charge eight championship roll-ups at $150 a
        # class.
        futurity_class_numbers = [
            number
            for number, *_ in SATURDAY_CLASSES + SUNDAY_CLASSES
            if len(number) == 1 and number.isalpha()
        ]
        if len(futurity_class_numbers) != 10:
            sys.exit(
                f"Expected 10 lettered futurity classes, found "
                f"{len(futurity_class_numbers)}: {futurity_class_numbers}"
            )
        for class_number in futurity_class_numbers:
            db.add(
                FuturityClass(
                    futurity_id=futurity.id, class_id=by_number[class_number].id
                )
            )

        for order, (division_name, members) in enumerate(FUTURITY_DIVISIONS):
            division = FuturityDivision(
                futurity_id=futurity.id,
                name=division_name,
                scoring_method="sum_placings",
                sort_order=order,
            )
            db.add(division)
            await db.flush()
            for class_number, scoring, group_name in members:
                db.add(
                    FuturityDivisionClass(
                        futurity_division_id=division.id,
                        class_id=by_number[class_number].id,
                        scoring=scoring,
                        group_name=group_name,
                    )
                )

        await db.commit()

        print(f"Show:        {show.name}")
        print(f"  id         {show.id}")
        print(f"  status     {show.status}   ({SATURDAY} to {SUNDAY})")
        print(f"  venue      {venue.name}, {venue.city} {venue.state}")
        print(f"  show type  {show_type.code} + "
              + " + ".join(sorted(clubs)) + " sanctioning")
        print(f"  staff      " + ", ".join(
            f"{f} {l} ({r.split('_')[-1].lower()})" for f, l, r, _e in STAFF
        ))
        print(f"  judges     {len(judges)} " + ", ".join(
            f"{j.first_name} {j.last_name}" for j in judges
        ))
        print(f"  classes    {len(rows)}  "
              f"({len(SATURDAY_CLASSES)} Sat / {len(SUNDAY_CLASSES)} Sun)")
        print(f"  disciplines {len(DISCIPLINES)}, brackets {len(BRACKETS)}, "
              f"pairs {len(pairs)}")
        print(f"  fees       {len(SHOW_FEES)} rows, office charge "
              f"${show.office_charge_cents / 100:.2f} {show.office_charge_basis}")
        print(f"  side pots  {len(SIDE_POTS)}")
        print(f"  futurity   {FUTURITY_NAME}: "
              f"{len(futurity_class_numbers)} classes, {len(FUTURITY_TIERS)} categories, "
              f"{len(FUTURITY_DIVISIONS)} Hi-Point divisions")
        codes = sum(1 for _d, r in rows if r[1])
        print(f"  APHA codes {codes} classes carry an APHA class code")


if __name__ == "__main__":
    asyncio.run(main())
