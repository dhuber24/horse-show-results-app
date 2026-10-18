"""The Trainer Registry: who is listed, what each plan shows, and in what order.

A trainer is listed when they opted in -- "List me in the Trainer Registry" at
sign-up, or "List in Trainer Registry" on their profile, both of which set
`trainers.is_public` -- and their account is not locked (`is_listed`).

**Two plans** (migration 165):

- **Basic, free:** a text listing -- name, business, disciplines, town. It
  appears in a near-me search, below every Pro listing and not ranked by
  distance.
- **Pro, $10 a month or $100 a year:** ranked nearest-first above Basic, with
  its distance shown; the rich profile (bio, headshot, logo, photos, video
  links, rate sheet, public email, website and socials, association cards and compliance
  badges); and a Contact Trainer form whose leads are stored and emailed to
  the trainer.

**Pro is a date, not a switch** (`is_pro`): on through `trainers.pro_until`,
Basic after. The app takes no payment -- a trainer asks
(`trainer_pro_requests`), an admin bills them outside the app and records the
date -- so a lapsed subscription needs nobody to turn it off.

**The plan is enforced where a listing is built** (`public_card`) and where its
pictures are served, never by refusing the edit: a Basic trainer may fill in
their whole Pro profile ahead of time, and nothing of it is public until Pro.

Admins are emailed when a trainer opts in (`listing_email`) and when one asks
for Pro (`pro_request_email`); a trainer is emailed each lead (`lead_email`).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Optional, Sequence
from urllib.parse import urlparse
from uuid import UUID

from mailer import public_app_url
from schemas import TrainerPublicOut, TrainerRateLine, TrainerRegistrationOut
from zip_locations import LatLon, miles_between, normalize_zip

# What a trainer can say they train. Broad on purpose -- this is how a visitor
# searches, so "Western Pleasure" rather than every division of it. No CHECK in
# the database: adding one here is the whole change.
TRAINER_DISCIPLINES: tuple[str, ...] = (
    "Western Pleasure",
    "Ranch Riding",
    "Ranch Versatility",
    "Reining",
    "Trail",
    "Western Riding",
    "Horsemanship",
    "Showmanship",
    "Halter",
    "Hunter Under Saddle",
    "Hunt Seat Equitation",
    "Hunter Hack",
    "Working Cow Horse",
    "Cutting",
    "Barrel Racing",
    "Pole Bending",
    "Roping",
    "Driving",
    "Colt Starting",
    "Youth & Beginner Lessons",
)

PRO_PLANS: dict[str, str] = {"monthly": "Pro, monthly", "annual": "Pro, annual"}

MAX_PHOTOS = 8
MAX_VIDEO_LINKS = 5
MAX_RATE_LINES = 20

# The radius choices the near-me search offers, in miles. None is "any distance".
RADIUS_CHOICES: tuple[Optional[int], ...] = (25, 50, 100, 250, None)


# ── Who is listed, and on which plan ───────────────────────────────────────────


def is_listed(trainer) -> bool:
    """Is this trainer shown in the registry? Needs `trainer.user` loaded.

    A locked account (`users.is_approved` false) comes off the registry with
    the login: whatever led an admin to lock it is not something to keep
    advertising. A registry row with no account can still be listed -- only an
    admin can set `is_public` on one.
    """
    if not trainer.is_public:
        return False
    user = trainer.user
    return user is None or bool(user.is_approved)


def is_pro(trainer, today: Optional[date] = None) -> bool:
    """On Pro through the paid-through date an admin recorded, inclusive."""
    pro_until = getattr(trainer, "pro_until", None)
    return pro_until is not None and pro_until >= (today or date.today())


def listing_problem(
    city: Optional[str],
    state: Optional[str],
    zip_code: Optional[str],
    disciplines: Optional[Sequence[str]],
) -> Optional[str]:
    """Why these details cannot be listed yet, or None when they can.

    A Basic listing is a name, what they train and where -- so those are what
    it needs. The zip is what places it in a near-me search; the town and state
    are what a visitor reads, since the zip itself is never shown. A zip the
    Census table does not know still passes: it is a real zip, just one that
    cannot be put on the map (see `zip_locations`).
    """
    if not (city or "").strip() or not (state or "").strip():
        return "A Trainer Registry listing needs your town and state."
    if not normalize_zip(zip_code):
        return "A Trainer Registry listing needs a 5-digit zip code so nearby clients can find you."
    if not any((d or "").strip() for d in (disciplines or [])):
        return "A Trainer Registry listing needs at least one discipline you train."
    return None


# ── Checking what a trainer typed ──────────────────────────────────────────────


def unknown_disciplines(values: Iterable[str]) -> list[str]:
    known = set(TRAINER_DISCIPLINES)
    return [v for v in values if v not in known]


def clean_disciplines(values: Iterable[str]) -> list[str]:
    """Known disciplines once each, in the catalogue's order."""
    chosen = set(values)
    return [d for d in TRAINER_DISCIPLINES if d in chosen]


