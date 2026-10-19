"""What GaitDesk invoices a show company, and the rules for issuing it
(migration 172).

The usage statement (`GET /show-companies/{id}/usage`) has always said what a
company owes -- each show's exhibitors at its billing plan, each Pro+ year at
its price. An invoice is a GaitDesk admin choosing lines off it, **net 30**:

  * **Priced by the statement, never typed.** A line is copied from the
    statement as it stands when the invoice is issued, so an invoice and the
    statement it came from cannot disagree about a show's price.
  * **Once.** A show, or a Pro+ year, is on at most one invoice that is not
    void. Voiding an invoice frees its lines to be invoiced again.
  * **After the show.** A show still running can still gain exhibitors, so it
    is invoiced once its last day has come. A Pro+ year is billed up front, so
    any unpaid year may be invoiced.
  * **Paid once, every way.** Online (`routers/company_billing.py`, settled in
    `payment_events.mark_invoice_paid`) or marked paid by an admin for a check
    or wire. Paying an invoice marks each Pro+ year on it paid too.
  * **GaitDesk never takes its fee out of an exhibitor's payment.** The show
    company pays the invoice itself. By bank (ACH) it pays the invoice; by
    credit card it pays the processing fee on top (`billing.payment_quote`);
    a debit card is never surcharged.
  * **A finished show is paid for before the next one is set up** (migration
    173, `settle_up_block`). A Basic or Pro show whose last day has passed,
    which costs something and is not on a paid invoice -- or one with a bank
    payment on its way -- stops the company setting up another show. The
    company settles it on My Company (`issue_settle_up_invoice`, then pays
    by card or bank); a check is marked paid by a GaitDesk admin. Either
    lifts it. Shows that ended before `show_companies.settle_shows_from`
    never block: they were run before the rule.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Optional, Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from billing import billable_exhibitor_count, invoice_due_on, invoice_status, platform_usage
from mailer import public_app_url
from models import GaitDeskInvoice, GaitDeskInvoiceLine, Show, ShowCompany, ShowEntry
from payment_events import invoice_label
from schemas import (
    CompanyUsageOut,
    GaitDeskInvoiceLineOut,
    GaitDeskInvoiceOut,
    UsageShowOut,
    UsageSubscriptionOut,
)
from show_companies import PLANS, show_billing_plan, utc_today


class InvoiceRefused(ValueError):
    """Why these lines cannot be invoiced, in words for the admin."""


@dataclass(frozen=True)
class InvoiceRef:
    invoice_id: UUID
    label: str
    # Paid, or a bank payment on its way: the line no longer holds the
    # company back (`settle_up_block`).
    settled: bool = False


@dataclass
class Invoiced:
    """What is already on an invoice that is not void."""
    shows: dict[UUID, InvoiceRef]
    years: dict[UUID, InvoiceRef]


async def invoiced_for_company(db: AsyncSession, company_id: UUID) -> Invoiced:
    rows = (
        await db.execute(
            select(
                GaitDeskInvoiceLine.show_id,
                GaitDeskInvoiceLine.subscription_id,
                GaitDeskInvoice.id,
                GaitDeskInvoice.number,
                GaitDeskInvoice.paid_on,
                GaitDeskInvoice.payment_pending_at,
            )
            .join(GaitDeskInvoice, GaitDeskInvoiceLine.invoice_id == GaitDeskInvoice.id)
            .where(GaitDeskInvoice.company_id == company_id, GaitDeskInvoice.voided_at.is_(None))
        )
    ).all()
    shows: dict[UUID, InvoiceRef] = {}
    years: dict[UUID, InvoiceRef] = {}
    for show_id, subscription_id, invoice_id, number, paid_on, pending_at in rows:
        ref = InvoiceRef(invoice_id, f"GD-{number:05d}", settled=paid_on is not None or pending_at is not None)
        if show_id:
            shows[show_id] = ref
        if subscription_id:
            years[subscription_id] = ref
    return Invoiced(shows, years)


def invoice_lines(
    usage,
    show_ids: Sequence[UUID],
    subscription_ids: Sequence[UUID],
    invoiced: Invoiced,
    today: date,
) -> list[dict]:
    """The lines of a new invoice, copied off the usage statement -- or
    `InvoiceRefused` saying which line cannot go on it and why."""
    if len(set(show_ids)) != len(show_ids) or len(set(subscription_ids)) != len(subscription_ids):
        raise InvoiceRefused("A show or a Pro+ year is listed twice.")
    shows = {line.show_id: line for line in usage.shows}
    years = {year.id: year for year in usage.subscriptions}
    lines: list[dict] = []
    for show_id in show_ids:
        line = shows.get(show_id)
        if line is None:
            raise InvoiceRefused("One of those shows is not run by this company.")
        if show_id in invoiced.shows:
            raise InvoiceRefused(f"{line.show_name} is already on invoice {invoiced.shows[show_id].label}.")
        if line.end_date is not None and line.end_date > today:
            raise InvoiceRefused(
                f"{line.show_name} has not finished yet, and it can still gain exhibitors. "
                "Invoice it after its last day."
            )
        lines.append({
            "kind": "show",
            "show_id": show_id,
            "subscription_id": None,
            "description": line.show_name,
            "billing_plan": line.billing_plan,
            "exhibitor_count": line.exhibitor_count,
            "rate_cents": line.rate_cents,
            "amount_cents": line.amount_cents,
        })
    for year_id in subscription_ids:
        year = years.get(year_id)
        if year is None:
            raise InvoiceRefused("That Pro+ year is not this company's.")
        if year_id in invoiced.years:
            raise InvoiceRefused(f"That Pro+ year is already on invoice {invoiced.years[year_id].label}.")
        if year.payment_received_on is not None:
            raise InvoiceRefused("That Pro+ year is already paid for.")
        if year.price_cents <= 0:
            raise InvoiceRefused("That Pro+ year is complimentary -- there is nothing to invoice.")
        lines.append({
            "kind": "pro_plus",
            "show_id": None,
            "subscription_id": year_id,
            "description": f"GaitDesk Pro+, {_day(year.starts_on)} to {_day(year.ends_on)}",
            "billing_plan": "pro_plus",
            "exhibitor_count": None,
            "rate_cents": None,
            "amount_cents": year.price_cents,
        })
    if not lines:
        raise InvoiceRefused("Choose at least one show or Pro+ year to invoice.")
    if sum(line["amount_cents"] for line in lines) <= 0:
        raise InvoiceRefused("Those lines come to nothing, so there is nothing to invoice.")
    return lines


def invoice_out(invoice: GaitDeskInvoice, today: date) -> GaitDeskInvoiceOut:
    return GaitDeskInvoiceOut(
        id=invoice.id,
        number=invoice.number,
        label=invoice_label(invoice),
        company_id=invoice.company_id,
        company_name=invoice.company_name,
        issued_on=invoice.issued_on,
        due_on=invoice.due_on,
        amount_cents=invoice.amount_cents,
        status=invoice_status(invoice, today),
        note=invoice.note,
        paid_on=invoice.paid_on,
        payment_method=invoice.payment_method,
        payment_reference=invoice.payment_reference,
        card_fee_cents=invoice.card_fee_cents or 0,
        voided_at=invoice.voided_at,
        created_at=invoice.created_at,
        lines=[
            GaitDeskInvoiceLineOut(
                id=line.id,
                kind=line.kind,
                show_id=line.show_id,
                subscription_id=line.subscription_id,
                description=line.description,
                billing_plan=line.billing_plan,
                exhibitor_count=line.exhibitor_count,
                rate_cents=line.rate_cents,
                amount_cents=line.amount_cents,
            )
            for line in sorted(invoice.lines, key=lambda l: (l.kind != "pro_plus", l.description.lower()))
        ],
    )


def _day(value: date) -> str:
    """ "Nov 16, 2026" -- spelled out, since `%-d` does not exist on Windows."""
    return f"{value:%b} {value.day}, {value.year}"


def _dollars(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def invoice_pay_url(invoice: GaitDeskInvoice) -> str:
    """The link that opens this invoice's payment on My Company. Signing in
    first brings the reader back to it (`/login?next=`)."""
    return f"{public_app_url()}/admin/my-company?invoice={invoice.id}"


def invoice_email(
    invoice: GaitDeskInvoice,
    lines: Iterable[GaitDeskInvoiceLine],
    *,
    pay_online: bool = True,
    intro: Optional[str] = None,
) -> tuple[str, str]:
    """The email to the company's show managers when an invoice is issued.
    `pay_online` is whether Stripe is set up: with it the link opens the
    payment; without it the invoice is paid by check. `intro` replaces the
    opening line -- a Pro+ year GaitDesk started says so."""
    label = invoice_label(invoice)
    subject = f"GaitDesk invoice {label}: {_dollars(invoice.amount_cents)} due {_day(invoice.due_on)}"
    body = [
        intro or f"GaitDesk has issued invoice {label} to {invoice.company_name}.",
        "",
    ]
    for line in lines:
        if line.kind == "show" and line.exhibitor_count is not None:
            body.append(
                f"  {line.description}: {line.exhibitor_count} exhibitors at {_dollars(line.rate_cents or 0)} "
                f"= {_dollars(line.amount_cents)}"
            )
        else:
            body.append(f"  {line.description}: {_dollars(line.amount_cents)}")
    body += [
        "",
        f"Total: {_dollars(invoice.amount_cents)}",
        f"Due: {_day(invoice.due_on)} (net 30)",
        "",
    ]
    if pay_online:
        body += [
            "Pay it online -- by bank transfer at no extra charge, or by credit card",
            "with the card processing fee added:",
            invoice_pay_url(invoice),
            "",
            f"Or pay by check: write invoice {label} on it, and GaitDesk marks it paid",
            "when it arrives.",
        ]
    else:
        body += [
            f"Pay by check, with invoice {label} written on it -- reply to this email",
            "for where to send it. GaitDesk marks it paid when it arrives. The invoice",
            "is on My Company:",
            invoice_pay_url(invoice),
        ]
    if invoice.note:
        body += ["", invoice.note]
    return subject, "\n".join(body)


def open_amount_cents(invoice: GaitDeskInvoice) -> Optional[int]:
    """What is still to pay on an invoice, or None when it cannot be paid."""
    if invoice.voided_at is not None or invoice.paid_on is not None:
        return None
    return invoice.amount_cents


# ── The usage statement (moved here from routers/show_companies.py) ──────────


async def load_company_for_usage(db: AsyncSession, company_id: UUID) -> Optional[ShowCompany]:
    """A company with what pricing its shows reads: its plan changes and its
    Pro+ years."""
    return (
        await db.execute(
            select(ShowCompany)
            .where(ShowCompany.id == company_id)
            .options(selectinload(ShowCompany.plan_changes), selectinload(ShowCompany.subscriptions))
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def usage_statement(db: AsyncSession, company: ShowCompany) -> CompanyUsageOut:
    """Every show the company runs, newest first, each priced at its own
    billing plan, and each Pro+ year at its price -- what the admin's usage
    statement shows, what an invoice copies its lines from, and what the
    settle-up rule reads, so none of them can price a show differently.
    `company` must have `plan_changes` and `subscriptions` loaded."""
    company_id = company.id
    plan = PLANS.get(company.plan) or PLANS["free"]
    invoiced = await invoiced_for_company(db, company_id)
    shows = (
        await db.execute(
            select(Show)
            .where(Show.company_id == company_id)
            .order_by(Show.start_date.desc(), Show.name)
        )
    ).scalars().all()
    # Only the columns the roster test reads -- a season's worth of shows is
    # thousands of rows, and nothing else on them is wanted here.
    show_entries = (
        await db.execute(
            select(ShowEntry.show_id, ShowEntry.registered_at, ShowEntry.cancelled_at).where(
                ShowEntry.show_id.in_([s.id for s in shows])
            )
        )
    ).all() if shows else []
    by_show: dict[UUID, list] = {}
    for se in show_entries:
        by_show.setdefault(se.show_id, []).append(se)

    lines = []
    for show in shows:
        billed = PLANS[show_billing_plan(company.plan_changes, company.subscriptions, show.start_date, show.end_date)]
        usage = platform_usage(billable_exhibitor_count(by_show.get(show.id, [])), billed.rate_cents)
        ref = invoiced.shows.get(show.id)
        lines.append(
            UsageShowOut(
                show_id=show.id,
                show_name=show.name,
                start_date=show.start_date,
                end_date=show.end_date,
                status=show.status,
                billing_plan=billed.key,
                billing_plan_label=billed.label,
                invoice_id=ref.invoice_id if ref else None,
                invoice_label=ref.label if ref else None,
                invoice_settled=bool(ref and ref.settled),
                **usage,
            )
        )
    years = [
        UsageSubscriptionOut(
            id=t.id,
            starts_on=t.starts_on,
            ends_on=t.ends_on,
            price_cents=t.price_cents,
            payment_received_on=t.payment_received_on,
            invoice_id=invoiced.years[t.id].invoice_id if t.id in invoiced.years else None,
            invoice_label=invoiced.years[t.id].label if t.id in invoiced.years else None,
        )
        for t in sorted(company.subscriptions, key=lambda t: t.starts_on, reverse=True)
    ]
    return CompanyUsageOut(
        company_id=company.id,
        company_name=company.name,
        plan=plan.key,
        plan_label=plan.label,
        rate_cents=plan.rate_cents,
        shows=lines,
        subscriptions=years,
        exhibitor_count=sum(line.exhibitor_count for line in lines),
        amount_cents=sum(line.amount_cents for line in lines) + sum(y.price_cents for y in years),
    )


# ── Settling up after a show (migration 173) ─────────────────────────────────


def unsettled_shows(usage, settle_from: date, today: date) -> list:
    """The shows that hold the company back from setting up another: finished
    (their last day before today), ending on or after `settle_from`, costing
    something, and not on an invoice that is paid or has a bank payment on
    its way. A Pro+ show costs nothing per exhibitor, so it never blocks."""
    return [
        line
        for line in usage.shows
        if line.end_date is not None
        and settle_from <= line.end_date < today
        and line.amount_cents > 0
        and not line.invoice_settled
    ]


def settle_up_message(company_name: str, shows: Sequence) -> str:
    names = ", ".join(line.show_name for line in shows[:3]) + (f" and {len(shows) - 3} more" if len(shows) > 3 else "")
    total = sum(line.amount_cents for line in shows)
    return (
        f"{company_name} has {'a show' if len(shows) == 1 else f'{len(shows)} shows'} to pay for before "
        f"setting up the next one: {names} ({_dollars(total)}). Settle up on My Company -- pay by card "
        "or bank transfer and you can carry on straight away, or pay by check and GaitDesk unlocks your "
        "account when it arrives."
    )


async def settle_up_block(db: AsyncSession, company_id: Optional[UUID]) -> Optional[str]:
    """Why this company cannot set up another show yet, or None when it can.
    The gate on every path that puts a new show under a company."""
    if company_id is None:
        return None
    company = await load_company_for_usage(db, company_id)
    if company is None:
        return None
    shows = unsettled_shows(await usage_statement(db, company), company.settle_shows_from, utc_today())
    return settle_up_message(company.name, shows) if shows else None


async def issue_settle_up_invoice(
    db: AsyncSession, company: ShowCompany, issued_by: Optional[UUID]
) -> Optional[GaitDeskInvoice]:
    """The company asking to settle up: an invoice for every finished show it
    has not been invoiced for yet, priced by the statement, due in 30 days --
    the same invoice an admin would issue. None when there is nothing new to
    invoice (every unsettled show is already on an open invoice to pay)."""
    today = utc_today()
    usage = await usage_statement(db, company)
    pending = [line for line in unsettled_shows(usage, company.settle_shows_from, today) if line.invoice_id is None]
    if not pending:
        return None
    lines = invoice_lines(usage, [line.show_id for line in pending], [], await invoiced_for_company(db, company.id), today)
    invoice = GaitDeskInvoice(
        company_id=company.id,
        company_name=company.name,
        issued_on=today,
        due_on=invoice_due_on(today),
        amount_cents=sum(line["amount_cents"] for line in lines),
        issued_by_user_id=issued_by,
        lines=[GaitDeskInvoiceLine(**line) for line in lines],
    )
    db.add(invoice)
    return invoice


async def issue_pro_plus_invoice(
    db: AsyncSession, company: ShowCompany, year_id: UUID, issued_by: Optional[UUID]
) -> Optional[GaitDeskInvoice]:
    """An invoice for a Pro+ year GaitDesk started before it was paid for
    (`routers/show_companies.start_pro_plus_year`): the
    year's line off the usage statement, due in 30 days. None when there is
    nothing to invoice -- the year is paid, free, or already on an invoice."""
    today = utc_today()
    usage = await usage_statement(db, company)
    try:
        lines = invoice_lines(usage, [], [year_id], await invoiced_for_company(db, company.id), today)
    except InvoiceRefused:
        return None
    invoice = GaitDeskInvoice(
        company_id=company.id,
        company_name=company.name,
        issued_on=today,
        due_on=invoice_due_on(today),
        amount_cents=sum(line["amount_cents"] for line in lines),
        issued_by_user_id=issued_by,
        lines=[GaitDeskInvoiceLine(**line) for line in lines],
    )
    db.add(invoice)
    return invoice


async def open_invoices_for_year(db: AsyncSession, year_id: UUID) -> list[GaitDeskInvoice]:
    """Unpaid, unvoided invoices that bill nothing but this Pro+ year -- the
    ones an admin marking the year paid settles too."""
    invoices = (
        await db.execute(
            select(GaitDeskInvoice)
            .join(GaitDeskInvoiceLine, GaitDeskInvoiceLine.invoice_id == GaitDeskInvoice.id)
            .where(
                GaitDeskInvoiceLine.subscription_id == year_id,
                GaitDeskInvoice.paid_on.is_(None),
                GaitDeskInvoice.voided_at.is_(None),
            )
            .execution_options(populate_existing=True)
        )
    ).scalars().unique().all()
    return [i for i in invoices if all(line.subscription_id == year_id for line in i.lines)]

