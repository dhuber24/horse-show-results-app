"""Which side pots a class obliges, and what satisfies the obligation.

A side pot bundles classes, and a show that runs one over its ranch riding
classes is saying the buy-in is part of entering them. Four things in that rule
are easy to get wrong, and each one is a way for the office to end up unable to
take an entry:

* **at least one covering pot, never all of them** — a class two pots have
  bundled is a choice, and requiring both charges two buy-ins for one entry;
* **a settled or closed pot never obliges** — nobody can be added to one, so
  requiring it would make the class unenterable by any route;
* **membership is per show entry** — one buy-in covers every class the pot
  names, so the second class asks for nothing;
* **an opt-in arriving with the request counts** — the entry and its buy-in are
  one press, and a check that ignored the request would refuse every first
  entry into a pot's classes.
"""
from types import SimpleNamespace
from uuid import uuid4

from side_pot_membership import (
    assert_pots_joinable,
    join_pots,
    joined_pot_ids,
    pots_covering_class,
    requirement_detail,
    unmet_pots,
)

RANCH_RIDING = uuid4()
RANCH_TRAIL = uuid4()
HALTER = uuid4()
SHOW_ENTRY = uuid4()
OTHER_ENTRY = uuid4()


def make_pot(*, name="Ranch Jackpot", classes=(), entries=(), status="open", fee=5000):
    """A SidePot as this module reads one: its classes and its buy-ins."""
    return SimpleNamespace(
        id=uuid4(),
        name=name,
        status=status,
        entry_fee_cents=fee,
        pot_classes=[SimpleNamespace(class_id=cid) for cid in classes],
        pot_entries=[SimpleNamespace(show_entry_id=eid) for eid in entries],
    )


def make_class(number="24", name="Ranch Riding Amateur"):
    return SimpleNamespace(id=RANCH_RIDING, class_number=number, class_name=name)


# ── Which pots cover a class ─────────────────────────────────────────────────

def test_a_class_no_pot_names_is_covered_by_nothing():
    pots = [make_pot(classes=[RANCH_RIDING])]
    assert pots_covering_class(pots, HALTER) == []


def test_a_settled_pot_does_not_cover_its_classes():
    # Its payouts are written and the pot endpoint refuses to add anybody, so
    # obliging it would leave the class unenterable by any route.
    pots = [make_pot(classes=[RANCH_RIDING], status="settled")]
    assert pots_covering_class(pots, RANCH_RIDING) == []


def test_a_closed_pot_does_not_cover_its_classes():
    pots = [make_pot(classes=[RANCH_RIDING], status="closed")]
    assert pots_covering_class(pots, RANCH_RIDING) == []


def test_covering_pots_come_back_in_name_order():
    late = make_pot(name="Zeta Pot", classes=[RANCH_RIDING])
    early = make_pot(name="Alpha Pot", classes=[RANCH_RIDING])
    assert [p.name for p in pots_covering_class([late, early], RANCH_RIDING)] == [
        "Alpha Pot",
        "Zeta Pot",
    ]


# ── What the requirement is satisfied by ─────────────────────────────────────

def test_no_pot_no_requirement():
    pots = [make_pot(classes=[RANCH_RIDING])]
    assert unmet_pots(pots, HALTER, SHOW_ENTRY) == []


def test_a_covered_class_is_refused_when_nobody_has_bought_in():
    pots = [make_pot(classes=[RANCH_RIDING])]
    assert [p.name for p in unmet_pots(pots, RANCH_RIDING, SHOW_ENTRY)] == ["Ranch Jackpot"]


def test_an_exhibitor_already_in_the_pot_is_asked_for_nothing():
    pots = [make_pot(classes=[RANCH_RIDING], entries=[SHOW_ENTRY])]
    assert unmet_pots(pots, RANCH_RIDING, SHOW_ENTRY) == []


def test_somebody_elses_buy_in_does_not_cover_this_exhibitor():
    pots = [make_pot(classes=[RANCH_RIDING], entries=[OTHER_ENTRY])]
    assert len(unmet_pots(pots, RANCH_RIDING, SHOW_ENTRY)) == 1


def test_one_buy_in_covers_every_class_the_pot_names():
    pots = [make_pot(classes=[RANCH_RIDING, RANCH_TRAIL], entries=[SHOW_ENTRY])]
    assert unmet_pots(pots, RANCH_RIDING, SHOW_ENTRY) == []
    assert unmet_pots(pots, RANCH_TRAIL, SHOW_ENTRY) == []


def test_one_of_two_covering_pots_is_enough():
    # Not both: a class bundled two ways is a choice the show meant somebody to
    # make, and requiring both would charge two buy-ins for one entry.
    joined = make_pot(name="Small Pot", classes=[RANCH_RIDING], entries=[SHOW_ENTRY])
    other = make_pot(name="Big Pot", classes=[RANCH_RIDING], fee=20000)
    assert unmet_pots([joined, other], RANCH_RIDING, SHOW_ENTRY) == []


def test_the_opt_in_on_the_request_satisfies_it():
    # The entry and its buy-in are one press. Without this every first entry
    # into a pot's classes would be refused, whatever the caller sent.
    pot = make_pot(classes=[RANCH_RIDING])
    assert unmet_pots([pot], RANCH_RIDING, SHOW_ENTRY, also_joining={pot.id}) == []


