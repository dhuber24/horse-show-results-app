"""Read a show's own printed show bill into a draft of the show.

A show bill is the whole show, laid out by the club before anything is keyed in
here: the dates and the venue, who is judging, which clubs sanction it, every
class in program order with its price, and the stall / shavings / camping
catalogue. `scripts/seed_mnsphc_paint_o_rama.py` is a day's hand transcription
of one. This module does that transcription and hands it back as a
**suggestion** -- `showbill_import.py` turns it into a review screen, and only a
person's press creates the show.

Design notes, mostly the ones `documents.py` already makes:

* Nothing here writes to the database. The caller keeps the read on a
  `show_bill_imports` row.
* **Transcribe, never compute.** A bill quotes class prices "per judge" and the
  app stores the multiplied figure, but the multiplication depends on a judge
  panel the reviewer may still change -- so the model reports the rate and says
  it is per judge, and the review screen does the arithmetic in front of them.
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

import json
import logging
import re
from datetime import date
from typing import Any

from .documents import (
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
# `required`; anything optional is nullable rather than omitted, so the shape
# that comes back never varies.


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
        "name": _nullable("string", "The show's name as printed, without the year unless the year is part of the name."),
        "start_date": _nullable("string", "First day of the show, YYYY-MM-DD."),
        "end_date": _nullable("string", "Last day of the show, YYYY-MM-DD."),
        "entry_deadline": _nullable(
            "string",
            "The day entries close for the show as a whole, YYYY-MM-DD, only if printed. "
            "Not a futurity's own deadline and not a stall-reservation deadline.",
        ),
        "breed_association": _nullable_enum(
            BREED_ASSOCIATION_CODES,
            "The breed association the show is approved by. OPEN when it is an open or "
            "all-breed show with no breed association. A show approved by APHA that also "
            "runs All Breed club classes is APHA.",
        ),
        "apha_show_number": _nullable("string", "APHA show/approval number, only if printed."),
        "aqha_show_number": _nullable("string", "AQHA show/approval number, only if printed."),
        "apha_zone": _nullable("integer", "APHA zone number 1-14, only if the bill states it."),
        "venue_name": _nullable("string", "Arena, fairground or facility name."),
        "venue_address": _nullable("string", "Street address, on one line."),
        "venue_city": _nullable("string", "City."),
        "venue_state": _nullable("string", "State or province, as its postal abbreviation where printed that way."),
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
        "staff": {
            "type": "array",
            "description": "Show officials named on the bill other than judges (manager, secretary, steward, ...).",
            "items": _object(
                {
                    "role": {"type": "string", "description": "Role as printed, e.g. 'Show Secretary'."},
                    "name": {"type": "string", "description": "Name as printed."},
                }
            ),
        },
    }
)

_JUDGE = _object(
    {
        "first_name": {"type": "string", "description": "Judge's first name as printed."},
        "last_name": {"type": "string", "description": "Judge's last name as printed."},
        "location": _nullable("string", "Home town/state printed beside the judge, if any."),
        "associations": _strings(
            "Association codes the bill says this judge is carded with or judging for "
            "(e.g. APHA, WSCA, NSBA). Empty if the bill does not say."
        ),
    }
)

_CLUB = _object(
    {
        "code": {"type": "string", "description": "The club's abbreviation as printed, e.g. NSBA, WSCA, MNSPHC."},
        "name": _nullable("string", "The club's full name if printed."),
        "fee_amount_cents": _nullable(
            "integer",
            "A separate sanction/club fee the bill charges on the club's classes, in cents. "
            "Null when the club's classes simply carry their own class price and there is "
            "no separate club fee.",
        ),
        "fee_unit": _nullable_enum(CLUB_FEE_UNITS, "How that separate club fee is charged."),
        "fee_text": _nullable("string", "The club fee exactly as printed, for the reviewer."),
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
        "association_code": _nullable(
            "string",
            "Whose judges a per-judge rate is multiplied by, when the bill says (e.g. WSCA for "
            "'$5 per WSCA judge'). Null for the whole panel or a flat price.",
        ),
        "printed_text": {"type": "string", "description": "The rate exactly as printed."},
    }
)

_CLASS = _object(
    {
        "date": _nullable("string", "The day this class runs, YYYY-MM-DD."),
        "number": _nullable("string", "The class number exactly as printed ('12', '2-3', 'A')."),
        "name": {
            "type": "string",
            "description": "The class name as printed, without the class number or association code.",
        },
        "discipline": _nullable(
            "string",
            "The riding style or event the class is in -- usually the section heading it is "
            "printed under (Halter, Showmanship, Western Pleasure, Trail, Barrel Racing, ...).",
        ),
        "bracket": _nullable(
            "string",
            "The division / age / skill bracket (Open, Amateur, Novice Amateur, Youth 13 & Under, "
            "Walk-Trot 11-18, Yearling, Green Horse, ...), as the bill words it.",
        ),
        "association_class_code": _nullable(
            "string", "The breed association's class code printed beside the class (e.g. 'AMH1', 'HS2')."
        ),
        "rate_key": _nullable(
            "string",
            "Which of class_rates prices this class. Null for championship and futurity classes, "
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
        "is_futurity": {
            "type": "boolean",
            "description": "True if the bill marks this class as part of a futurity programme.",
        },
        "note": _nullable(
            "string", "One short sentence for the reviewer if something about this class was unclear. Otherwise null."
        ),
    }
)

_FEE = _object(
    {
        "label": {"type": "string", "description": "The fee's name as printed, e.g. 'Stall', 'Shavings', 'Office charge'."},
        "amount_cents": {"type": "integer", "description": "The standard amount in cents."},
        "unit": {"type": "string", "enum": list(FEE_UNITS), "description": "How the fee is charged. See the instructions."},
        "notes": _nullable("string", "Any wording on the bill that qualifies the fee, verbatim and short."),
        "early_amount_cents": _nullable(
            "integer", "A lower early-booking amount in cents, only if the bill prints one with a deadline."
        ),
        "early_deadline": _nullable("string", "The deadline for that early amount, YYYY-MM-DD."),
        "min_quantity": _nullable(
            "integer", "For shavings only: the minimum number of bags every stall must be bedded with, if stated."
        ),
    }
)

SHOWBILL_SCHEMA: dict[str, Any] = _object(
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
        "classes": {
            "type": "array",
            "items": _CLASS,
            "description": "Every class on the schedule, in the printed program order.",
        },
        "fees": {
            "type": "array",
            "items": _FEE,
            "description": "Every charge that is not a class entry price.",
        },
        "not_imported": _strings(
            "One short line for each thing on the bill this form has no place for -- side pots / "
            "jackpots, a futurity's categories and rules, hi-point awards, sponsors, refund policy."
        ),
        "warnings": _strings(
            "Short sentences for the reviewer about anything uncertain: an unreadable section, a "
            "page that seems cut off, prices that conflict, a year you had to infer."
        ),
    }
)


SYSTEM_PROMPT = """You transcribe horse show bills (also called premium lists or \
prize lists) into a structured draft for a horse show management app. A show \
manager uploads the club's own printed bill; your output pre-fills a review \
screen they check and correct before the show is created.

