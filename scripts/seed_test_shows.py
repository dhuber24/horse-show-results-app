"""Rebuild the end-to-end test fixture: three OPEN shows, one per lifecycle stage.

Where `seed_demo_shows.py` gives you one show per association to exercise the
association-specific code, this gives you one show per *lifecycle stage* so the
whole exhibitor -> office -> gate -> results path can be walked in the UI:

    1. DRAFT     — future, fully set up, never published. Setup/publish path.
    2. PUBLISHED — future, open for self-registration. Five exhibitors already
                   signed up; the other seven are free for manual testing.
    3. ACTIVE    — spans today. Everyone signed up with back numbers, stalls,
                   shavings and camping reserved, classes entered, day one
                   judged, day two half-run at the gate.

DESTRUCTIVE: every existing show is deleted first (with its classes, entries,
results and sign-ups, via ON DELETE CASCADE). Shows are the only thing wiped —
users, exhibitors, horses, trainers, judges and venues are reused as they are,
so the cast of characters stays stable across runs. That also makes this
mutually exclusive with `seed_demo_shows.py`: running either removes the
other's shows.

Re-runnable: it always wipes and rebuilds, so it converges on the same fixture
rather than skipping work it has already done. Dates are relative to the run
date, so the ACTIVE show is always mid-flight and the PUBLISHED show is always
still ahead.

Run against the configured DATABASE_URL using the backend image:

    docker run --rm \
      -v "$PWD/backend:/app" -v "$PWD/scripts:/scripts" \
      -w /app -e PYTHONPATH=/app -e DATABASE_URL="$DATABASE_URL" \
      horse-show-results-app-backend python /scripts/seed_test_shows.py
"""

import asyncio
import random
import sys
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models import (
    Association,
    Class,
    CogginsOverrideAudit,
    Discipline,
    Division,
    Entry,
    Exhibitor,
    ExhibitorRegistration,
    Horse,
    HorseRegistration,
    Judge,
    Result,
    ResultAudit,
    Ring,
    Show,
    ShowContactMessage,
    ShowEntry,
    ShowEntryReservation,
    ShowFee,
    ShowGateSteward,
    ShowJudge,
    ShowManager,
    ShowSanctioning,
    ShowScribe,
    ShowSecretary,
    ShowType,
    ShowVerification,
    SidePot,
    SidePotClass,
    SidePotEntry,
    User,
    Venue,
    discipline_divisions,
)
# Reused rather than reimplemented: seeded placings must land exactly where the
# scribe screen would put them, or the fixture disagrees with the app the
# moment someone edits a score.
from routers.results import _recompute_places_from_scores

RNG_SEED = 20260812

SECRETARY_EMAIL = "secretary@test.com"
MANAGER_EMAIL = "manager@test.com"
GATE_STEWARD_EMAIL = "user@gatesteward.com"
# Created by scripts/seed_scribes.py — like the other staff accounts, this
# script reuses it and does not create it.
SCRIBE_EMAIL = "user@scribe.com"

# One OPEN class schedule, shared by all three shows: (discipline, score_type,
# [brackets]). Class names are "<bracket> <discipline>". The bracket set is
# sized to the real exhibitor roster — splitting youth into 13-and-under would
# leave one-entry classes, which are a poor test of placings.
SCHEDULE = [
    ("Halter",               "placement", ["Open", "Amateur", "Youth"]),
    ("Showmanship",          "pattern",   ["Open", "Amateur", "Youth"]),
    ("Western Pleasure",     "placement", ["Open", "Amateur", "Youth", "Walk-Trot"]),
    ("Western Horsemanship", "pattern",   ["Amateur", "Youth"]),
    ("Trail",                "pattern",   ["Open", "Amateur", "Youth"]),
    ("Ranch Riding",         "pattern",   ["Open", "Amateur"]),
    ("Barrel Racing",        "time",      ["Open", "Youth"]),
    ("Pole Bending",         "time",      ["Open", "Youth"]),
]

BRACKET_ORDER = ["Open", "Amateur", "Youth", "Walk-Trot"]

