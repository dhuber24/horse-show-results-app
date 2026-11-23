"""Open the WSCA Championship Horse Show for registration, half full of people.

The show itself -- 107 classes, two rings, stall periods, fees, side pots -- came
off the uploaded 2026 show bill and is not rebuilt here. That bill's dates are
behind us (Sep 24-28, 2026, entries closing Aug 23), so nobody can sign up for
it. This moves it forward and fills it the way `seed_test_shows.py` fills its
PUBLISHED show: some exhibitors already signed up, the rest left free so class
registration can be walked by hand.

  * Dates. The whole show moves by whole weeks to a Thursday at least three
    weeks out (or `--start`), so the bill's Thursday-Monday shape and every
    class's day hold: classes, stall periods, move-in dates, stalls opening.
    Online sign-up then closes ten days before the show, the stall early rate
    ends the same day (the bill tied the two), and exhibitors' class changes
    close the day before the show (`self_entry_closes = on_date`) -- the bill's
    import had made every class change the office's.
  * Six families, twelve riders (all @example.com, password 12345678), signed
    up with WSCA memberships, back numbers on their horses (this show numbers
    horses), stalls by period -- Full show, Pleasure, Games -- with tack stalls,
    a tie stall, an Early Move-In Pass, electrical and a parking permit.
  * Their entries follow the bill: each rider only in their own age band as of
    January 1 (PW 10 & under, Jr 11-13, Int 14-17, Sr 18-34, Sr+ 35-49, Sr++
    50+, and the 17 & Under / 18 & Over splits), pleasure riders on the first
    two days, game riders on the last three, jackpot classes only with a horse
    shown in a like class. Team classes are entered with their teams --
    Tandem Bareback, Rescue Race, Ribbon Race, 4-In-A-Line -- plus one tandem
    team with nobody named yet, so the short-team flag shows. Barrel riders buy
    into the 5D side pot.
  * Not entered by anybody: pony, walk-trot, adaptive, driving, saddle seat,
    non-stock, futurity and maturity classes. Those need ponies, qualified
    riders or young horses the cast does not have.

Left free for testing: Jolene and Maddie Hasselquist, Heather and Harper
Solberg, Lily Braaten, Megan Thorsrud, Paul Rydberg, Emma Kowalczyk -- and any
account of your own.

Re-runnable. Each run removes the twelve riders' sign-ups, entries and horse
numbers at this show and rebuilds them; nobody else's sign-up or entry at the
show is touched, the free exhibitors' included. People and horses
are reused from `seed_mnsphc_live_show.py`, which must have run first.

    DBURL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
    docker run --rm \\
      -v "$PWD/backend:/app" -v "$PWD/scripts:/scripts" \\
      -w /app -e PYTHONPATH=/app -e DATABASE_URL="$DBURL" \\
      horse-show-results-app-backend python /scripts/seed_wsca_champ_show.py

`--start YYYY-MM-DD` puts the first show day somewhere else (it must be a
Thursday, as on the bill).
"""

from __future__ import annotations

import argparse
import asyncio
import random
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select, update

from database import AsyncSessionLocal
from models import (
    Association,
    Class,
    Discipline,
    Division,
    Entry,
    EntryTeamMember,
    Exhibitor,
    ExhibitorHorse,
    ExhibitorRegistration,
    Futurity,
    Horse,
    Show,
    ShowEntry,
    ShowEntryReservation,
    ShowFee,
    ShowHorseNumber,
    ShowRegistrationDraft,
    ShowRegistrationProfile,
    ShowStallPeriod,
    SidePot,
    SidePotEntry,
    User,
)

SHOW_NAME = "WSCA Championship Horse Show"
SHOW_TZ = ZoneInfo("America/Chicago")
RANDOM_SEED = 20261122
EMAIL_DOMAIN = "@example.com"
FIRST_BACK_NUMBER = 101
PASSWORD_NOTE = "12345678"

# Days before the show: online sign-up's last day (and the stall early rate's,
# which the bill ties to it), and the last day exhibitors change their classes.
SIGNUP_CLOSES_DAYS_BEFORE = 10
CLASS_CHANGES_CLOSE_DAYS_BEFORE = 1


