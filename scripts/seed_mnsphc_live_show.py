"""Stand the MNSPHC Paint-O-Rama up as a show in progress today, full of people.

`seed_mnsphc_paint_o_rama.py` builds the show off the printed bill and leaves it
empty in DRAFT a year out. This builds the same show under its own name, dated
today and tomorrow and ACTIVE, and then runs it up to the middle of the first
morning:

  * 20 exhibitor accounts (password 12345678, all @example.com) -- ten amateurs
    and ten youth, mostly in families that share their horses -- with complete
    profiles, memberships, competition cards and 77 horses between them:
    papered, pedigreed, most with a current Coggins on file.
  * Every one of them signed up: back number, stalls, shavings, hook-ups, the
    show's release signed (bar two the desk still has to chase).
  * Entries across the schedule such that at least 60% of all classes carry ten
    or more horses. Every entry is put through the app's own APHA rules engine
    before it is written, so nothing here is an entry the desk would refuse --
    see "What is and is not realistic" below.
  * The side pot buy-ins and futurity nominations those entries oblige.
  * Payments recorded against about two-thirds of the accounts.
  * The first three classes judged, placed on all four judges' cards, marked
    done at the gate and posted to the live results -- and the Grand & Reserve
    class after them holding its call-backs, on deck.

Re-runnable. It deletes and rebuilds only the show named LIVE_SHOW_NAME; the
exhibitor accounts and their horses are reused by email and by registered name,
so a second run converges rather than accumulating people.

    DBURL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
    MSYS_NO_PATHCONV=1 docker run --rm \\
      -v "$PWD/backend:/app" -v "$PWD/scripts:/scripts" \\
      -w /app -e PYTHONPATH=/app -e DATABASE_URL="$DBURL" \\
      horse-show-results-app-backend python /scripts/seed_mnsphc_live_show.py

`--plan-only` prints the entry plan without touching the database, and
`--start YYYY-MM-DD` dates the show somewhere other than today (Central time).

What is and is not realistic
----------------------------
Twenty people cannot honestly put ten horses into 60% of a 172-class APHA bill.
A rail or halter class takes one entry per exhibitor (the app 409s a second),
so it needs ten *different people* eligible for its division, and the bill cuts
people finely: Youth 13 & Under, Novice Youth, two Youth Walk-Trot bands, Novice
Amateur, Amateur Walk-Trot, five WSCA age bands. So the line is drawn at what
the app can see:

  * Kept: everything the rules engine refuses (youth age caps, SC-185.F horse
    caps, SC-190.A.3.a horse ages, the Walk-Trot shared-horse rule, relationship
    to owner, the Novice declaration); one entry per exhibitor in a class that
    is not a pattern class; and everything a class name states outright --
    rider ages and age bands, amateur or youth, horse ages, stallions/geldings/
    mares, overo/tobiano, junior/senior/green horses, the skill the class asks.
  * Relaxed: walk-trot and novice *status*. The app stores neither -- only the
    cards on a profile, which nothing compares with an entry -- so a youth here
    may ride the Novice Youth class and a Youth Walk-Trot class at one show.
    Each exhibitor is given the competition card for every division they ended
    up entered in, so the profile and the entries agree.
  * Heavy: people show several horses in the pattern classes, which the app
    allows, and there is no professional -- a trainer can only enter Open
    classes, and every seat spent on one is an amateur class that cannot reach
    ten.
"""

from __future__ import annotations

import argparse
import asyncio
import random
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import bcrypt
from sqlalchemy import select

from database import AsyncSessionLocal
from models import (
    Association,
    Breed,
    Entry,
    EntryAttestation,
    Exhibitor,
    ExhibitorCompetitionCard,
    ExhibitorHorse,
    ExhibitorRegistration,
    FuturityEntry,
    FuturityFeeTier,
    FuturityMembershipOption,
    Horse,
    HorseColor,
    HorseDocument,
    HorsePattern,
    HorseRegistration,
    Result,
    ShowEntry,
    ShowEntryReservation,
    ShowFee,
    ShowGateSteward,
    ShowJudge,
    ShowPayment,
    ShowScribe,
    ShowWaiver,
    ShowWaiverSignature,
    SidePot,
    SidePotClass,
    SidePotEntry,
    User,
)
from routers.show_financials import _load_financials
from rules import get_rules
from rules.apha import ATTESTATION_STATEMENTS, division_for_class, youth_age

import seed_mnsphc_paint_o_rama as base
from seed_demo_horse_documents import build_coggins_pdf

LIVE_SHOW_NAME = (
    "*LIVE TEST* - MNSPHC Splash of Color & Futurity — Paint-O-Rama & All Breed Show"
)

# Fixed, so the same command produces the same show. Change it for a different
# draw of entries and placings.
RANDOM_SEED = 20260921

SHOW_TZ = ZoneInfo("America/Chicago")
EMAIL_DOMAIN = "example.com"
PASSWORD = base.SEED_PASSWORD

# "60% of all classes have at least 10 horses" -- all 172, championships and
# futurity classes included in the denominator.
BIG_CLASS_SIZE = 10
BIG_CLASS_SHARE = 0.60

# How many classes have been judged, placed and posted when the seed stops the
# clock. They are the first ones in the program.
CLASSES_DONE = 3

# Existing staff accounts put on the show when this database has them, so the
# gate and scribe screens can be driven without assigning anybody first.
GATE_STEWARD_EMAIL = "user@gatesteward.com"
SCRIBE_EMAIL = "user@scribe.com"
OFFICE_NAME = "Christina Kooiman"  # the bill's show secretary, see base.STAFF

# ── The people ────────────────────────────────────────────────────────────────
#
# `kind` is who the app treats them as, amateur or youth. `novice` and
# `walk_trot` are their real status, which only decides what their profile
# shows. `family` names the other people here whose horses they may show, and
# how that *owner* is related to them -- the value goes on the entry's
# relationship-to-owner line. `guardian` is for a youth whose parent is not one
# of the twenty.


@dataclass
class Person:
    key: str
    first: str
    last: str
    dob: date
    kind: str  # "am" | "youth"
    city: str
    novice: bool = False
    walk_trot: bool = False
    family: dict[str, str] = field(default_factory=dict)
    guardian: tuple[str, str] | None = None  # (name, relationship)

    @property
    def email(self) -> str:
        return f"{self.first.lower()}.{self.last.lower()}@{EMAIL_DOMAIN}"

    @property
    def full_name(self) -> str:
        return f"{self.first} {self.last}"

    def born(self, show_year: int) -> date:
        """Birth dates are written for a 2026 show and slide with the show year,
        so everybody keeps their age -- and their classes -- whenever it runs."""
        return self.dob.replace(year=self.dob.year + show_year - 2026)


