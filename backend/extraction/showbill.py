"""Read a show's own printed show bill into a draft of the show.

A show bill is the whole show, laid out by the club before anything is keyed in
here: the dates and the venue, who is judging, which clubs sanction it, every
class in program order with its price, and the stall / shavings / camping
catalogue. `scripts/seed_mnsphc_paint_o_rama.py` is a day's hand transcription
of one. This module does that transcription and hands it back as a
**draft** -- `showbill_import.py` creates a DRAFT show from it once a person
has confirmed its name, dates, judges and venue (`showbill_draft.py` builds
it). The office checks the show against the bill as it walks the setup
steps; the read lists nothing for it to check.

Design notes:

* Nothing here writes to the database. The caller keeps the read on a
  `show_bill_imports` row.
* **Transcribe, never compute.** A bill quotes class prices "per judge" and the
  app stores the multiplied figure, but the multiplication depends on a judge
  panel the office may still change -- so the model reports the rate and says
  it is per judge, and `showbill_draft.py` multiplies it by the judges the bill
  names and says so in the office notes.
* **A class price is never a show fee.** The single most expensive mistake this
  app has made with a real bill was a class rate stored as a `per_entry` fee
  row, which billed every entry on top of the class's own price (a $36 class
  came to $552). The prompt spells the fee families out for that reason, and
  class prices go to `class_rates` and nowhere else.
* A failure is never fatal. Setting a show up by hand works exactly as it did
  before this existed, so every error comes back as a result the screen can
  show rather than raising.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Sequence

from .common import (
    STATUS_FAILED,
    STATUS_SUCCEEDED,
    STATUS_UNSUPPORTED_MEDIA,
    ExtractionResult,
    _document_block,
    _get_client,
    extraction_available,
    supports_extraction,
)

logger = logging.getLogger(__name__)

SHOWBILL_MODEL = "claude-opus-5"

# Opus 5 can refuse through its safety classifiers. A show bill is about as far
# from that as a document gets, but a refusal would otherwise cost the manager
# the whole read, so the request carries the server-side fallback: on a policy
# decline the API re-runs it on the named model inside the same call.
FALLBACK_BETA = "server-side-fallback-2026-06-01"
FALLBACK_MODELS = [{"model": "claude-opus-4-8"}]

# `max_tokens` bounds thinking *and* the answer. A 172-class bill is roughly
# 15k tokens of JSON before any thinking, so this is sized for the long bills
# rather than the typical one -- a read truncated at the cap is a read lost,
# and only the tokens actually produced are billed. Large enough that the SDK
# requires streaming, which is also what keeps a minutes-long read from hitting
# an HTTP timeout.
MAX_TOKENS = 100_000

BREED_ASSOCIATION_CODES = ("APHA", "AQHA", "ApHC", "FQHR", "OPEN")

# The show fee units the model may choose, in the families `billing.py` bills
# by. `per_class_per_horse` (withdrawn) and `percent_of_entry` (never billed,
# never offered by any editor) are left out on purpose: offering a unit no
# screen would show is how a row ends up nobody can explain.
FEE_UNITS = (
    # Booked by the exhibitor at sign-up.
    "per_stall",
    "per_bag",
    "per_night",
    "per_day",
    "per_show",
    # Charged automatically to everyone who enters a class.
    "per_exhibitor",
    "per_horse",
    "per_judge_per_horse",
    "per_judge_per_exhibitor",
    "per_judge_per_entry",
    "per_entry",
    # Printed on the bill; bills nobody.
    "flat",
)

CLUB_FEE_UNITS = (
    "per_entry",
    "per_exhibitor",
    "per_horse",
    "per_judge_per_horse",
    "per_judge_per_exhibitor",
)

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# --- Output schema -----------------------------------------------------------
# Structured outputs need `additionalProperties: false` and every property in
# `required`; anything optional is nullable or blank rather than omitted, so the
# shape that comes back never varies.
#
# The API also refuses a schema with more than 16 union-typed properties (a
# `["string", "null"]` type or an `anyOf`): 400 BadRequestError, "Schemas
# contains too many parameters with union types", on every upload. So optional
# *text* is a plain string left empty when the bill doesn't print it -- the
# normalizer's `_clean_str` reads "" as None, so nothing downstream changes --
# and `null` is kept for the numbers, booleans and enums, where no blank value
# exists. `test_the_schema_stays_under_the_union_limit` pins the count.


def _text(description: str) -> dict[str, Any]:
    """Optional text: an empty string when the bill doesn't print it."""
    return {"type": "string", "description": f"{description} Empty string if not printed."}


def _nullable(json_type: str, description: str) -> dict[str, Any]:
    return {"type": [json_type, "null"], "description": description}


def _nullable_enum(values: tuple[str, ...], description: str) -> dict[str, Any]:
    return {
        "anyOf": [{"type": "string", "enum": list(values)}, {"type": "null"}],
        "description": description,
    }


def _object(properties: dict[str, Any], description: str | None = None) -> dict[str, Any]:
    schema: dict[str, Any] = {
        "type": "object",
        "additionalProperties": False,
        "required": list(properties),
        "properties": properties,
    }
    if description:
        schema["description"] = description
    return schema


def _strings(description: str) -> dict[str, Any]:
    return {"type": "array", "items": {"type": "string"}, "description": description}


_SHOW = _object(
    {
        "name": _text("The show's name as printed, without the year unless the year is part of the name."),
        "start_date": _text("First day of the show, YYYY-MM-DD."),
        "end_date": _text("Last day of the show, YYYY-MM-DD."),
        "entry_deadline": _text(
            "The day entries close for the show as a whole, YYYY-MM-DD, only if printed. "
            "Not a futurity's own deadline and not a stall-reservation deadline.",
        ),
        "breed_association": _nullable_enum(
            BREED_ASSOCIATION_CODES,
            "The breed association the show is approved by. OPEN when it is an open or "
            "all-breed show with no breed association. A show approved by APHA that also "
            "runs All Breed club classes is APHA.",
        ),
        "apha_show_number": _text("APHA show/approval number, only if printed."),
        "aqha_show_number": _text("AQHA show/approval number, only if printed."),
        "apha_zone": _nullable("integer", "APHA zone number 1-14, only if the bill states it."),
        "venue_name": _text("Arena, fairground or facility name."),
        "venue_address": _text("Street address, on one line."),
        "venue_city": _text("City."),
        "venue_state": _text("State or province, as its postal abbreviation where printed that way."),
        "venue_zip": _text("ZIP or postal code."),
        "shavings_ban_outside": _nullable(
            "boolean",
            "True only if the bill says outside shavings/bedding are not allowed (must be "
            "bought on the grounds). Null if not mentioned.",
        ),
        "requires_coggins": _nullable("boolean", "True if a negative Coggins is required. Null if not mentioned."),
        "requires_health_certificate": _nullable(
            "boolean", "True if a health certificate (CVI) is required. Null if not mentioned."
        ),
        "health_certificate_valid_days": _nullable(
            "integer", "How recent the health certificate must be, in days, if stated (e.g. 'within 30 days' -> 30)."
        ),
        "requires_vaccination": _nullable(
            "boolean", "True if proof of vaccination is required. Null if not mentioned."
        ),
        "vaccination_notes": _text(
            "Which vaccinations the show requires and how recent, in the bill's words "
            "(e.g. 'Flu/Rhino and EHV within 6 months').",
        ),
    }
)

