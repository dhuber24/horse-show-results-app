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

    def required_published_places(self, cls) -> int | None:
        """How many places each judge must have filed before a class is posted.

        None means the association does not say, which is the honest default —
        an OPEN show answers to nobody about how deep it places, and inventing a
        number here would block a jackpot that only pays three.

        Associations that *do* say override this. The number is a floor, not a
        target: a class with fewer entries than that can only fill what it has,
        which is the caller's job to cap.
        """
        return None

    def ties_must_be_broken(self, cls) -> bool:
        """Whether two equal scores may be posted as a shared place.

        False by default: a shared place is a perfectly ordinary result at a show
        that answers to nobody, and an open jackpot may well pay two thirds.

        Associations that require the judge to break every tie override this.
        Note what it does *not* mean — the app never breaks the tie itself. It
        refuses to post one nobody has answered, and the answer is recorded in
        `results.tiebreak_rank` so neither score is altered.
        """
        return False

    def calculate_points(self, result, cls):
        """Points awarded for a placing. Default: 1st=10, 2nd=9, ... down to 1."""
        place = getattr(result, "place", None)
        if not place or place < 1:
            return 0
        return max(11 - place, 0)

    def _issue(self, severity, code, message, **extra):
        """One validation issue, in the shape both entry doors already render.

        `routers/entries.py` and `routers/show_registration.py` filter on
        `severity == "error"` and show `message` to the person entering, so a
        warning is reported without blocking. Extra ids are stringified because
        this dict is serialized straight into an HTTP response.
        """
        issue = {"severity": severity, "code": code, "message": message}
        issue.update({key: str(value) for key, value in extra.items() if value is not None})
        return issue
