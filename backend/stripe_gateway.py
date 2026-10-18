"""Stripe, behind one door (migration 172).

Every call GaitDesk makes to Stripe is a function here, and each returns plain
dicts -- so the routers and the webhook handlers never import the SDK, and the
tests replace one function rather than a payment processor.

**Optional, like SMTP and `ANTHROPIC_API_KEY`.** With no `STRIPE_SECRET_KEY`
set -- local dev, CI, a fresh clone, or production before the account exists
-- `configured()` is False, nothing offers to take a payment, and every
payment screen says online payment is not set up yet. The office still records
cash and checks, an admin still records a trainer's Pro date or a paid invoice
by hand, and nothing anybody needs waits on Stripe. The SDK itself is imported
only when a call is made, so a missing package is the same "not set up".

The settings, all read from the environment on each call so a restart is all a
key change needs:

  * `STRIPE_SECRET_KEY` -- GaitDesk's secret key (`sk_test_...` / `sk_live_...`).
  * `STRIPE_PUBLISHABLE_KEY` -- its publishable key (`pk_...`), handed to the
    browser to draw the card and bank form.
  * `STRIPE_WEBHOOK_SECRET` -- the signing secret of the webhook endpoint for
    GaitDesk's own account (`/api/stripe/webhook`).
  * `STRIPE_CONNECT_WEBHOOK_SECRET` -- the signing secret of the endpoint that
    listens to connected accounts (`/api/stripe/webhook/connect`).
  * `STRIPE_CARD_PERCENT_BP` / `STRIPE_CARD_FIXED_CENTS` -- the card rate the
    processing fee is worked out from, 290 and 30 (2.9% + 30c, Stripe's US
    standard rate) unless GaitDesk's account is priced otherwise.

**Three kinds of money, and GaitDesk only ever holds its own.** A trainer's
Pro subscription and a show company's GaitDesk invoice are charged on
GaitDesk's account. An exhibitor's payment to a show company is charged on the
company's own Stripe account (`stripe_account`, a connected account made with
Accounts v2 and configured as v1's Standard): it goes from the exhibitor to
the company, and GaitDesk takes nothing from it.

**SDK version.** `stripe` 15.x: Accounts v2 needs it, and from 15 a Stripe
object is no longer a dict -- `_plain` turns every response into one.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)

NOT_CONFIGURED = "Online payment is not set up yet."

DEFAULT_CARD_PERCENT_BP = 290
DEFAULT_CARD_FIXED_CENTS = 30


class PaymentsNotConfigured(RuntimeError):
    pass


class PaymentError(RuntimeError):
    """Stripe refused the request -- a declined card, a bad token. `message` is
    Stripe's own wording, written for the person paying."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


# ── Settings ──────────────────────────────────────────────────────────────────


def secret_key() -> str:
    return os.getenv("STRIPE_SECRET_KEY", "").strip()


def publishable_key() -> str:
    return os.getenv("STRIPE_PUBLISHABLE_KEY", "").strip()


def configured() -> bool:
    """Can GaitDesk take a payment at all? Both keys are needed: the secret one
    to charge, the publishable one for the browser to draw the form."""
    return bool(secret_key() and publishable_key())


def webhook_secret(connect: bool = False) -> str:
    name = "STRIPE_CONNECT_WEBHOOK_SECRET" if connect else "STRIPE_WEBHOOK_SECRET"
    return os.getenv(name, "").strip()


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        logger.warning("%s is not a whole number; using %d", name, default)
        return default


def card_rate() -> tuple[int, int]:
    """The card processing rate the fee is worked out from: basis points and
    cents. 2.9% + 30c unless the environment says otherwise."""
    return (
        _int_env("STRIPE_CARD_PERCENT_BP", DEFAULT_CARD_PERCENT_BP),
        _int_env("STRIPE_CARD_FIXED_CENTS", DEFAULT_CARD_FIXED_CENTS),
    )


async def run(fn, /, *args, **kwargs):
    """Call one of the functions below off the event loop: the SDK makes
    blocking HTTP requests, and a slow Stripe must not stall every other
    request the API is serving."""
    return await asyncio.to_thread(fn, *args, **kwargs)


def require_configured() -> None:
    """503 for an endpoint that can do nothing without Stripe."""
    if not configured():
        raise HTTPException(503, NOT_CONFIGURED)


# ── The SDK ───────────────────────────────────────────────────────────────────