# (discipline, day_index, ring_index) — what runs where, per show length.
DAY_PLAN_2 = [
    ("Halter", 0, 0), ("Showmanship", 0, 1),
    ("Western Pleasure", 0, 0), ("Western Horsemanship", 0, 1),
    ("Trail", 1, 1), ("Ranch Riding", 1, 0),
    ("Barrel Racing", 1, 0), ("Pole Bending", 1, 0),
]
DAY_PLAN_3 = [
    ("Halter", 0, 0), ("Showmanship", 0, 1), ("Western Pleasure", 0, 0),
    ("Western Horsemanship", 1, 0), ("Trail", 1, 1), ("Ranch Riding", 1, 0),
    ("Barrel Racing", 2, 0), ("Pole Bending", 2, 0),
]

# Leading gate statuses per (day, ring) for the ACTIVE show; anything past the
# end of the tuple stays 'pending'. Day 0 is judged, day 1 is mid-flight, day 2
# has not started. At most one 'in_progress' per ring per day, which is what the
# gate router enforces.
ACTIVE_GATE_PLAN = {
    (0, 0): ("done", "done", "done", "done", "done", "done", "done"),
    (0, 1): ("done", "done", "done"),
    (1, 0): ("done", "done", "ready"),
    (1, 1): ("in_progress",),
    (2, 0): (),
}

# Exhibitors signed up for the PUBLISHED show. Deliberately a minority of the
# roster: the other seven are what you use to walk self-registration by hand.
PUBLISHED_SIGNUPS = [
    "Grant Halvorsen",
    "Rachel Lindqvist",
    "Sofia Delgado",
    "Caleb Ruthford",
    "Emily Stroud",
]


def _iso_offset(today: date, days: int) -> date:
    return today + timedelta(days=days)


def _age_on(dob, on: date):
    """Whole years old on a given day, or None when no birth date is on file."""
    if dob is None:
        return None
    return on.year - dob.year - ((on.month, on.day) < (dob.month, dob.day))


def _eligible(bracket: str, age) -> bool:
    """Whether an exhibitor of this age may enter this bracket.

    Unknown age counts as an adult: the two accounts with no birth date on file
    are the hand-made test logins, and locking them out of every Amateur class
    would make them useless for testing.
    """
    if bracket in ("Open", "Walk-Trot"):
        return True
    if bracket == "Amateur":
        return age is None or age >= 19
    if bracket == "Youth":
        return age is not None and age <= 18
    return False


def _horse_is_restricted_to_halter(horse: Horse, on: date) -> bool:
    """Under-three horses are shown in hand, not under saddle.

    Keeps the fixture honest: the roster contains a yearling, and entering it in
    Western Pleasure would produce data no show office would ever accept.
    """
    age = _age_on(horse.foaling_date, on)
    return age is not None and age < 3