PEOPLE = [
    # Amateurs. Ages on 1 January: 18-34 four, 35-49 three, 50+ three, which is
    # the spread the WSCA age bands need to have anybody in them at all.
    Person("travis", "Travis", "Lindqvist", date(1984, 3, 12), "am", "Cambridge",
           family={"ava": "Daughter"}),
    Person("jolene", "Jolene", "Hasselquist", date(1971, 6, 2), "am", "Pine City",
           family={"maddie": "Daughter"}),
    Person("brad", "Brad", "Engebretson", date(1979, 10, 19), "am", "Mora",
           family={"sophie": "Daughter"}),
    Person("stacy", "Stacy", "Rasmussen", date(1991, 3, 3), "am", "Isanti",
           family={"chloe": "Daughter"}),
    Person("heather", "Heather", "Solberg", date(2001, 8, 14), "am", "Hinckley",
           novice=True, family={"harper": "Sister"}),
    Person("renee", "Renee", "Gunderson", date(1992, 7, 7), "am", "Braham",
           walk_trot=True, family={"owen": "Son"}),
    Person("carla", "Carla", "Wendt", date(1966, 1, 25), "am", "Sandstone",
           family={"jack": "Grandchild"}),
    Person("dana", "Dana", "Kuehn", date(1982, 5, 29), "am", "Rush City",
           novice=True, family={"ella": "Daughter"}),
    Person("megan", "Megan", "Thorsrud", date(1997, 4, 8), "am", "North Branch"),
    Person("paul", "Paul", "Rydberg", date(1963, 9, 17), "am", "Moose Lake", novice=True),
    # Youth. 13 & Under six (two of them 10 and under), 14-17 four.
    Person("ava", "Ava", "Lindqvist", date(2009, 5, 4), "youth", "Cambridge",
           family={"travis": "Father"}),
    Person("maddie", "Maddie", "Hasselquist", date(2012, 8, 30), "youth", "Pine City",
           family={"jolene": "Mother"}),
    Person("sophie", "Sophie", "Engebretson", date(2008, 11, 15), "youth", "Mora",
           family={"brad": "Father"}),
    Person("chloe", "Chloe", "Rasmussen", date(2011, 9, 26), "youth", "Isanti",
           novice=True, family={"stacy": "Mother"}),
    Person("harper", "Harper", "Solberg", date(2016, 6, 18), "youth", "Hinckley",
           walk_trot=True, family={"heather": "Sister"}, guardian=("Karen Solberg", "Mother")),
    Person("owen", "Owen", "Gunderson", date(2013, 10, 1), "youth", "Braham",
           walk_trot=True, family={"renee": "Mother"}),
    Person("jack", "Jack", "Wendt", date(2015, 2, 9), "youth", "Sandstone",
           walk_trot=True, family={"carla": "Grandparent"}, guardian=("Jess Wendt", "Mother")),
    Person("ella", "Ella", "Kuehn", date(2014, 7, 21), "youth", "Rush City",
           family={"dana": "Mother"}),
    Person("lily", "Lily", "Braaten", date(2010, 2, 22), "youth", "Cambridge",
           guardian=("Tom Braaten", "Father")),
    Person("emma", "Emma", "Kowalczyk", date(2013, 4, 9), "youth", "Duluth",
           novice=True, guardian=("Kate Kowalczyk", "Mother")),
]
PEOPLE_BY_KEY = {p.key: p for p in PEOPLE}

# ── The horses ────────────────────────────────────────────────────────────────
#
# (owner, registered name, barn name, sex, age in show years, pattern, colour,
#  roles, green). Age is counted the horse way -- every horse turns a year older
# on 1 January -- so 0 is this year's foal. Young stock is heavy on purpose: the
# day opens on two weanling futurity classes and an amateur stallion class.
#
# Roles say what a horse is shown in:
#   aa      all-around -- western, english, trail, ranch, showmanship, halter
#   wp      western pleasure / horsemanship / trail / showmanship
#   hus     hunter under saddle / equitation / showmanship
#   ranch   the ranch classes and trail
#   speed   poles, stakes, barrels
#   rein    reining
#   halter  shown at halter as an adult horse
#   western / english / trail   one of those on its own
#   young   weanling, yearling or two-year-old: in-hand and futurity stock
#
# Horses 13, 37 and 58 are the health-paperwork exercise: see upsert_horses.
HORSES = [
    ("travis", "Chocolate Chip Zip", "Chip", "Gelding", 7, "Tobiano", "Chestnut", "rein ranch western", False),
    ("travis", "Invested N Dreams", "Dreamer", "Stallion", 3, "Overo", "Bay", "western english halter", True),
    ("travis", "Lazy Loper Deluxe", "Deluxe", "Stallion", 2, "Tobiano", "Sorrel", "young", False),
    ("travis", "Kiss Me Im Irish", "Irish", "Gelding", 2, "Sabino", "Red Roan", "young", False),
    ("travis", "Northern Lights Hotrod", "Hotrod", "Stallion", 1, "Tobiano", "Black", "young", False),
    ("travis", "Midnight Blue Invitation", "Blue", "Stallion", 0, "Tovero", "Blue Roan", "young", False),
    ("ava", "Pretty In Pistols", "Pistol", "Mare", 8, "Tobiano", "Bay", "aa", False),
    ("ava", "Lindqvist Legacy", "Legacy", "Gelding", 12, "Overo", "Sorrel", "aa", False),
    ("travis", "Cash N Carry Paint", "Cash", "Gelding", 10, "Tobiano", "Palomino", "ranch speed western", False),
    ("jolene", "Hasselquist Hot Pursuit", "Pursuit", "Stallion", 0, "Tobiano", "Bay", "young", False),
    ("jolene", "Hasselquist Harmony", "Harmony", "Mare", 0, "Overo", "Sorrel", "young", False),
    ("jolene", "Too Hot To Handle HQ", "Handle", "Stallion", 1, "Tobiano", "Chestnut", "young", False),
    ("jolene", "Painted Lady Luck", "Lucky", "Mare", 1, "Frame Overo", "Palomino", "young", False),
    ("jolene", "Sweet Tea Tobiano", "Tea", "Mare", 2, "Tobiano", "Buckskin", "young", False),
    ("jolene", "Radiant Invitation", "Rae", "Mare", 4, "Tobiano", "Bay", "western english halter", True),
    ("jolene", "Zippin Up The Paint", "Zippy", "Mare", 11, "Tobiano", "Sorrel", "aa", False),
    ("maddie", "Maddies Main Man", "Moose", "Gelding", 13, "Overo", "Chestnut", "aa", False),
    ("jolene", "Sir Tobiano Blue", "Bluey", "Gelding", 6, "Tobiano", "Blue Roan", "aa", False),
    ("jolene", "Fast Lane Freddie", "Freddie", "Gelding", 10, "Overo", "Bay", "ranch speed western", False),
    ("brad", "Engebretson Fancy Filly", "Fancy", "Mare", 0, "Sabino", "Chestnut", "young", False),
    ("brad", "Good Golly Miss Molly", "Molly", "Mare", 1, "Tobiano", "Palomino", "young", False),
    ("brad", "Sure Shot Sensation", "Shooter", "Gelding", 4, "Overo", "Sorrel", "western trail halter", True),
    ("brad", "Ranchin In The Rain", "Rain", "Gelding", 9, "Tobiano", "Grullo", "ranch speed western", False),
    ("brad", "Mister Good Bars", "Mister", "Gelding", 14, "Tobiano", "Bay", "aa", False),
    ("sophie", "Hunt Club Hottie", "Hottie", "Gelding", 12, "Tobiano", "Grey", "aa", False),
    ("brad", "Sheza Hot Commodity", "Dottie", "Mare", 7, "Overo", "Black", "aa", False),
    ("stacy", "Rasmussen Rocket Man", "Rocket", "Stallion", 0, "Tobiano", "Palomino", "young", False),
    ("stacy", "Dancing In Denim", "Denim", "Mare", 2, "Overo", "Bay", "young", False),
    ("stacy", "Smart Lil Paintbrush", "Brush", "Gelding", 10, "Tobiano", "Bay", "aa", False),
    ("stacy", "Barrel Of Dynamite", "Dyna", "Mare", 13, "Tobiano", "Sorrel", "speed western", False),
    ("chloe", "Chloes Checkmate", "Checkers", "Gelding", 7, "Tobiano", "Black", "aa", False),
    ("stacy", "Invite Me To Dance", "Dancer", "Mare", 5, "Overo", "Chestnut", "aa", True),
    ("stacy", "Isanti Ranch Hand", "Hank", "Gelding", 8, "Tobiano", "Dun", "ranch western", False),
    ("heather", "Solberg Sunrise", "Sunny", "Mare", 1, "Tobiano", "Palomino", "young", False),
    ("heather", "Solberg Summer Storm", "Stormy", "Mare", 0, "Overo", "Black", "young", False),
    ("heather", "Artful Invitation", "Art", "Gelding", 7, "Overo", "Chestnut", "aa", True),
    ("harper", "Grandmas Good Girl", "Granny", "Mare", 16, "Tobiano", "Sorrel", "wp", False),
    ("heather", "Kettle River Cowgirl", "Cowgirl", "Mare", 9, "Tobiano", "Bay", "ranch speed western halter", False),
    ("heather", "Simply Sweet Tobiano", "Sweetie", "Gelding", 12, "Tobiano", "Palomino", "aa", False),
    ("heather", "Heza Lazy Tobiano", "Lazy", "Gelding", 5, "Tobiano", "Sorrel", "western english halter", True),
    ("renee", "Gunderson Gold Rush", "Goldie", "Mare", 10, "Tobiano", "Palomino", "aa", False),
    ("renee", "Gunderson Gold Digger", "Digger", "Stallion", 0, "Tobiano", "Palomino", "young", False),
    ("renee", "Ranch Hand Rowdy", "Rowdy", "Gelding", 12, "Overo", "Bay Roan", "ranch western halter", False),
    ("owen", "Old Timer Tobiano", "Timer", "Gelding", 15, "Tobiano", "Sorrel", "ranch western", False),
    ("renee", "Braham Blue Boy", "Boy", "Gelding", 8, "Tobiano", "Blue Roan", "aa", False),
    ("renee", "Zip N Speed", "Zip", "Mare", 11, "Overo", "Sorrel", "speed western", False),
    ("carla", "Wendt Wild Card", "Wildcard", "Stallion", 0, "Overo", "Bay", "young", False),
    ("carla", "Wendt Whisper", "Whisper", "Mare", 0, "Tobiano", "Sorrel", "young", False),
    ("carla", "Frosty Flashback", "Frosty", "Gelding", 1, "Tobiano", "Grey", "young", False),
    ("carla", "Chrome Plated Cowboy", "Chrome", "Gelding", 2, "Tobiano", "Sorrel", "young", False),
    ("carla", "Majestic Mr Wendt", "Major", "Stallion", 8, "Overo", "Bay", "halter western", False),
    ("carla", "Blue Suede Blessing", "Blessing", "Mare", 12, "Tobiano", "Blue Roan", "wp", False),
    ("jack", "Jacks Lucky Charm", "Charm", "Gelding", 14, "Tobiano", "Bay", "aa", False),
    ("carla", "Sandstone Sensation", "Sensation", "Mare", 6, "Overo", "Chestnut", "aa", False),
    ("carla", "Wendt Way West", "Westy", "Gelding", 9, "Tobiano", "Grullo", "ranch speed western halter", False),
    ("dana", "Kuehn Command Performance", "Commander", "Stallion", 0, "Tobiano", "Bay", "young", False),
    ("dana", "Hesa Northern Star", "Star", "Stallion", 1, "Overo", "Black", "young", False),
    ("dana", "Cowboys Dont Cry", "Cowboy", "Gelding", 5, "Tobiano", "Buckskin", "ranch western halter", True),
    ("dana", "Only Blue Skies", "Skye", "Mare", 9, "Tobiano", "Blue Roan", "aa", False),
    ("ella", "Ellas Painted Pony", "Pony", "Gelding", 13, "Tobiano", "Sorrel", "aa", False),
    ("dana", "Rush City Rebel", "Rebel", "Gelding", 8, "Overo", "Bay", "aa", False),
    ("dana", "Quick Silver Paint", "Silver", "Mare", 10, "Tobiano", "Grey", "speed western", False),
    ("megan", "Moonlit Meadow Lark", "Lark", "Mare", 0, "Tobiano", "Grey", "young", False),
    ("megan", "Iron Horse Invitation", "Iron", "Stallion", 2, "Overo", "Black", "young", False),
    ("megan", "A Touch Of Elegance", "Ellie", "Mare", 4, "Tovero", "Bay", "hus halter", True),
    ("megan", "Thorsrud Top Notch", "Notch", "Gelding", 8, "Tobiano", "Chestnut", "aa", False),
    ("megan", "North Branch Nitro", "Nitro", "Gelding", 9, "Overo", "Sorrel", "speed ranch western", False),
    ("paul", "Rydberg Rose", "Rosie", "Mare", 0, "Tobiano", "Sorrel", "young", False),
    ("paul", "Prairie Wind Invite", "Windy", "Stallion", 1, "Tobiano", "Bay", "young", False),
    # Solid Paint-Bred: no pattern, so no colour class -- and since SC-325's
    # 2025 amendment, nothing else refuses it.
    ("paul", "Dusty Trail Boss", "Boss", "Gelding", 15, None, "Dun", "ranch western", False),
    ("paul", "Slow Motion Magic", "Magic", "Gelding", 11, "Tobiano", "Sorrel", "wp halter", False),
    ("paul", "Moose Lake Maggie", "Maggie", "Mare", 7, "Overo", "Bay", "aa", False),
    ("lily", "Lil Bit Of Sparkle", "Sparkle", "Mare", 9, "Tobiano", "Palomino", "aa", False),
    ("lily", "Run Like The Wind", "Wind", "Gelding", 14, "Overo", "Sorrel", "speed ranch western", False),
    ("lily", "Lily Of The Valley", "Val", "Gelding", 6, "Tobiano", "Bay", "aa", False),
    ("emma", "Emmas Easy Invitation", "Buddy", "Gelding", 11, "Tobiano", "Bay", "wp halter", False),
    ("emma", "Duluth Dazzler", "Dazzle", "Mare", 8, "Tobiano", "Black", "aa speed", False),
]

