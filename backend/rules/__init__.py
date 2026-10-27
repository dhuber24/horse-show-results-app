"""Show-type rules dispatch.

Each show type can have its own rules module with a common interface.
As new rule methods are added to `DefaultRules`, per-type modules can override
just the methods they need — everything else falls back to the default.

Usage:
    from rules import get_rules
    rules = get_rules(show.show_type.code if show.show_type else None)
    rules.validate_entry(entry, show, cls)

Register new types by importing their module below and adding to RULES.
"""
from .default import DefaultRules
from .apha import APHARules
from .aqha import AQHARules

RULES: dict[str, DefaultRules] = {
    "APHA": APHARules(),
    "AQHA": AQHARules(),
    "OPEN": DefaultRules(),
}

_default = DefaultRules()


def get_rules(code: str | None) -> DefaultRules:
    if not code:
        return _default
    return RULES.get(code.upper(), _default)


# What still refuses an entry. **No association's eligibility rule does**
# (2026-10-27): which registrations and rules a show holds its exhibitors to is
# the show company's call, so an entry the APHA or AQHA rules would turn away is
# saved, and its issues go back to whoever entered it and onto the show's
# readiness panel for the office to chase. `severity` still says how serious
# each one is -- an "error" is one the association would not accept -- it just
# no longer decides whether the entry is kept.
#
# The exception is a value the database cannot store: an unknown APHA division
# would fail the `check_entries_apha_division` CHECK on commit and surface as a
# 409 naming nothing. That is a malformed request, not a rule.
REFUSING_CODES = frozenset({"APHA_DIVISION_UNKNOWN"})


def refusing_issues(issues: list[dict]) -> list[dict]:
    """The issues that still turn the entry away -- see `REFUSING_CODES`."""
    return [issue for issue in issues if issue.get("code") in REFUSING_CODES]
