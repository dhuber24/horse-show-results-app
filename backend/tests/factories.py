"""Stub objects for the pure-logic tests.

`billing.py` and the health block in `routers/horse_documents.py` are duck-typed
— they read attributes off whatever they are handed and never touch the ORM or
the database. So the tests build plain namespaces rather than model instances,
which keeps them free of a session, a connection, and the migration state.

Every factory defaults the attributes its subject reads, so a test names only
the ones it is actually about. A test that has to spell out six irrelevant
fields to say one thing about office charges stops being readable.
"""
from __future__ import annotations

from datetime import date
from types import SimpleNamespace
from typing import Optional
from uuid import uuid4


def make_show(**overrides) -> SimpleNamespace:
    """A show, defaulted to the plainest case: no club sanctioning, no office
    charge, Coggins required and nothing else."""
    defaults = dict(
        id=uuid4(),
        # Money
        office_charge_cents=0,
        office_charge_basis="per_back_number",
        sanctioning=[],
        # Dates
        start_date=date(2026, 6, 1),
        end_date=date(2026, 6, 3),
        # Health paperwork policy (migration 097)
        requires_coggins=True,
        requires_health_certificate=False,
        health_certificate_valid_days=30,
        requires_vaccination=False,
        vaccination_valid_days=365,
        vaccination_notes=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def make_sanctioning(code: Optional[str]) -> SimpleNamespace:
    """One `show_sanctioning` row. `code=None` builds the row with no
    association attached, which is the shape a half-finished registry edit
    leaves behind."""
    association = None if code is None else SimpleNamespace(code=code)
    return SimpleNamespace(association=association)


def make_fee(**overrides) -> SimpleNamespace:
    """A `show_fees` row. No early rate unless a test asks for one."""
    defaults = dict(
        id=uuid4(),
        code="STALL",
        label="Stall",
        unit="per_stall",
        amount_cents=5000,
        early_amount_cents=None,
        early_deadline=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def make_class(**overrides) -> SimpleNamespace:
    defaults = dict(
        id=uuid4(),
        class_number=1,
        class_name="Western Pleasure",
        class_date=date(2026, 6, 1),
        entry_fee_cents=2500,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def make_entry(cls=..., horse_name="Dusty", horse_id=..., **overrides) -> SimpleNamespace:
    """A class entry.

    `cls` and `horse_id` sentinel-default rather than defaulting to None, so a
    test can pass None explicitly to build the orphaned-class and no-horse
    cases — which are exactly the ones `build_bill` has a branch for.
    """
    if horse_id is ...:
        horse_id = uuid4()
    if cls is ...:
        cls = make_class()
    defaults = dict(
        id=uuid4(),
        class_=cls,
        # Carried alongside `class_` because futurity billing matches entries to
        # a futurity's classes by id without loading the class itself.
        class_id=cls.id if cls is not None else None,
        horse=SimpleNamespace(name=horse_name) if horse_name is not None else None,
        horse_id=horse_id,
        exhibitor_id=uuid4(),
        back_number=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def make_reservation(fee=None, quantity=1, reserved_at=None) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        show_fee=make_fee() if fee is None else fee,
        quantity=quantity,
        reserved_at=reserved_at or date(2026, 4, 1),
    )


def make_payment(amount_cents: int) -> SimpleNamespace:
    """A recorded payment. Negative is a refund — see migration 096."""
    return SimpleNamespace(id=uuid4(), amount_cents=amount_cents)


def make_side_pot(entry_fee_cents=2000, payback_percent=80) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(), entry_fee_cents=entry_fee_cents, payback_percent=payback_percent
    )


def make_payout(payout_cents: int) -> SimpleNamespace:
    return SimpleNamespace(payout_cents=payout_cents)


def make_fee_tier(name="Category #3", amount_cents=15000) -> SimpleNamespace:
    return SimpleNamespace(id=uuid4(), name=name, amount_cents=amount_cents)


def make_membership_option(name="Single Membership", amount_cents=3000) -> SimpleNamespace:
    """A club membership the futurity sells at entry (migration 109)."""
    return SimpleNamespace(id=uuid4(), name=name, amount_cents=amount_cents)


def make_futurity_entry(
    tier=..., horse_id=..., is_member=False, entered_at=None, membership=None, **overrides
) -> SimpleNamespace:
    """One horse enrolled in a futurity.

    `tier` sentinel-defaults so a test can pass None to build the
    no-tier-chosen case, which `futurity_charge_cents` treats as a zero rate.
    `membership` defaults to None — most entrants already hold a card or do not
    want one, and a stub without the attribute at all is the pre-109 shape
    `billing.membership_fee_cents` is deliberately tolerant of.
    """
    if tier is ...:
        tier = make_fee_tier()
    if horse_id is ...:
        horse_id = uuid4()
    defaults = dict(
        id=uuid4(),
        show_entry_id=uuid4(),
        horse_id=horse_id,
        horse=SimpleNamespace(name="Dusty"),
        fee_tier=tier,
        membership_option=membership,
        is_member=is_member,
        entered_at=entered_at or date(2026, 5, 1),
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def make_futurity(classes=(), entries=(), **overrides) -> SimpleNamespace:
    """A futurity, defaulted to no deadline and no office fee.

    `classes` is a list of class stubs; they are wrapped into the
    `futurity_classes` association shape `billing.futurity_lines` reads.
    """
    defaults = dict(
        id=uuid4(),
        name="North Star Futurity",
        entry_deadline=None,
        late_fee_cents=0,
        office_fee_member_cents=0,
        office_fee_nonmember_cents=0,
        futurity_classes=[SimpleNamespace(class_id=c.id) for c in classes],
        entries=list(entries),
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)