# A stall period: one window the bill sells stalls for, with what it sells.
# No union-typed property anywhere in it (see the note above `_text`): a price
# or count the bill doesn't print is 0, and a period that sells no pass has an
# empty `early_move_in_pass`.
STALL_KINDS = ("box", "tie", "tack")

_STALL = _object(
    {
        "kind": {
            "type": "string",
            "enum": list(STALL_KINDS),
            "description": "box: a box, horse or regular stall. tie: a tie stall. tack: a tack stall.",
        },
        "amount_cents": {
            "type": "integer",
            "description": "The price per stall for this period, in cents. When the price rises after a "
            "date (\"prices DOUBLE after the entry deadline\"), the raised price.",
        },
        "early_amount_cents": {
            "type": "integer",
            "description": "When the price rises after a date, the lower price before it, in cents. "
            "0 when the bill prints one price only.",
        },
        "horses_per_tack_stall": {
            "type": "integer",
            "description": "Tack stalls only: the fewest horses needed for each tack stall, if stated. 0 otherwise.",
        },
        "notes": _text(
            "What the bill says about this stall in this period, short: which barns, a group form, "
            "a cleaning fee that applies to it."
        ),
    }
)

_PASS = _object(
    {
        "label": {"type": "string", "description": "The pass as printed, e.g. 'Priority Move-In Pass'."},
        "amount_cents": {"type": "integer", "description": "Its price, in cents."},
        "move_in": _text(
            "When holders may move in from: YYYY-MM-DD, or YYYY-MM-DD HH:MM (24-hour) when an hour is printed."
        ),
        "move_in_until": _text(
            "When that early move-in ends, if printed ('2 PM to 4 PM' -> the 4 PM): YYYY-MM-DD, or "
            "YYYY-MM-DD HH:MM (24-hour)."
        ),
        "per_exhibitor": {
            "type": "boolean",
            "description": "True when it is sold once per exhibitor, trailer or permit; false when priced per stall.",
        },
        "notes": _text("What else the bill says about it, short: limited, first come first served, one trailer."),
    }
)

_STALL_PERIOD = _object(
    {
        "name": {
            "type": "string",
            "description": "What the bill calls this window, short: 'Full show', 'Pleasure', 'Games'. "
            "'Full show' when the bill sells stalls for the whole show only.",
        },
        "move_in": _text(
            "When this period's stalls may first be moved into: YYYY-MM-DD, or YYYY-MM-DD HH:MM "
            "(24-hour) when an hour is printed."
        ),
        "move_out": _text(
            "When this period's stalls must be empty: YYYY-MM-DD, or YYYY-MM-DD HH:MM (24-hour) when an "
            "hour is printed."
        ),
        "move_out_note": _text(
            "A move-out no clock states, in the bill's words: 'one hour after your last class'."
        ),
        "move_in_notes": _text(
            "Only what exhibitors with stalls in THIS period must know and the other periods' "
            "exhibitors don't: their own move-in gate or barn, where they get their stall "
            "assignment when that differs by period, when they must be out. A rule the bill states "
            "for every stall (or for stalls in general) is stall_notes, not here -- never in both. "
            "Empty when the bill sells stalls for one period only. Short lines, plain text."
        ),
        "reserve_by": _text(
            "The last day the lower prices (early_amount_cents) apply, YYYY-MM-DD -- e.g. the entry "
            "deadline when prices double after it. Empty when no stall here has a lower price."
        ),
        "stalls": {
            "type": "array",
            "items": _STALL,
            "description": "Each stall type this period sells, once each. Empty when the bill prints no stall price.",
        },
        "early_move_in_pass": {
            "type": "array",
            "items": _PASS,
            "description": "At most one: a pass this period's exhibitors buy to move in before the "
            "period's move-in. Empty if none.",
        },
    }
)

_JUDGE = _object(
    {
        "first_name": {"type": "string", "description": "Judge's first name as printed."},
        "last_name": {"type": "string", "description": "Judge's last name as printed."},
        "associations": _strings(
            "Association codes the bill says this judge is carded with or judging for "
            "(e.g. APHA, WSCA, NSBA). Empty if the bill does not say."
        ),
    }
)

_CLUB = _object(
    {
        "code": {"type": "string", "description": "The club's abbreviation as printed, e.g. NSBA, WSCA, MNSPHC."},
        "name": _text("The club's full name if printed."),
        "fee_amount_cents": _nullable(
            "integer",
            "A separate sanction/club fee the bill charges on the club's classes, in cents. "
            "Null when the club's classes simply carry their own class price and there is "
            "no separate club fee.",
        ),
        "fee_unit": _nullable_enum(CLUB_FEE_UNITS, "How that separate club fee is charged."),
        "fee_text": _text("The club fee exactly as printed, for the reviewer."),
    }
)

_RATE = _object(
    {
        "key": {
            "type": "string",
            "description": "A short identifier you choose for this rate (e.g. 'apha_open'), used by classes[].rate_key.",
        },
        "label": {"type": "string", "description": "What the bill calls this rate, e.g. 'APHA Open & Amateur classes'."},
        "amount_cents": {
            "type": "integer",
            "description": "The amount printed, in cents. If quoted per judge, the per-judge amount -- do not multiply.",
        },
        "per_judge": {"type": "boolean", "description": "True if the bill quotes this price per judge."},
        "association_code": _text(
            "Whose judges a per-judge rate is multiplied by, when the bill says (e.g. WSCA for "
            "'$5 per WSCA judge'). Empty for the whole panel or a flat price.",
        ),
        "printed_text": {"type": "string", "description": "The rate exactly as printed."},
    }
)