@dataclass
class Rider:
    email: str
    style: str                 # "pleasure", "games" or "allround"
    pleasure_horse: str | None
    games_horse: str | None
    pleasure: tuple[str, ...]  # discipline groups ridden on the pleasure days


WESTERN = ("Showmanship", "Western Pleasure", "Western Horsemanship")
ENGLISH = ("Hunt Seat Pleasure", "Hunt Seat Equitation")
RANCH = ("Ranch Pleasure", "Ranch Riding")
FUN = ("Bareback", "Egg & Spoon")

# Six families. Each rider shows one horse on the pleasure days and one in the
# games; a kid on an all-round horse shows the same one in both.
RIDERS = [
    Rider("travis.lindqvist", "games", None, "Cash N Carry Paint", ()),
    Rider("ava.lindqvist", "allround", "Pretty In Pistols", "Lindqvist Legacy", WESTERN + ENGLISH + ("Egg & Spoon",)),
    Rider("brad.engebretson", "pleasure", "Ranchin In The Rain", None, RANCH + ("Western Pleasure",)),
    Rider("sophie.engebretson", "allround", "Hunt Club Hottie", "Mister Good Bars", WESTERN + ENGLISH + ("Bareback",)),
    Rider("carla.wendt", "pleasure", "Blue Suede Blessing", None, WESTERN + RANCH),
    Rider("jack.wendt", "allround", "Jacks Lucky Charm", "Jacks Lucky Charm", WESTERN + FUN),
    Rider("dana.kuehn", "games", None, "Quick Silver Paint", ()),
    Rider("ella.kuehn", "allround", "Ellas Painted Pony", "Ellas Painted Pony", WESTERN + RANCH + ("Egg & Spoon",)),
    Rider("stacy.rasmussen", "games", None, "Barrel Of Dynamite", ()),
    Rider("chloe.rasmussen", "allround", "Chloes Checkmate", "Smart Lil Paintbrush", WESTERN + ENGLISH),
    Rider("renee.gunderson", "pleasure", "Ranch Hand Rowdy", None, RANCH + ("Western Pleasure", "Bareback")),
    Rider("owen.gunderson", "games", None, "Old Timer Tobiano", ()),
]

GAMES = ("Pennant Race", "Pole Bending", "Key Race", "Jumping Figure 8", "Barrel Racing", "Egg & Spoon")
GAMES_ODDS = {"Jumping Figure 8": 0.5}

# Classes nobody in the cast can honestly enter -- see the module docstring.
SKIP_WORDS = (
    "Pony", "Walk Trot", "Assisted", "Unassisted", "Driving", "Saddle Seat",
    "Non-Stock", "Futurity", "Maturity", "Snaffle Bit",
)

# Jackpot class -> the like class a horse must have shown in, and who enters.
JACKPOTS = {
    "$500 Added Jackpot Western Pleasure": ("Western Pleasure", ["ava.lindqvist", "sophie.engebretson", "carla.wendt", "brad.engebretson"]),
    "$500 Added Jackpot Ranch Pleasure": ("Ranch Pleasure", ["brad.engebretson", "renee.gunderson", "carla.wendt"]),
    "$500 Added Jackpot English Pleasure": ("Hunt Seat Pleasure", ["sophie.engebretson", "ava.lindqvist"]),
}

# Team class -> teams of (rider, horse) seats; the first seat enters and pays.
# A horse of None rides the team's horse (Tandem Bareback, Rescue Race).
TEAMS = {
    "Tandem Bareback": [
        [("sophie.engebretson", "Hunt Club Hottie"), ("ava.lindqvist", None)],
        # Entered with nobody named yet: the desk and class page flag it short.
        [("jack.wendt", "Jacks Lucky Charm")],
    ],
    "4-In-A-Line": [
        [("stacy.rasmussen", "Barrel Of Dynamite"), ("dana.kuehn", "Quick Silver Paint"),
         ("travis.lindqvist", "Cash N Carry Paint"), ("owen.gunderson", "Old Timer Tobiano")],
    ],
    "Rescue Race": [
        [("ella.kuehn", "Ellas Painted Pony"), ("dana.kuehn", None)],
    ],
    "Ribbon Race": [
        [("owen.gunderson", "Old Timer Tobiano"), ("travis.lindqvist", "Cash N Carry Paint")],
        [("chloe.rasmussen", "Smart Lil Paintbrush"), ("stacy.rasmussen", "Barrel Of Dynamite")],
    ],
}