def _sdk():
    if not configured():
        raise PaymentsNotConfigured(NOT_CONFIGURED)
    try:
        import stripe  # noqa: PLC0415 -- optional dependency, imported on use
    except ImportError as exc:  # pragma: no cover - the image installs it
        logger.error("The stripe package is not installed")
        raise PaymentsNotConfigured(NOT_CONFIGURED) from exc
    return stripe


def _plain(obj: Any) -> dict:
    """A Stripe object as a plain dict. Its string form is its JSON, which is
    stable across SDK versions where `to_dict` is not."""
    if obj is None:
        return {}
    if isinstance(obj, dict) and not hasattr(obj, "to_dict"):
        return obj
    return json.loads(str(obj))


def _call(fn, *args, **kwargs) -> dict:
    """A v1 call: `fn` picks the resource method off the SDK module."""
    stripe = _sdk()
    return _guarded(stripe, lambda: fn(stripe)(*args, api_key=secret_key(), **kwargs))


def _call_v2(fn, params: dict) -> dict:
    """A v2 call (`/v2/...`): `fn` picks the service off a `StripeClient`.
    Only the v2 endpoints need the client; everything else stays on the
    module-level v1 calls above."""
    stripe = _sdk()
    return _guarded(stripe, lambda: fn(stripe.StripeClient(secret_key()))(params=params))


def _guarded(stripe, request) -> dict:
    try:
        return _plain(request())
    except stripe.CardError as exc:
        raise PaymentError(exc.user_message or "Your card was declined.") from exc
    except stripe.InvalidRequestError as exc:
        logger.warning("Stripe refused a request: %s", exc)
        raise PaymentError(exc.user_message or "The payment could not be processed. Please try again.") from exc
    except stripe.StripeError as exc:
        logger.exception("Stripe request failed")
        raise PaymentError("The payment service could not be reached. Please try again in a moment.") from exc


def _account(stripe_account: Optional[str]) -> dict:
    return {"stripe_account": stripe_account} if stripe_account else {}


# ── Customers, subscriptions and the billing portal (GaitDesk's account) ──────


def create_customer(email: Optional[str], name: str, metadata: dict) -> str:
    customer = _call(lambda s: s.Customer.create, email=email or None, name=name, metadata=metadata)
    return customer["id"]


def create_subscription_checkout(
    *,
    customer_id: str,
    amount_cents: int,
    interval: str,
    product_name: str,
    success_url: str,
    cancel_url: str,
    metadata: dict,
) -> str:
    """A Stripe Checkout page for a card subscription; returns its URL.

    The price is given inline from `PRO_PRICES` rather than as a Price id kept
    in the environment, so the one place a price is written stays the app.
    Card only -- a trainer has no other way to pay, and GaitDesk pays the fee.
    """
    session = _call(
        lambda s: s.checkout.Session.create,
        mode="subscription",
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{
            "quantity": 1,
            "price_data": {
                "currency": "usd",
                "unit_amount": amount_cents,
                "recurring": {"interval": interval},
                "product_data": {"name": product_name},
            },
        }],
        subscription_data={"metadata": metadata},
        metadata=metadata,
        success_url=success_url,
        cancel_url=cancel_url,
    )
    return session["url"]


def create_billing_portal(customer_id: str, return_url: str) -> str:
    """Stripe's own page for a customer to change their card or cancel."""
    session = _call(lambda s: s.billing_portal.Session.create, customer=customer_id, return_url=return_url)
    return session["url"]


# ── One-off payments, confirmed on the server ─────────────────────────────────


def confirmation_token(token_id: str, stripe_account: Optional[str] = None) -> dict:
    """What the payer entered, before anything is charged: the method type
    (`card`, `us_bank_account`, ...) and, for a card, its funding -- credit,
    debit, prepaid or unknown. Read here, never taken from the browser, since
    it decides whether a fee is added."""
    token = _call(lambda s: s.ConfirmationToken.retrieve, token_id, **_account(stripe_account))
    preview = token.get("payment_method_preview") or {}
    method_type = preview.get("type")
    card = preview.get("card") or {}
    return {
        "id": token.get("id", token_id),
        "method_type": method_type,
        "card_funding": card.get("funding") if method_type == "card" else None,
        # The brand only. No digits of the card are ever passed on: GaitDesk
        # keeps no part of a card number (migration 173).
        "card_brand": card.get("brand") if method_type == "card" else None,
    }


