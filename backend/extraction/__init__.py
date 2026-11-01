"""AI-assisted reading of an uploaded show bill.

Everything in here produces *suggestions*. Nothing in here writes to a record.
The person setting the show up reviews what the model read and creates the show
themselves — see `showbill_import.py` for the review/create half.
"""

from .common import (
    ExtractionResult,
    extraction_available,
    supports_extraction,
)

__all__ = [
    "ExtractionResult",
    "extraction_available",
    "supports_extraction",
]
