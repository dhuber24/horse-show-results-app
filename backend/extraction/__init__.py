"""AI-assisted reading of uploaded documents.

Everything in here produces *suggestions*. Nothing in here writes to a record.
The uploader reviews what the model read and saves it themselves — see
`routers/horse_documents.py` for the review/save half.
"""

from .documents import (
    EXTRACTION_MODEL,
    ExtractionResult,
    extract_horse_document,
    extraction_available,
    supports_extraction,
)

__all__ = [
    "EXTRACTION_MODEL",
    "ExtractionResult",
    "extract_horse_document",
    "extraction_available",
    "supports_extraction",
]