_CLASS = _object(
    {
        "date": _text("The day this class runs, YYYY-MM-DD."),
        "number": _text("The class number exactly as printed ('12', '2-3', 'A')."),
        "name": {
            "type": "string",
            "description": "The class name as printed, without the class number or association code.",
        },
        "discipline": _text(
            "The riding style or event the class is in -- usually the section heading it is "
            "printed under (Halter, Showmanship, Western Pleasure, Trail, Barrel Racing, ...).",
        ),
        "bracket": _text(
            "The division / age / skill bracket (Open, Amateur, Novice Amateur, Youth 13 & Under, "
            "Walk-Trot 11-18, Yearling, Green Horse, ...), as the bill words it.",
        ),
        "association_class_code": _text(
            "The breed association's class code printed beside the class (e.g. 'AMH1', 'HS2')."
        ),
        "rate_key": _text(
            "Which of class_rates prices this class. A rate named for a kind of class ('Double class', "
            "'4-In-A-Line', 'Adaptive') prices the classes of that kind: a class two riders or two horses "
            "ride as one entry is a double class. Empty for championship and futurity classes, "
            "or when no printed rate applies.",
        ),
        "club_codes": _strings(
            "Codes of the clubs (from `clubs`) that sanction or run THIS class, e.g. a class "
            "marked WSCA or 'MNSPHC All Breed'. Empty for a class only the breed association approves."
        ),
        "is_championship": {
            "type": "boolean",
            "description": "True for a Grand & Reserve / Grand Champion class that horses are called back into rather than entered.",
        },
        "futurity": _text(
            "The name of the futurity (from `futurities`) this class is part of, exactly as you "
            "wrote it there.",
        ),
        "side_pots": _strings(
            "Names of the side pots or jackpots (from `side_pots`) this class counts toward, "
            "exactly as you wrote them there. Empty for most classes."
        ),
    }
)

_FEE = _object(
    {
        "label": {"type": "string", "description": "The fee's name as printed, e.g. 'Stall', 'Shavings', 'Office charge'."},
        "amount_cents": {"type": "integer", "description": "The standard amount in cents."},
        "unit": {"type": "string", "enum": list(FEE_UNITS), "description": "How the fee is charged. See the instructions."},
        "notes": _text("Any wording on the bill that qualifies the fee, verbatim and short."),
        "early_amount_cents": _nullable(
            "integer", "A lower early-booking amount in cents, only if the bill prints one with a deadline."
        ),
        "early_deadline": _text("The deadline for that early amount, YYYY-MM-DD."),
        "min_quantity": _nullable(
            "integer", "For shavings only: the minimum number of bags every stall must be bedded with, if stated."
        ),
    }
)

_FUTURITY = _object(
    {
        "name": {
            "type": "string",
            "description": "The futurity's name as printed. One programme per entry: a Maturity or "
            "Derby printed beside a Futurity is its own futurity, even under one heading or price.",
        },
        "description": _text("One or two sentences on what the futurity is, in the bill's words."),
        "entry_deadline": _text("The futurity's own nomination or entry deadline, YYYY-MM-DD."),
        "late_fee_cents": _nullable("integer", "A late fee per class after that deadline, in cents, if printed."),
        "office_fee_member_cents": _nullable(
            "integer", "A one-time office or nomination fee for club members, in cents, if printed."
        ),
        "office_fee_nonmember_cents": _nullable(
            "integer", "The same fee for non-members, in cents. The single figure when the bill prints only one."
        ),
        "fee_tiers": {
            "type": "array",
            "description": "The futurity's per-class prices by the category an entrant picks "
            "(e.g. 'Open $50', 'Non-Pro $35'). Never a list of programmes: 'Futurity classes $85, "
            "Maturity classes $85' is two futurities at $85 each. Empty if the bill prints none.",
            "items": _object(
                {
                    "name": {"type": "string", "description": "The tier as printed."},
                    "amount_cents": {"type": "integer", "description": "Its per-class price, in cents."},
                }
            ),
        },
        "entry_instructions": _text("How to enter or nominate, in the bill's words."),
        "award_notice": _text("What the futurity pays out or awards, in the bill's words."),
        "rules_notice": _text("Its eligibility rules and how its categories work, in the bill's words."),
        "refund_policy": _text("What happens to the money if a horse does not show, in the bill's words."),
    }
)

_SIDE_POT = _object(
    {
        "name": {"type": "string", "description": "The side pot or jackpot's name as printed."},
        "description": _text("What it is and how it is won, in the bill's words, short."),
        "entry_fee_cents": _nullable("integer", "What it costs to enter, in cents, if printed."),
        "payback_percent": _nullable(
            "integer", "The percent of the pot paid back to winners (0-100), only if the bill states it."
        ),
        # Plain, not nullable: 0 / "placings" mean "not printed", which keeps
        # each pass under the API's limit on union-typed properties.
        "scoring": {
            "type": "string",
            "enum": ["placings", "time"],
            "description": (
                "time: it is won on the time of a run the exhibitor makes in one of its classes "
                "(a barrel or pole sidepot, a 4D or 5D); placings: anything else."
            ),
        },
        "added_money_cents": {
            "type": "integer",
            "description": "Money the show adds to the pot ('$1,000 Added'), in cents. 0 if none is printed.",
        },
        "d_count": {
            "type": "integer",
            "description": "How many Ds a time pot pays: 5 for a 5D, 4 for a 4D. 0 if it is not split into Ds.",
        },
        "d_split_ms": {
            "type": "integer",
            "description": (
                "How far apart its D lines are, in milliseconds: 500 for half-second splits, "
                "1000 for one-second splits. 0 if not printed."
            ),
        },
    }
)



# The bill is read in three passes, each held to its own schema: everything but
# the class list and the stalls; then the class list with the programmes run
# over it -- futurities and side pots, which are named per class -- and, at the
# same time, the stall periods. One schema for the whole bill is refused by the
# API -- "The compiled grammar is too large" -- and so was the header with the
# stall periods added to it (2026-11-18), although each part compiles, so the
# split is forced, not chosen. The header goes first because each class points
# at one of its `class_rates` by key; the stalls need nothing from it.
#
# The bill is not cached between the passes, on purpose: the output schema sits
# ahead of the bill in the prompt prefix, so two schemas are two prefixes and
# the second pass never read the cache -- measured 2026-11-12, `cache_read` 0
# on both -- while each pass paid the 1.25x cache write. Every pass reads the
# bill at the plain input rate.
HEADER_SCHEMA: dict[str, Any] = _object(
    {
        "show": _SHOW,
        "judges": {"type": "array", "items": _JUDGE, "description": "Every judge named on the bill."},
        "clubs": {
            "type": "array",
            "items": _CLUB,
            "description": "Club sanctioning bodies (not the breed association) whose classes run at this show.",
        },
        "class_rates": {
            "type": "array",
            "items": _RATE,
            "description": "The distinct class entry prices the bill quotes.",
        },
        "fees": {
            "type": "array",
            "items": _FEE,
            "description": "Every charge that is not a class entry price, a stall or an Early Move-In Pass "
            "(stalls and passes are read in their own pass).",
        },
        "notes_for_exhibitors": _text(
            "What an exhibitor should know that no other field holds: awards and hi-point prizes, "
            "sponsors, refund and scratch policy, arrival and check-in, dogs, golf carts, grounds "
            "rules. Short lines, one per topic, plain text."
        ),
        "notes_for_office": _text(
            "What only the show office needs and no other field holds: the show officials named "
            "(managers, secretaries, stewards, ring crew) with their roles and contact details, "
            "the bill's own office procedures. Short lines, plain text. Information about the show "
            "only, never a list of things to check."
        ),
    }
)