ROLE_SKILLS = {
    "aa": {"western", "english", "trail", "ranch", "showman", "halter"},
    "wp": {"western", "trail", "showman"},
    "hus": {"english", "showman"},
    "ranch": {"ranch", "trail"},
    "speed": {"speed"},
    "rein": {"reining"},
    "halter": {"halter", "showman"},
    "western": {"western"},
    "english": {"english"},
    "trail": {"trail"},
    "young": set(),
}

# The colour classes split the patterns in two.
OVERO_PATTERNS = {"Overo", "Frame Overo", "Sabino", "Splashed White"}
TOBIANO_PATTERNS = {"Tobiano", "Tovero"}

# Invented sires and dams, drawn from for pedigrees. The futurity requires one.
SIRES = [
    "Invitation Only", "Hot Scotch Bonanza", "Zippos Mr Good Bar", "Radical Rodder",
    "Gunner Be A Tobiano", "Northern Pride", "A Good Machine", "Blazing Hot",
    "Hollywood Jac", "Sheza Lopin Sensation", "The Lazy Loper", "Mr Chip Off The Ol Block",
]
DAMS = [
    "Miss Painted Lady", "Sweet Lil Invitation", "Zippin Bar Tobiano", "Dreamy Tobiana",
    "Sheza Hot Pistol", "Lady Blue Heaven", "Kiss My Tobiano", "Painted Prairie Rose",
    "Good Girl Gone West", "Classic Chocolate Kiss", "Sophisticated Sadie", "Blue Belle Bonanza",
]

# ── Which bracket admits whom ────────────────────────────────────────────────

IN_HAND_DISCIPLINES = {
    "Halter", "Performance Halter", "Color Class", "Ranch Conformation",
    "Showmanship", "In-Hand Trail", "Longe Line",
}
# Brackets any rider may enter: the Open division, and the brackets that say
# something about the horse rather than the rider.
OPEN_BRACKETS = {
    "Open", "Weanling", "Yearling", "Two Year Old", "Three Year Old",
    "Four Year & Older", "3 & 4 Year Old", "Junior Horse (5 & Younger)",
    "Senior Horse (6 & Older)", "Green Horse", "Futurity",
}
# The All Breed rider-age brackets, read literally. Walk-trot status is not
# checked (see the module docstring); the ages are.
AGE_BANDS = {
    "13 & Under": (0, 13), "14-17": (14, 17), "18-34": (18, 34),
    "35-49": (35, 49), "50+": (50, 200), "17 & Under": (0, 17),
    "18 & Over": (18, 200), "Walk-Trot 17 & Under": (0, 17),
    "Walk-Trot 18 & Over": (18, 200), "Walk-Trot All Ages": (0, 200),
}
YOUTH_BRACKETS = {
    "Youth": (0, 18), "Youth 18 & Under": (0, 18), "Youth 13 & Under": (0, 13),
    "Novice Youth 18 & Under": (0, 18), "Youth Walk-Trot 5-10": (5, 10),
    "Youth Walk-Trot 11-18": (11, 18),
}
AMATEUR_BRACKETS = {"Amateur", "Novice Amateur", "Amateur Walk-Trot"}

