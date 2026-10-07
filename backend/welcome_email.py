"""The email a new account gets: what GaitDesk does for that role, and where to start.

Sent once, when the account is created, from every path that creates one --
the four sign-up screens, an admin or show office making somebody an account,
a scribe or gate steward accepting an invite, and an admin giving a registry
judge a login. Not on a role change: that person already has an account and a
welcome would be news to nobody.

**Best-effort, like every email here.** `mailer.py` does nothing without SMTP,
and nothing in a sign-up depends on this arriving: the account is committed
before it is sent, it is sent after the response (a `BackgroundTasks` task, so
a slow SMTP server never holds up the sign-up screen), and it carries no link
anybody needs -- every address in it is a page the person reaches from the app
anyway. So it never sends a password, and never sends a token.

**Every claim in it is a thing the app does today, in the words its screens
use** ("My Account", "My Shows", "What I Owe"). A welcome that promises a
screen the role cannot open is the first thing the person learns not to trust.
When a role's screens change, change its entry in `ROLE_WELCOMES` with them;
the test pins that every role in `VALID_ROLES` has one.
"""
from __future__ import annotations

from dataclasses import dataclass

from mailer import public_app_url, send_email


@dataclass(frozen=True)
class RoleWelcome:
    label: str
    # Where the person should go first, as an app path.
    start_path: str
    start_label: str
    facts: tuple[str, ...]
    tips: tuple[str, ...]


# The tip every role gets, last. `/forgot-password` asks the account's own
# security question, so without one only an administrator can reset it -- and
# the person finds that out on the day they are locked out.
SECURITY_QUESTION_TIP = (
    "Set a security question under My Account ({url}/profile). Without one, "
    "only an administrator can reset your password if you forget it."
)

ROLE_WELCOMES: dict[str, RoleWelcome] = {
    "EXHIBITOR": RoleWelcome(
        label="Exhibitor",
        start_path="/shows/upcoming",
        start_label="Browse upcoming shows",
        facts=(
            "Sign up for any show that's open for entries: pick your classes "
            "and horses online, right up to the show's online sign-up deadline.",
            "My Shows lists every show you've signed up for, with your classes "
            "and a What I Owe page for each show's bill.",
            "Once a show starts, you can usually still enter and scratch your "
            "own classes until each class begins -- unless the show office "
            "closes class changes when the show starts.",
            "Results go up live as each class is posted, so you can check "
            "placings from your phone at the rail.",
        ),
        tips=(
            "Add your horses under My Account > My Horses before your first "
            "show, and upload their papers -- registration, Coggins, health "
            "certificate -- so the show office can check them off before you "
            "reach the desk.",
            "Add your association memberships under My Account > Memberships. "
            "Shows read them when you enter an association class.",
        ),
    ),
    "TRAINER": RoleWelcome(
        label="Trainer",
        start_path="/profile",
        start_label="Finish your trainer profile",
        facts=(
            "Your trainer profile is the record horse owners and show offices "
            "pick when they name you as a horse's trainer.",
            "The Horses tab on My Account lists every horse that names you as "
            "its trainer.",
            "Your profile holds your business details, a headshot, and your "
            "SafeSport and background-check dates in one place.",
        ),
        tips=(
            "Add your association memberships under My Account > Affiliations.",
            "Fill in your business name and public contact details, and upload "
            "a headshot, so owners can tell you're the right trainer.",
        ),
    ),
    "SHOW_MANAGER": RoleWelcome(
        label="Show Manager",
        start_path="/admin/shows/new",
        start_label="Create your first show",
        facts=(
            "You create and run shows. The setup wizard walks a show from a "
            "draft through dates, venue, classes, fees, judges and staff, and "
            "you publish it when it's ready for exhibitors to sign up.",
            "Exhibitors sign up and pick their classes online. Your office sees "
            "every entry, back number and bill for the show in one place.",
            "Your scribes enter placings at the ring, and results go public "
            "when a class is posted -- on the show's results pages and on any "
            "board you put up in the arena.",
            "You belong to a show company. At My Company Staff you can ask for "
            "colleagues to be added; a GaitDesk administrator approves each one.",
        ),
        tips=(
            "Add a co-manager in Step 1 of the show's setup (Basics & Staff), "
            "so somebody else can run the show if you can't.",
            "Invite your scribes and gate stewards from Step 1 too. Each gets a "
            "link to set their own password, and lands already assigned to "
            "your show.",
        ),
    ),
    "SHOW_SECRETARY": RoleWelcome(
        label="Show Secretary",
        start_path="/admin/shows",
        start_label="Open your shows",
        facts=(
            "You run the office side of your shows: classes, entries, back "
            "numbers and results.",
            "The registration desk puts one exhibitor on one screen -- their "
            "sign-up, classes, back number, paperwork and bill. A walk-up "
            "with no account needs only a first and last name.",
            "Missing paperwork, like a Coggins or a membership card, is flagged "
            "for you to sort out at the counter. It never stops an entry.",
            "Scribes' placings save into a draft. Nothing is public until "
            "somebody posts the class.",
        ),
        tips=(
            "Open a show's registration desk before show day and walk one "
            "exhibitor through it, so the counter isn't the first time you "
            "see it.",
            "Invite your scribes and gate stewards from Step 1 of the show's "
            "setup (Basics & Staff). Each gets a link to set their own "
            "password, and lands already assigned to your show.",
        ),
    ),
    "SCRIBE": RoleWelcome(
        label="Scribe",
        start_path="/scribe",
        start_label="See the shows you're assigned to",
        facts=(
            "You enter what the judge calls: placings, or the maneuver and "
            "penalty scores on a judge's card. GaitDesk adds up the card; the "
            "judge decides every number on it.",
            "Your screen saves as you go -- there is no Save button.",
            "Results stay a draft until the class is posted, so nothing goes "
            "public half-entered.",
        ),
        tips=(
            "Sign in on the phone or tablet you'll use at the judge's stand "
            "before the show, and check your show is listed under Shows. If it "
            "isn't, ask the show secretary to assign you.",
            "Write down exactly what the judge calls. If a total looks wrong, "
            "the judge's call stands -- tell the show office rather than "
            "changing a score.",
        ),
    ),
    "GATE_STEWARD": RoleWelcome(
        label="Gate Steward",
        start_path="/gate",
        start_label="Open the gate screen",
        facts=(
            "The gate screen runs the in-gate for one show day: each class's "
            "order of go, exhibitor check-in, and where every class stands.",
            "A class turns Ready on its own once everyone is checked in; you "
            "start it when the first exhibitor enters the ring.",
            "Check-in opens for a class when it's on deck in its ring.",
            "Every step can be undone: a check-in, a class start, or a class "
            "you marked finished too early.",
        ),
        tips=(
            "Open the gate screen and pick the show day before the first class, "
            "so you're not finding your way around with a line at the gate.",
            "Only one class runs in a ring at a time. When you start the next "
            "one, GaitDesk asks whether the last one finished.",
        ),
    ),
    "JUDGE": RoleWelcome(
        label="Judge",
        start_path="/profile",
        start_label="Check your details",
        facts=(
            "Your account is linked to your record in GaitDesk's judge "
            "registry -- the one record every show that hires you reads your "
            "name, contact details and association cards from.",
            "A correction to that record is made once and reaches every show "
            "you work.",
            "The scribe at your side records what you call. GaitDesk adds up "
            "the card; it never decides what a maneuver is worth or which "
            "penalty applies.",
        ),
        tips=(
            "Check your name and contact details under My Account. If your "
            "association cards are wrong, tell the show office that hired you.",
            "Follow results live at {url}/shows/active while a show is running.",
        ),
    ),
    "ADMIN": RoleWelcome(
        label="Administrator",
        start_path="/admin",
        start_label="Open the admin home",
        facts=(
            "You can reach everything in GaitDesk, including every paid feature.",
            "Only an administrator creates show companies, approves the people "
            "a company adds, and switches its paid features on.",
            "Requests waiting on you -- somebody asking to join a show company, "
            "or a company asking for a paid feature -- are counted on the "
            "Show Companies tile of the admin home.",
        ),
        tips=(
            "Check that count daily: a company can't add the colleague it "
            "asked for until an administrator answers.",
            "Paid features are switched on per show company at Show Companies, "
            "never per person -- everybody in the company gets them.",
        ),
    ),
}