CLASSES_SCHEMA: dict[str, Any] = _object(
    {
        "classes": {
            "type": "array",
            "items": _CLASS,
            "description": "Every class on the schedule, in the printed program order.",
        },
        "futurities": {
            "type": "array",
            "items": _FUTURITY,
            "description": "Every futurity the bill runs. Empty if none.",
        },
        "side_pots": {
            "type": "array",
            "items": _SIDE_POT,
            "description": "Every side pot or jackpot exhibitors pay into on top of class entries. Empty if none.",
        },
    }
)

STALLS_SCHEMA: dict[str, Any] = _object(
    {
        "stall_notes": _text(
            "General stalling notes: the stall rules every exhibitor who stalls must know, whichever "
            "period they book, in the bill's words -- unloading, how and where stall assignments are "
            "given, no switching stalls, barn office hours, bedding and shavings rules, cleaning and "
            "checking out, reservation and refund policy for stalls. Everything about stalls that "
            "names no one period goes here, and all of it does when the bill sells stalls for one "
            "period only. Not prices, not move-in days and hours (those are each period's move_in "
            "and move_out), and nothing that only one period's exhibitors need -- that is the "
            "period's own move_in_notes. Short lines, plain text.",
        ),
        "stall_periods": {
            "type": "array",
            "items": _STALL_PERIOD,
            "description": "Each window the bill sells stalls for, in the bill's order, with the stalls it "
            "sells. One 'Full show' period when every stall is sold for the whole show. Empty when "
            "the bill says nothing about stalls.",
        },
    }
)

SHOWBILL_SCHEMAS: tuple[dict[str, Any], ...] = (HEADER_SCHEMA, CLASSES_SCHEMA, STALLS_SCHEMA)


