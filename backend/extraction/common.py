"""What a read of an uploaded file needs, whatever the file is: the client, the
block the file travels in, and the shape a read comes back in."""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass, field
from typing import Any, Optional

STATUS_SUCCEEDED = "succeeded"
STATUS_UNSUPPORTED_MEDIA = "unsupported_media"
STATUS_FAILED = "failed"

# TIFF is deliberately absent: the upload endpoint accepts it, but it is not a
# format the model reads, and adding an image-conversion dependency to support
# a format almost nothing scans to is not worth it. Those uploads fall back to
# doing it by hand.
_IMAGE_MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp"}
_PDF_MEDIA_TYPE = "application/pdf"


def supports_extraction(mime_type: str) -> bool:
    """Whether this file type can be read at all."""
    return mime_type == _PDF_MEDIA_TYPE or mime_type in _IMAGE_MEDIA_TYPES


def extraction_available() -> bool:
    """Whether the service is configured. False just means doing it by hand."""
    return bool(os.getenv("ANTHROPIC_API_KEY"))


@dataclass
class ExtractionResult:
    """What a read produced, in a shape the caller can persist and return."""

    status: str
    fields: dict[str, Any] = field(default_factory=dict)
    error_message: Optional[str] = None
    model: Optional[str] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None

    @property
    def succeeded(self) -> bool:
        return self.status == STATUS_SUCCEEDED


_client = None


def _get_client():
    """Build the client on first use so the app boots without a key configured."""
    global _client
    if _client is None:
        from anthropic import AsyncAnthropic

        _client = AsyncAnthropic()
    return _client


def _document_block(content: bytes, mime_type: str) -> dict[str, Any]:
    data = base64.standard_b64encode(content).decode("utf-8")
    if mime_type == _PDF_MEDIA_TYPE:
        return {
            "type": "document",
            "source": {"type": "base64", "media_type": _PDF_MEDIA_TYPE, "data": data},
        }
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": mime_type, "data": data},
    }
