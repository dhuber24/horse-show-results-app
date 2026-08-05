"""Best-effort outbound email.

SMTP is optional in this deployment. With no `SMTP_HOST` configured — local
dev, a Codespace, a fresh clone — `send_email` returns None and logs, and every
caller is expected to carry on. That is deliberate: the flows that send mail
(horse-access approval, ownership transfer) all surface the same link in the UI
for copy/paste, so an undelivered email is an inconvenience rather than a dead
end. Email must never be the reason a horse can't change hands.

Uses stdlib `smtplib` on a worker thread rather than adding an async SMTP
dependency: this sends a handful of short messages per day, and the thread hop
keeps the event loop free without another package in the image.
"""
from __future__ import annotations

import asyncio
import logging
import os
import smtplib
from email.message import EmailMessage

logger = logging.getLogger(__name__)


def public_app_url() -> str:
    """Base URL for links we put in email. Must be reachable by the recipient,
    so it is the public frontend origin, not the internal backend host."""
    return os.getenv("PUBLIC_APP_URL", "http://localhost:3000").rstrip("/")


def smtp_configured() -> bool:
    return bool(os.getenv("SMTP_HOST"))


def _send_sync(to: str, subject: str, body: str) -> None:
    host = os.getenv("SMTP_HOST", "")
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER") or None
    password = os.getenv("SMTP_PASSWORD") or None
    sender = os.getenv("SMTP_FROM") or user or "no-reply@horseshowresults.app"
    use_tls = os.getenv("SMTP_STARTTLS", "true").lower() not in ("0", "false", "no")

    message = EmailMessage()
    message["From"] = sender
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    with smtplib.SMTP(host, port, timeout=15) as smtp:
        if use_tls:
            smtp.starttls()
        if user and password:
            smtp.login(user, password)
        smtp.send_message(message)


async def send_email(to: str | None, subject: str, body: str) -> bool | None:
    """Send one plain-text message.

    Returns True on success, False if sending was attempted and failed, and
    None if there was nothing to attempt (no SMTP configured, or no address).
    Never raises — callers commit their work regardless of delivery.
    """
    if not to or not smtp_configured():
        logger.info("Email not sent (no SMTP configured or no recipient): %s", subject)
        return None
    try:
        await asyncio.to_thread(_send_sync, to, subject, body)
        return True
    except Exception:
        logger.exception("Failed to send email to %s: %s", to, subject)
        return False
