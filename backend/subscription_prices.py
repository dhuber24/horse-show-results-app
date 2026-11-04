"""What GaitDesk charges for its plans, from which day (migration 179).

Every price is a row of `subscription_prices`: an amount, from a day on. The
price of anything is the latest row on or before its day, so the table is a
history and changing a price never rewrites one already in force:

  * **A show is priced on its first day** (`usage_statement`), so a show that
    started before a change keeps the old price. Section 6 of the Terms promises
    that. Raising a show company's price takes 30 days' notice, by email and on
    My Company (`RAISE_NOTICE_DAYS`, `change_refusal`).
  * **A Pro+ year keeps the price it was started at** (`price_cents` on its row).
  * **A trainer's card subscription keeps the price it started at**, because
    Stripe holds the price on the subscription. A change reaches new subscribers
    only, so it needs no notice to anybody.

Nothing reads a price from anywhere else: `PLANS` says what a plan includes, and
this says what it costs. Load the book once per request with `load_prices`.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import SubscriptionPrice

BASIC_RATE = "basic_rate"
PRO_RATE = "pro_rate"
PRO_PLUS_ANNUAL = "pro_plus_annual"
TRAINER_MONTHLY = "trainer_monthly"
TRAINER_ANNUAL = "trainer_annual"

# The prices migration 179 seeds, and what the book answers with if a row is
# ever missing -- never a free show by accident.
STARTING_CENTS: dict[str, int] = {
    BASIC_RATE: 200,
    PRO_RATE: 400,
    PRO_PLUS_ANNUAL: 149900,
    TRAINER_MONTHLY: 1000,
    TRAINER_ANNUAL: 10000,
}

# Which price a per-exhibitor plan reads. Free and Pro+ cost nothing per exhibitor.
_RATE_KEYS = {"basic": BASIC_RATE, "pro": PRO_RATE}
_TRAINER_KEYS = {"monthly": TRAINER_MONTHLY, "annual": TRAINER_ANNUAL}

# Section 6 of the Terms: at least 30 days' notice before raising a price.
RAISE_NOTICE_DAYS = 30

# Stripe will not charge less than 50 cents, so a price paid by card can't be.
STRIPE_MINIMUM_CENTS = 50


@dataclass(frozen=True)
class PriceInfo:
    key: str
    label: str
    per: str
    audience: str
    minimum_cents: int
    # A raise needs notice only where it reaches somebody already on the plan.
    raise_needs_notice: bool


PRICE_INFO: dict[str, PriceInfo] = {
    BASIC_RATE: PriceInfo(BASIC_RATE, "GaitDesk Basic", "exhibitor", "companies", 0, True),
    PRO_RATE: PriceInfo(PRO_RATE, "GaitDesk Pro", "exhibitor", "companies", 0, True),
    PRO_PLUS_ANNUAL: PriceInfo(PRO_PLUS_ANNUAL, "GaitDesk Pro+", "year", "companies", STRIPE_MINIMUM_CENTS, True),
    TRAINER_MONTHLY: PriceInfo(TRAINER_MONTHLY, "Trainer Pro, monthly", "month", "trainers", STRIPE_MINIMUM_CENTS, False),
    TRAINER_ANNUAL: PriceInfo(TRAINER_ANNUAL, "Trainer Pro, annual", "year", "trainers", STRIPE_MINIMUM_CENTS, False),
}


@dataclass(frozen=True)
class PriceBook:
    """Every price row, as `(key, effective_on, amount_cents)`, oldest first."""
    rows: tuple[tuple[str, date, int], ...] = ()

    def cents(self, key: str, on: date) -> int:
        """The price in force on a day. Rows set on the same day: the last set wins."""
        found: Optional[int] = None
        for row_key, effective_on, amount in self.rows:
            if row_key == key and effective_on <= on:
                found = amount
        return STARTING_CENTS[key] if found is None else found

    def rate(self, plan: Optional[str], on: date) -> int:
        """What a plan charges per exhibitor on a day; 0 for Free and Pro+."""
        key = _RATE_KEYS.get(plan or "")
        return self.cents(key, on) if key else 0

    def annual(self, on: date) -> int:
        """What a Pro+ year costs on a day."""
        return self.cents(PRO_PLUS_ANNUAL, on)

    def trainer(self, plan: str, on: date) -> int:
        """What a new Trainer Pro subscription costs on a day."""
        return self.cents(_TRAINER_KEYS[plan], on)

    def upcoming(self, key: str, today: date) -> Optional[tuple[date, int]]:
        """The next scheduled change that actually changes the price, if any."""
        days = sorted({day for row_key, day, _ in self.rows if row_key == key and day > today})
        for day in days:
            amount = self.cents(key, day)
            if amount != self.cents(key, today):
                return day, amount
        return None

    def plan_key(self, plan: Optional[str]) -> Optional[str]:
        """The price a plan is sold at, or None for a plan that costs nothing."""
        return PRO_PLUS_ANNUAL if plan == "pro_plus" else _RATE_KEYS.get(plan or "")


# The prices with no rows, for a pure function's tests.
STARTING_PRICES = PriceBook()


async def load_prices(db: AsyncSession) -> PriceBook:
    rows = (
        await db.execute(
            select(SubscriptionPrice.key, SubscriptionPrice.effective_on, SubscriptionPrice.amount_cents).order_by(
                SubscriptionPrice.effective_on, SubscriptionPrice.created_at
            )
        )
    ).all()
    return PriceBook(tuple((r.key, r.effective_on, r.amount_cents) for r in rows))


def change_refusal(prices: PriceBook, key: str, amount_cents: int, effective_on: date, today: date) -> Optional[str]:
    """Why a price can't be set to this from this day, or None when it can.

    A past day is always refused: it would re-price what has already run. A raise
    on a show company's plan is refused inside the notice the Terms promise."""
    info = PRICE_INFO.get(key)
    if info is None:
        return "That isn't a GaitDesk price."
    if amount_cents < info.minimum_cents:
        if info.minimum_cents == 0:
            return "A price can't be negative."
        return f"{info.label} is paid by card, and Stripe won't charge less than 50 cents."
    if effective_on < today:
        return "A price can't start in the past: it would change what shows that have already run cost."
    if amount_cents == prices.cents(key, effective_on):
        return f"{info.label} is already that price on that day."
    if info.raise_needs_notice and amount_cents > prices.cents(key, effective_on):
        earliest = today + timedelta(days=RAISE_NOTICE_DAYS)
        if effective_on < earliest:
            return (
                f"A raise takes {RAISE_NOTICE_DAYS} days' notice (Terms, section 6). "
                f"The earliest it can start is {earliest:%B} {earliest.day}, {earliest.year}."
            )
    return None


def is_raise(prices: PriceBook, key: str, amount_cents: int, effective_on: date) -> bool:
    return amount_cents > prices.cents(key, effective_on)


def history_for(prices: Iterable, key: str) -> list:
    """One price's rows, newest first."""
    return sorted(
        (row for row in prices if row.key == key),
        key=lambda row: (row.effective_on, row.created_at),
        reverse=True,
    )