class ShowSpec:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _show_specs(today: date) -> list[ShowSpec]:
    """The three shows, dated relative to the run date."""
    return [
        ShowSpec(
            key="draft",
            name="Cannon Valley Fall Finale Open Show",
            venue="Cannon Valley Equestrian Center",
            status="DRAFT",
            start=_iso_offset(today, 70),
            days=2,
            rings=["Main Arena", "Warm-Up Arena"],
            entry_fee_cents=2500,
            office_charge_cents=1500,
            office_charge_basis="per_back_number",
            shavings_ban_outside=True,
            clubs=[("WSCA", 200)],
            judges=[("Tonya", "Beaulieu", "tonya.beaulieu@example.com", "(319) 555-0366")],
            fees=[
                # Early rate still wide open — this is the show you use to check
                # that a fresh booking is quoted the discount.
                ("stall", "Stall (whole show)", 10000, "per_stall", None, 8000, 45),
                ("shavings", "Shavings", 800, "per_bag",
                 "Outside shavings are not permitted.", None, None),
                ("camping", "Camping", 3500, "per_night", "Electric hookup included.", None, None),
                ("late_entry", "Post-entry fee", 2500, "per_entry",
                 "Charged on entries taken after the close of entries.", None, None),
            ],
            signups=[],
            back_number_start=None,
            messages=[],
        ),
        ShowSpec(
            key="published",
            name="Prairie Rose Open Autumn Classic",
            venue="Prairie Rose Arena",
            status="PUBLISHED",
            start=_iso_offset(today, 33),
            days=2,
            rings=["Coliseum", "Outdoor Arena"],
            entry_fee_cents=2500,
            office_charge_cents=1500,
            office_charge_basis="per_back_number",
            shavings_ban_outside=False,
            # NSBA sanctioning puts the 6%-of-entry sanction line on every bill.
            clubs=[("NSBA", 300)],
            judges=[
                ("Sandra", "Whitcomb", "sandra.whitcomb@example.com", "(806) 555-0311"),
                ("Ray", "Hollingsworth", "ray.hollingsworth@example.com", "(940) 555-0322"),
            ],
            fees=[
                # Stall early rate has closed, camping's is still open. The
                # exhibitors seeded below booked stalls before the deadline, so
                # their bill keeps the old rate while a new booking pays 110.00 —
                # which is the whole point of pricing off reserved_at.
                ("stall", "Stall (whole show)", 11000, "per_stall", None, 8500, -7),
                ("shavings", "Shavings", 800, "per_bag", None, None, None),
                ("camping", "Camping", 4000, "per_night", "Dry camping only.", 3000, 14),
                ("late_entry", "Post-entry fee", 3000, "per_entry",
                 "Charged on entries taken after the close of entries.", None, None),
            ],
            signups=PUBLISHED_SIGNUPS,
            back_number_start=201,
            messages=[
                ("Dana Whitlock", "dana.whitlock@example.com", "(507) 555-0198",
                 "Stall availability", "Are there still stalls open for the Autumn Classic? "
                 "We would need three, arriving the day before.", "new", False),
                ("Pete Ramirez", "pete.ramirez@example.com", None,
                 "Walk-trot age limit", "Is the walk-trot western pleasure open to adult "
                 "riders, or youth only?", "new", False),
            ],
        ),
        ShowSpec(
            key="active",
            name="Black Hawk Summer Open Championship",
            venue="Black Hawk County Fairgrounds",
            status="ACTIVE",
            start=_iso_offset(today, -1),
            days=3,
            rings=["Show Arena", "Outdoor Arena"],
            entry_fee_cents=3000,
            # per_horse basis, so the office charge on the bill scales with the
            # horses an exhibitor brought rather than being a flat line.
            office_charge_cents=2000,
            office_charge_basis="per_horse",
            shavings_ban_outside=True,
            clubs=[("NSBA", 300), ("WSCA", 200)],
            judges=[
                ("Denise", "Marchetti", "denise.marchetti@example.com", "(512) 555-0344"),
                ("Curtis", "Blayne", "curtis.blayne@example.com", "(405) 555-0355"),
            ],
            fees=[
                # Both early deadlines are long past; the sign-ups below are
                # dated either side of them, so one show carries both rates.
                ("stall", "Stall (whole show)", 12000, "per_stall", None, 9500, -30),
                ("shavings", "Shavings", 900, "per_bag",
                 "Outside shavings are not permitted.", None, None),
                ("camping", "Camping", 4500, "per_night", "Electric hookup included.", 3500, -30),
                ("late_entry", "Post-entry fee", 3500, "per_entry",
                 "Charged on entries taken after the close of entries.", None, None),
            ],
            signups="ALL",
            back_number_start=101,
            messages=[
                ("Marla Cheswick", "marla.cheswick@example.com", "(319) 555-0142",
                 "Gate times for Sunday", "What time does the first class go in the show "
                 "arena on Sunday? We have a long haul home.", "new", False),
                ("Ben Aldritch", "ben.aldritch@example.com", None,
                 "Lost jacket", "I left a navy show jacket by the warm-up pen Saturday "
                 "afternoon. Has anything been turned in?", "read", False),
                ("Susan Ortiz", "susan.ortiz@example.com", "(563) 555-0177",
                 "Camping arrival", "We will be arriving late Friday night — is the "
                 "camping gate left open?", "archived", True),
            ],
        ),
    ]


async def _wipe_shows(db: AsyncSession) -> int:
    """Delete every show. Everything show-scoped follows via ON DELETE CASCADE.

    The two audit tables are cleared explicitly: their rows hang off entries and
    classes by SET NULL rather than CASCADE, so they would otherwise survive as
    history of shows that no longer exist.
    """
    await db.execute(delete(ResultAudit))
    await db.execute(delete(CogginsOverrideAudit))
    existing = (await db.execute(select(func.count()).select_from(Show))).scalar_one()
    await db.execute(delete(Show))
    await db.flush()
    return existing


async def _user_by_email(db: AsyncSession, email: str):
    return (
        await db.execute(select(User).where(func.lower(User.email) == email.lower()))
    ).scalar_one_or_none()


