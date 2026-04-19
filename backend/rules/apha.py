"""APHA (American Paint Horse Association) rules.

Stub — override methods from DefaultRules as APHA-specific logic is added.
"""
from .default import DefaultRules


class APHARules(DefaultRules):
    code = "APHA"
