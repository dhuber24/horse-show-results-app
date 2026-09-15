"""Which memberships and papers a show may ask somebody to produce.

The incident these pin: at the registration desk, an **Open show with no club
sanctioning** listed APHA, WSCA and MNSPHC membership sign-offs for the
exhibitor and four registration sign-offs for the horse, and counted every one
of them in that exhibitor's outstanding total. None of them were that show's
business, and none of them could ever be cleared by anybody working it.

An exhibitor's profile carries every card they hold and a horse carries every
body it is papered with, because both belong to the person and the animal
rather than to a weekend. What the office may ask for is the intersection with
the bodies the show actually runs under -- which `exhibitor_profile` and
`horse_eligibility` had always used, and the desk had not.
"""
from types import SimpleNamespace
from uuid import uuid4

from show_associations import asked_of


def _reg(association_id):
    return SimpleNamespace(association_id=association_id)


# ── What the show may ask about ───────────────────────────────────────────────


def test_a_show_asks_only_about_the_bodies_it_runs_under():
    apha, aqha, nsba = uuid4(), uuid4(), uuid4()
    held = [_reg(apha), _reg(aqha), _reg(nsba)]

    asked = asked_of(held, {apha})

    assert [r.association_id for r in asked] == [apha]


def test_an_open_show_with_no_clubs_asks_about_nothing():
    """There is deliberately no `associations` row for OPEN, so the show's list
    is empty -- and an empty list means *nothing to ask for*, never everything.
    This is the case that put three unclearable sign-offs in front of the desk."""
    assert asked_of([_reg(uuid4()), _reg(uuid4())], set()) == []


def test_a_dual_sanctioned_show_asks_about_each_of_its_bodies():
    """A breed body plus its clubs: the exhibitor produces a card for each."""
    apha, wsca, mnsphc, aqha = uuid4(), uuid4(), uuid4(), uuid4()
    held = [_reg(apha), _reg(aqha), _reg(wsca), _reg(mnsphc)]

    asked = asked_of(held, {apha, wsca, mnsphc})

    assert {r.association_id for r in asked} == {apha, wsca, mnsphc}


def test_a_body_the_show_runs_under_that_nobody_holds_adds_no_row():
    """The list is built from what is on file. A missing APHA card is the
    registration screen's prompt and the horse picker's flag, not a desk
    sign-off against a number nobody has typed in."""
    assert asked_of([], {uuid4()}) == []
