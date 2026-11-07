"""A show's discussion board (migration 183).

The people at a show had no way to talk to each other where everybody could
read it: the marquee is the office's one line on a TV, and the Contact form goes
to the office alone. The board is public -- anybody may read it, on every plan
(the owner's call, 2026-11-07) -- and anybody may post: a visitor with no
account, an exhibitor, a trainer, the show office.

**Who wrote a post comes from the session, never the body,** the way the
Contact form stamps its sender (`routers/show_contact.py`, migration 103). The
route handler forwards the session when there is one; the poster's name, badge
and back number are worked out here (`author_kind_for`). Nothing a browser sends
can make a post read "Show Office".

**Anonymous hides the poster from everybody but a GaitDesk admin** (the owner's
call). The account is still recorded, so an admin can deal with abuse; the show
office sees "Anonymous" like everybody else, because people asking about the
office -- or a judge -- would not feel anonymous otherwise. The office can still
hide the post. A visitor is already nameless, so has no anonymous to choose.

**Posts go up at once; the office moderates afterwards** (the owner's call):
it hides and unhides posts, pins its own announcements to the top, and sets the
board open to anybody, open to signed-in accounts only, or closed to new posts
(`show_boards`). A post carrying a word `profanity.py` refuses is never saved.

**One level of replies.** A reply to a reply is refused: a thread a phone has to
indent twice is one nobody at the rail can follow.

**Throttled per account, and visitors as one.** The API sees every request from
the Next server's one address (see "Rate limits" in `docs/auth.md`), so keying
on the address would throttle the whole show as one caller. An account is a
trusted key, from the session; a visitor has none, so every visitor shares one
budget. Somebody flooding that budget is what *signed-in only* is for.

The request and response models live here, as `routers/show_marquee.py` keeps
its own: nothing else in the app reads a board post.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Iterable, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backnumbers import back_numbers_for_show
from cancellations import is_on_roster
from database import get_db
from dependencies import require_admin_or_show_admin, require_api_key, require_authenticated, safe_uuid
from models import Exhibitor, Show, ShowBoard, ShowBoardPost, ShowEntry, User
from profanity import find_profanity, refusal_message
from routers.shows import _assert_show_access
from show_access import works_show
from show_companies import ALL_FEATURE_ROLES, show_freeze

router = APIRouter(prefix="/shows/{show_id}/board", tags=["Discussion Board"])

# A board is read wherever the show's other public pages are: not a DRAFT.
READABLE_STATUSES = ("PUBLISHED", "ACTIVE", "COMPLETED")
# And posted to until the show is over. A finished show's board stays up to be
# read, but nobody is watching it any more to moderate a new post.
POSTABLE_STATUSES = ("PUBLISHED", "ACTIVE")

BoardMode = Literal["open", "signed_in", "closed"]
Category = Literal["general", "question", "callout", "update", "lost_found"]
AuthorKind = Literal["visitor", "member", "exhibitor", "trainer", "office", "gaitdesk"]

# Matches ck_show_board_posts_body_length.
MAX_BODY_CHARS = 2000
THREADS_PER_PAGE = 50

# The badge printed beside a poster's name. A member -- an account that is
# none of the others here -- and a visitor get none.
BADGES: dict[str, Optional[str]] = {
    "gaitdesk": "GaitDesk",
    "office": "Show Office",
    "exhibitor": "Exhibitor",
    "trainer": "Trainer",
    "member": None,
    "visitor": None,
}


# ── Rules ────────────────────────────────────────────────────────────────────

def author_kind_for(role: Optional[str], is_office: bool, on_roster: bool) -> str:
    """What a poster is at this show, for their badge.

    `role` is None for a visitor. `is_office` is whether they work this show
    *and* may do so today -- a show frozen by an unpaid renewal refuses its
    office, so its staff post without the badge. An exhibitor on this show's
    roster is an Exhibitor before a Trainer: at the show, their back number is
    what the rail knows them by.
    """
    if role is None:
        return "visitor"
    if role == "ADMIN":
        return "gaitdesk"
    if is_office:
        return "office"
    if on_roster:
        return "exhibitor"
    if role == "TRAINER":
        return "trainer"
    return "member"


def posting_refusal(show_status: str, mode: str, signed_in: bool) -> Optional[tuple[int, str]]:
    """(status, why) when this reader may not post right now, in the words the
    board prints, or None when they may. Signing in would answer a 401; a 403
    is the same for everybody."""
    if show_status not in POSTABLE_STATUSES:
        return 403, "This show is over, so its board is read-only."
    if mode == "closed":
        return 403, "The show office has closed the board to new posts."
    if mode == "signed_in" and not signed_in:
        return 401, "The show office has asked everybody to sign in to post."
    return None


def clean_body(raw: str) -> str:
    """The post as stored: trimmed, with runs of blank lines kept to one, or a
    422 saying what is wrong with it."""
    lines = [line.rstrip() for line in raw.strip().splitlines()]
    kept: list[str] = []
    for line in lines:
        if line == "" and kept and kept[-1] == "":
            continue
        kept.append(line)
    body = "\n".join(kept)
    if not body:
        raise HTTPException(422, "Write something to post.")
    if len(body) > MAX_BODY_CHARS:
        raise HTTPException(
            422,
            f"Keep a post to {MAX_BODY_CHARS} characters -- this one is {len(body)}.",
        )
    words = find_profanity(body)
    if words:
        raise HTTPException(422, refusal_message(words))
    return body


def author_view(post, back_number: Optional[int], reveal: bool) -> dict:
    """How the board names who wrote a post.

    `reveal` is for a GaitDesk admin: who is behind an anonymous post, so abuse
    can be dealt with. Nobody else is ever sent it, the show office included.
    """
    if post.is_anonymous:
        shown = {"name": "Anonymous", "badge": None, "back_number": None, "anonymous": True}
    elif post.author_kind == "visitor":
        shown = {"name": "Visitor", "badge": None, "back_number": None, "anonymous": False}
    else:
        shown = {
            "name": post.author_name or "GaitDesk member",
            "badge": BADGES.get(post.author_kind),
            "back_number": back_number if post.author_kind == "exhibitor" else None,
            "anonymous": False,
        }
    shown["revealed"] = (
        {
            "name": post.author_name,
            "badge": BADGES.get(post.author_kind),
            "user_id": str(post.author_user_id) if post.author_user_id else None,
        }
        if reveal and post.is_anonymous
        else None
    )
    return shown


@dataclass(frozen=True)
class Reader:
    """Who is reading the board, from the session."""

    user_id: Optional[UUID] = None
    role: Optional[str] = None
    can_moderate: bool = False

    @property
    def is_admin(self) -> bool:
        return self.role == "ADMIN"


def serialize_post(post, reader: Reader, back_numbers: dict) -> dict:
    deleted = post.deleted_at is not None
    return {
        "id": str(post.id),
        "parent_id": str(post.parent_id) if post.parent_id else None,
        "category": post.category,
        # A deleted post is only ever sent as the placeholder over its replies.
        "body": None if deleted else post.body,
        "created_at": post.created_at,
        "pinned": post.pinned_at is not None,
        "hidden": post.hidden_at is not None,
        "deleted": deleted,
        "author": (
            {"name": None, "badge": None, "back_number": None, "anonymous": False, "revealed": None}
            if deleted
            else author_view(post, back_numbers.get(post.author_exhibitor_id), reader.is_admin)
        ),
        "is_mine": (
            not deleted
            and reader.user_id is not None
            and post.author_user_id == reader.user_id
        ),
    }


def build_threads(tops: Iterable, replies: Iterable, reader: Reader, back_numbers: dict) -> list[dict]:
    """The threads a reader sees, in the order given, each with its replies
    oldest first.

    A hidden post is the moderator's to see, marked, and nobody else's -- and a
    hidden thread takes its replies with it. A post its author deleted is gone,
    unless replies hang off it: then it stays as a placeholder, so an answer is
    not left under nothing.
    """
    by_parent: dict = {}
    for reply in sorted(replies, key=lambda r: r.created_at):
        if reply.deleted_at is not None:
            continue
        if reply.hidden_at is not None and not reader.can_moderate:
            continue
        by_parent.setdefault(reply.parent_id, []).append(reply)

    threads = []
    for top in tops:
        if top.hidden_at is not None and not reader.can_moderate:
            continue
        its_replies = by_parent.get(top.id, [])
        if top.deleted_at is not None and not its_replies:
            continue
        thread = serialize_post(top, reader, back_numbers)
        thread["replies"] = [serialize_post(r, reader, back_numbers) for r in its_replies]
        threads.append(thread)
    return threads


class PostThrottle:
    """How often one account, or the visitors between them, may post.

    In memory, per process: a burst limit, not an audit. Restarting the API
    forgets it, which costs nothing worth keeping.
    """

    def __init__(
        self,
        per_account: int,
        visitors: int,
        window_seconds: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.per_account = per_account
        self.visitors = visitors
        self.window = window_seconds
        self.clock = clock
        self._hits: dict[str, deque] = {}

    def allow(self, user_id: Optional[UUID]) -> bool:
        key = f"user:{user_id}" if user_id else "visitors"
        limit = self.per_account if user_id else self.visitors
        now = self.clock()
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] >= self.window:
            hits.popleft()
        if len(hits) >= limit:
            return False
        hits.append(now)
        if len(self._hits) > 5000:
            # Accounts that posted once an hour ago need no entry.
            self._hits = {k: v for k, v in self._hits.items() if v and now - v[-1] < self.window}
        return True


# Six posts a minute is a busy person, not a slow one. The visitors' budget is
# shared by every visitor at the show at once.
throttle = PostThrottle(per_account=6, visitors=30)


# ── Database helpers ─────────────────────────────────────────────────────────

async def _readable_show_or_404(show_id: UUID, db: AsyncSession) -> Show:
    show = await db.get(Show, show_id)
    if not show or show.status not in READABLE_STATUSES:
        # One answer for "no such show" and "a draft": a stranger probing ids
        # must not learn which drafts exist.
        raise HTTPException(404, "Show not found")
    return show


async def _board_mode(show_id: UUID, db: AsyncSession) -> str:
    row = await db.get(ShowBoard, show_id)
    return row.mode if row else "open"


async def _reader(show_id: UUID, x_user_id: Optional[str], x_user_role: Optional[str], db: AsyncSession) -> Reader:
    user_id = safe_uuid(x_user_id) if x_user_id else None
    if user_id is None:
        return Reader()
    role = x_user_role or None
    can_moderate = await works_show(db, show_id, user_id, role)
    if can_moderate and role not in ALL_FEATURE_ROLES and await show_freeze(db, show_id):
        can_moderate = False
    return Reader(user_id=user_id, role=role, can_moderate=can_moderate)


async def _author(show_id: UUID, reader: Reader, db: AsyncSession) -> tuple[str, Optional[str], Optional[UUID]]:
    """(kind, name, exhibitor id) for whoever is posting."""
    if reader.user_id is None:
        return "visitor", None, None
    user = await db.get(User, reader.user_id)
    if user is None:
        return "visitor", None, None
    name = " ".join(part for part in (user.first_name, user.last_name) if part).strip() or user.full_name
    exhibitor = (
        await db.execute(select(Exhibitor).where(Exhibitor.user_id == reader.user_id))
    ).scalars().first()
    on_roster = False
    if exhibitor is not None:
        show_entry = (
            await db.execute(
                select(ShowEntry).where(ShowEntry.show_id == show_id, ShowEntry.exhibitor_id == exhibitor.id)
            )
        ).scalars().first()
        on_roster = is_on_roster(show_entry)
    kind = author_kind_for(reader.role, reader.can_moderate, on_roster)
    return kind, name, exhibitor.id if exhibitor else None


async def _back_numbers(show_id: UUID, posts: Iterable, db: AsyncSession) -> dict:
    """Back number per exhibitor who posted under their name here. Read now,
    not stored: a number issued after the post is still the one they wear."""
    wanted = {
        p.author_exhibitor_id
        for p in posts
        if p.author_kind == "exhibitor" and not p.is_anonymous and p.author_exhibitor_id
    }
    if not wanted:
        return {}
    numbers = await back_numbers_for_show(show_id, db)
    return {exhibitor_id: numbers.first_for_exhibitor(exhibitor_id) for exhibitor_id in wanted}


async def _post_in_show_or_404(show_id: UUID, post_id: UUID, db: AsyncSession) -> ShowBoardPost:
    post = await db.get(ShowBoardPost, post_id)
    if not post or post.show_id != show_id:
        raise HTTPException(404, "Post not found")
    return post


# ── Models ───────────────────────────────────────────────────────────────────

class PostCreate(BaseModel):
    # Bounded generously here and exactly in `clean_body`, which says so in words.
    body: str = Field(min_length=1, max_length=MAX_BODY_CHARS * 2)
    category: Category = "general"
    is_anonymous: bool = False
    parent_id: Optional[UUID] = None


class Moderation(BaseModel):
    hidden: Optional[bool] = None
    pinned: Optional[bool] = None


class BoardSettings(BaseModel):
    mode: BoardMode


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", dependencies=[Depends(require_api_key)])
async def read_board(
    show_id: UUID,
    before: Optional[datetime] = Query(default=None, description="Threads posted before this moment"),
    with_viewer: bool = Query(default=True, description="Also say who the reader would post as"),
    x_user_id: Optional[str] = Header(None),
    x_user_role: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """The board, newest threads first, pinned ones above them on the first
    page. Public: the route handler sends the session when there is one, which
    only changes what the reader may do, and for a moderator, that hidden
    posts are shown to them marked."""
    show = await _readable_show_or_404(show_id, db)
    mode = await _board_mode(show_id, db)
    reader = await _reader(show_id, x_user_id, x_user_role, db)

    def visible(query):
        if not reader.can_moderate:
            query = query.where(ShowBoardPost.hidden_at.is_(None))
        return query

    tops_query = visible(
        select(ShowBoardPost).where(
            ShowBoardPost.show_id == show_id,
            ShowBoardPost.parent_id.is_(None),
            ShowBoardPost.pinned_at.is_(None),
        )
    )
    if before is not None:
        tops_query = tops_query.where(ShowBoardPost.created_at < before)
    page = list(
        (
            await db.execute(
                tops_query.order_by(ShowBoardPost.created_at.desc()).limit(THREADS_PER_PAGE + 1)
            )
        ).scalars().all()
    )
    has_more = len(page) > THREADS_PER_PAGE
    page = page[:THREADS_PER_PAGE]

    pinned = []
    if before is None:
        pinned = list(
            (
                await db.execute(
                    visible(
                        select(ShowBoardPost).where(
                            ShowBoardPost.show_id == show_id,
                            ShowBoardPost.parent_id.is_(None),
                            ShowBoardPost.pinned_at.is_not(None),
                        )
                    ).order_by(ShowBoardPost.pinned_at.desc())
                )
            ).scalars().all()
        )

    tops = pinned + page
    replies = []
    if tops:
        replies = list(
            (
                await db.execute(
                    visible(
                        select(ShowBoardPost).where(ShowBoardPost.parent_id.in_([t.id for t in tops]))
                    )
                )
            ).scalars().all()
        )

    back_numbers = await _back_numbers(show_id, tops + replies, db)
    signed_in = reader.user_id is not None
    refusal = posting_refusal(show.status, mode, signed_in)

    # Who the composer says they will post as -- asked for on the first load
    # only, not on every poll.
    posting_as = None
    if with_viewer and signed_in:
        kind, name, exhibitor_id = await _author(show_id, reader, db)
        number = None
        if kind == "exhibitor" and exhibitor_id:
            number = (await back_numbers_for_show(show_id, db)).first_for_exhibitor(exhibitor_id)
        posting_as = {"name": name, "badge": BADGES.get(kind), "back_number": number}

    return {
        "show_status": show.status,
        "mode": mode,
        "can_post": refusal is None,
        "posting_refusal": refusal[1] if refusal else None,
        "signed_in": signed_in,
        "posting_as": posting_as,
        "can_moderate": reader.can_moderate,
        "threads": build_threads(tops, replies, reader, back_numbers),
        "has_more": has_more,
        "next_before": page[-1].created_at if has_more and page else None,
    }


@router.post("/posts", status_code=201, dependencies=[Depends(require_api_key)])
async def create_post(
    show_id: UUID,
    body: PostCreate,
    x_user_id: Optional[str] = Header(None),
    x_user_role: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Post to the board, or reply to a post. No session needed: a visitor
    posts as "Visitor". The session, when there is one, decides the name and
    badge -- nothing in the body can."""
    show = await _readable_show_or_404(show_id, db)
    reader = await _reader(show_id, x_user_id, x_user_role, db)
    signed_in = reader.user_id is not None

    refusal = posting_refusal(show.status, await _board_mode(show_id, db), signed_in)
    if refusal:
        raise HTTPException(*refusal)

    text = clean_body(body.body)

    category = body.category
    if body.parent_id is not None:
        parent = await db.get(ShowBoardPost, body.parent_id)
        if (
            not parent
            or parent.show_id != show_id
            or parent.deleted_at is not None
            or (parent.hidden_at is not None and not reader.can_moderate)
        ):
            raise HTTPException(404, "That post is no longer on the board.")
        if parent.parent_id is not None:
            raise HTTPException(422, "Reply to the post at the top of the thread.")
        # A reply belongs to its thread; it carries no category of its own.
        category = "general"

    if not throttle.allow(reader.user_id):
        raise HTTPException(
            429,
            "You've posted several times just now -- give it a minute and try again."
            if signed_in
            else "A lot of visitors are posting just now -- give it a minute, or sign in to post.",
        )

    kind, name, exhibitor_id = await _author(show_id, reader, db)
    post = ShowBoardPost(
        show_id=show_id,
        parent_id=body.parent_id,
        category=category,
        body=text,
        # A visitor has no name to withhold.
        is_anonymous=body.is_anonymous and kind != "visitor",
        author_user_id=reader.user_id if kind != "visitor" else None,
        author_exhibitor_id=exhibitor_id,
        author_kind=kind,
        author_name=name,
        created_at=datetime.now(timezone.utc),
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)
    back_numbers = await _back_numbers(show_id, [post], db)
    out = serialize_post(post, reader, back_numbers)
    out["replies"] = []
    return out