# WSCA numbers for the riders the cast left without one.
NEW_WSCA_NUMBERS = {
    "ava.lindqvist": "W51150", "jack.wendt": "W51151",
    "dana.kuehn": "W51152", "chloe.rasmussen": "W51153",
}

FREE = [
    "jolene.hasselquist", "maddie.hasselquist", "heather.solberg", "harper.solberg",
    "lily.braaten", "megan.thorsrud", "paul.rydberg", "emma.kowalczyk",
]


def age_on(dob: date, on: date) -> int:
    return on.year - dob.year - ((on.month, on.day) < (dob.month, dob.day))


def rider_band(division: str, discipline: str) -> tuple[int, int] | None:
    """Rider ages a class takes, from its division as printed; None when the
    division is not a rider age band (horse ages, ponies, Unassigned)."""
    d = division.replace(".", "").strip()
    if discipline == "Egg & Spoon" and d in ("Jr", "Sr"):
        return (0, 17) if d == "Jr" else (18, 200)
    return {
        "PW": (0, 10),
        "Jr": (11, 13),
        "Int": (14, 17),
        "Sr": (18, 34),
        "Sr+": (35, 49),
        "Sr++": (50, 200),
        "Jr 17 & Under": (0, 17),
        "Sr 18 & Over": (18, 200),
        "Sr+ 35 & Over": (35, 200),
    }.get(d)


def default_start(today: date) -> date:
    """The first Thursday at least three weeks out."""
    day = today + timedelta(days=21)
    return day + timedelta(days=(3 - day.weekday()) % 7)


async def _one(db, stmt):
    return (await db.execute(stmt)).scalars().first()


