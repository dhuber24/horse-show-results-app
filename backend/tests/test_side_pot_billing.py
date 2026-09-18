"""Side pot buy-ins on the exhibitor's bill.

Pot money used to be kept out of `build_bill` entirely, on the grounds that
folding it into a balance would make Financials disagree with the bill the
exhibitor reads on My Shows. That reasoning stopped holding when entering a
class an open pot bundles became the buy-in: the charge is no longer a decision
somebody makes on the pot's own screen, it is a consequence of an entry, and a
charge nobody chose has to appear on the bill they are handed. Both screens read
`build_bill`, so putting it there is what makes them agree.

Two things are easy to get wrong here, and both are about *which* pots charge:

* **status does not excuse a membership.** `OPEN_POT_STATUSES` answers whether a
  pot may oblige somebody to buy in. A pot settled on the Saturday still charges
  the people who were in it — its payouts were funded by exactly that money.
* **`paid` is not a billing flag.** It defaults true, the UI never asks, and
  billing only the unpaid rows would make the bill move by a figure nothing on
  any screen explains.
"""
from types import SimpleNamespace
from uuid import uuid4

from billing import side_pot_lines
from side_pot_membership import billed_pots, pot_bill_index

SHOW_ENTRY = uuid4()
OTHER_ENTRY = uuid4()
RANCH_RIDING = uuid4()
RANCH_TRAIL = uuid4()


def make_pot(*, name="Ranch Jackpot", classes=(), entries=(), status="open", fee=5000):
    return SimpleNamespace(
        id=uuid4(),
        name=name,
        status=status,
        entry_fee_cents=fee,
        pot_classes=[SimpleNamespace(class_id=cid) for cid in classes],
        pot_entries=[SimpleNamespace(show_entry_id=eid) for eid in entries],
    )


# ── Which pots reach the bill ────────────────────────────────────────────────

def test_a_pot_they_are_not_in_charges_nothing():
    pots = [make_pot(classes=[RANCH_RIDING], entries=[OTHER_ENTRY])]
    assert billed_pots(pots, SHOW_ENTRY) == []


def test_a_pot_they_are_in_is_billed():
    pot = make_pot(classes=[RANCH_RIDING], entries=[SHOW_ENTRY])
    assert billed_pots([pot], SHOW_ENTRY) == [pot]


def test_a_settled_pot_still_charges_the_people_who_were_in_it():
    """Its payouts were funded by these buy-ins. Dropping the charge would pay
    out money the show never billed for."""
    pot = make_pot(classes=[RANCH_RIDING], entries=[SHOW_ENTRY], status="settled")
    assert billed_pots([pot], SHOW_ENTRY) == [pot]


def test_a_closed_pot_still_charges():
    pot = make_pot(classes=[RANCH_RIDING], entries=[SHOW_ENTRY], status="closed")
    assert billed_pots([pot], SHOW_ENTRY) == [pot]


def test_nobody_on_the_roster_is_billed_nothing():
    """A walk-up with no `show_entries` row yet reads as None, not as everybody."""
    pots = [make_pot(classes=[RANCH_RIDING], entries=[SHOW_ENTRY])]
    assert billed_pots(pots, None) == []


# ── What the lines say ───────────────────────────────────────────────────────

def test_one_line_per_pot_whatever_its_class_count():
    """Membership hangs off the roster row, so a pot bundling six classes is one
    buy-in — not one per class entered."""
    pot = make_pot(classes=[RANCH_RIDING, RANCH_TRAIL], entries=[SHOW_ENTRY], fee=2500)
    lines, total = side_pot_lines([pot])
    assert len(lines) == 1
    assert total == 2500
    assert lines[0]["class_count"] == 2


def test_two_pots_are_two_buy_ins():
    pots = [
        make_pot(name="Ranch Jackpot", classes=[RANCH_RIDING], entries=[SHOW_ENTRY], fee=2500),
        make_pot(name="Trail Jackpot", classes=[RANCH_TRAIL], entries=[SHOW_ENTRY], fee=1000),
    ]
    lines, total = side_pot_lines(pots)
    assert total == 3500
    assert [l["name"] for l in lines] == ["Ranch Jackpot", "Trail Jackpot"]


def test_lines_are_name_sorted_so_a_bill_does_not_reshuffle():
    pots = [
        make_pot(name="Trail Jackpot", entries=[SHOW_ENTRY]),
        make_pot(name="Ranch Jackpot", entries=[SHOW_ENTRY]),
    ]
    lines, _ = side_pot_lines(pots)
    assert [l["name"] for l in lines] == ["Ranch Jackpot", "Trail Jackpot"]


def test_no_pots_is_no_lines_and_no_money():
    assert side_pot_lines([]) == ([], 0)


def test_the_line_carries_the_status_so_a_settled_pot_can_say_so():
    pot = make_pot(entries=[SHOW_ENTRY], status="settled")
    lines, _ = side_pot_lines([pot])
    assert lines[0]["status"] == "settled"


# ── The rollup index ─────────────────────────────────────────────────────────

def test_the_index_keys_every_member_of_every_pot():
    """Financials builds an account per exhibitor; one pass over the pots beats
    a `billed_pots` call each."""
    pot = make_pot(classes=[RANCH_RIDING], entries=[SHOW_ENTRY, OTHER_ENTRY])
    index = pot_bill_index([pot])
    assert index[SHOW_ENTRY] == [pot]
    assert index[OTHER_ENTRY] == [pot]


def test_the_index_agrees_with_billed_pots():
    pots = [
        make_pot(name="A", entries=[SHOW_ENTRY]),
        make_pot(name="B", entries=[OTHER_ENTRY]),
        make_pot(name="C", entries=[SHOW_ENTRY, OTHER_ENTRY]),
    ]
    index = pot_bill_index(pots)
    assert index.get(SHOW_ENTRY, []) == billed_pots(pots, SHOW_ENTRY)
    assert index.get(OTHER_ENTRY, []) == billed_pots(pots, OTHER_ENTRY)


def test_a_pot_nobody_is_in_is_absent_rather_than_empty():
    assert pot_bill_index([make_pot()]) == {}
