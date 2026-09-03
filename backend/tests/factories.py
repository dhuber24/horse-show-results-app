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
        sanctioning=[],
        # `build_bill` reads the show's own fee catalog and its judge panel off
        # the Show row, the same way it reads `sanctioning`. Defaulted to empty
        # so a test about class fees says nothing about either — and present at
        # all so a test that forgets them fails the way the app does rather
        # than passing on a stub the ORM would never hand over. The office
        # charge is one of these `fees` rows since migration 132.
        fees=[],
        judges=[],
        # Dates
        start_date=date(2026, 6, 1),
        end_date=date(2026, 6, 3),
        # The day entries close (migration 123). None is the ordinary case -- most
        # shows have never set one, which is the case APHA SC-090.C has to fall
        # back from.
        entry_deadline=None,
        # APHA zone 1-14 (migration 119). None is the ordinary case — most
        # shows are not APHA and none of them state a zone by default.
        apha_zone=None,
        # What kind of APHA show, and whether a clinic runs alongside it
        # (migration 124). None is every show that has not said — which is the
        # case SC-100 and SC-105 have nothing to check against.
        show_category=None,
        offers_clinic=False,
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


def make_sanctioning(
    code: Optional[str], per_class_fee_cents: int = 300, association_id=None
) -> SimpleNamespace:
    """One `show_sanctioning` row. `code=None` builds the row with no
    association attached, which is the shape a half-finished registry edit
    leaves behind.

    `association_id` is what `class_sanctioning` joins on, so a test that wants
    a club to actually charge has to hand the same id to `make_class_sanction`.
    Defaulted to a fresh uuid rather than to the code, so two rows for the same
    club in one test are still distinguishable."""
    association_id = association_id or uuid4()
    association = None if code is None else SimpleNamespace(code=code, name=code)
    return SimpleNamespace(
        association=association,
        association_id=association_id,
        per_class_fee_cents=per_class_fee_cents,
    )


def make_class_sanction(sanctioning) -> SimpleNamespace:
    """A `class_sanctioning` row pointing at the club `sanctioning` describes.

    Takes the show_sanctioning row rather than a bare id because the two only
    mean anything together — a designation for a club the show does not carry
    is priced at zero, which is a case worth being able to build deliberately.
    """
    return SimpleNamespace(
        association_id=sanctioning.association_id,
        association=sanctioning.association,
    )


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
        min_quantity=0,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def make_judges(count: int) -> list:
    """A judge panel, as `build_bill` sees it: only the size matters.

    These are `show_judges` assignment rows, not registry judges — nothing in
    billing reads a name off them.
    """
    return [SimpleNamespace(id=uuid4()) for _ in range(count)]


def make_show_judge(first="Dale", last="Rogers", codes=("APHA",)) -> SimpleNamespace:
    """One `show_judges` assignment carrying the registry judge behind it.

    Separate from `make_judges` on purpose: billing counts the panel and reads
    nothing off it, while APHA SC-090.B reads the judge's name and what they are
    carded with. A panel built for one is the wrong shape for the other, and a
    single factory serving both would quietly give every billing test a name.
    """
    return SimpleNamespace(
        id=uuid4(),
        judge=SimpleNamespace(
            id=uuid4(),
            first_name=first,
            last_name=last,
            associations=[SimpleNamespace(code=code) for code in codes],
        ),
    )


def make_class(**overrides) -> SimpleNamespace:
    defaults = dict(
        id=uuid4(),
        class_number=1,
        class_name="Western Pleasure",
        class_date=date(2026, 6, 1),
        entry_fee_cents=2500,
        # The classifier-assigned riding style and the bracket, as the ORM hands
        # them over. Both default to None because most tests say nothing about
        # either -- and APHA SC-095.A reads them together, since "Open halter, 2
        # and under" lives half in the class name and half in the bracket.
        discipline=None,
        division=None,
        # No club sanctions this class unless a test says so. Defaulted to empty
        # rather than omitted so a class built here behaves like one the ORM
        # loaded — `sanctioning` is `lazy="selectin"` and is never absent.
        sanctioning=[],
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def make_horse(name="Dusty", **overrides) -> SimpleNamespace:
    """A horse, as the association rules engines see it.

    `rules/apha.py` and `rules/aqha.py` read attributes off whatever they are
    handed and never touch a session, so a namespace is the whole fixture.
    Defaults describe a Regular Registry horse with nothing unusual about it.
    """
    defaults = dict(
        id=uuid4(),
        name=name,
        is_solid_paint_bred=False,
        # None is the ordinary case: plenty of horses have no foaling date on
        # file, and APHA SC-190.A.3.a declines to check an age nobody recorded
        # rather than guessing one.
        foaling_date=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def make_exhibitor(name="Pat Rider", **overrides) -> SimpleNamespace:
    """An exhibitor, as the association rules engines see them.

    `date_of_birth` is None by default because most records carry none, and APHA
    YP-075 declines to check an age nobody recorded rather than guessing at one.
    """
    defaults = dict(
        id=uuid4(),
        full_name=name,
        date_of_birth=None,
        registrations=[],
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def make_entry(cls=..., horse_name="Dusty", horse_id=..., **overrides) -> SimpleNamespace:
    """A class entry.

    `cls` and `horse_id` sentinel-default rather than defaulting to None, so a
    test can pass None explicitly to build the orphaned-class and no-horse
    cases — which are exactly the ones `build_bill` has a branch for.

    `status` defaults to ENTERED because that is what the association rules key
    on: an entry the rules engine considers withdrawn is skipped entirely, and a
    fixture that silently defaulted to withdrawn would make every rule test pass
    for the wrong reason.
    """
    if horse_id is ...:
        horse_id = uuid4()
    if cls is ...:
        cls = make_class()
    exhibitor = overrides.get("exhibitor") or make_exhibitor()
    defaults = dict(
        id=uuid4(),
        class_=cls,
        # Carried alongside `class_` because futurity billing matches entries to
        # a futurity's classes by id without loading the class itself.
        class_id=cls.id if cls is not None else None,
        horse=make_horse(name=horse_name) if horse_name is not None else None,
        horse_id=horse_id,
        # Both doors wire `entry.exhibitor` in memory before validating, so the
        # rules engine can read it without a lazy load and the fixture has to
        # carry it too. `exhibitor_id` is taken from the object rather than
        # invented, so a test that reads either gets the same person.
        exhibitor=exhibitor,
        exhibitor_id=exhibitor.id,
        back_number=None,
        # Association validation fields. None is the ordinary case — most shows
        # are not APHA and never name a division.
        status="ENTERED",
        apha_division=None,
        relationship_to_owner=None,
        # Declarations made about this entry (migration 118). Empty by default,
        # and present at all so a rule reading it behaves like it does against a
        # real Entry, whose relationship is `lazy="selectin"` and never absent.
        attestations=[],
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
