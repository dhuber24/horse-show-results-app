"""Three things registration was letting through, and what now stops them.

Each one is a rule the app already held somewhere and was not applying:

* A show that bans outside shavings took sign-ups with no bedding at all,
  because the ban and the fee's `min_quantity` are the same requirement written
  down twice and only the second was enforced.
* A Grand & Reserve Champion class sat in the exhibitor's class picker, priced
  at nought, waiting for anybody who scrolled far enough -- when the only way
  into one is to place first or second in a qualifying class.
* A horse could be taken off a profile while it was entered in classes at a
  show still to come, leaving the exhibitor billed for entries on a horse that
  had vanished from every picker they could reach.
"""
from types import SimpleNamespace
from uuid import uuid4

import pytest

from reservations import minimum_shortfall, required_quantity, stalls_reserved
from rules.disciplines import entered_by_qualification


# -- The bedding floor -------------------------------------------------------

def _fee(unit, *, min_quantity=0, label="Shavings"):
    return SimpleNamespace(id=uuid4(), unit=unit, min_quantity=min_quantity, label=label)


def _show(*, ban=False):
    return SimpleNamespace(shavings_ban_outside=ban)


def test_a_show_with_no_policy_and_no_minimum_requires_nothing():
    """Every show before this, and most shows after it."""
    bag = _fee("per_bag")
    stall = _fee("per_stall", label="Horse stall")

    assert minimum_shortfall([bag, stall], show=_show(), requested={stall.id: 2}) is None


def test_banning_outside_shavings_requires_bedding_from_anybody_stabling():
    """The bug this exists for.

    The MNSPHC show bill says outside shavings are not allowed and the show
    sells bags -- and `min_quantity` was 0, so the sign-up went through with no
    bedding booked at all. The ban *is* the requirement; it just was not the
    column anybody was reading.
    """
    bag = _fee("per_bag")
    stall = _fee("per_stall", label="Horse stall")

    short = minimum_shortfall([bag, stall], show=_show(ban=True), requested={stall.id: 2})

    assert short is not None
    fee, floor, booked = short
    assert fee is bag
    assert (floor, booked) == (1, 0)


def test_a_line_left_out_entirely_is_a_line_booked_at_nought():
    """Checked against the fee catalogue, not against the lines that were sent.

    Omitting the bedding line is the easiest way to book none of it, and a
    range check over `body.reservations` cannot see a line that is not in it.
    """
    bag = _fee("per_bag", min_quantity=4)
    stall = _fee("per_stall", label="Horse stall")

    short = minimum_shortfall([bag, stall], show=_show(), requested={stall.id: 1})

    assert short is not None and short[0] is bag


def test_zero_is_below_the_floor_rather_than_an_answer_to_it():
    bag = _fee("per_bag", min_quantity=2)

    short = minimum_shortfall([bag], show=_show(), requested={bag.id: 0})

    assert short is not None and short[1] == 2


def test_a_day_haul_entry_with_no_stall_owes_no_bedding():
    """A ban on outside shavings is about what goes in a stall. Somebody who
    ships in on the Saturday, shows, and goes home has nothing to bed -- and
    charging them for a bag they cannot use is the requirement misfiring in the
    one direction nobody can argue out of at the desk."""
    bag = _fee("per_bag")
    stall = _fee("per_stall", label="Horse stall")

    assert minimum_shortfall([bag, stall], show=_show(ban=True), requested={}) is None


def test_dropping_to_no_stalls_drops_the_bedding_requirement_with_it():
    """Which is why the floor is computed from the booking in hand rather than
    seeded once when the form opens."""
    bag = _fee("per_bag")
    stall = _fee("per_stall", label="Horse stall")

    with_stall = required_quantity(bag, show=_show(ban=True), stalls=1)
    without = required_quantity(bag, show=_show(ban=True), stalls=0)

    assert (with_stall, without) == (1, 0)


def test_an_explicit_minimum_beats_the_derived_one():
    """The show has said something more specific than "some", and the
    derivation must not talk it down to a single bag."""
    bag = _fee("per_bag", min_quantity=4)

    assert required_quantity(bag, show=_show(ban=True), stalls=2) == 4


def test_stalls_are_counted_across_every_stall_line():
    """A show sells a horse stall, a tack stall and early arrival separately.
    Any of them means the exhibitor is stabling here."""
    horse_stall = _fee("per_stall", label="Horse stall")
    tack = _fee("per_stall", label="Tack stall")

    assert stalls_reserved([horse_stall, tack], {tack.id: 1}) == 1


def test_the_ban_does_not_put_a_floor_on_anything_but_bedding():
    """It is a rule about shavings. A camping spot is not bedding."""
    camping = _fee("per_night", label="Camping")
    stall = _fee("per_stall", label="Horse stall")

    assert minimum_shortfall(
        [camping, stall], show=_show(ban=True), requested={stall.id: 1, camping.id: 0}
    ) is None


# -- Classes you qualify into ------------------------------------------------

@pytest.mark.parametrize(
    "name",
    [
        "Grand & Reserve Amateur Stallions",
        "Youth Grand & Reserve Geldings",
        "Grand and Reserve Mares",
        "Grand Champion Mares",
        "Reserve Champion Gelding",
        "Performance Grand Champion",
    ],
)
def test_a_championship_class_is_not_entered(name):
    """Every one of these is on a real MNSPHC schedule, priced at $0, and was
    sitting in the exhibitor's class picker."""
    assert entered_by_qualification(name) is True


@pytest.mark.parametrize(
    "name",
    [
        "Western Pleasure",
        "Ranch Trail",
        # Deliberately narrow. "Champion" on its own is not enough: a Hi-Point
        # champion is an award rather than a class, and a show is entitled to
        # name an ordinary class something with the word in it.
        "Hi-Point Champion",
        "Championship Trail",
        # Not a class at all, and the substring is a trap worth pinning.
        "Reserved Stall",
        "",
        None,
    ],
)
def test_an_ordinary_class_is_left_alone(name):
    assert entered_by_qualification(name) is False