# Somebody with a role this module doesn't know yet still gets a welcome --
# a plain one, with nothing in it the role might not be able to do.
FALLBACK_WELCOME = RoleWelcome(
    label="GaitDesk",
    start_path="/",
    start_label="Open GaitDesk",
    facts=(
        "GaitDesk runs ranch and western pleasure horse shows: entries, back "
        "numbers, and results posted live.",
    ),
    tips=(),
)


def welcome_for(role: str | None) -> RoleWelcome:
    return ROLE_WELCOMES.get(role or "", FALLBACK_WELCOME)


def welcome_message(
    first_name: str,
    email: str,
    role: str | None,
    *,
    set_up_by_staff: bool = False,
    show_name: str | None = None,
) -> tuple[str, str]:
    """The subject and plain-text body of one welcome.

    `set_up_by_staff` is for an account somebody else made with a password
    they chose: the person has never seen it, and the email must say so rather
    than tell them to sign in with a password they don't have. It never
    carries the password itself.

    `show_name` is the show an invite assigned them to.
    """
    url = public_app_url()
    welcome = welcome_for(role)
    name = (first_name or "").strip() or "there"
    account = "GaitDesk account" if welcome is FALLBACK_WELCOME else f"GaitDesk {welcome.label} account"

    lines = [f"Hi {name},", "", f"Welcome to GaitDesk -- your {account} is ready."]
    if show_name:
        lines += ["", f"You've been assigned to {show_name}."]
    lines += ["", f"Sign in at {url}/login with {email}."]
    if set_up_by_staff:
        lines += [
            "",
            "Your account was set up for you, so you didn't choose its "
            "password. Ask whoever set it up for the password, then change it "
            f"under My Account ({url}/profile).",
        ]

    lines += ["", "WHAT YOU CAN DO IN GAITDESK", ""]
    lines += [f"- {fact.format(url=url)}" for fact in welcome.facts]

    tips = [*welcome.tips, SECURITY_QUESTION_TIP]
    lines += ["", "A FEW TIPS FOR GETTING STARTED", ""]
    lines += [f"{n}. {tip.format(url=url)}" for n, tip in enumerate(tips, start=1)]

    lines += [
        "",
        f"{welcome.start_label}: {url}{welcome.start_path}",
        "",
        "See you at the show,",
        "GaitDesk",
    ]
    return "Welcome to GaitDesk", "\n".join(lines) + "\n"


async def send_welcome_email(
    email: str,
    first_name: str,
    role: str | None,
    *,
    set_up_by_staff: bool = False,
    show_name: str | None = None,
) -> bool | None:
    """Best-effort; never raises. Run it after the account is committed --
    as a background task, so the sign-up response never waits on SMTP."""
    subject, body = welcome_message(
        first_name, email, role, set_up_by_staff=set_up_by_staff, show_name=show_name
    )
    return await send_email(email, subject, body)