def is_web_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in ("http", "https") and "." in (parsed.hostname or "")


def video_links_problem(urls: Sequence[str]) -> Optional[str]:
    if len(urls) > MAX_VIDEO_LINKS:
        return f"Add up to {MAX_VIDEO_LINKS} video links."
    for url in urls:
        if len(url) > 500 or not is_web_url(url):
            return f"{url[:80]} is not a web address. Video links start with https://"
    return None


# ── What a listing shows ───────────────────────────────────────────────────────


@dataclass(frozen=True)
class ListingMedia:
    """The ids of a trainer's pictures -- never the bytes, which the media
    endpoint serves one at a time."""
    headshot_id: Optional[UUID] = None
    logo_id: Optional[UUID] = None
    photo_ids: tuple[UUID, ...] = ()


def safesport_current(completed_at: Optional[date], today: Optional[date] = None) -> bool:
    # SafeSport training is valid for one year from completion.
    if not completed_at:
        return False
    return ((today or date.today()) - completed_at).days <= 365


def background_check_current(expires_at: Optional[date], today: Optional[date] = None) -> bool:
    if not expires_at:
        return False
    return expires_at >= (today or date.today())


def public_card(
    trainer,
    affiliations: Iterable,
    media: ListingMedia,
    today: Optional[date] = None,
) -> TrainerPublicOut:
    """The registry's view of one trainer, cut to their plan.

    Basic is the first block alone. On Pro an affiliation whose card has lapsed
    is still left off: "AQHA Professional" on an advert is a claim about today.
    """
    today = today or date.today()
    card = TrainerPublicOut(
        id=trainer.id,
        first_name=trainer.first_name,
        last_name=trainer.last_name,
        name=trainer.name,
        business_name=trainer.business_name,
        city=trainer.city,
        state=trainer.state,
        country=trainer.country,
        disciplines=list(trainer.disciplines or []),
        tier="basic",
    )
    if not is_pro(trainer, today):
        return card

    current = [a for a in affiliations if a.expires_at is None or a.expires_at >= today]
    return card.model_copy(update={
        "tier": "pro",
        "bio": trainer.bio,
        "website": trainer.website,
        "public_phone": trainer.phone,
        "public_email": trainer.email,
        "social_facebook": trainer.social_facebook,
        "social_instagram": trainer.social_instagram,
        "social_tiktok": trainer.social_tiktok,
        "headshot_id": media.headshot_id,
        "logo_id": media.logo_id,
        "photo_ids": list(media.photo_ids),
        "video_urls": list(trainer.video_urls or []),
        "rate_sheet": [TrainerRateLine.model_validate(line) for line in (trainer.rate_sheet or [])],
        "can_contact": True,
        "safesport_current": safesport_current(trainer.safesport_completed_at, today),
        "background_check_current": background_check_current(trainer.background_check_expires_at, today),
        "has_liability_insurance": bool(trainer.has_liability_insurance),
        "affiliations": [TrainerRegistrationOut.model_validate(a) for a in current],
    })


# ── In what order ──────────────────────────────────────────────────────────────


def rank_listings(
    entries: Sequence[tuple[TrainerPublicOut, Optional[LatLon]]],
    origin: Optional[LatLon],
    radius_miles: Optional[float],
) -> list[TrainerPublicOut]:
    """Order the registry for one visitor. `entries` arrive in name order.

    Every Pro listing comes before every Basic one. With a place to search
    from, Pro is ranked nearest-first and carries its distance; Basic stays in
    name order without one -- proximity ranking is what Pro buys. A radius,
    when given, applies to both plans: a Basic trainer still *appears* in a
    near-me search, just below the Pro ones, and a trainer the map cannot place
    is outside every radius.
    """
    pro: list[tuple[float, TrainerPublicOut]] = []
    unplaced_pro: list[TrainerPublicOut] = []
    basic: list[TrainerPublicOut] = []

    for card, coords in entries:
        distance = miles_between(origin, coords) if origin and coords else None
        if origin and radius_miles is not None and (distance is None or distance > radius_miles):
            continue
        if card.tier != "pro":
            basic.append(card)
        elif distance is None:
            unplaced_pro.append(card)
        else:
            pro.append((distance, card.model_copy(update={"distance_miles": round(distance, 1)})))

    pro.sort(key=lambda item: item[0])
    return [card for _, card in pro] + unplaced_pro + basic