Transcribe what is printed. Do not invent, complete or correct. A null or an \
empty list costs the manager a minute of typing; a plausible wrong value can \
reach an exhibitor's bill.

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
to fill in a year the heading leaves out, and say so in `warnings`.
- Grand & Reserve / Grand Champion classes are ones horses are called back into \
from earlier classes. Mark `is_championship` and leave `rate_key` null.
- Classes the bill marks as part of a futurity: mark `is_futurity` and leave \
`rate_key` null -- the futurity prices them.

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

Clubs
- The breed association (APHA, AQHA ...) is `show.breed_association`, not a club. \
Clubs are the other sanctioning bodies whose classes run at the show (NSBA, \
WSCA, a regional club's All Breed classes ...).
- `club_codes` on a class says which clubs sanction THAT class. Most classes at \
a breed show carry none.
- A club's `fee_amount_cents` is only for a separate sanction or club fee the \
bill charges on top of the class price. When the club's classes just carry their \
own price, that price is a class rate and the club fee is null.

Other fees -> `fees`, and the unit decides who pays
- Booked by the exhibitor: per_stall (stalls, tack stalls), per_bag (shavings), \
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
- flat: anything whose occurrence cannot be worked out from entries -- late or \
post-entry fees, penalties (stall cleanout, NSF checks), deposits, and "all day" \
or "all-in" fee bundles that replace per-class fees. When unsure whether a fee \
applies to everyone, use flat: a flat fee is printed and bills nobody, so the \
reviewer can promote it; a wrongly automatic fee bills everyone.
- Early rates: only when the bill prints both a lower amount and the date it \
applies until.

Everything else
- Side pots and jackpots, a futurity's categories, fees and rules, hi-point \
awards, sponsors, refund and cancellation policies: one short line each in \
`not_imported`. Do not force them into classes or fees.
- Money is integer cents: $36 -> 3600, $7.50 -> 750.
- Dates are YYYY-MM-DD.
- Put anything uncertain in `warnings` and on the class's `note`. \
Under-reporting uncertainty is worse than over-reporting it: a flagged value gets \
a second look, an unflagged wrong one may not.
- If the document is not a horse show bill, return empty lists and nulls and say \
so in `warnings`."""


def _clean_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = " ".join(value.split())
    return value or None


def _clean_date(value: Any, label: str, warnings: list[str]) -> str | None:
    text = _clean_str(value)
    if text is None:
        return None
    if _DATE_RE.match(text):
        try:
            return date.fromisoformat(text).isoformat()
        except ValueError:
            pass
    warnings.append(f"Could not read {label} as a date ({text!r}); left blank.")
    return None


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
    one of the rates. Anything that fails is dropped to null and named in
    `warnings`, so a malformed value never reaches a form as though it had been
    read off the page.
    """
    warnings = [w for w in (_clean_str(x) for x in raw.get("warnings") or []) if w]

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
        )
    }
    for key in ("start_date", "end_date", "entry_deadline"):
        show[key] = _clean_date(show_raw.get(key), key.replace("_", " "), warnings)
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
    days = show_raw.get("health_certificate_valid_days")
    show["health_certificate_valid_days"] = (
        days if isinstance(days, int) and not isinstance(days, bool) and 0 < days <= 365 else None
    )
    show["staff"] = [
        {"role": _clean_str(s.get("role")) or "", "name": _clean_str(s.get("name")) or ""}
        for s in show_raw.get("staff") or []
        if isinstance(s, dict) and _clean_str(s.get("name"))
    ]
    if show["start_date"] and show["end_date"] and show["end_date"] < show["start_date"]:
        warnings.append("The end date read as earlier than the start date; both left for you to set.")
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
                "location": _clean_str(j.get("location")),
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
    dangling: set[str] = set()
    for c in raw.get("classes") or []:
        name = _clean_str(c.get("name"))
        if not name:
            continue
        rate_key = _clean_str(c.get("rate_key"))
        if rate_key and rate_key not in rate_keys:
            dangling.add(rate_key)
            rate_key = None
        label = f"class {c.get('number') or name}"
        classes.append(
            {
                "date": _clean_date(c.get("date"), f"the date of {label}", warnings),
                "number": _clean_str(c.get("number")),
                "name": name,
                "discipline": _clean_str(c.get("discipline")),
                "bracket": _clean_str(c.get("bracket")),
                "association_class_code": _clean_str(c.get("association_class_code")),
                "rate_key": rate_key,
                "club_codes": _clean_codes(c.get("club_codes")),
                "is_championship": bool(c.get("is_championship")),
                "is_futurity": bool(c.get("is_futurity")),
                "note": _clean_str(c.get("note")),
            }
        )
    if dangling:
        warnings.append(
            "Some classes pointed at a price the bill's rate list does not have "
            f"({', '.join(sorted(dangling))}); those classes were left unpriced."
        )

    fees = []
    for f in raw.get("fees") or []:
        label = _clean_str(f.get("label"))
        cents = _clean_cents(f.get("amount_cents"))
        unit = f.get("unit")
        if not label or cents is None or unit not in FEE_UNITS:
            continue
        early_cents = _clean_cents(f.get("early_amount_cents"))
        early_deadline = _clean_date(f.get("early_deadline"), f"the early deadline for {label}", warnings)
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

    return {
        "show": show,
        "judges": judges,
        "clubs": clubs,
        "class_rates": rates,
        "classes": classes,
        "fees": fees,
        "not_imported": [x for x in (_clean_str(v) for v in raw.get("not_imported") or []) if x],
        "warnings": warnings,
    }


