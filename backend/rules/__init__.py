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