# ── Email ──────────────────────────────────────────────────────────────────────


def _one_line(value: str) -> str:
    """Text safe for an email header: whatever somebody typed, on one line."""
    return " ".join(value.split())


def _who(trainer) -> str:
    return f"{trainer.name} ({trainer.business_name})" if trainer.business_name else trainer.name


def _trainer_lines(trainer, login_email: Optional[str]) -> list[str]:
    where = ", ".join(p for p in (trainer.city, trainer.state) if p)
    lines = [
        f"Name: {trainer.name}",
        f"Business / barn: {trainer.business_name or '(none)'}",
        f"Location: {where or '(none)'}{f' {trainer.zip_code}' if trainer.zip_code else ''}",
        f"Disciplines: {', '.join(trainer.disciplines or []) or '(none)'}",
        f"Public email: {trainer.email or '(none)'}",
        f"Public phone: {trainer.phone or '(none)'}",
        f"Login email: {login_email or '(no account)'}",
        f"Private phone: {trainer.private_phone or '(none)'}",
    ]
    return lines


def listing_email(trainer, login_email: Optional[str], at_signup: bool) -> tuple[str, str]:
    """The email to each admin when a trainer opts in to the registry.

    The subject names the trainer and their business, so an inbox says who it
    is before it is opened; both are typed by the trainer, so both are folded
    onto one line -- a newline in a header is either an error or an injected
    header. Reply-To is set to the trainer by the caller.
    """
    subject = _one_line(f"Trainer Registry: {_who(trainer)} wants to be listed")
    lines = [
        f"{trainer.name} {'signed up as a trainer and ticked' if at_signup else 'turned on'} "
        '"List me in the Trainer Registry". Their listing is live now, on '
        f"{'Pro' if is_pro(trainer) else 'Basic'}.",
        "",
        *_trainer_lines(trainer, login_email),
        "",
        "Their listing, as the public sees it:",
        f"{public_app_url()}/trainers/{trainer.id}",
        "",
        'To take it down, untick "Listed in the Trainer Registry" on their record:',
        f"{public_app_url()}/admin/trainers/{trainer.id}",
    ]
    if login_email:
        lines += ["", f"Replying to this email goes to {login_email}."]
    return subject, "\n".join(lines)


def pro_request_email(trainer, plan: str, login_email: Optional[str]) -> tuple[str, str]:
    """The email to each admin when a trainer asks for Pro."""
    plan_label = PRO_PLANS.get(plan, plan)
    subject = _one_line(f"Trainer Registry Pro: {_who(trainer)} asked for {plan_label}")
    lines = [
        f"{trainer.name} asked for Trainer Registry {plan_label}.",
        "",
        "GaitDesk takes no payment in the app: bill them, then record how long",
        "they have paid for on their record. Pro switches on with that date and",
        "back to Basic after it.",
        "",
        *_trainer_lines(trainer, login_email),
        "",
        f"{public_app_url()}/admin/trainers/{trainer.id}",
    ]
    if login_email:
        lines += ["", f"Replying to this email goes to {login_email}."]
    return subject, "\n".join(lines)


def lead_email(trainer, lead) -> tuple[str, str]:
    """The email to a trainer for one Contact Trainer message. Reply-To is the
    sender, set by the caller; every lead is also on their registry page."""
    subject = _one_line(f"GaitDesk Trainer Registry: a message from {lead.sender_name}")
    lines = [
        f"{lead.sender_name} found you on the GaitDesk Trainer Registry and sent you a message.",
        "",
        f"Name: {lead.sender_name}",
        f"Email: {lead.sender_email}",
    ]
    if lead.sender_phone:
        lines.append(f"Phone: {lead.sender_phone}")
    lines += [
        "",
        lead.message,
        "",
        f"Replying to this email goes to {lead.sender_email}. Every message is",
        "also kept on your Trainer Registry page:",
        f"{public_app_url()}/profile/registry",
    ]
    return subject, "\n".join(lines)


def lead_recipient(trainer) -> Optional[str]:
    """Where a lead is emailed: the public email -- the address the trainer
    chose to be reached at -- or else the one they sign in with."""
    if trainer.email:
        return trainer.email
    user = getattr(trainer, "user", None)
    return user.email if user else None