async def _load_roster(db: AsyncSession) -> list[dict]:
    """Exhibitors who have a horse they could actually show, with that horse.

    Reads the roster rather than inventing one — the point of this fixture is to
    exercise the app against the people and horses already on file.
    """
    exhibitors = (
        await db.execute(select(Exhibitor).order_by(Exhibitor.full_name))
    ).scalars().all()
    horses = (await db.execute(select(Horse))).scalars().all()
    by_owner: dict = {}
    for horse in horses:
        # created_by is what the self-registration horse picker reads, so it is
        # what decides whether this pairing is reachable in the UI at all.
        owner_id = horse.created_by_exhibitor_id or horse.owner_exhibitor_id
        if owner_id is None:
            continue
        by_owner.setdefault(owner_id, []).append(horse)

    roster = []
    for exhibitor in exhibitors:
        mounts = by_owner.get(exhibitor.id)
        if not mounts:
            continue
        roster.append({"exhibitor": exhibitor, "horse": sorted(mounts, key=lambda h: h.name)[0]})
    return roster


async def _get_or_create_judge(db: AsyncSession, first, last, email, phone) -> Judge:
    judge = (
        await db.execute(select(Judge).where(func.lower(Judge.email) == email.lower()))
    ).scalar_one_or_none()
    if judge is None:
        judge = Judge(first_name=first, last_name=last, email=email, phone=phone)
        db.add(judge)
        await db.flush()
    return judge