async def extract_showbill(content: bytes, mime_type: str, filename: str) -> ExtractionResult:
    """Read a show bill. Never raises -- failures come back as a result."""
    if not supports_extraction(mime_type):
        return ExtractionResult(
            status=STATUS_UNSUPPORTED_MEDIA,
            error_message=f"{mime_type} can't be read automatically. Set the show up by hand.",
        )
    if not extraction_available():
        return ExtractionResult(
            status=STATUS_UNSUPPORTED_MEDIA,
            error_message="Reading show bills is not configured on this server. Set the show up by hand.",
        )

    try:
        client = _get_client()
        # No cache_control on the system prompt, unlike documents.py: a show is
        # set up from its bill once, so there is no second read to share a
        # cached prefix with, and a cache write bills above the base rate.
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
                "format": {"type": "json_schema", "schema": SHOWBILL_SCHEMA},
            },
            messages=[
                {
                    "role": "user",
                    "content": [
                        _document_block(content, mime_type),
                        {
                            "type": "text",
                            "text": (
                                f"Uploaded as {filename!r}. Transcribe this show bill. "
                                "Trust the page over the filename."
                            ),
                        },
                    ],
                }
            ],
        ) as stream:
            response = await stream.get_final_message()
    except Exception as exc:  # noqa: BLE001 - surfaced to the uploader, never fatal
        logger.exception("showbill extraction: request failed for %s", filename)
        return ExtractionResult(
            status=STATUS_FAILED,
            error_message=f"Could not read the show bill ({type(exc).__name__}). Try again, or set the show up by hand.",
            model=SHOWBILL_MODEL,
        )

    usage = {
        "model": response.model,
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }

    if response.stop_reason == "refusal":
        return ExtractionResult(
            status=STATUS_FAILED,
            error_message="The show bill could not be processed. Set the show up by hand.",
            **usage,
        )
    if response.stop_reason == "max_tokens":
        return ExtractionResult(
            status=STATUS_FAILED,
            error_message=(
                "The show bill was too long to read in one pass. Try uploading the "
                "class schedule pages on their own, or set the show up by hand."
            ),
            **usage,
        )

    text = next((b.text for b in response.content if b.type == "text"), None)
    try:
        parsed = json.loads(text) if text else None
    except json.JSONDecodeError:
        parsed = None
    if not isinstance(parsed, dict):
        logger.error("showbill extraction: no usable JSON for %s", filename)
        return ExtractionResult(
            status=STATUS_FAILED,
            error_message="Could not read the show bill. Try again, or set the show up by hand.",
            **usage,
        )

    return ExtractionResult(status=STATUS_SUCCEEDED, fields=normalize_showbill(parsed), **usage)