async def seed(start: date | None) -> None:
    rng = random.Random(RANDOM_SEED)
    now = datetime.now(timezone.utc)
    today = now.astimezone(SHOW_TZ).date()

    async with AsyncSessionLocal() as db:
        show = await _one(db, select(Show).where(Show.name == SHOW_NAME))
        if show is None:
            sys.exit(f"No show named {SHOW_NAME!r} -- upload the show bill first.")

        # ── Dates ────────────────────────────────────────────────────────────
        start = start or default_start(today)
        if start.weekday() != 3:
            sys.exit(f"--start {start} is a {start:%A}; the bill's show starts on a Thursday.")
        delta = start - show.start_date
        if delta.days % 7:
            sys.exit("internal: the show is not on a Thursday now; refusing a shift that moves weekdays")
        if delta:
            show.start_date += delta
            show.end_date += delta
            if show.stalls_open_date:
                show.stalls_open_date += delta
            await db.execute(update(Class).where(Class.show_id == show.id)
                             .values(class_date=Class.class_date + delta))
            await db.execute(update(ShowStallPeriod).where(ShowStallPeriod.show_id == show.id).values(
                move_in_date=ShowStallPeriod.move_in_date + delta,
                move_out_date=ShowStallPeriod.move_out_date + delta,
            ))
            await db.execute(update(ShowFee).where(ShowFee.show_id == show.id).values(
                move_in_date=ShowFee.move_in_date + delta,
                move_in_end_date=ShowFee.move_in_end_date + delta,
            ))
            await db.execute(update(Futurity).where(Futurity.show_id == show.id)
                             .values(entry_deadline=Futurity.entry_deadline + delta))
        show.entry_deadline = start - timedelta(days=SIGNUP_CLOSES_DAYS_BEFORE)
        if show.entry_deadline < today:
            sys.exit(f"Sign-up would close {show.entry_deadline}, already past; pick a later --start.")
        await db.execute(update(ShowFee).where(ShowFee.show_id == show.id, ShowFee.early_deadline.is_not(None))
                         .values(early_deadline=show.entry_deadline))
        show.self_entry_closes = "on_date"
        show.self_entry_closes_on = start - timedelta(days=CLASS_CHANGES_CLOSE_DAYS_BEFORE)
        show.status = "PUBLISHED"
        await db.flush()

        # ── People ───────────────────────────────────────────────────────────
        wanted = [r.email + EMAIL_DOMAIN for r in RIDERS] + [f + EMAIL_DOMAIN for f in FREE]
        rows = (await db.execute(
            select(User.email, Exhibitor).join(Exhibitor, Exhibitor.user_id == User.id)
            .where(User.email.in_(wanted))
        )).all()
        people = {email.split("@")[0]: ex for email, ex in rows}
        missing = [r.email for r in RIDERS if r.email not in people]
        if missing:
            sys.exit(f"Missing exhibitors {missing}; run scripts/seed_mnsphc_live_show.py first.")

        # Horses each rider may show: their own, and those they are linked to.
        horses_by_name: dict[str, Horse] = {}
        access: dict[str, set] = defaultdict(set)
        ids = {ex.id: key for key, ex in people.items()}
        for horse in (await db.execute(select(Horse).where(Horse.owner_exhibitor_id.in_(ids)))).scalars():
            horses_by_name[horse.name] = horse
            access[ids[horse.owner_exhibitor_id]].add(horse.id)
        for link in (await db.execute(select(ExhibitorHorse).where(ExhibitorHorse.exhibitor_id.in_(ids)))).scalars():
            access[ids[link.exhibitor_id]].add(link.horse_id)

        def horse(name: str | None, rider: str) -> Horse | None:
            if name is None:
                return None
            h = horses_by_name.get(name)
            if h is None or h.id not in access[rider]:
                sys.exit(f"{rider} cannot show {name!r}: not their horse or linked to them.")
            return h

        # ── Clear this script's last run ─────────────────────────────────────
        # Only the riders this script signs up: the free exhibitors' sign-ups
        # are whatever was walked by hand, and a re-run leaves them be.
        cast_ids = [people[r.email].id for r in RIDERS]
        class_ids = select(Class.id).where(Class.show_id == show.id)
        await db.execute(delete(Entry).where(Entry.class_id.in_(class_ids), Entry.exhibitor_id.in_(cast_ids)))
        await db.execute(delete(ShowEntry).where(ShowEntry.show_id == show.id, ShowEntry.exhibitor_id.in_(cast_ids)))
        await db.execute(delete(ShowRegistrationProfile).where(
            ShowRegistrationProfile.show_id == show.id, ShowRegistrationProfile.exhibitor_id.in_(cast_ids)))
        await db.execute(delete(ShowRegistrationDraft).where(
            ShowRegistrationDraft.show_id == show.id, ShowRegistrationDraft.exhibitor_id.in_(cast_ids)))
        await db.execute(delete(ShowHorseNumber).where(
            ShowHorseNumber.show_id == show.id,
            ShowHorseNumber.horse_id.in_([h.id for h in horses_by_name.values()
                                          if h.owner_exhibitor_id in cast_ids])))
        await db.flush()

        # ── WSCA memberships ─────────────────────────────────────────────────
        wsca = await _one(db, select(Association).where(Association.code == "WSCA"))
        held = set((await db.execute(select(ExhibitorRegistration.exhibitor_id).where(
            ExhibitorRegistration.association_id == wsca.id))).scalars())
        for key, number in NEW_WSCA_NUMBERS.items():
            if people[key].id not in held:
                db.add(ExhibitorRegistration(exhibitor_id=people[key].id, association_id=wsca.id,
                                             member_number=number))

        # ── Classes ──────────────────────────────────────────────────────────
        classes = (await db.execute(
            select(Class, Discipline.name, Division.name)
            .outerjoin(Discipline, Discipline.id == Class.discipline_id)
            .outerjoin(Division, Division.id == Class.division_id)
            .where(Class.show_id == show.id)
        )).all()
        by_name = {c.class_name: c for c, _, _ in classes}
        age_day = date(start.year, 1, 1)  # "Class & age divisions determined as of January 1"

        entries: list[tuple[Class, str, Horse]] = []
        horse_in_class: set = set()
        days_shown: dict = defaultdict(set)  # horse id -> show-day indexes

        def enter(cls: Class, rider: str, h: Horse) -> Entry | None:
            if (cls.id, h.id) in horse_in_class:
                return None
            horse_in_class.add((cls.id, h.id))
            entries.append((cls, rider, h))
            days_shown[h.id].add((cls.class_date - start).days)
            row = Entry(class_id=cls.id, exhibitor_id=people[rider].id, horse_id=h.id, status="ENTERED")
            db.add(row)
            return row

        for r in RIDERS:
            ex = people[r.email]
            age = age_on(ex.date_of_birth, age_day)
            for cls, discipline, division in sorted(classes, key=lambda t: (t[0].class_date, t[0].sort_order or 0)):
                if cls.team_size or "Jackpot" in cls.class_name or any(w in cls.class_name for w in SKIP_WORDS):
                    continue
                band = rider_band(division or "", discipline or "")
                if band is None or not band[0] <= age <= band[1]:
                    continue
                pleasure_day = (cls.class_date - start).days <= 1
                if pleasure_day and discipline in r.pleasure and r.pleasure_horse:
                    if rng.random() < 0.85:
                        enter(cls, r.email, horse(r.pleasure_horse, r.email))
                elif not pleasure_day and discipline in GAMES and r.games_horse:
                    if rng.random() < GAMES_ODDS.get(discipline, 0.85):
                        enter(cls, r.email, horse(r.games_horse, r.email))

        # Jackpots: only on a horse already shown in a like class.
        for class_name, (like, riders) in JACKPOTS.items():
            cls = by_name[class_name]
            for rider in riders:
                shown = [h for c, who, h in entries
                         if who == rider and next(d for k, d, _ in classes if k.id == c.id) == like]
                if shown:
                    enter(cls, rider, shown[0])

        # Teams.
        team_count = 0
        for class_name, teams in TEAMS.items():
            cls = by_name[class_name]
            for team in teams:
                (lead, lead_horse), *rest = team
                row = enter(cls, lead, horse(lead_horse, lead))
                if row is None:
                    continue
                row.team_members = [
                    EntryTeamMember(exhibitor_id=people[who].id, horse_id=horse(h, who).id if h else None,
                                    position=n)
                    for n, (who, h) in enumerate(rest, start=2)
                ]
                for who, h in rest:
                    if h:
                        days_shown[horses_by_name[h].id].add((cls.class_date - start).days)
                team_count += 1
        await db.flush()

        # ── Sign-ups ─────────────────────────────────────────────────────────
        show_entries: dict[str, ShowEntry] = {}
        for r in RIDERS:
            registered = now - timedelta(days=rng.randint(2, 18), hours=rng.randint(0, 10))
            first_day = 2 if r.style == "games" else 0
            last_day = 1 if r.style == "pleasure" else (show.end_date - start).days
            se = ShowEntry(
                show_id=show.id,
                exhibitor_id=people[r.email].id,
                registered_at=registered,
                # The pleasure crowd moves in Wednesday, the game horses Friday night.
                arrival_date=start + timedelta(days=first_day - 1),
                departure_date=start + timedelta(days=last_day),
            )
            show_entries[r.email] = se
            db.add(se)
        show_entries["carla.wendt"].stall_request = "Next to the Lindqvist and Engebretson barns, please"
        show_entries["dana.kuehn"].registration_notes = "Game horse arriving Friday 9 PM with the Rasmussens."
        await db.flush()

        # Back numbers: the show numbers horses, in the order the bill lists them.
        taken = set((await db.execute(select(ShowHorseNumber.back_number).where(
            ShowHorseNumber.show_id == show.id))).scalars())
        number = FIRST_BACK_NUMBER
        shown = {h.id: h for _, _, h in entries} | {
            horses_by_name[h].id: horses_by_name[h] for t in TEAMS.values() for team in t for _, h in team if h
        }
        shown_horses = sorted(shown.items(), key=lambda kv: kv[1].name)
        for horse_id, _ in shown_horses:
            while number in taken:
                number += 1
            db.add(ShowHorseNumber(show_id=show.id, horse_id=horse_id, back_number=number))
            number += 1

        # Stalls: one per horse shown, on the owner's account, for the period
        # its days need; extras by family.
        fees = {f.code: f for f in (await db.execute(select(ShowFee).where(ShowFee.show_id == show.id))).scalars()}
        periods = {p.name: p for p in (await db.execute(
            select(ShowStallPeriod).where(ShowStallPeriod.show_id == show.id))).scalars()}

        def stall_fee(period: str, kind: str) -> ShowFee:
            pid = periods[period].id
            return next(f for f in fees.values() if f.stall_period_id == pid and f.stall_kind == kind)

        owner_key = {ex.id: key for key, ex in people.items()}
        lines: dict[str, dict] = defaultdict(lambda: defaultdict(int))
        for horse_id, h in shown_horses:
            days = days_shown[horse_id]
            period = "Full show" if min(days) <= 1 and max(days) >= 2 else ("Pleasure" if max(days) <= 1 else "Games")
            account = owner_key[h.owner_exhibitor_id]
            kind = "tie" if account == "ella.kuehn" else "box"
            lines[account][stall_fee(period, kind).id] += 1
        lines["carla.wendt"][stall_fee("Pleasure", "tack").id] += 1
        lines["stacy.rasmussen"][stall_fee("Games", "tack").id] += 1
        lines["ella.kuehn"][fees["early_move_in_4eb7f717"].id] += 1
        lines["stacy.rasmussen"][fees["camping"].id] += 1
        lines["carla.wendt"][fees["camping_wednesday_friday_electrical"].id] += 1
        lines["brad.engebretson"][fees["camping_wednesday_friday_electrical"].id] += 1
        lines["travis.lindqvist"][fees["camping_late_friday_monday_electrical"].id] += 1
        lines["renee.gunderson"][fees["permit_parking_permit_non_electrical"].id] += 1
        lines["dana.kuehn"][fees["permit_parking_permit_non_electrical"].id] += 1
        for account, booked in lines.items():
            se = show_entries[account]
            for fee_id, qty in booked.items():
                db.add(ShowEntryReservation(show_entry_id=se.id, show_fee_id=fee_id, quantity=qty,
                                            reserved_at=se.registered_at.astimezone(SHOW_TZ).date()))

        # The 5D barrels side pot: most barrel riders buy in.
        pot = await _one(db, select(SidePot).where(SidePot.show_id == show.id, SidePot.name == "Sidepot 5D Barrels"))
        barrel_riders = sorted({who for c, who, _ in entries if "Barrels" in c.class_name})
        pot_riders = [w for w in barrel_riders if rng.random() < 0.7] if pot else []
        for who in pot_riders:
            db.add(SidePotEntry(side_pot_id=pot.id, show_entry_id=show_entries[who].id, paid=False))

        await db.commit()

        per_class = defaultdict(int)
        for c, _, _ in entries:
            per_class[c.class_number] += 1
        print(f"Show:  {show.name}")
        print(f"  id           {show.id}")
        print(f"  dates        {show.start_date:%a %b %d} - {show.end_date:%a %b %d, %Y}  ({show.status})")
        print(f"  sign-up      open through {show.entry_deadline:%a %b %d} (stall early rate the same)")
        print(f"  class doors  exhibitors change classes through {show.self_entry_closes_on:%a %b %d}")
        print(f"  signed up    {len(RIDERS)} riders: " + ", ".join(people[r.email].full_name for r in RIDERS))
        print(f"  entries      {len(entries)} in {len(per_class)} of {len(classes)} classes, "
              f"{team_count} teams; {len(shown_horses)} horses numbered from {FIRST_BACK_NUMBER}")
        print(f"  side pot     5D barrels: {len(pot_riders)} buy-ins")
        print(f"  free         " + ", ".join(people[f].full_name for f in FREE if f in people))
        print(f"  logins       <first>.<last>{EMAIL_DOMAIN} / {PASSWORD_NOTE}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--start", type=date.fromisoformat, default=None,
                        help="first show day, a Thursday (default: the first at least three weeks out)")
    args = parser.parse_args()
    asyncio.run(seed(args.start))


if __name__ == "__main__":
    main()