# Which skill a ridden class asks of the horse.
DISCIPLINE_SKILL = {
    "Hunter Under Saddle": "english",
    "Hunt Seat Equitation": "english",
    "Western Pleasure": "western",
    "Western Horsemanship": "western",
    "Western Riding": "western",
    "Trail": "trail",
    "Ranch Trail": "ranch",
    "Ranch Riding": "ranch",
    "Ranch Pleasure": "ranch",
    "Ranch Rail Pleasure": "ranch",
    "Pole Bending": "speed",
    "Stake Race": "speed",
    "Barrel Racing": "speed",
    "Reining": "reining",
}


@dataclass
class HorsePlan:
    index: int
    owner: str
    name: str
    barn: str
    sex: str
    age: int
    pattern: str | None
    color: str
    skills: set[str]
    green: bool
    sire: str
    dam: str
    id: object = None  # filled from the database

    @property
    def pattern_group(self) -> str | None:
        if self.pattern in OVERO_PATTERNS:
            return "overo"
        if self.pattern in TOBIANO_PATTERNS:
            return "tobiano"
        return None


@dataclass
class ClassPlan:
    number: str
    name: str
    discipline: str
    bracket: str
    fee_key: str
    score_type: str
    day: date
    order: int
    division: str | None = None
    id: object = None


def build_horses(rng: random.Random) -> list[HorsePlan]:
    horses = []
    for index, (owner, name, barn, sex, age, pattern, color, roles, green) in enumerate(HORSES):
        skills: set[str] = set()
        for role in roles.split():
            skills |= ROLE_SKILLS[role]
        horses.append(HorsePlan(
            index=index, owner=owner, name=name, barn=barn, sex=sex, age=age,
            pattern=pattern, color=color, skills=skills, green=green,
            sire=rng.choice(SIRES), dam=rng.choice(DAMS),
        ))
    return horses


def build_access(horses: list[HorsePlan]) -> dict[str, list[tuple[HorsePlan, str]]]:
    """Which horses each person may show, and the relationship line it carries:
    their own ("Self") and their family's (how the owner is related to them)."""
    access: dict[str, list[tuple[HorsePlan, str]]] = defaultdict(list)
    for person in PEOPLE:
        for horse in horses:
            if horse.owner == person.key:
                access[person.key].append((horse, "Self"))
            elif horse.owner in person.family:
                access[person.key].append((horse, person.family[horse.owner]))
    return access


def person_age(person: Person, show_start: date) -> int:
    """Age on 1 January of the show year -- YP-075's rule, and the All Breed
    bands read the same way. The app's own function, so the plan and the rules
    engine agree about everyone's age."""
    return youth_age(
        SimpleNamespace(date_of_birth=person.born(show_start.year)), SimpleNamespace(start_date=show_start)
    )


def rider_ok(person: Person, age: int, cls: ClassPlan) -> bool:
    bracket = cls.bracket
    if bracket == "Lead Line 3-8":
        return 3 <= age <= 8
    if bracket in OPEN_BRACKETS:
        return True
    if bracket in YOUTH_BRACKETS:
        low, high = YOUTH_BRACKETS[bracket]
        return person.kind == "youth" and low <= age <= high
    if bracket in AMATEUR_BRACKETS:
        return person.kind == "am"
    if bracket in AGE_BANDS:
        low, high = AGE_BANDS[bracket]
        return low <= age <= high
    raise ValueError(f"Class {cls.number}: no rider rule for bracket {bracket!r}")


def horse_ok(horse: HorsePlan, cls: ClassPlan) -> bool:
    d, b, name = cls.discipline, cls.bracket, cls.name.lower()
    age = horse.age

    if b == "Futurity":
        if cls.number == "A":
            return age == 0 and horse.sex != "Mare"
        if cls.number == "B":
            return age == 0 and horse.sex == "Mare"
        if d == "Halter" and "yearling" in name:
            return age == 1
        if d == "Halter" and "2 year old" in name:
            return age == 2
        if d in ("In-Hand Trail", "Longe Line"):
            return age == 1
        return age == 2  # the four two-year-old walk-trot riding classes

    if d in ("Halter", "Performance Halter"):
        if "stallion" in name and horse.sex != "Stallion":
            return False
        if "gelding" in name and horse.sex != "Gelding":
            return False
        if ("mare" in name or "fillies" in name) and horse.sex != "Mare":
            return False
        if d == "Performance Halter":
            return age >= 3 and "halter" in horse.skills
        wanted = {"Yearling": 1, "Two Year Old": 2, "Three Year Old": 3}.get(b)
        if wanted is not None:
            return age == wanted
        if b == "Four Year & Older":
            return age >= 4 and "halter" in horse.skills
        # "All Ages" amateur, youth and All Breed halter: yearlings and up.
        return age >= 1 and (age <= 2 or "halter" in horse.skills)
    if d == "Color Class":
        wanted = "overo" if "overo" in name else "tobiano"
        return age >= 1 and horse.pattern_group == wanted and (age <= 2 or "halter" in horse.skills)
    if d == "Ranch Conformation":
        return age >= 3 and "ranch" in horse.skills
    if d == "Showmanship":
        return age >= 3 and "showman" in horse.skills
    if d == "In-Hand Trail":
        return age == 1 if ("yearling" in name or b == "Yearling") else 1 <= age <= 2
    if d == "Longe Line":
        return age == (2 if b == "Two Year Old" else 1)
    if d == "Lead Line":
        return age >= 10 and "western" in horse.skills

    skill = DISCIPLINE_SKILL.get(d)
    if skill is None:
        raise ValueError(f"Class {cls.number}: no horse rule for discipline {d!r}")
    if b == "Two Year Old":
        return age == 2
    if age < 3 or skill not in horse.skills:
        return False
    if b == "Junior Horse (5 & Younger)":
        return age <= 5
    if b == "Senior Horse (6 & Older)":
        return age >= 6
    if b == "3 & 4 Year Old":
        return age in (3, 4)
    if b == "Green Horse":
        return horse.green
    return True


# ── The plan ──────────────────────────────────────────────────────────────────


@dataclass
class PlannedEntry:
    cls: ClassPlan
    person: Person
    horse: HorsePlan
    relationship: str
    row: Entry | None = None