def test_an_opt_in_to_a_pot_that_does_not_cover_the_class_does_not_satisfy_it():
    covering = make_pot(name="Ranch Jackpot", classes=[RANCH_RIDING])
    elsewhere = make_pot(name="Halter Jackpot", classes=[HALTER])
    unmet = unmet_pots([covering, elsewhere], RANCH_RIDING, SHOW_ENTRY,
                       also_joining={elsewhere.id})
    assert [p.name for p in unmet] == ["Ranch Jackpot"]


def test_an_exhibitor_with_no_roster_row_is_in_no_pots():
    pots = [make_pot(classes=[RANCH_RIDING], entries=[SHOW_ENTRY])]
    assert joined_pot_ids(pots, None) == set()
    assert len(unmet_pots(pots, RANCH_RIDING, None)) == 1


# ── What the refusal says ────────────────────────────────────────────────────

def test_the_refusal_names_the_pot_and_its_price():
    # "This class needs a side pot" is not actionable: which pot, and what it
    # costs, is the whole of the decision.
    pot = make_pot(classes=[RANCH_RIDING], fee=5000)
    detail = requirement_detail(make_class(), [pot])
    assert detail["code"] == "SIDE_POT_REQUIRED"
    assert "Ranch Jackpot" in detail["message"]
    assert "$50.00" in detail["message"]
    assert detail["side_pots"] == [
        {"id": str(pot.id), "name": "Ranch Jackpot", "entry_fee_cents": 5000}
    ]


def test_the_refusal_offers_the_choice_when_two_pots_cover_the_class():
    pots = [
        make_pot(name="Big Pot", classes=[RANCH_RIDING], fee=20000),
        make_pot(name="Small Pot", classes=[RANCH_RIDING], fee=2500),
    ]
    detail = requirement_detail(make_class(), pots)
    assert "one of them" in detail["message"]
    assert len(detail["side_pots"]) == 2


# ── Checking an opt-in that arrived on the request ───────────────────────────

class FakeSession:
    """Just enough of AsyncSession for `join_pots`, which only ever adds."""

    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)


def test_a_pot_from_another_show_is_refused_rather_than_ignored():
    # Silently dropping it would take the money and leave the entry unbacked.
    pot = make_pot(classes=[RANCH_RIDING])
    try:
        assert_pots_joinable([pot], {uuid4()}, {RANCH_RIDING})
    except ValueError as exc:
        assert "not open" in str(exc)
    else:
        raise AssertionError("expected a refusal")


def test_a_settled_pot_cannot_be_bought_into():
    pot = make_pot(classes=[RANCH_RIDING], status="settled")
    try:
        assert_pots_joinable([pot], {pot.id}, {RANCH_RIDING})
    except ValueError as exc:
        assert "not open" in str(exc)
    else:
        raise AssertionError("expected a refusal")


def test_a_pot_covering_none_of_the_entered_classes_is_refused():
    # The opt-in exists to satisfy this rule; a buy-in for something nobody is
    # entering is a charge the exhibitor never chose.
    pot = make_pot(name="Halter Jackpot", classes=[HALTER])
    try:
        assert_pots_joinable([pot], {pot.id}, {RANCH_RIDING})
    except ValueError as exc:
        assert "does not cover" in str(exc)
    else:
        raise AssertionError("expected a refusal")


def test_a_covering_pot_is_accepted():
    pot = make_pot(classes=[RANCH_RIDING])
    assert assert_pots_joinable([pot], {pot.id}, {RANCH_RIDING}) == [pot]


# ── Joining ──────────────────────────────────────────────────────────────────

def test_joining_writes_one_row_marked_paid():
    # `paid` is true because pot money settles with the show bill: being in the
    # pot is what owing the buy-in means, and a pot of unpaid rows pays nothing.
    pot = make_pot(classes=[RANCH_RIDING])
    db = FakeSession()
    created = join_pots(SHOW_ENTRY, [pot], db)
    assert len(created) == 1
    assert created[0].show_entry_id == SHOW_ENTRY
    assert created[0].paid is True
    assert len(db.added) == 1


def test_joining_a_pot_twice_buys_in_once():
    # Both entry doors may pass the same pot again — the exhibitor's form sends
    # it with every class in a batch, and two classes in one pot is one buy-in.
    pot = make_pot(classes=[RANCH_RIDING, RANCH_TRAIL])
    db = FakeSession()
    assert len(join_pots(SHOW_ENTRY, [pot], db)) == 1
    assert join_pots(SHOW_ENTRY, [pot], db) == []
    assert len(db.added) == 1


def test_joining_leaves_the_loaded_pot_able_to_answer_the_next_class():
    # The row is appended to the pot in hand, so a batch entering two of its
    # classes does not try to buy in twice before anything is flushed.
    pot = make_pot(classes=[RANCH_RIDING, RANCH_TRAIL])
    db = FakeSession()
    join_pots(SHOW_ENTRY, [pot], db)
    assert unmet_pots([pot], RANCH_TRAIL, SHOW_ENTRY) == []