SYSTEM_PROMPT = """You transcribe horse show bills (also called premium lists or \
prize lists) into a structured draft for a horse show management app. A show \
manager uploads the club's own printed bill; your output becomes a draft of the \
show, which the show office reviews and corrects before it is published.

Transcribe what is printed. Do not invent, complete or correct. A blank, a null \
or an empty list costs the manager a minute of typing; a plausible wrong value \
can reach an exhibitor's bill. Leave a text field as an empty string when the \
bill doesn't print it.

The class schedule
- List every class, in the order the bill prints them, day by day. Include \
championship classes and futurity classes -- they are on the schedule too. One \
entry per class; a class printed once is one entry even if the bill shows it \
twice (e.g. once in the schedule and once in a fee table).
- `number` is the class number exactly as printed ("12", "2-3", "A"). `name` is \
the class name without the number or code. When the bill prints classes under a \
heading such as HALTER or SHOWMANSHIP and the class line itself only says \
"Yearling Stallions", the heading is the `discipline`; keep `name` as printed.
- `bracket` is the division the class is for -- the rider division (Open, \
Amateur, Novice Amateur, Youth 18 & Under, Amateur Walk-Trot ...) or, for halter \
and some performance classes, the horse's age or level (Yearling, Two Year Old, \
Green Horse). Use the bill's own words.
- `date`: bills usually group classes under a day heading. Use the show's dates \
to fill in a year the heading leaves out.
- Grand & Reserve / Grand Champion classes are ones horses are called back into \
from earlier classes. Mark `is_championship` and leave `rate_key` empty. Bills \
usually print them with no class number: leave `number` empty then -- never \
invent one or borrow the class beside it.
- A club class judged at the same time as a breed class is its own class. Bills \
print it beside the breed class with its own number -- "5. Amateur Performance \
Stallions / 5N. NSBA", "12 / 12N", "AQHA 30 / NSBA 30N". It is one ring and one \
go, but the club class has its own entries, its own fee (usually the club's own \
per-class or per-judge rate, often outside any flat fee), its own judges' cards \
and its own placings. So list it as a separate entry straight after the breed \
class: `number` exactly as printed ("5N"), the same `name` as the class it runs \
with, `club_codes` naming the club, and `rate_key` pointing at the club's rate. \
Never fold it into the breed class or add its price to the breed class's rate.
- Classes the bill marks as run together -- judged at the same time, combined, \
or flagged with a symbol whose legend says so ("* classes run simultaneously") \
-- are still separate classes, one entry each.
- Classes the bill marks as part of a futurity: set `futurity` to that \
futurity's name and leave `rate_key` empty -- the futurity prices them.
- A class that counts toward a side pot or jackpot lists it in `side_pots`. A \
jackpot with a go of its own -- its own class, judged or run separately, \
like a jackpot pleasure class -- is a class, not a side pot. But a sidepot \
that takes its times or placings from runs made in other classes ("times \
will be taken from the age division run", "no separate run") is a side pot \
over those classes even when the schedule numbers it like a class: list it \
in `side_pots`, name it on each class its runs come from, and do not list it \
as a class.

Class prices -> `class_rates`, never `fees`
- A class entry price belongs in `class_rates`, and each class points at the \
rate that applies to it through `rate_key`. Bills usually state a handful of \
rates ("APHA Open/Amateur $9 per judge", "Youth $7 per judge", "WSCA classes \
$5 per judge") -- one rate row each.
- If a rate is quoted per judge, give the per-judge amount and set `per_judge`. \
Never multiply by the number of judges; the reviewer does that. If it is per \
judge of one association only, name it in `association_code`.
- A class price must never also appear in `fees`. A fee row charges on top of \
every class price, so repeating a class price there bills exhibitors twice.
- Every class someone enters gets the rate that applies, even when the rate \
is named for a kind of class rather than listing its classes. "Double class" \
or "pairs" prices the classes one entry rides as two riders or two horses \
(tandem bareback, ribbon race, rescue race, pairs or partner classes); a \
"4-in-a-line" or team rate the classes ridden by that many; "adaptive" the \
assisted and unassisted classes; "jackpot" the jackpot classes. "Single \
class" is every other class. Leave `rate_key` empty only where no printed rate \
fits -- a class left empty costs nothing to enter.

Clubs
- The breed association (APHA, AQHA ...) is `show.breed_association`, not a club. \
Clubs are the other sanctioning bodies whose classes run at the show (NSBA, \
WSCA, a regional club's All Breed classes ...).
- `club_codes` on a class says which clubs sanction THAT class. Most classes at \
a breed show carry none.
- A club's `fee_amount_cents` is only for a separate sanction or club fee the \
bill charges on top of the class price. When the club's classes just carry their \
own price, that price is a class rate and the club fee is null.

Stalls -> `stall_periods`, never `fees`
- A stall period is one window the bill sells stalls for, with its own move-in \
and move-out. A bill that sells every stall for the whole show has one period, \
"Full show". A bill that sells the same stall for different parts of the show \
-- the full show, the pleasure days, the games days -- has one period for each, \
in the bill's order, named short ("Full show", "Pleasure", "Games").
- Each period lists the stall types it sells, once each: box, tie, tack. The \
same price in different barns ("Horse Barn" and "Cattle Barn" stalls at $130) is \
one box stall; name the barns in its `notes`. A stall type sold only for the \
whole show (tie stalls "for the full show") belongs to the full-show period. A \
tack stall's minimum ("at least 4 horses per tack stall") is \
`horses_per_tack_stall`.
- A price that rises after a date ("stalling prices DOUBLE after the class entry \
deadline") is the raised price in `amount_cents`, the printed price in \
`early_amount_cents`, and that date in the period's `reserve_by`.
- A pass sold for moving in before a period's move-in (Early or Priority Move-In \
Pass) goes on the period whose stalls it moves in early, with its own move-in. \
If it serves more than one period, put it on the first.
- Never list a stall or a pass in `fees` as well. A charge per stall that is \
not a stall -- a deposit, a bedding package -- is a `fees` row; a cleaning or \
check-out penalty is a flat `fees` row.

Other fees -> `fees`, and the unit decides who pays
- Booked by the exhibitor: per_stall (an extra priced per stall that is not a \
stall, e.g. a stall deposit), per_bag (shavings), \
per_night / per_day (camping or hook-ups priced by the night or day -- a night \
and a day are different: Friday to Sunday is three days and two nights), \
per_show (one price for the whole show per thing booked, e.g. "$60 hook-up for \
the weekend").
- Charged automatically to everyone who enters: per_exhibitor (once per person, \
e.g. an office fee per back number), per_horse (once per horse, e.g. a drug fee), \
per_judge_per_horse / per_judge_per_exhibitor (the same, per judge), \
per_judge_per_entry (a breed association's assessment per class per judge, \
collected and forwarded -- e.g. an APHA fee per class per judge), per_entry (a \
charge added to every class entered, on top of the class price -- never the \
class price itself).
- Parking and other permits (a parking permit, a side-by-side or golf cart \
permit, an additional vehicle): per_show, or per_day when priced by the day, \
labelled with the permit's name ("Parking Permit", "Side-by-Side Permit"). \
Never camping: a hook-up or camping spot is its own row.
- flat: anything whose occurrence cannot be worked out from entries -- late or \
post-entry fees, penalties (stall cleanout, NSF checks), deposits, and "all day" \
or "all-in" fee bundles that replace per-class fees. When unsure whether a fee \
applies to everyone, use flat: a flat fee is printed and bills nobody, so the \
reviewer can promote it; a wrongly automatic fee bills everyone.
- Early rates: only when the bill prints both a lower amount and the date it \
applies until.

Futurities and side pots
- A futurity is a programme a horse is nominated to, with its own deadline, \
fees and categories. List each in `futurities` with whatever the bill prints \
about it, in the bill's words; leave the rest empty.
- Each programme is its own futurity, even when the bill prints them under one \
heading or one price ("Futurity & Maturity classes are $85", \
"Futurity/Maturity Pleasure", "Futurity and Derby"). A horse is entered in one \
of them by its age, and each runs its own classes -- so list a Futurity for the \
classes the bill names Futurity and a Maturity (or Derby) for the classes it \
names Maturity (or Derby), each named as the bill names it, each carrying the \
price, deadline and wording printed for both. Set each class's `futurity` to \
the one its own name says. `fee_tiers` are the categories an entrant picks \
within one programme (Open, Non-Pro, Category #1) -- never the programmes.
- A side pot or jackpot is money exhibitors pay into on top of their class \
entries, paid back to the winners of one or more classes. List each in \
`side_pots`, and name it on each class it covers.
- A sidepot won on time (barrels, poles: "5D", "4D", "1/2 second splits") is \
`scoring` time, with its number of Ds and how far apart they are. Its classes \
are the ones its times come from -- for a barrel sidepot taken from the age \
division runs, every age-division barrel class, not an adaptive or team one. \
Its price is usually in the entry fee table ("SIDEPOT 5D BARRELS $40"): that \
is its `entry_fee_cents`, not a class rate. Added money and a payout percent \
printed for it ("$1,000 Added", "75% payout") are its `added_money_cents` and \
`payback_percent`. Who may enter it (a futurity or derby horse's age) is the \
office's to check: say so in its description.

Notes
- Each note goes in the field for the part of the show it is about -- the \
office sets each part up on its own step, and a note in the wrong field is \
printed twice or in the wrong place:
  - stalls and moving in and out (unloading, barn office, stall assignments, \
bedding and cleaning rules, departure) -> split by who it is for. Ask of each \
rule: would an exhibitor with a stall in ANY period need it? Then it is a \
general stalling note, in `stall_notes`, said once -- so is every stall rule \
when the bill sells stalls for one period only. Does it name or only fit one \
period ("Games stalls move in through the back gate after 9 PM Friday")? \
Then it is that period's `move_in_notes`. A rule that fits some periods but \
not all goes in each of those periods' `move_in_notes`. A period's days and \
hours are its `move_in` and `move_out`, not a note. Never put one rule in both;
  - which vaccinations are required and how recent -> `show.vaccination_notes`;
  - wording about one fee or booked item (a camping hook-up's amps, a shavings \
brand, a stall deposit's terms) -> that fee's `notes`;
  - a futurity's or side pot's wording -> the futurity or side pot, read with \
the class list;
  - what only the show office needs -- the show officials named, with their \
roles and contact details -> `notes_for_office`;
  - anything else an exhibitor should know that none of those holds -- awards \
and hi-point prizes, sponsors, refund and scratch policy, show-office hours, \
dogs, golf carts, grounds rules -> `notes_for_exhibitors`.
- Say each thing once, in its own field. Short lines, in the bill's words.
- A stall price is never repeated in a note: it is on the stall type.

More than one document
- The show office may upload the club's other papers beside the bill -- a \
rules and information sheet, a futurity entry sheet, a stall reservation form. \
Document 1 is always the show bill; every other document is from the same show. \
Read them together and give one answer for the show: a rule, fee, deadline or \
note that only a supporting document prints belongs in the same field as if \
the bill had printed it.
- The show bill is the schedule. List a class once even when another document \
prints it too, in the bill's order and with the bill's number.
- Where two documents disagree about anything -- a date, a price, a judge, a \
deadline -- take the show bill's value.
- A supporting document that is not about this show (another year, another \
show) is ignored.

Everything else
- Money is integer cents: $36 -> 3600, $7.50 -> 750.
- Dates are YYYY-MM-DD.
- If the document is not a horse show bill, return empty lists, blanks and nulls."""


def _clean_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = " ".join(value.split())
    return value or None


def _clean_date(value: Any) -> str | None:
    text = _clean_str(value)
    if text is None:
        return None
    if _DATE_RE.match(text):
        try:
            return date.fromisoformat(text).isoformat()
        except ValueError:
            pass
    return None


_MOMENT_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?$")