async def _build_show(
    db: AsyncSession,
    spec: ShowSpec,
    today: date,
    show_type: ShowType,
    venues: dict,
    associations: dict,
    staff: dict,
    roster: list[dict],
    rng: random.Random,
) -> dict:
    end = spec.start + timedelta(days=spec.days - 1)

    show = Show(
        name=spec.name,
        venue_id=venues[spec.venue].id,
        show_type_id=show_type.id,
        start_date=spec.start,
        end_date=end,
        status=spec.status,
        office_charge_cents=spec.office_charge_cents,
        office_charge_basis=spec.office_charge_basis,
        shavings_ban_outside=spec.shavings_ban_outside,
        created_by_user_id=staff["manager"].id if staff["manager"] else None,
    )
    db.add(show)
    await db.flush()

    # ── Staff, sanctioning, judges, fees ─────────────────────────────────────
    if staff["secretary"]:
        db.add(ShowSecretary(show_id=show.id, user_id=staff["secretary"].id))
    if staff["manager"]:
        db.add(ShowManager(show_id=show.id, user_id=staff["manager"].id))
    if staff["gate_steward"]:
        db.add(ShowGateSteward(show_id=show.id, user_id=staff["gate_steward"].id))
    if staff["scribe"]:
        db.add(ShowScribe(show_id=show.id, user_id=staff["scribe"].id))

    for code, per_class_cents in spec.clubs:
        db.add(ShowSanctioning(
            show_id=show.id,
            association_id=associations[code].id,
            per_class_fee_cents=per_class_cents,
        ))

    for i, (first, last, email, phone) in enumerate(spec.judges):
        judge = await _get_or_create_judge(db, first, last, email, phone)
        db.add(ShowJudge(show_id=show.id, judge_id=judge.id, sort_order=i))

    fees: dict[str, ShowFee] = {}
    for i, (code, label, cents, unit, notes, early_cents, early_offset) in enumerate(spec.fees):
        fee = ShowFee(
            show_id=show.id,
            code=code,
            label=label,
            amount_cents=cents,
            unit=unit,
            notes=notes,
            sort_order=i,
            # Written as a pair or not at all — half of one is rejected by the
            # fee endpoints and would be a discount that never fires.
            early_amount_cents=early_cents if early_offset is not None else None,
            early_deadline=_iso_offset(today, early_offset) if early_offset is not None else None,
        )
        db.add(fee)
        fees[code] = fee

    # ── Rings, disciplines, brackets, memberships ────────────────────────────
    rings = []
    for i, ring_name in enumerate(spec.rings):
        ring = Ring(show_id=show.id, name=ring_name, sort_order=i)
        db.add(ring)
        rings.append(ring)

    disciplines: dict[str, Discipline] = {}
    for i, (name, score_type, _brackets) in enumerate(SCHEDULE):
        discipline = Discipline(
            show_id=show.id, name=name, sort_order=i, default_score_type=score_type
        )
        db.add(discipline)
        disciplines[name] = discipline

    divisions: dict[str, Division] = {}
    for i, bracket in enumerate(BRACKET_ORDER):
        division = Division(show_id=show.id, name=bracket, sort_order=i)
        db.add(division)
        divisions[bracket] = division
    await db.flush()

    # The composite FK on `classes` refuses any (discipline, bracket) pair that
    # is not registered here first.
    memberships = {
        (disciplines[name].id, divisions[bracket].id)
        for name, _score_type, brackets in SCHEDULE
        for bracket in brackets
    }
    await db.execute(
        discipline_divisions.insert(),
        [{"discipline_id": d, "division_id": v} for d, v in sorted(memberships, key=str)],
    )

    # ── Classes ──────────────────────────────────────────────────────────────
    day_plan = DAY_PLAN_3 if spec.days >= 3 else DAY_PLAN_2
    score_types = {name: st for name, st, _b in SCHEDULE}
    brackets_by_discipline = {name: b for name, _st, b in SCHEDULE}

    classes: list[Class] = []
    class_number = 1
    for discipline_name, day_index, ring_index in day_plan:
        ring = rings[ring_index % len(rings)]
        class_date = spec.start + timedelta(days=day_index)
        for bracket in brackets_by_discipline[discipline_name]:
            cls = Class(
                show_id=show.id,
                ring_id=ring.id,
                discipline_id=disciplines[discipline_name].id,
                division_id=divisions[bracket].id,
                class_number=str(class_number),
                class_name=f"{bracket} {discipline_name}",
                class_date=class_date,
                status="OPEN",
                score_type=score_types[discipline_name],
                entry_fee_cents=spec.entry_fee_cents,
                sort_order=class_number,
            )
            cls._day_index = day_index
            cls._ring_index = ring_index
            cls._bracket = bracket
            db.add(cls)
            classes.append(cls)
            class_number += 1
    await db.flush()

    # ── Contact messages ─────────────────────────────────────────────────────
    for name, email, phone, subject, body, status, handled in spec.messages:
        db.add(ShowContactMessage(
            show_id=show.id,
            sender_name=name,
            sender_email=email,
            sender_phone=phone,
            subject=subject,
            message=body,
            status=status,
            handled_by_user_id=staff["secretary"].id if handled and staff["secretary"] else None,
            handled_at=datetime.now(timezone.utc) - timedelta(days=1) if handled else None,
        ))

    summary = {
        "show": show,
        "classes": len(classes),
        "signups": 0,
        "entries": 0,
        "results": 0,
    }
    if not spec.signups:
        return summary

    # ── Sign-ups, reservations, back numbers ─────────────────────────────────
    if spec.signups == "ALL":
        participants = list(roster)
    else:
        wanted = set(spec.signups)
        participants = [p for p in roster if p["exhibitor"].full_name in wanted]

    show_entries: dict = {}
    back_number = spec.back_number_start
    for person in participants:
        exhibitor = person["exhibitor"]
        # Booked well before the show. Half the ACTIVE roster booked early
        # enough to have caught the early rate and half did not, so one bill
        # run covers both branches of fee_rate_cents.
        booked_offset = rng.choice([-52, -45, -38, -21, -14, -9])
        reserved_at = _iso_offset(today, booked_offset)
        show_entry = ShowEntry(
            show_id=show.id,
            exhibitor_id=exhibitor.id,
            back_number=back_number,
            registered_at=datetime.combine(reserved_at, datetime.min.time(), timezone.utc),
            arrival_date=spec.start - timedelta(days=1),
            departure_date=spec.start + timedelta(days=spec.days - 1),
            registration_notes=rng.choice([
                None, None, None,
                "Please stall us next to the Reyes group if possible.",
                "Arriving late Friday evening.",
                "Two horses on one trailer — need adjacent stalls.",
            ]),
        )
        db.add(show_entry)
        await db.flush()
        show_entries[exhibitor.id] = show_entry
        back_number += 1

        stalls = rng.choice([1, 1, 1, 2])
        bags = rng.choice([2, 3, 4, 6])
        nights = rng.choice([0, 0, 2, 3])
        for code, quantity in (("stall", stalls), ("shavings", bags), ("camping", nights)):
            if quantity <= 0:
                continue
            db.add(ShowEntryReservation(
                show_entry_id=show_entry.id,
                show_fee_id=fees[code].id,
                quantity=quantity,
                reserved_at=reserved_at,
            ))
        summary["signups"] += 1

    # ── Class entries ────────────────────────────────────────────────────────
    entries_by_class: dict = {}
    for cls in classes:
        pool = []
        for person in participants:
            exhibitor, horse = person["exhibitor"], person["horse"]
            age = _age_on(exhibitor.date_of_birth, spec.start)
            if not _eligible(cls._bracket, age):
                continue
            if (
                _horse_is_restricted_to_halter(horse, spec.start)
                and not cls.class_name.endswith("Halter")
            ):
                continue
            pool.append(person)

        if not pool:
            entries_by_class[cls.id] = []
            continue

        target = max(2, round(len(pool) * rng.uniform(0.55, 0.9)))
        chosen = rng.sample(pool, min(len(pool), target))

        rows = []
        for person in chosen:
            entry = Entry(
                class_id=cls.id,
                exhibitor_id=person["exhibitor"].id,
                horse_id=person["horse"].id,
                status="ENTERED",
            )
            db.add(entry)
            rows.append(entry)
            summary["entries"] += 1
        entries_by_class[cls.id] = rows
    await db.flush()

    if spec.status != "ACTIVE":
        return summary

    # ── Gate state and judged results (ACTIVE show only) ─────────────────────
    by_day_ring: dict = {}
    for cls in classes:
        by_day_ring.setdefault((cls._day_index, cls._ring_index), []).append(cls)

    scored: list[Class] = []
    for key, group in by_day_ring.items():
        plan = ACTIVE_GATE_PLAN.get(key, ())
        for i, cls in enumerate(group):
            gate_status = plan[i] if i < len(plan) else "pending"
            cls.gate_status = gate_status
            # A class that has run or is running is closed to new entries.
            cls.status = "CLOSED" if gate_status in ("done", "in_progress") else "OPEN"

            rows = entries_by_class.get(cls.id, [])
            if gate_status in ("done", "in_progress", "ready"):
                order = list(rows)
                rng.shuffle(order)
                for position, entry in enumerate(order, start=1):
                    entry.gate_order = position
                    entry.gate_checked_in = True
            if gate_status == "done" and rows:
                scored.append(cls)

    # One scratch on the day, so the entry list is not uniformly perfect.
    if scored:
        dq_class = scored[0]
        dq_rows = entries_by_class.get(dq_class.id, [])
        if len(dq_rows) > 2:
            dq_rows[-1].is_disqualified = True

    for cls in scored:
        rows = [e for e in entries_by_class.get(cls.id, []) if not e.is_disqualified]
        if not rows:
            continue
        placed = list(rows)
        rng.shuffle(placed)
        if cls.score_type == "placement":
            for place, entry in enumerate(placed, start=1):
                db.add(Result(class_id=cls.id, entry_id=entry.id, place=place, is_tie=False))
        elif cls.score_type == "pattern":
            # Descending scores in the order drawn; place is recomputed below
            # from raw_score, which is the source of truth for pattern classes.
            score = rng.uniform(74.0, 79.5)
            for entry in placed:
                db.add(Result(
                    class_id=cls.id, entry_id=entry.id, place=1, raw_score=round(score, 1)
                ))
                score -= rng.uniform(0.5, 2.5)
        else:  # time
            seconds = rng.uniform(14.8, 16.4)
            for entry in placed:
                db.add(Result(
                    class_id=cls.id, entry_id=entry.id, place=1, raw_score=round(seconds, 3)
                ))
                seconds += rng.uniform(0.15, 1.4)
        summary["results"] += len(placed)
    await db.flush()

    for cls in scored:
        await _recompute_places_from_scores(cls, db)

    # ── Desk paperwork sign-offs ─────────────────────────────────────────────
    verifier = staff["secretary"]
    verified_at = datetime.now(timezone.utc) - timedelta(days=1)
    for person in participants[: max(1, len(participants) * 2 // 3)]:
        exhibitor, horse = person["exhibitor"], person["horse"]

        if horse.foaling_date is not None:
            db.add(ShowVerification(
                show_id=show.id,
                kind="horse_age",
                horse_id=horse.id,
                # Snapshot of what was on file, exactly as the office endpoint
                # derives it — a mismatch is what makes a check read as stale.
                verified_value=horse.foaling_date.isoformat(),
                verified_by=verifier.id if verifier else None,
                verified_by_name=verifier.full_name if verifier else None,
                created_at=verified_at,
            ))

        horse_regs = (await db.execute(
            select(HorseRegistration).where(HorseRegistration.horse_id == horse.id)
        )).scalars().all()
        for registration in horse_regs[:1]:
            db.add(ShowVerification(
                show_id=show.id,
                kind="horse_registration",
                horse_id=horse.id,
                association_id=registration.association_id,
                verified_value=registration.registration_number,
                verified_by=verifier.id if verifier else None,
                verified_by_name=verifier.full_name if verifier else None,
                created_at=verified_at,
            ))

        memberships = (await db.execute(
            select(ExhibitorRegistration).where(
                ExhibitorRegistration.exhibitor_id == exhibitor.id
            )
        )).scalars().all()
        for membership in memberships[:1]:
            db.add(ShowVerification(
                show_id=show.id,
                kind="exhibitor_membership",
                exhibitor_id=exhibitor.id,
                association_id=membership.association_id,
                verified_value=membership.member_number,
                verified_by=verifier.id if verifier else None,
                verified_by_name=verifier.full_name if verifier else None,
                created_at=verified_at,
            ))

    # ── Side pot ─────────────────────────────────────────────────────────────
    pot_classes = [c for c in classes if c.class_name.endswith(("Western Pleasure", "Trail"))]
    if pot_classes:
        pot = SidePot(
            show_id=show.id,
            name="All-Around Jackpot",
            description="Combined placings across the pleasure and trail classes. "
                        "Opt in at the office by the end of day one.",
            entry_fee_cents=2500,
            payback_percent=90,
            scoring_method="sum_placings",
            eligibility_rule="any_class",
            payout_schedule={"1-3": [100], "4-7": [70, 30], "8-15": [60, 30, 10]},
            status="open",
        )
        db.add(pot)
        await db.flush()
        for cls in pot_classes:
            db.add(SidePotClass(side_pot_id=pot.id, class_id=cls.id))
        for person in rng.sample(participants, min(6, len(participants))):
            db.add(SidePotEntry(
                side_pot_id=pot.id,
                show_entry_id=show_entries[person["exhibitor"].id].id,
                paid=True,
            ))

    return summary


async def seed(db: AsyncSession) -> None:
    today = date.today()
    rng = random.Random(RNG_SEED)

    show_type = (
        await db.execute(select(ShowType).where(ShowType.code == "OPEN"))
    ).scalar_one_or_none()
    if show_type is None:
        sys.exit("No OPEN show type found. Apply migrations and seed show_types first.")

    associations = {
        a.code: a for a in (await db.execute(select(Association))).scalars().all()
    }
    venues = {v.name: v for v in (await db.execute(select(Venue))).scalars().all()}

    staff = {
        "secretary": await _user_by_email(db, SECRETARY_EMAIL),
        "manager": await _user_by_email(db, MANAGER_EMAIL),
        "gate_steward": await _user_by_email(db, GATE_STEWARD_EMAIL),
        "scribe": await _user_by_email(db, SCRIBE_EMAIL),
    }
    for role, user in staff.items():
        if user is None:
            print(f"  ! no {role} account found — shows will be created without one")

    roster = await _load_roster(db)
    if not roster:
        sys.exit("No exhibitors with horses on file. Run seed_demo_people.py first.")

    specs = _show_specs(today)
    for spec in specs:
        if spec.venue not in venues:
            sys.exit(f"Venue not found: {spec.venue}")
        for code, _fee in spec.clubs:
            if code not in associations:
                sys.exit(f"Association not found: {code}")

    removed = await _wipe_shows(db)
    print(f"Removed {removed} existing show(s).\n")

    print(f"Roster: {len(roster)} exhibitors with a horse.\n")
    for spec in specs:
        result = await _build_show(
            db, spec, today, show_type, venues, associations, staff, roster, rng
        )
        show = result["show"]
        print(f"  {show.name}")
        print(f"    OPEN | {show.status} | {show.start_date} - {show.end_date} | {spec.venue}")
        print(
            f"    classes: {result['classes']} | sign-ups: {result['signups']} | "
            f"entries: {result['entries']} | results: {result['results']}"
        )

    await db.commit()
    print("\nDone.")


async def main() -> None:
    async with AsyncSessionLocal() as db:
        await seed(db)


if __name__ == "__main__":
    asyncio.run(main())