@router.delete("/posts/{post_id}", status_code=204)
async def delete_own_post(
    show_id: UUID,
    post_id: UUID,
    x_user_id: str = Depends(require_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Take your own post down. A visitor cannot -- nothing ties a visitor's
    post to them -- and asks the office to hide it instead."""
    await _readable_show_or_404(show_id, db)
    post = await _post_in_show_or_404(show_id, post_id, db)
    if post.author_user_id is None or post.author_user_id != safe_uuid(x_user_id):
        raise HTTPException(403, "Only the person who wrote a post can delete it.")
    if post.deleted_at is None:
        post.deleted_at = datetime.now(timezone.utc)
        await db.commit()


@router.patch("/posts/{post_id}", dependencies=[Depends(require_admin_or_show_admin)])
async def moderate_post(
    show_id: UUID,
    post_id: UUID,
    body: Moderation,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """The show office hides or unhides a post, or pins one to the top."""
    await _readable_show_or_404(show_id, db)
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    post = await _post_in_show_or_404(show_id, post_id, db)
    moderator = safe_uuid(x_user_id)
    now = datetime.now(timezone.utc)

    if body.pinned is not None:
        if post.parent_id is not None:
            raise HTTPException(422, "Only a post at the top of a thread can be pinned.")
        if body.pinned and post.pinned_at is None:
            post.pinned_at, post.pinned_by_user_id = now, moderator
        elif not body.pinned:
            post.pinned_at, post.pinned_by_user_id = None, None
    if body.hidden is not None:
        if body.hidden and post.hidden_at is None:
            post.hidden_at, post.hidden_by_user_id = now, moderator
        elif not body.hidden:
            post.hidden_at, post.hidden_by_user_id = None, None

    await db.commit()
    await db.refresh(post)
    reader = Reader(user_id=moderator, role=x_user_role, can_moderate=True)
    back_numbers = await _back_numbers(show_id, [post], db)
    return serialize_post(post, reader, back_numbers)


@router.put("/settings", dependencies=[Depends(require_admin_or_show_admin)])
async def set_board_settings(
    show_id: UUID,
    body: BoardSettings,
    x_api_key: str = Header(...),
    x_user_id: str = Header(...),
    x_user_role: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """Open the board to anybody, to signed-in accounts only, or close it to
    new posts. What is already posted stays up either way."""
    await _readable_show_or_404(show_id, db)
    await _assert_show_access(show_id, x_api_key, x_user_id, x_user_role, db)
    row = await db.get(ShowBoard, show_id)
    if row is None:
        row = ShowBoard(show_id=show_id)
        db.add(row)
    row.mode = body.mode
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by_user_id = safe_uuid(x_user_id)
    await db.commit()
    return {"mode": row.mode}
