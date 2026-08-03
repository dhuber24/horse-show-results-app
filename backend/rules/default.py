"""Default rules — all show types inherit from this.

Override only the methods that differ for a specific breed association.
Add new rule methods here first so every type picks up a safe default.
"""


class DefaultRules:
    code = "OPEN"

    @staticmethod
    def entry_is_active(entry) -> bool:
        """Whether an entry is live enough to validate.

        A not-yet-flushed Entry has `status is None` because the column default
        is applied at flush time, so a bare `status != "ENTERED"` check treats
        unsaved entries as withdrawn and skips every rule. Callers validate
        before flushing, so None must count as ENTERED.
        """
        return (getattr(entry, "status", None) or "ENTERED") == "ENTERED"

    def validate_entry(self, entry, show, cls, context=None):
        """Return list[str] of validation errors. Empty = valid."""
        return []

    def validate_show_schedule(self, show, classes, context=None):
        """Return validation issue dicts for show-level readiness checks."""
        return []

    def calculate_points(self, result, cls):
        """Points awarded for a placing. Default: 1st=10, 2nd=9, ... down to 1."""
        place = getattr(result, "place", None)
        if not place or place < 1:
            return 0
        return max(11 - place, 0)
