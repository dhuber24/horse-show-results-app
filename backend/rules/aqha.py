"""AQHA (American Quarter Horse Association) rules.

Stub — override methods from DefaultRules as AQHA-specific logic is added.
"""
from .default import DefaultRules


class AQHARules(DefaultRules):
    code = "AQHA"