def create_payment(
    *,
    amount_cents: int,
    token_id: str,
    return_url: str,
    description: str,
    metadata: dict,
    idempotency_key: str,
    receipt_email: Optional[str] = None,
    stripe_account: Optional[str] = None,
) -> dict:
    """Charge `amount_cents` with what the payer entered, now. Returns the
    PaymentIntent's id, status and client secret: `succeeded` for most cards,
    `processing` for a bank payment (settled days later, by webhook), or
    `requires_action` when the bank wants the payer to confirm -- the browser
    finishes that with the client secret."""
    intent = _call(
        lambda s: s.PaymentIntent.create,
        amount=amount_cents,
        currency="usd",
        confirm=True,
        confirmation_token=token_id,
        automatic_payment_methods={"enabled": True},
        return_url=return_url,
        description=description,
        metadata=metadata,
        receipt_email=receipt_email or None,
        idempotency_key=idempotency_key,
        **_account(stripe_account),
    )
    return {
        "id": intent["id"],
        "status": intent.get("status"),
        "client_secret": intent.get("client_secret"),
        "amount": intent.get("amount"),
        "metadata": intent.get("metadata") or {},
    }


def retrieve_payment(intent_id: str, stripe_account: Optional[str] = None) -> dict:
    intent = _call(lambda s: s.PaymentIntent.retrieve, intent_id, **_account(stripe_account))
    return {
        "id": intent["id"],
        "status": intent.get("status"),
        "amount": intent.get("amount"),
        "metadata": intent.get("metadata") or {},
        "payment_method_types": intent.get("payment_method_types") or [],
    }


# ── A show company's own account (Connect, Standard) ──────────────────────────


def create_connected_account(email: Optional[str], business_name: str, metadata: dict) -> str:
    """A Stripe account for a show company, made with Accounts v2 -- which
    Stripe requires of a new Connect platform; `Account.create` is refused.

    Configured as what Accounts v1 called a Standard account: the full Stripe
    Dashboard (`dashboard: full`), and Stripe collecting its processing fees
    from the company and carrying the losses (`fees_collector` /
    `losses_collector: stripe`). The company owns it: it signs in to Stripe
    itself, its disputes and payouts are its own. The `merchant` configuration
    takes payments -- cards, and ACH bank payments. Responsibilities cannot
    be changed once set.
    """
    account = _call_v2(
        lambda c: c.v2.core.accounts.create,
        {
            **({"contact_email": email} if email else {}),
            "display_name": business_name,
            "identity": {"country": "us"},
            "dashboard": "full",
            "defaults": {
                "currency": "usd",
                "responsibilities": {"fees_collector": "stripe", "losses_collector": "stripe"},
            },
            "configuration": {
                "merchant": {
                    "capabilities": {
                        "card_payments": {"requested": True},
                        "ach_debit_payments": {"requested": True},
                    }
                }
            },
            "metadata": metadata,
        },
    )
    return account["id"]


def create_onboarding_link(account_id: str, refresh_url: str, return_url: str) -> str:
    """Stripe's hosted sign-up for the company's account (v2 account links)."""
    link = _call_v2(
        lambda c: c.v2.core.account_links.create,
        {
            "account": account_id,
            "use_case": {
                "type": "account_onboarding",
                "account_onboarding": {
                    "configurations": ["merchant"],
                    "refresh_url": refresh_url,
                    "return_url": return_url,
                },
            },
        },
    )
    return link["url"]


def retrieve_account(account_id: str) -> dict:
    """Whether the company's account can take payments yet. Read through the
    v1 endpoint, which Stripe answers for a v2 account too, in the v1 shape --
    `charges_enabled` is the one fact this needs."""
    account = _call(lambda s: s.Account.retrieve, account_id)
    return {
        "id": account["id"],
        "charges_enabled": bool(account.get("charges_enabled")),
        "details_submitted": bool(account.get("details_submitted")),
        "payouts_enabled": bool(account.get("payouts_enabled")),
    }


# ── Webhooks ──────────────────────────────────────────────────────────────────


class BadSignature(ValueError):
    pass


def verify_event(payload: bytes, signature: str, connect: bool = False) -> dict:
    """The event Stripe signed, as a plain dict -- or `BadSignature`.

    Verified against the raw bytes exactly as Stripe sent them, which is why
    the web service forwards the body untouched. With no signing secret
    configured nothing is trusted: an unsigned event could mark any invoice
    paid.
    """
    secret = webhook_secret(connect)
    if not secret:
        raise BadSignature("No webhook signing secret is configured.")
    stripe = _sdk()
    try:
        stripe.Webhook.construct_event(payload, signature, secret)
    except (ValueError, stripe.SignatureVerificationError) as exc:
        raise BadSignature(str(exc)) from exc
    return json.loads(payload)
