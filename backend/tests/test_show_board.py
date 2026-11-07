"""The rules of a show's discussion board (migration 183).

Who a poster is shown as, who may post when, and what each reader is sent --
anonymity above all: an anonymous post names its author to a GaitDesk admin and
to nobody else, the show office included.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from routers.show_board import (
    MAX_BODY_CHARS,
    PostThrottle,
    Reader,
    author_kind_for,
    build_threads,
    clean_body,
    posting_refusal,
    serialize_post,
)

T0 = datetime(2026, 11, 7, 9, 0, tzinfo=timezone.utc)
SOMEBODY = uuid4()
EXHIBITOR = uuid4()


def post(**overrides) -> SimpleNamespace:
    fields = dict(
        id=uuid4(),
        parent_id=None,
        category="question",
        body="Is the warm-up pen open?",
        created_at=T0,
        pinned_at=None,
        hidden_at=None,
        deleted_at=None,
        is_anonymous=False,
        author_user_id=SOMEBODY,
        author_exhibitor_id=None,
        author_kind="member",
        author_name="Pat Rider",
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


PUBLIC = Reader()
OFFICE = Reader(user_id=uuid4(), role="SHOW_SECRETARY", can_moderate=True)
ADMIN = Reader(user_id=uuid4(), role="ADMIN", can_moderate=True)
AUTHOR = Reader(user_id=SOMEBODY, role="EXHIBITOR")


# ── Who a poster is at this show ─────────────────────────────────────────────

def test_nobody_signed_in_is_a_visitor():
    assert author_kind_for(None, False, False) == "visitor"


def test_a_gaitdesk_admin_is_gaitdesk_not_the_show_office():
    assert author_kind_for("ADMIN", True, False) == "gaitdesk"


def test_the_show_office_is_the_show_office_only_where_it_works_today():
    assert author_kind_for("SHOW_SECRETARY", True, False) == "office"
    # A secretary at somebody else's show, or at a frozen show, is a member.
    assert author_kind_for("SHOW_SECRETARY", False, False) == "member"


def test_an_entrant_is_an_exhibitor_before_a_trainer():
    assert author_kind_for("TRAINER", False, True) == "exhibitor"
    assert author_kind_for("TRAINER", False, False) == "trainer"
    assert author_kind_for("EXHIBITOR", False, False) == "member"


# ── Who may post when ────────────────────────────────────────────────────────

@pytest.mark.parametrize("status", ["PUBLISHED", "ACTIVE"])
def test_an_open_board_takes_anybodys_post(status):
    assert posting_refusal(status, "open", signed_in=False) is None


def test_a_finished_show_is_read_only_for_everybody():
    code, _ = posting_refusal("COMPLETED", "open", signed_in=True)
    assert code == 403


def test_a_closed_board_takes_no_posts_even_from_the_signed_in():
    code, _ = posting_refusal("ACTIVE", "closed", signed_in=True)
    assert code == 403


def test_signed_in_only_turns_a_visitor_away_with_a_401_and_lets_an_account_in():
    code, why = posting_refusal("ACTIVE", "signed_in", signed_in=False)
    assert code == 401 and "sign in" in why
    assert posting_refusal("ACTIVE", "signed_in", signed_in=True) is None


# ── What a post may say ──────────────────────────────────────────────────────

def test_a_post_is_trimmed_and_blank_lines_kept_to_one():
    assert clean_body("  Lost:\n\n\n\na grey halter   \n") == "Lost:\n\na grey halter"


@pytest.mark.parametrize("typed", ["", "   ", "\n\n"])
def test_an_empty_post_is_refused(typed):
    with pytest.raises(HTTPException) as refused:
        clean_body(typed)
    assert refused.value.status_code == 422


def test_a_post_at_the_limit_is_taken_and_one_over_is_refused():
    assert len(clean_body("a" * MAX_BODY_CHARS)) == MAX_BODY_CHARS
    with pytest.raises(HTTPException) as refused:
        clean_body("a" * (MAX_BODY_CHARS + 1))
    assert refused.value.status_code == 422


def test_profanity_is_refused_and_named():
    with pytest.raises(HTTPException) as refused:
        clean_body("this draw is sh1t")
    assert refused.value.status_code == 422
    assert "“shit”" in refused.value.detail


# ── Who a reader is told wrote it ────────────────────────────────────────────

def test_a_named_post_prints_its_name_and_badge():
    shown = serialize_post(post(author_kind="office", author_name="Jo Office"), PUBLIC, {})
    assert shown["author"]["name"] == "Jo Office"
    assert shown["author"]["badge"] == "Show Office"


def test_an_exhibitor_post_carries_the_back_number_they_wear_now():
    p = post(author_kind="exhibitor", author_exhibitor_id=EXHIBITOR)
    shown = serialize_post(p, PUBLIC, {EXHIBITOR: 42})
    assert shown["author"]["badge"] == "Exhibitor"
    assert shown["author"]["back_number"] == 42


def test_a_visitor_post_reads_visitor():
    shown = serialize_post(post(author_kind="visitor", author_user_id=None, author_name=None), PUBLIC, {})
    assert shown["author"]["name"] == "Visitor"
    assert shown["author"]["badge"] is None


@pytest.mark.parametrize("reader", [PUBLIC, OFFICE, AUTHOR], ids=["public", "show office", "author"])
def test_an_anonymous_post_names_nobody_to_anybody_but_an_admin(reader):
    p = post(is_anonymous=True, author_kind="exhibitor", author_exhibitor_id=EXHIBITOR)
    shown = serialize_post(p, reader, {EXHIBITOR: 42})
    assert shown["author"] == {
        "name": "Anonymous",
        "badge": None,
        "back_number": None,
        "anonymous": True,
        "revealed": None,
    }


def test_a_gaitdesk_admin_is_told_who_wrote_an_anonymous_post():
    p = post(is_anonymous=True, author_kind="exhibitor")
    revealed = serialize_post(p, ADMIN, {})["author"]["revealed"]
    assert revealed == {"name": "Pat Rider", "badge": "Exhibitor", "user_id": str(SOMEBODY)}


def test_the_author_is_told_a_post_is_theirs_even_when_anonymous():
    p = post(is_anonymous=True)
    assert serialize_post(p, AUTHOR, {})["is_mine"] is True
    assert serialize_post(p, PUBLIC, {})["is_mine"] is False


# ── What the board shows ─────────────────────────────────────────────────────

def test_replies_come_oldest_first_under_their_thread():
    top = post()
    later = post(parent_id=top.id, created_at=T0 + timedelta(minutes=5), body="Yes")
    sooner = post(parent_id=top.id, created_at=T0 + timedelta(minutes=1), body="Asking the office")
    threads = build_threads([top], [later, sooner], PUBLIC, {})
    assert [r["body"] for r in threads[0]["replies"]] == ["Asking the office", "Yes"]


def test_a_hidden_post_is_the_moderators_to_see_and_takes_its_replies_with_it():
    top = post(hidden_at=T0)
    reply = post(parent_id=top.id)
    assert build_threads([top], [reply], PUBLIC, {}) == []
    seen = build_threads([top], [reply], OFFICE, {})
    assert seen[0]["hidden"] is True and len(seen[0]["replies"]) == 1


def test_a_hidden_reply_is_dropped_for_the_public_only():
    top = post()
    reply = post(parent_id=top.id, hidden_at=T0)
    assert build_threads([top], [reply], PUBLIC, {})[0]["replies"] == []
    assert build_threads([top], [reply], OFFICE, {})[0]["replies"][0]["hidden"] is True


def test_a_deleted_post_is_gone_unless_replies_hang_off_it():
    lonely = post(deleted_at=T0)
    answered = post(deleted_at=T0)
    answer = post(parent_id=answered.id, author_kind="office", body="It's open")
    threads = build_threads([lonely, answered], [answer], PUBLIC, {})
    assert len(threads) == 1
    placeholder = threads[0]
    assert placeholder["deleted"] is True
    assert placeholder["body"] is None and placeholder["author"]["name"] is None
    assert placeholder["is_mine"] is False
    assert placeholder["replies"][0]["body"] == "It's open"


def test_a_deleted_reply_is_never_shown():
    top = post()
    assert build_threads([top], [post(parent_id=top.id, deleted_at=T0)], OFFICE, {})[0]["replies"] == []


# ── How often ────────────────────────────────────────────────────────────────

class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def test_an_account_gets_its_own_budget_and_it_refills():
    clock = Clock()
    throttle = PostThrottle(per_account=2, visitors=5, clock=clock)
    me, you = uuid4(), uuid4()
    assert throttle.allow(me) and throttle.allow(me)
    assert not throttle.allow(me)
    assert throttle.allow(you)
    clock.now = 61
    assert throttle.allow(me)


def test_visitors_share_one_budget():
    throttle = PostThrottle(per_account=2, visitors=3, clock=Clock())
    assert all(throttle.allow(None) for _ in range(3))
    assert not throttle.allow(None)
    # An account is not held up by the visitors.
    assert throttle.allow(uuid4())