def _clean_moment(value: Any) -> tuple[str | None, str | None]:
    """A day, and the hour on it if one was printed: "2027-08-20 18:00" ->
    ("2027-08-20", "18:00"). Anything else is blanked; an hour that isn't one
    keeps only the day."""
    text = _clean_str(value)
    if not text:
        return None, None
    match = _MOMENT_RE.match(text)
    day = None
    if match:
        try:
            day = date.fromisoformat(match.group(1)).isoformat()
        except ValueError:
            day = None
    if day is None:
        return None, None
    if match.group(2) is None:
        return day, None
    hour, minute = int(match.group(2)), int(match.group(3))
    if hour > 23 or minute > 59:
        return day, None
    return day, f"{hour:02d}:{minute:02d}"


def _clean_cents(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    cents = int(round(value))
    return cents if cents >= 0 else None


def _clean_codes(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    seen: dict[str, str] = {}
    for value in values:
        code = _clean_str(value)
        if code and code.upper() not in seen:
            seen[code.upper()] = code
    return list(seen.values())


def normalize_showbill(raw: dict[str, Any]) -> dict[str, Any]:
    """Coerce the model's output into values the review screen can trust.

    Structured outputs guarantee the shape, not the meaning: a date field is a
    string, not necessarily a date; a `rate_key` is a string, not necessarily
    one of the rates. Anything that fails is dropped to null, so a malformed
    value never reaches a form as though it had been read off the page.
    """
    show_raw = raw.get("show") or {}
    show: dict[str, Any] = {
        key: _clean_str(show_raw.get(key))
        for key in (
            "name",
            "apha_show_number",
            "aqha_show_number",
            "venue_name",
            "venue_address",
            "venue_city",
            "venue_state",
            "venue_zip",
        )
    }
    for key in ("start_date", "end_date", "entry_deadline"):
        show[key] = _clean_date(show_raw.get(key))
    breed = show_raw.get("breed_association")
    show["breed_association"] = breed if breed in BREED_ASSOCIATION_CODES else None
    zone = show_raw.get("apha_zone")
    show["apha_zone"] = zone if isinstance(zone, int) and not isinstance(zone, bool) and 1 <= zone <= 14 else None
    for key in (
        "shavings_ban_outside",
        "requires_coggins",
        "requires_health_certificate",
        "requires_vaccination",
    ):
        value = show_raw.get(key)
        show[key] = value if isinstance(value, bool) else None
    show["vaccination_notes"] = _clean_text(show_raw.get("vaccination_notes"))
    show["stall_notes"] = _clean_text(show_raw.get("stall_notes"))
    days = show_raw.get("health_certificate_valid_days")
    show["health_certificate_valid_days"] = (
        days if isinstance(days, int) and not isinstance(days, bool) and 0 < days <= 365 else None
    )
    if show["start_date"] and show["end_date"] and show["end_date"] < show["start_date"]:
        show["start_date"] = show["end_date"] = None

    judges = []
    for j in raw.get("judges") or []:
        first, last = _clean_str(j.get("first_name")), _clean_str(j.get("last_name"))
        if not (first and last):
            continue
        judges.append(
            {
                "first_name": first,
                "last_name": last,
                "associations": _clean_codes(j.get("associations")),
            }
        )

    clubs = []
    seen_clubs: set[str] = set()
    for c in raw.get("clubs") or []:
        code = _clean_str(c.get("code"))
        if not code or code.upper() in seen_clubs:
            continue
        seen_clubs.add(code.upper())
        unit = c.get("fee_unit")
        clubs.append(
            {
                "code": code,
                "name": _clean_str(c.get("name")),
                "fee_amount_cents": _clean_cents(c.get("fee_amount_cents")),
                "fee_unit": unit if unit in CLUB_FEE_UNITS else None,
                "fee_text": _clean_str(c.get("fee_text")),
            }
        )

    rates = []
    rate_keys: set[str] = set()
    for r in raw.get("class_rates") or []:
        key = _clean_str(r.get("key"))
        cents = _clean_cents(r.get("amount_cents"))
        if not key or key in rate_keys or cents is None:
            continue
        rate_keys.add(key)
        rates.append(
            {
                "key": key,
                "label": _clean_str(r.get("label")) or key,
                "amount_cents": cents,
                "per_judge": bool(r.get("per_judge")),
                "association_code": _clean_str(r.get("association_code")),
                "printed_text": _clean_str(r.get("printed_text")),
            }
        )

    classes = []
    for c in raw.get("classes") or []:
        name = _clean_str(c.get("name"))
        if not name:
            continue
        rate_key = _clean_str(c.get("rate_key"))
        # A rate the bill's rate list doesn't have leaves the class unpriced.
        if rate_key and rate_key not in rate_keys:
            rate_key = None
        futurity = _clean_str(c.get("futurity"))
        classes.append(
            {
                "date": _clean_date(c.get("date")),
                "number": _clean_str(c.get("number")),
                "name": name,
                "discipline": _clean_str(c.get("discipline")),
                "bracket": _clean_str(c.get("bracket")),
                "association_class_code": _clean_str(c.get("association_class_code")),
                "rate_key": rate_key,
                "club_codes": _clean_codes(c.get("club_codes")),
                "is_championship": bool(c.get("is_championship")),
                "futurity": futurity,
                "is_futurity": bool(futurity) or bool(c.get("is_futurity")),
                "side_pots": _clean_codes(c.get("side_pots")),
            }
        )

    fees = []
    for f in raw.get("fees") or []:
        label = _clean_str(f.get("label"))
        cents = _clean_cents(f.get("amount_cents"))
        unit = f.get("unit")
        if not label or cents is None or unit not in FEE_UNITS:
            continue
        early_cents = _clean_cents(f.get("early_amount_cents"))
        early_deadline = _clean_date(f.get("early_deadline"))
        if (early_cents is None) != (early_deadline is None):
            early_cents = early_deadline = None
        minimum = f.get("min_quantity")
        fees.append(
            {
                "label": label,
                "amount_cents": cents,
                "unit": unit,
                "notes": _clean_str(f.get("notes")),
                "early_amount_cents": early_cents,
                "early_deadline": early_deadline,
                "min_quantity": (
                    minimum
                    if isinstance(minimum, int) and not isinstance(minimum, bool) and 0 < minimum < 1000
                    else None
                ),
            }
        )

    futurities = []
    seen_futurities: set[str] = set()
    for f in raw.get("futurities") or []:
        name = _clean_str(f.get("name")) if isinstance(f, dict) else None
        if not name or name.lower() in seen_futurities:
            continue
        seen_futurities.add(name.lower())
        tiers = []
        for t in f.get("fee_tiers") or []:
            tier_name = _clean_str(t.get("name")) if isinstance(t, dict) else None
            tier_cents = _clean_cents(t.get("amount_cents")) if isinstance(t, dict) else None
            if tier_name and tier_cents is not None:
                tiers.append({"name": tier_name, "amount_cents": tier_cents})
        futurities.append(
            {
                "name": name,
                "description": _clean_str(f.get("description")),
                "entry_deadline": _clean_date(f.get("entry_deadline")),
                "late_fee_cents": _clean_cents(f.get("late_fee_cents")),
                "office_fee_member_cents": _clean_cents(f.get("office_fee_member_cents")),
                "office_fee_nonmember_cents": _clean_cents(f.get("office_fee_nonmember_cents")),
                "fee_tiers": tiers,
                "entry_instructions": _clean_text(f.get("entry_instructions")),
                "award_notice": _clean_text(f.get("award_notice")),
                "rules_notice": _clean_text(f.get("rules_notice")),
                "refund_policy": _clean_text(f.get("refund_policy")),
            }
        )

    side_pots = []
    seen_pots: set[str] = set()
    for p in raw.get("side_pots") or []:
        name = _clean_str(p.get("name")) if isinstance(p, dict) else None
        if not name or name.lower() in seen_pots:
            continue
        seen_pots.add(name.lower())
        payback = p.get("payback_percent")
        timed = p.get("scoring") == "time"
        side_pots.append(
            {
                "name": name,
                "description": _clean_str(p.get("description")),
                "entry_fee_cents": _clean_cents(p.get("entry_fee_cents")),
                "payback_percent": (
                    payback
                    if isinstance(payback, int) and not isinstance(payback, bool) and 0 <= payback <= 100
                    else None
                ),
                "scoring": "time" if timed else "placings",
                "added_money_cents": _clean_cents(p.get("added_money_cents")) or 0,
                # Only a time pot has Ds; None is "not printed".
                "d_count": _clean_count(p.get("d_count"), 11) if timed else None,
                "d_split_ms": _clean_count(p.get("d_split_ms"), 60001) if timed else None,
            }
        )

    return {
        "show": show,
        "judges": judges,
        "clubs": clubs,
        "class_rates": rates,
        "classes": classes,
        "stall_periods": _clean_stall_periods(raw.get("stall_periods")),
        "fees": fees,
        "futurities": futurities,
        "side_pots": side_pots,
        "notes_for_exhibitors": _clean_text(raw.get("notes_for_exhibitors")),
        "notes_for_office": _clean_text(raw.get("notes_for_office")),
    }


def _clean_count(value: Any, high: int) -> int | None:
    """A positive count below `high`; 0, which the schema uses for "not
    printed", is None."""
    if isinstance(value, int) and not isinstance(value, bool) and 0 < value < high:
        return value
    return None


def _clean_stall_periods(raw: Any) -> list[dict[str, Any]]:
    """The windows the bill sells stalls for, each with its stall types and
    pass. A period with no name is dropped unless it is the only one, which is
    the whole show; one stall type per period, the first the bill prints; a
    lower price with no day it ends is dropped, as `fees` drops one."""
    periods: list[dict[str, Any]] = []
    seen: set[str] = set()
    items = [p for p in (raw or []) if isinstance(p, dict)]
    for p in items:
        name = _clean_str(p.get("name")) or ("Full show" if len(items) == 1 else None)
        if not name:
            continue
        name = name[:60]
        if name.casefold() in seen:
            continue
        seen.add(name.casefold())
        move_in_date, move_in_time = _clean_moment(p.get("move_in"))
        move_out_date, move_out_time = _clean_moment(p.get("move_out"))
        reserve_by = _clean_date(p.get("reserve_by"))

        stalls: list[dict[str, Any]] = []
        for st in p.get("stalls") or []:
            if not isinstance(st, dict) or st.get("kind") not in STALL_KINDS:
                continue
            # A second price for the same kind: the first is used.
            if any(s["kind"] == st["kind"] for s in stalls):
                continue
            cents = _clean_cents(st.get("amount_cents"))
            if cents is None:
                continue
            early = _clean_cents(st.get("early_amount_cents")) or None
            if early is not None and (reserve_by is None or early >= cents):
                early = None
            stalls.append(
                {
                    "kind": st["kind"],
                    "amount_cents": cents,
                    "early_amount_cents": early,
                    "horses_per_tack_stall": (
                        _clean_count(st.get("horses_per_tack_stall"), 100) if st["kind"] == "tack" else None
                    ),
                    "notes": _clean_str(st.get("notes")),
                }
            )
        if not any(s["early_amount_cents"] for s in stalls):
            reserve_by = None

        early_pass = None
        for ps in p.get("early_move_in_pass") or []:
            if not isinstance(ps, dict):
                continue
            cents = _clean_cents(ps.get("amount_cents"))
            if cents is None:
                continue
            pass_date, pass_time = _clean_moment(ps.get("move_in"))
            end_date, end_time = _clean_moment(ps.get("move_in_until"))
            early_pass = {
                "label": _clean_str(ps.get("label")),
                "amount_cents": cents,
                "move_in_date": pass_date,
                "move_in_time": pass_time,
                "move_in_end_date": end_date,
                "move_in_end_time": end_time,
                "per_exhibitor": bool(ps.get("per_exhibitor")),
                "notes": _clean_str(ps.get("notes")),
            }
            break

        periods.append(
            {
                "name": name,
                "move_in_date": move_in_date,
                "move_in_time": move_in_time,
                "move_out_date": move_out_date,
                "move_out_time": move_out_time,
                "move_out_note": _clean_str(p.get("move_out_note")),
                "move_in_notes": _clean_text(p.get("move_in_notes")),
                "reserve_by": reserve_by,
                "stalls": stalls,
                "early_move_in_pass": early_pass,
            }
        )
    return periods


def _clean_text(value: Any) -> str | None:
    """Text that keeps its line breaks -- notes and a futurity's wording are
    read as paragraphs and lists, and folding them onto one line loses that."""
    if not isinstance(value, str):
        return None
    lines = [" ".join(line.split()) for line in value.strip().splitlines()]
    text = "\n".join(lines).strip()
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    return text or None


@dataclass(frozen=True)
class SupportingDocument:
    """A document read together with the bill (migration 201): the club's
    rules and information sheet, a futurity or stall form."""

    content: bytes
    mime_type: str
    filename: str


async def extract_showbill(
    content: bytes,
    mime_type: str,
    filename: str,
    supporting: Sequence[SupportingDocument] = (),
) -> ExtractionResult:
    """Read a show bill, with any supporting documents from the same show.
    Never raises -- failures come back as a result."""
    for doc_type in (mime_type, *(d.mime_type for d in supporting)):
        if not supports_extraction(doc_type):
            return ExtractionResult(
                status=STATUS_UNSUPPORTED_MEDIA,
                error_message=f"{doc_type} can't be read automatically. Set the show up by hand.",
            )
    if not extraction_available():
        return ExtractionResult(
            status=STATUS_UNSUPPORTED_MEDIA,
            error_message="Reading show bills is not configured on this server. Set the show up by hand.",
        )

    try:
        client = _get_client()
    except Exception as exc:  # noqa: BLE001 - surfaced to the uploader, never fatal
        logger.exception("showbill extraction: no client for %s", filename)
        return ExtractionResult(
            status=STATUS_FAILED,
            error_message=f"Could not read the show bill ({type(exc).__name__}). Try again, or set the show up by hand.",
            model=SHOWBILL_MODEL,
        )
    # No cache_control: see the note above HEADER_SCHEMA.
    documents = _documents(content, mime_type, filename, supporting)
    usage = _Usage()
    uploaded = _uploaded_as(filename, supporting)

    header, failure = await _read_pass(
        client,
        documents,
        f"{uploaded} Transcribe this show bill: everything except the class list, futurities and side "
        "pots, and except the stalls and any Early Move-In Pass, which are read separately -- leave those "
        "out of fees, and leave doubts about them to those passes. Trust the page over the filename.",
        HEADER_SCHEMA,
        filename,
        usage,
    )
    if failure:
        return failure

    # Neither needs the other, so they are read at the same time.
    (classes, failure), (stalls, stall_failure) = await asyncio.gather(
        _read_pass(
            client,
            documents,
            f"{uploaded} Transcribe the class list of this show bill, and its futurities and side pots. "
            f"{_rate_key_instruction(header)} The rest of the bill has been read already: warn only about the "
            "class list, the futurities and the side pots. Trust the page over the filename.",
            CLASSES_SCHEMA,
            filename,
            usage,
        ),
        _read_pass(
            client,
            documents,
            f"{uploaded} Transcribe only the stalls this show sells: each stall period with its stall "
            "prices and Early Move-In Pass, and the stall rules every period shares. The rest of the bill is "
            "read separately: warn only about the stalls. Trust the page over the filename.",
            STALLS_SCHEMA,
            filename,
            usage,
        ),
    )
    if failure or stall_failure:
        return failure or stall_failure

    raw = {
        **header,
        "show": {**(header.get("show") or {}), "stall_notes": stalls.get("stall_notes")},
        "stall_periods": stalls.get("stall_periods") or [],
        "classes": classes.get("classes") or [],
        "futurities": classes.get("futurities") or [],
        "side_pots": classes.get("side_pots") or [],
    }
    return ExtractionResult(status=STATUS_SUCCEEDED, fields=normalize_showbill(raw), **usage.as_fields())



class _Usage:
    """Tokens across both passes. Any cached input is counted as input read."""

    def __init__(self) -> None:
        self.model: str | None = SHOWBILL_MODEL
        self.input_tokens: int | None = None
        self.output_tokens: int | None = None

    def add(self, response: Any) -> None:
        u = response.usage
        read = u.input_tokens + (u.cache_creation_input_tokens or 0) + (u.cache_read_input_tokens or 0)
        self.model = response.model
        self.input_tokens = (self.input_tokens or 0) + read
        self.output_tokens = (self.output_tokens or 0) + u.output_tokens

    def as_fields(self) -> dict[str, Any]:
        return {"model": self.model, "input_tokens": self.input_tokens, "output_tokens": self.output_tokens}


def _rate_key_instruction(header: dict[str, Any]) -> str:
    """Tell the class pass which rate keys the header pass chose."""
    rates = [
        f"{key} ({_clean_str(r.get('printed_text')) or _clean_str(r.get('label')) or 'no text'})"
        for r in header.get("class_rates") or []
        if isinstance(r, dict) and (key := _clean_str(r.get("key")))
    ]
    if not rates:
        return "No class rates were read from this bill, so leave every class's `rate_key` empty."
    return (
        "The bill's class rates have already been read under these keys: "
        + "; ".join(rates)
        + ". Set each class's `rate_key` to one of these keys exactly, or leave it empty."
    )


def _documents(
    content: bytes, mime_type: str, filename: str, supporting: Sequence[SupportingDocument]
) -> list[dict[str, Any]]:
    """The bill, and each supporting document after it with a line saying what
    it is. A bill on its own is sent exactly as it always was."""
    bill = _document_block(content, mime_type)
    if not supporting:
        return [bill]
    blocks: list[dict[str, Any]] = [
        {"type": "text", "text": f"Document 1 -- the show bill, uploaded as {filename!r}:"},
        bill,
    ]
    for n, doc in enumerate(supporting, start=2):
        blocks.append(
            {
                "type": "text",
                "text": f"Document {n} -- a supporting document from the same show, uploaded as {doc.filename!r}:",
            }
        )
        blocks.append(_document_block(doc.content, doc.mime_type))
    return blocks


def _uploaded_as(filename: str, supporting: Sequence[SupportingDocument]) -> str:
    """The sentence each pass's instruction opens with."""
    if not supporting:
        return f"Uploaded as {filename!r}."
    count = len(supporting)
    return (
        f"The show bill and {count} supporting document{'s' if count != 1 else ''} from the same show are "
        "above. Read them together as one show, the way the system prompt says for more than one document."
    )


async def _read_pass(
    client: Any,
    documents: list[dict[str, Any]],
    instruction: str,
    schema: dict[str, Any],
    filename: str,
    usage: _Usage,
) -> tuple[dict[str, Any], ExtractionResult | None]:
    """One pass over the bill. Returns the parsed JSON, or a failure result."""
    try:
        async with client.beta.messages.stream(
            model=SHOWBILL_MODEL,
            max_tokens=MAX_TOKENS,
            betas=[FALLBACK_BETA],
            fallbacks=FALLBACK_MODELS,
            system=SYSTEM_PROMPT,
            output_config={
                # A transcription of a hundred-odd classes where one misread
                # price reaches every entrant's bill: worth the deeper pass.
                "effort": "high",
                "format": {"type": "json_schema", "schema": schema},
            },
            messages=[
                {
                    "role": "user",
                    "content": [*documents, {"type": "text", "text": instruction}],
                }
            ],
        ) as stream:
            response = await stream.get_final_message()
    except Exception as exc:  # noqa: BLE001 - surfaced to the uploader, never fatal
        logger.exception("showbill extraction: request failed for %s", filename)
        return {}, ExtractionResult(
            status=STATUS_FAILED,
            error_message=f"Could not read the show bill ({type(exc).__name__}). Try again, or set the show up by hand.",
            **usage.as_fields(),
        )

    usage.add(response)

    if response.stop_reason == "refusal":
        return {}, ExtractionResult(
            status=STATUS_FAILED,
            error_message="The show bill could not be processed. Set the show up by hand.",
            **usage.as_fields(),
        )
    if response.stop_reason == "max_tokens":
        return {}, ExtractionResult(
            status=STATUS_FAILED,
            error_message=(
                "The show bill was too long to read in one pass. Try uploading the "
                "class schedule pages on their own, or set the show up by hand."
            ),
            **usage.as_fields(),
        )

    text = next((b.text for b in response.content if b.type == "text"), None)
    try:
        parsed = json.loads(text) if text else None
    except json.JSONDecodeError:
        parsed = None
    if not isinstance(parsed, dict):
        logger.error("showbill extraction: no usable JSON for %s", filename)
        return {}, ExtractionResult(
            status=STATUS_FAILED,
            error_message="Could not read the show bill. Try again, or set the show up by hand.",
            **usage.as_fields(),
        )
    return parsed, None
