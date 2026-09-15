"""What show staff say they are carded with, and how a corrected list is stored.

The incident behind this module: show-staff signup asked these questions on the
account form itself, and got them wrong twice over. The picker fetched
`/api/associations`, which requires a session that somebody creating an account
does not have yet -- so it 401'd and rendered an empty list for every person it
was ever shown to. And the one association the form did name, APHA, was named by
a certification lookup that **refused to submit** without a hit against APHA's
own list: an unverifiable claim turned into a hard stop, in an app that also
serves AQHA, ApHC, FQHR and unaffiliated shows.

So the questions moved behind the account, and `plan_certification_changes` is
the half that decides what a re-answered questionnaire writes.
"""
from uuid import uuid4

from staff_certifications import normalize_id_number, plan_certification_changes


# ── A blank is not an identifier ──────────────────────────────────────────────


def test_an_empty_number_is_stored_as_nothing():
    """An empty box and an untyped one mean the same thing. Storing `""` for one
    would have the desk render an identifier that is present and says nothing."""
    assert normalize_id_number("") is None
    assert normalize_id_number("   ") is None
    assert normalize_id_number(None) is None


def test_a_number_keeps_its_value_without_surrounding_space():
    assert normalize_id_number("  SM-4417 ") == "SM-4417"


# ── The list is replaced, not added to ────────────────────────────────────────


def test_unticking_an_association_removes_it():
    """The questionnaire shows every association at once, so unticking one is how
    somebody corrects a mistake -- with an add-only endpoint that correction
    would have nowhere to go."""
    apha, aqha = uuid4(), uuid4()

    plan = plan_certification_changes({apha: "A-1", aqha: "Q-2"}, [(apha, "A-1")])

    assert plan["remove"] == {aqha}
    assert plan["upsert"] == {apha: "A-1"}


def test_answering_none_clears_every_certification():
    """'No association' is a real answer -- plenty of shows run unaffiliated."""
    apha, wsca = uuid4(), uuid4()

    plan = plan_certification_changes({apha: "A-1", wsca: None}, [])

    assert plan["remove"] == {apha, wsca}
    assert plan["upsert"] == {}


def test_a_first_answer_creates_every_row():
    apha, nsba = uuid4(), uuid4()

    plan = plan_certification_changes({}, [(apha, "A-1"), (nsba, None)])

    assert plan["remove"] == set()
    assert plan["upsert"] == {apha: "A-1", nsba: None}


def test_correcting_a_number_keeps_the_association():
    """The row is updated rather than dropped and rebuilt — the id number is the
    only thing that changed."""
    apha = uuid4()

    plan = plan_certification_changes({apha: "typo"}, [(apha, "A-1")])

    assert plan["remove"] == set()
    assert plan["upsert"] == {apha: "A-1"}


def test_clearing_only_the_number_keeps_the_certification():
    """Somebody is certified whether or not they have the card to hand. Emptying
    the box must not read as unticking the association."""
    apha = uuid4()

    plan = plan_certification_changes({apha: "A-1"}, [(apha, "")])

    assert plan["remove"] == set()
    assert plan["upsert"] == {apha: None}


# ── A repeated association is one row ─────────────────────────────────────────


def test_the_same_association_twice_is_one_row_last_one_winning():
    """The unique constraint is on (user_id, association_id), and a client that
    sent the same body twice meant one certification rather than an error."""
    apha = uuid4()

    plan = plan_certification_changes({}, [(apha, "first"), (apha, "second")])

    assert plan["upsert"] == {apha: "second"}


# ── Breed and club are the same fact here ─────────────────────────────────────


def test_breed_registries_and_clubs_are_not_told_apart():
    """A manager carded by APHA and approved by WSCA holds two certifications,
    and this module has no reason to rank them. The split is the picker's, so a
    reader can find the row they are looking for."""
    apha, wsca, mnsphc = uuid4(), uuid4(), uuid4()

    plan = plan_certification_changes({}, [(apha, "A-1"), (wsca, None), (mnsphc, "M-9")])

    assert plan["remove"] == set()
    assert set(plan["upsert"]) == {apha, wsca, mnsphc}