class Planner:
    """Chooses who enters what, checking every entry with the app's own rules.

    Enough classes that can reach ten are filled to ten or more, tightest
    first while the show-wide horse limits still have room; everything else
    gets a handful. A pairing somebody has already shown in another class is
    preferred, so people stay on their own horses rather than swapping about.
    """

    def __init__(self, classes: list[ClassPlan], horses: list[HorsePlan], show_start: date, rng):
        self.classes = classes
        self.horses = horses
        self.rng = rng
        self.access = build_access(horses)
        self.ages = {p.key: person_age(p, show_start) for p in PEOPLE}
        self.rules = get_rules("APHA")
        self.show_ns = SimpleNamespace(start_date=show_start, end_date=show_start + timedelta(days=1))
        self.foaled = {h.index: date(show_start.year - h.age, 4, 1) for h in horses}
        self.entries: list[PlannedEntry] = []
        self.by_class: dict[str, list[PlannedEntry]] = defaultdict(list)
        self.used_pairs: Counter = Counter()
        # A futurity nomination is one horse on one account, and it prices only
        # that account's entries -- so a horse two people showed in futurity
        # classes would have the second person's classes billed at nothing.
        self.futurity_handler: dict[int, str] = {}
        self.context = {
            "apha_disciplines": {c.number: c.discipline for c in classes},
            "apha_brackets": {c.number: c.bracket for c in classes},
            "apha_entries": [],
        }
        self.need = -(-len(classes) * int(BIG_CLASS_SHARE * 100) // 100)  # ceiling
        self.candidates = {c.number: self._candidates(c) for c in classes}
        self.capacities = {c.number: self._capacity(c) for c in classes}

    def _candidates(self, cls: ClassPlan) -> list[tuple[Person, HorsePlan, str]]:
        if cls.fee_key == "CHAMPIONSHIP":
            return []  # placed into, not entered -- the call-backs are added later
        return [
            (person, horse, relationship)
            for person in PEOPLE
            if rider_ok(person, self.ages[person.key], cls)
            for horse, relationship in self.access[person.key]
            if horse_ok(horse, cls)
        ]

    def _capacity(self, cls: ClassPlan) -> int:
        """The most horses the class could hold before the show-wide limits."""
        options: dict[str, set[int]] = defaultdict(set)
        for person, horse, _r in self.candidates[cls.number]:
            options[person.key].add(horse.index)
        if cls.score_type == "pattern":
            return len(set().union(*options.values())) if options else 0
        return len(self._match(options, limit=len(options)))

    @staticmethod
    def _match(options: dict[str, set[int]], limit: int, order=None) -> dict[str, int]:
        """One horse per person, one person per horse: augmenting paths."""
        owner_of: dict[int, str] = {}
        matched: dict[str, int] = {}

        def augment(person, seen):
            for horse in options[person]:
                if horse in seen:
                    continue
                seen.add(horse)
                if horse not in owner_of or augment(owner_of[horse], seen):
                    owner_of[horse] = person
                    matched[person] = horse
                    return True
            return False

        for person in (order or list(options)):
            if len(matched) >= limit:
                break
            augment(person, set())
        return matched

    def _valid(self, cls: ClassPlan, person: Person, horse: HorsePlan, relationship: str) -> bool:
        entry = SimpleNamespace(
            id=None,
            status="ENTERED",
            exhibitor_id=person.key,
            horse_id=horse.index,
            apha_division=cls.division,
            relationship_to_owner=relationship,
            attestations=(
                [SimpleNamespace(kind="novice_eligibility")]
                if cls.division in ("NOVICE_AMATEUR", "NOVICE_YOUTH") else []
            ),
            horse=SimpleNamespace(id=horse.index, name=horse.name, foaling_date=self.foaled[horse.index]),
            exhibitor=SimpleNamespace(id=person.key, full_name=person.full_name, date_of_birth=person.born(self.show_ns.start_date.year)),
        )
        cls_ns = SimpleNamespace(id=cls.number, class_name=cls.name)
        issues = self.rules.validate_entry(entry, self.show_ns, cls_ns, self.context)
        return not any(i.get("severity") == "error" for i in issues)

    def _add(self, cls: ClassPlan, person: Person, horse: HorsePlan, relationship: str) -> None:
        if cls.fee_key == "FUTURITY":
            self.futurity_handler.setdefault(horse.index, person.key)
        self.entries.append(PlannedEntry(cls, person, horse, relationship))
        self.by_class[cls.number].append(self.entries[-1])
        self.used_pairs[(person.key, horse.index)] += 1
        self.context["apha_entries"].append(SimpleNamespace(
            id=len(self.entries), exhibitor_id=person.key, horse_id=horse.index,
            class_id=cls.number, apha_division=cls.division,
        ))

    def _preference(self, person: Person, horse: HorsePlan) -> float:
        # Familiar pairings first, then the horse's own people, then anyone;
        # a random tail so the same people do not always win.
        familiar = min(self.used_pairs[(person.key, horse.index)], 3)
        own = 1 if horse.owner == person.key else 0
        return -(familiar * 2 + own + self.rng.random() * 1.5)

    def fill(self, cls: ClassPlan, target: int) -> int:
        """Enter up to `target` horses in the class. Returns how many are in."""
        placed = self.by_class[cls.number]
        horses_in = {e.horse.index for e in placed}
        people_in = {e.person.key for e in placed}
        valid = [
            (p, h, r) for p, h, r in self.candidates[cls.number]
            if h.index not in horses_in
            and (cls.fee_key != "FUTURITY"
                 or self.futurity_handler.get(h.index, p.key) == p.key)
            and self._valid(cls, p, h, r)
        ]
        if cls.score_type == "pattern":
            # Horse by horse, each to the most natural rider still allowed one --
            # re-checked as the class fills, since a rider's horse count moves.
            by_horse = defaultdict(list)
            for p, h, r in valid:
                by_horse[h.index].append((p, h, r))
            order = list(by_horse)
            self.rng.shuffle(order)
            order.sort(key=lambda i: -max(self.used_pairs[(p.key, i)] for p, _h, _r in by_horse[i]))
            per_person = Counter(e.person.key for e in placed)
            for index in order:
                if len(placed) >= target:
                    break
                riders = sorted(
                    by_horse[index],
                    key=lambda c: (per_person[c[0].key], self._preference(c[0], c[1])),
                )
                for p, h, r in riders:
                    if self._valid(cls, p, h, r):
                        self._add(cls, p, h, r)
                        per_person[p.key] += 1
                        break
            return len(placed)

        # One horse per person: a matching, so a class that can just reach ten
        # does reach it rather than losing a seat to an unlucky first pick.
        options: dict[str, set[int]] = defaultdict(set)
        pick = {}
        for p, h, r in sorted(valid, key=lambda c: self._preference(c[0], c[1])):
            if p.key in people_in:
                continue
            options[p.key].add(h.index)
            pick.setdefault((p.key, h.index), (p, h, r))
        # Iterate each person's horses best-first inside the matching too.
        for key in options:
            options[key] = sorted(options[key], key=lambda i: self._preference(pick[(key, i)][0], pick[(key, i)][1]))
        order = list(options)
        self.rng.shuffle(order)
        matched = self._match(options, limit=max(0, target - len(placed)), order=order)
        for key, index in matched.items():
            p, h, r = pick[(key, index)]
            self._add(cls, p, h, r)
        return len(placed)

    def plan(self, full: list[str]) -> None:
        rng, caps = self.rng, self.capacities
        # The classes the morning opens on take every horse that can go in.
        for number in full:
            self.fill(self._class(number), caps[number])

        big_able = [c for c in self.classes if caps[c.number] >= BIG_CLASS_SIZE and c.number not in full]
        # Tightest first, while the show-wide horse limits still have room.
        for cls in sorted(big_able, key=lambda c: (caps[c.number], rng.random())):
            extra = rng.choice([0, 0, 1, 1, 2, 3, 4, 5, 7])
            self.fill(cls, min(caps[cls.number], BIG_CLASS_SIZE + extra))

        for cls in self.classes:
            if cls.number in full or caps[cls.number] >= BIG_CLASS_SIZE:
                continue
            cap = caps[cls.number]
            if cap:
                self.fill(cls, rng.choice([cap, rng.randint(max(1, cap // 2), cap), rng.randint(1, cap)]))

        # Anything the limits held under ten gets another go now the rest of the
        # schedule is known.
        for cls in big_able:
            if len(self.by_class[cls.number]) < BIG_CLASS_SIZE:
                self.fill(cls, BIG_CLASS_SIZE)

    def _class(self, number: str) -> ClassPlan:
        return next(c for c in self.classes if c.number == number)

    def big_count(self) -> int:
        return sum(1 for c in self.classes if len(self.by_class[c.number]) >= BIG_CLASS_SIZE)


def load_class_plans(first_day: date) -> list[ClassPlan]:
    score_types = dict(base.DISCIPLINES)
    rows = [(first_day, r) for r in base.SATURDAY_CLASSES] + [
        (first_day + timedelta(days=1), r) for r in base.SUNDAY_CLASSES
    ]
    return [
        ClassPlan(
            number=number, name=name, discipline=discipline, bracket=bracket,
            fee_key=fee_key, score_type=score_types[discipline], day=day, order=order,
            division=division_for_class(bracket, name),
        )
        for order, (day, (number, _code, name, discipline, bracket, fee_key)) in enumerate(rows, start=1)
    ]


def print_plan(planner: Planner, verbose: bool) -> None:
    classes = planner.classes
    big = planner.big_count()
    print(f"Plan: {len(planner.entries)} entries in "
          f"{sum(1 for c in classes if planner.by_class[c.number])} classes; "
          f"{big}/{len(classes)} classes with {BIG_CLASS_SIZE}+ horses "
          f"({big / len(classes):.0%}; need {planner.need})")
    print(f"  horses shown {len({e.horse.index for e in planner.entries})}/{len(planner.horses)}")
    print("  entries per person: " + ", ".join(
        f"{p.first} {sum(1 for e in planner.entries if e.person.key == p.key)}" for p in PEOPLE))
    if not verbose:
        return
    by_bracket = defaultdict(list)
    for c in classes:
        by_bracket[c.bracket].append(
            f"{c.number}:{len(planner.by_class[c.number])}/{planner.capacities[c.number]}")
    for bracket, cells in by_bracket.items():
        print(f"  {bracket:28} " + " ".join(cells))


# ── Writing it ───────────────────────────────────────────────────────────────


async def _one(db, stmt):
    return (await db.execute(stmt)).scalars().first()


def _phone(rng: random.Random) -> str:
    return f"{rng.choice(['320', '218', '763', '612', '651'])}-555-{rng.randint(100, 199):04d}"


def _guardian(person: Person) -> tuple[str, str] | None:
    """Who signs for a youth, and as what: a parent among the twenty, or the
    parent named on the profile."""
    for key, relationship in person.family.items():
        if relationship in ("Mother", "Father"):
            return PEOPLE_BY_KEY[key].full_name, relationship
    return person.guardian


def _central(day: date, hh: int, mm: int) -> datetime:
    return datetime.combine(day, time(hh, mm), tzinfo=SHOW_TZ).astimezone(timezone.utc)


async def upsert_people(db, rng, hashed: str, show_year: int) -> dict[str, Exhibitor]:
    """Accounts and exhibitor rows, reused by email on a re-run. Every profile
    is complete, so nobody is stopped at registration step one."""
    exhibitors: dict[str, Exhibitor] = {}
    streets = ["County Rd 5", "Hwy 23", "Kettle River Rd", "Pine Ridge Trl", "Snake River Dr", "Main St"]
    for person in PEOPLE:
        user = await _one(db, select(User).where(User.email == person.email))
        if user is None:
            user = User(
                email=person.email, role="EXHIBITOR", first_name=person.first,
                last_name=person.last, full_name=person.full_name,
                hashed_password=hashed, is_approved=True,
            )
            db.add(user)
            await db.flush()
        exhibitor = await _one(db, select(Exhibitor).where(Exhibitor.user_id == user.id))
        if exhibitor is None:
            exhibitor = Exhibitor(user_id=user.id, full_name=person.full_name)
            db.add(exhibitor)
        exhibitor.full_name = person.full_name
        exhibitor.date_of_birth = person.born(show_year)
        exhibitor.phone = exhibitor.phone or _phone(rng)
        exhibitor.address = exhibitor.address or f"{rng.randint(1200, 38999)} {rng.choice(streets)}"
        exhibitor.city = person.city
        exhibitor.state = "MN"
        exhibitor.zip = exhibitor.zip or f"55{rng.randint(0, 999):03d}"
        if person.kind == "youth":
            name, _relationship = _guardian(person)
            exhibitor.parent_guardian_name = name
            exhibitor.parent_guardian_phone = exhibitor.parent_guardian_phone or _phone(rng)
            exhibitor.emergency_contact_name = name
        else:
            exhibitor.emergency_contact_name = exhibitor.emergency_contact_name or (
                f"{rng.choice(['Mark', 'Sue', 'Dave', 'Ann', 'Jim', 'Deb'])} {person.last}"
            )
        exhibitor.emergency_contact_phone = exhibitor.emergency_contact_phone or _phone(rng)
        exhibitors[person.key] = exhibitor
    await db.flush()
    return exhibitors


# Health paperwork the desk has to chase: one Coggins that runs out on the first
# show day, one never uploaded, one that lapsed last month.
COGGINS_EXPIRES_DAY_ONE = 13
COGGINS_MISSING = 37
COGGINS_LAPSED = 58


async def upsert_horses(db, horses, exhibitors, lookups, show_start, rng, admin_id) -> None:
    breed, colors, patterns, apha = lookups["breed"], lookups["colors"], lookups["patterns"], lookups["apha"]
    for horse in horses:
        owner = exhibitors[horse.owner]
        row = await _one(db, select(Horse).where(
            Horse.name == horse.name, Horse.owner_exhibitor_id == owner.id,
        ))
        if row is None:
            row = Horse(name=horse.name, owner_exhibitor_id=owner.id, created_by_exhibitor_id=owner.id)
            db.add(row)
        row.barn_name = horse.barn
        row.owner_name = owner.full_name
        row.sex = horse.sex
        row.foaling_date = date(show_start.year - horse.age, rng.randint(2, 6), rng.randint(1, 28))
        row.sire_name = horse.sire
        row.dam_name = horse.dam
        row.breed_id = breed.id
        row.color_id = colors[horse.color].id
        row.pattern_id = patterns[horse.pattern].id if horse.pattern else None
        row.is_solid_paint_bred = horse.pattern is None
        await db.flush()
        horse.id = row.id

        number = f"{1926000 + horse.index * 37}"
        reg = await _one(db, select(HorseRegistration).where(
            HorseRegistration.horse_id == row.id, HorseRegistration.association_id == apha.id,
        ))
        if reg is None:
            taken = await _one(db, select(HorseRegistration).where(
                HorseRegistration.association_id == apha.id,
                HorseRegistration.registration_number == number,
            ))
            if taken is None:
                db.add(HorseRegistration(horse_id=row.id, association_id=apha.id, registration_number=number))

        coggins = (await db.execute(select(HorseDocument).where(
            HorseDocument.horse_id == row.id, HorseDocument.document_type == "COGGINS",
        ))).scalars().all()
        for doc in coggins:  # re-dated every run, so a re-run on a later day keeps the same story
            await db.delete(doc)
        if horse.index == COGGINS_MISSING:
            continue
        if horse.index == COGGINS_EXPIRES_DAY_ONE:
            issued = show_start - timedelta(days=365)
        elif horse.index == COGGINS_LAPSED:
            issued = show_start - timedelta(days=400)
        else:
            issued = show_start - timedelta(days=rng.randint(40, 300))
        expires = issued + timedelta(days=365)
        pdf = build_coggins_pdf(horse.name, owner.full_name, issued, expires)
        db.add(HorseDocument(
            horse_id=row.id, document_type="COGGINS",
            original_filename=f"coggins-{horse.barn.lower().replace(' ', '-')}.pdf",
            file_data=pdf, mime_type="application/pdf", file_size=len(pdf),
            issue_date=issued, expiry_date=expires,
            uploaded_by_user_id=owner.user_id or admin_id,
        ))

    # Profile links, so each horse is on the list of everyone who shows it. The
    # owner's own list reads created_by_exhibitor_id and needs no link.
    for person in PEOPLE:
        exhibitor = exhibitors[person.key]
        for horse, relationship in build_access(horses)[person.key]:
            if horse.owner == person.key:
                continue
            link = await _one(db, select(ExhibitorHorse).where(
                ExhibitorHorse.exhibitor_id == exhibitor.id, ExhibitorHorse.horse_id == horse.id,
            ))
            if link is None:
                db.add(ExhibitorHorse(
                    exhibitor_id=exhibitor.id, horse_id=horse.id, relationship_to_owner=relationship,
                ))
            else:
                link.relationship_to_owner = relationship
    await db.flush()


async def upsert_memberships(db, exhibitors, lookups, show_start, planner, rng) -> None:
    """APHA for everyone but one (and one lapsed a fortnight ago), MNSPHC for
    most, WSCA for the All Breed regulars; and an APHA card for every carded
    division each person is entered in."""
    apha, wsca, mnsphc = lookups["apha"], lookups["wsca"], lookups["mnsphc"]
    year_end = date(show_start.year, 12, 31)
    carded = {"AMATEUR", "NOVICE_AMATEUR", "AMATEUR_WALK_TROT", "NOVICE_YOUTH", "YOUTH_WALK_TROT_11_18"}
    divisions = defaultdict(set)
    for e in planner.entries:
        if e.cls.division in carded:
            divisions[e.person.key].add(e.cls.division)

    async def put(exhibitor, association, number, expires):
        row = await _one(db, select(ExhibitorRegistration).where(
            ExhibitorRegistration.exhibitor_id == exhibitor.id,
            ExhibitorRegistration.association_id == association.id,
        ))
        if row is None:
            db.add(ExhibitorRegistration(
                exhibitor_id=exhibitor.id, association_id=association.id,
                member_number=number, expires_at=expires,
            ))
        else:
            row.member_number, row.expires_at = number, expires

    for i, person in enumerate(PEOPLE):
        exhibitor = exhibitors[person.key]
        if person.key != "megan":  # never filed -- the desk's membership check prompts
            lapsed = person.key == "paul"
            await put(exhibitor, apha, f"{820000 + i * 131}",
                      show_start - timedelta(days=14) if lapsed else year_end)
        if i % 5 != 3:
            await put(exhibitor, mnsphc, f"MN{2600 + i}", year_end)
        if i % 3 != 1:
            await put(exhibitor, wsca, f"W{51000 + i * 7}", None)

        for division in sorted(divisions[person.key]):
            card = await _one(db, select(ExhibitorCompetitionCard).where(
                ExhibitorCompetitionCard.exhibitor_id == exhibitor.id,
                ExhibitorCompetitionCard.association_id == apha.id,
                ExhibitorCompetitionCard.division == division,
            ))
            if card is None:
                db.add(ExhibitorCompetitionCard(
                    exhibitor_id=exhibitor.id, association_id=apha.id, division=division,
                    card_number=f"{division[:2]}{rng.randint(10000, 99999)}",
                    valid_year=show_start.year,
                ))
            else:
                card.valid_year = show_start.year
    await db.flush()


async def seed(show_start: date, plan_only: bool, verbose: bool) -> None:
    rng = random.Random(RANDOM_SEED)
    classes = load_class_plans(show_start)
    horses = build_horses(rng)
    planner = Planner(classes, horses, show_start, rng)
    done_numbers = [c.number for c in classes[:CLASSES_DONE]]
    planner.plan(full=done_numbers)
    print_plan(planner, verbose or plan_only)
    if planner.big_count() < planner.need:
        sys.exit(f"Plan falls short: {planner.big_count()} classes of {BIG_CLASS_SIZE}+, need {planner.need}.")
    if plan_only:
        return

    hashed = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt()).decode()
    now = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as db:
        built = await base.build_show(db, show_name=LIVE_SHOW_NAME, first_day=show_start, status="ACTIVE")
        show = built["show"]
        # A show running today closed its entries a while ago and has its number.
        show.entry_deadline = show_start - timedelta(days=10)
        show.apha_show_number = f"LT-{show_start:%y%m%d}"
        admin = await _one(db, select(User).where(User.email == base.ADMIN_EMAIL))
        secretary = built["staff"]["christina.kooiman@example.com"]

        for email, table in ((GATE_STEWARD_EMAIL, ShowGateSteward), (SCRIBE_EMAIL, ShowScribe)):
            user = await _one(db, select(User).where(User.email == email))
            if user is not None:
                db.add(table(show_id=show.id, user_id=user.id))

        for plan in classes:
            plan.id = built["classes"][plan.number].id

        lookups = {
            "breed": await _one(db, select(Breed).where(Breed.name == "American Paint Horse")),
            "colors": {c.name: c for c in (await db.execute(select(HorseColor))).scalars()},
            "patterns": {p.name: p for p in (await db.execute(select(HorsePattern))).scalars()},
            "apha": await _one(db, select(Association).where(Association.code == "APHA")),
            "wsca": built["clubs"]["WSCA"],
            "mnsphc": built["clubs"]["MNSPHC"],
        }
        exhibitors = await upsert_people(db, rng, hashed, show_start.year)
        await upsert_horses(db, horses, exhibitors, lookups, show_start, rng, admin.id)
        await upsert_memberships(db, exhibitors, lookups, show_start, planner, rng)

        # ── Sign-ups: the roster, back numbers, stalls and bedding ───────────
        fees = {f.code: f for f in (await db.execute(
            select(ShowFee).where(ShowFee.show_id == show.id))).scalars()}
        # Every horse that is shown gets a stall ("ALL HORSES MUST HAVE A
        # STALL"), booked on its owner's account whoever is showing it.
        stabled_by = {e.horse.index: e.horse.owner for e in planner.entries}

        requested = {"ava": 7, "jolene": 21, "carla": 88, "lily": 113, "travis": 1}
        next_number = 200
        show_entries: dict[str, ShowEntry] = {}
        for i, person in enumerate(PEOPLE):
            if person.key in requested:
                number = requested[person.key]
            else:
                next_number += rng.randint(1, 14)
                number = next_number
            se = ShowEntry(
                show_id=show.id,
                exhibitor_id=exhibitors[person.key].id,
                back_number=number,
                preferred_back_number=requested.get(person.key),
                registered_at=_central(show_start - timedelta(days=rng.randint(12, 45)),
                                       rng.randint(7, 21), rng.randint(0, 59)),
                arrival_date=show_start - timedelta(days=rng.choice([1, 1, 1, 2])),
                departure_date=show_start + timedelta(days=1),
            )
            if i % 6 == 2:
                se.stall_request = f"Next to the {rng.choice(['Hasselquist', 'Wendt', 'Lindqvist'])} barn, please"
            if i % 7 == 4:
                se.registration_notes = "Arriving late the night before -- will check in at the gate."
            db.add(se)
            show_entries[person.key] = se
        await db.flush()

        for person in PEOPLE:
            se = show_entries[person.key]
            stalls = sum(1 for who in stabled_by.values() if who == person.key)
            booked_on = se.registered_at.astimezone(SHOW_TZ).date()
            lines = []
            if stalls:
                lines += [("stall", stalls), ("shavings", stalls * 2)]
                if stalls >= 3:
                    lines.append(("tack_stall", 1))
                if person.key in ("jolene", "carla"):
                    lines.append(("early_arrival_stall", stalls))
            if person.kind == "am" and rng.random() < 0.75:
                lines.append(("camping", 1))
            for code, qty in lines:
                db.add(ShowEntryReservation(
                    show_entry_id=se.id, show_fee_id=fees[code].id, quantity=qty, reserved_at=booked_on,
                ))

        # ── Class entries ────────────────────────────────────────────────────
        statement = ATTESTATION_STATEMENTS["novice_eligibility"]
        for planned in planner.entries:
            person = planned.person
            row = Entry(
                class_id=planned.cls.id,
                exhibitor_id=exhibitors[person.key].id,
                horse_id=planned.horse.id,
                status="ENTERED",
                apha_division=planned.cls.division,
                relationship_to_owner=planned.relationship,
            )
            if planned.cls.division in ("NOVICE_AMATEUR", "NOVICE_YOUTH"):
                row.attestations = [EntryAttestation(
                    kind="novice_eligibility", statement=statement,
                    attested_by_user_id=exhibitors[person.key].user_id,
                    attested_by_name=person.full_name,
                )]
            db.add(row)
            planned.row = row
        await db.flush()

        # ── Side pot buy-ins: entering a class a pot bundles is buying in ────
        pot_classes: dict[object, set] = defaultdict(set)
        for link in (await db.execute(
            select(SidePotClass).join(SidePot).where(SidePot.show_id == show.id)
        )).scalars():
            pot_classes[link.side_pot_id].add(link.class_id)
        pot_members = {}
        for pot_id, class_ids in pot_classes.items():
            pot_members[pot_id] = sorted({e.person.key for e in planner.entries if e.cls.id in class_ids})
            for key in pot_members[pot_id]:
                db.add(SidePotEntry(side_pot_id=pot_id, show_entry_id=show_entries[key].id, paid=True))

        # ── Futurity nominations: one per horse in any futurity class ────────
        futurity = built["futurity"]
        tiers = sorted((await db.execute(select(FuturityFeeTier).where(
            FuturityFeeTier.futurity_id == futurity.id))).scalars(), key=lambda t: t.sort_order)
        memberships = sorted((await db.execute(select(FuturityMembershipOption).where(
            FuturityMembershipOption.futurity_id == futurity.id))).scalars(), key=lambda o: o.sort_order)
        futurity_numbers = set(built["futurity_class_numbers"])
        nominated: dict[int, PlannedEntry] = {}
        for e in planner.entries:
            if e.cls.number in futurity_numbers:
                nominated.setdefault(e.horse.index, e)
        for n, (_index, e) in enumerate(sorted(nominated.items())):
            is_member = n % 4 != 1
            db.add(FuturityEntry(
                futurity_id=futurity.id,
                show_entry_id=show_entries[e.person.key].id,
                horse_id=e.horse.id,
                fee_tier_id=tiers[[0, 1, 2, 2, 1, 2][n % 6]].id,
                is_member=is_member,
                membership_option_id=memberships[n % 2].id if not is_member and n % 3 == 0 else None,
                shown_by_name=None if e.horse.owner == e.person.key else e.person.full_name,
                # One nomination came in the morning after the deadline, and owes
                # the late fee on every futurity class that horse is in.
                entered_at=(futurity.entry_deadline + timedelta(days=1)) if n == 5
                else futurity.entry_deadline - timedelta(days=rng.randint(3, 30)),
            ))

        # ── Paperwork: the show's release, and the futurity's ────────────────
        release = ShowWaiver(
            show_id=show.id,
            title="Release of liability",
            body=(
                "I understand that horse shows involve inherent risks, and I release "
                "the Minnesota North Star Paint Horse Club, Double F Arena, the show "
                "management and their volunteers from all claims arising from my "
                "participation, or that of the minor I sign for.\n\n"
                "SAMPLE TEXT FOR TEST DATA. A show's real release comes from its insurer."
            ),
            is_required=True,
            sort_order=1,
        )
        db.add(release)
        await db.flush()
        futurity_release = await _one(db, select(ShowWaiver).where(ShowWaiver.futurity_id == futurity.id))
        in_futurity = {e.person.key for e in nominated.values()}
        unsigned = {"renee", "owen"}   # the desk still has to chase these two
        on_paper = {"paul", "carla"}   # handed a paper blank across the counter
        for person in PEOPLE:
            waivers = [release] + ([futurity_release] if person.key in in_futurity else [])
            for waiver in waivers:
                if waiver is release and person.key in unsigned:
                    continue
                guardian = _guardian(person) if person.kind == "youth" else None
                paper = person.key in on_paper
                db.add(ShowWaiverSignature(
                    waiver_id=waiver.id,
                    exhibitor_id=exhibitors[person.key].id,
                    signed_name=guardian[0] if guardian else person.full_name,
                    signed_by_guardian=guardian is not None,
                    guardian_relationship=guardian[1] if guardian else None,
                    signed_at=show_entries[person.key].registered_at,
                    on_paper=paper,
                    recorded_by=secretary.id if paper else None,
                    recorded_by_name=OFFICE_NAME if paper else None,
                ))
        await db.flush()

        # ── The first classes of the morning: gate, placings, posted ─────────
        judges = sorted((await db.execute(select(ShowJudge).where(
            ShowJudge.show_id == show.id))).scalars(), key=lambda j: j.sort_order)
        first_posted = now - timedelta(minutes=22 * CLASSES_DONE + 8)
        for step, number in enumerate(done_numbers):
            planned = planner.by_class[number]
            go = list(range(1, len(planned) + 1))
            rng.shuffle(go)
            # One underlying quality per horse, judged with some disagreement:
            # four cards that mostly agree and rarely match exactly.
            quality = {id(p): rng.gauss(0, 1) for p in planned}
            for p, order in zip(planned, go):
                p.row.gate_order = order
                p.row.gate_checked_in = True
            for judge in judges:
                card = sorted(planned, key=lambda p: -(quality[id(p)] + rng.gauss(0, 0.6)))
                for place, p in enumerate(card, start=1):
                    db.add(Result(
                        class_id=p.cls.id, entry_id=p.row.id, judge_id=judge.id,
                        place=place, outcome="placed", is_tie=False,
                    ))
            built["classes"][number].gate_status = "done"
            built["classes"][number].results_published_at = first_posted + timedelta(minutes=22 * step)
        await db.flush()

        # The Grand & Reserve after the stallion class calls back every horse a
        # judge placed first or second in it -- entered by the desk, as the office
        # does at the show, and on deck now.
        last_done = done_numbers[-1]
        callback_class = built["classes"]["2-3"]
        winners = set((await db.execute(select(Result.entry_id).where(
            Result.class_id == built["classes"][last_done].id, Result.place <= 2,
        ))).scalars())
        called_back = []
        for p in planner.by_class[last_done]:
            if p.row.id in winners:
                db.add(Entry(
                    class_id=callback_class.id, exhibitor_id=p.row.exhibitor_id,
                    horse_id=p.row.horse_id, status="ENTERED",
                    apha_division=p.row.apha_division,
                    relationship_to_owner=p.row.relationship_to_owner,
                ))
                called_back.append(p.horse.name)
        await db.commit()

        # ── Money: what the office has taken so far ──────────────────────────
        # Read off the same loader the Financials screen uses, so "paid in full"
        # means exactly what that screen will say.
        financials = await _load_financials(show.id, db)
        accounts = sorted(financials["accounts"], key=lambda a: a["exhibitor_name"])
        paid_full = part_paid = 0
        for n, account in enumerate(accounts):
            billed = account["bill"]["total_cents"]
            mode = n % 3  # paid in full, paid a deposit, or paying at the desk today
            if billed <= 0 or mode == 2:
                continue
            amount = billed if mode == 0 else max(100, round(billed * rng.choice([0.25, 0.4, 0.5]) / 100) * 100)
            method = rng.choice(["check", "check", "card", "cash", "transfer"])
            db.add(ShowPayment(
                show_entry_id=account["show_entry_id"], amount_cents=amount, method=method,
                reference=f"#{rng.randint(1001, 9999)}" if method == "check" else None,
                received_on=show_start - timedelta(days=rng.randint(0, 20)),
                note="Paid in full with entries" if mode == 0 else "Deposit with entries",
                recorded_by=secretary.id, recorded_by_name=OFFICE_NAME,
            ))
            paid_full += mode == 0
            part_paid += mode == 1
        await db.commit()

        billed_total = sum(a["bill"]["total_cents"] for a in accounts)
        print()
        print(f"Show:  {show.name}")
        print(f"  id         {show.id}")
        print(f"  status     {show.status}  {show.start_date} to {show.end_date}")
        print(f"  people     {len(PEOPLE)} exhibitors (password {PASSWORD}), {len(horses)} horses")
        print(f"  entries    {len(planner.entries) + len(called_back)}; "
              f"{len(nominated)} futurity nominations; side pots "
              + ", ".join(str(len(m)) for m in pot_members.values()))
        print(f"  posted     classes {', '.join(done_numbers)}; on deck: 2-3 with "
              f"{len(called_back)} call-backs ({', '.join(called_back)})")
        print(f"  money      billed ${billed_total / 100:,.2f}; {paid_full} paid in full, "
              f"{part_paid} paid a deposit, {len(accounts) - paid_full - part_paid} owing it all")
        print(f"  logins     " + ", ".join(p.email for p in PEOPLE[:2]) + ", ... (all @example.com)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--start", type=date.fromisoformat, default=None,
                        help="first show day (default: today, Central time)")
    parser.add_argument("--plan-only", action="store_true",
                        help="print the entry plan and stop; writes nothing")
    parser.add_argument("--verbose", action="store_true",
                        help="print every class's entry count against what it could hold")
    args = parser.parse_args()
    start = args.start or datetime.now(SHOW_TZ).date()
    asyncio.run(seed(start, args.plan_only, args.verbose))


if __name__ == "__main__":
    main()
