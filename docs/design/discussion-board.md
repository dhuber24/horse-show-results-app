# A Show's Discussion Board

Read before changing the discussion board: who may post, how a poster is named, anonymity, moderation, the profanity filter, or the board's page. The Contact form, the private way to reach the show office, is in `routers/show_contact.py`; the marquee, the office's one line on the lobby TV, is in [live-boards-and-high-point.md](live-boards-and-high-point.md).

One claim per bullet, the claim first. Add new ones under the heading they belong to.

## Key Files

| Area | File |
| --- | --- |
| The rules, the endpoints, the throttle | `backend/routers/show_board.py` |
| The words the board refuses | `backend/profanity.py` |
| The tables | `database/migrations/183_show_discussion_board.sql` (`show_board_posts`, `show_boards`) |
| The page, for everybody, with the office's controls on it | `frontend/app/shows/[id]/board/page.tsx`, `DiscussionBoard.tsx` |
| Types, labels and the little the screen works out | `frontend/lib/show-board.ts` |
| Route handlers (session forwarded when there is one) | `frontend/app/api/shows/[showId]/board/` |

## What it is

- **A public board per show, on every plan** (migration 183; the owner's call, 2026-11-07). Questions, callouts, show updates, lost & found: things the people at a show say to each other, where everybody at the rail can read them on a phone. Neither the marquee (office only, one line) nor the Contact form (private, to the office) did that.
- **Anybody may read it and anybody may post**: a visitor with no account, an exhibitor, a trainer, the show office. It is a tile on the show's hub (`lib/show-hub.ts`, beside *Message the Show Office*) and a public-screen tile on the office's menu (`sections.ts`).
- **Readable at a PUBLISHED, ACTIVE or COMPLETED show, and posted to until the show is over.** A finished show's board is read-only, since nobody is watching it any longer to moderate. A DRAFT show's board is a 404, the same answer as no such show, so a stranger cannot learn which drafts exist.
- **One level of replies.** A reply to a reply is refused (422): a thread a phone has to indent twice is one nobody at the rail can follow. A reply has no category of its own.

## Who a post is shown as

- **Who wrote a post comes from the session, never the body**, the way the Contact form stamps its sender (migration 103). The route handler forwards the session when there is one. The body carries the words, the category and the anonymous tick, and nothing a browser sends can make a post read "Show Office".
- **The badge is a snapshot of what the poster was at this show when they posted** (`author_kind`, `author_name`): GaitDesk (an ADMIN), Show Office (works the show, through `show_access.works_show`), Exhibitor (on this show's roster, `is_on_roster`), Trainer, or none (any other account, and a visitor). Somebody who leaves the company keeps the badge on what they said for it. An entrant who is also a trainer reads Exhibitor, because at the show their back number is what the rail knows them by.
- **An exhibitor's back number is read when the board is read, not stored**, through `back_numbers_for_show`. A number issued after the post is still the one they wear.
- **Staff at a show frozen by an unpaid Pro+ renewal post without the Show Office badge, and cannot moderate.** A frozen show refuses its office; the board, like every public page, is never frozen.

## Anonymity

- **An anonymous post names its author to a GaitDesk admin and to nobody else, the show office included** (the owner's call, 2026-11-07). People asking about the office, or a judge, would not feel anonymous otherwise. The office can still hide the post without knowing who wrote it.
- **The account is still recorded on an anonymous post** (`author_user_id`), so an admin can deal with abuse. An admin reading the board is sent `author.revealed` on each anonymous post; `serialize_post` sends it to nobody else, and `test_show_board.py` pins that for the public, the office and the author.
- **The author is still told a post is theirs** (`is_mine`), so they can delete it. That goes only to the author's own session.
- **A visitor has no anonymous to choose.** Their post already reads "Visitor", and a CHECK refuses an anonymous visitor row.

## Moderation

- **Posts go up at once; the show office moderates afterwards** (the owner's call). It hides and unhides posts, and pins a thread to the top (`PATCH .../posts/{id}`, `_assert_show_access`). A reply cannot be pinned.
- **Hiding is not deleting.** A hidden post is sent to a moderator marked *Hidden* and to nobody else, and a hidden thread takes its replies with it. Unhiding puts it back as it was.
- **There is no separate office screen.** The office moderates on the public page: the backend sends a moderator what it hid, and the page offers Hide and Pin beside each post. One page means the office sees the board exactly as the rail does.
- **The office's one setting is who may post** (`show_boards.mode`, `PUT .../settings`): open to anybody (no row), signed-in accounts only, or closed to new posts. What is already up stays up. A visitor at a signed-in-only board gets a 401 and a sign-in link; a closed board is a 403 for everybody.
- **An author with an account may delete their own post**; a visitor cannot, since nothing ties a visitor's post to them. A deleted post with replies under it stays as a placeholder ("The author deleted this post"), so an answer is not left under nothing; without replies it is gone.

## The profanity filter

- **A post carrying a refused word is refused with the word named, and never saved** (`profanity.py`, the owner's request). Not starred out: nothing offensive is stored, and the poster sees exactly what to reword.
- **It is a first line, not moderation.** It sees through capitals, `$h1t`, `fuuuuck` and `f.u.c.k`, and nothing cleverer. Hiding a post deals with the rest.
- **It must never refuse ordinary show talk, so it matches whole words.** Matching inside words is how "Scunthorpe" gets refused. Only stems that occur in no innocent word (`ANYWHERE`) are found inside one. Endings are allowed only where no innocent word results ("spic" takes none, for "spicy").
- **Words a horse show uses for a living, or says at the rail, are deliberately absent**: *ass* and *jackass* (donkeys), *cock*, *dick*, *hell*, *damn*, *chink*. `test_profanity.py` keeps a list of ordinary posts that must pass. Add to it before adding a word.

## Throttling

- **Six posts a minute per account, and thirty a minute for all visitors together** (`PostThrottle`). Every request reaches the API from the Next server's one address (see "Rate limits" in [auth.md](../auth.md)), so keying on the address would throttle the whole show as one caller. An account is a trusted key, from the session; a visitor has none.
- **In memory, per process.** It is a burst limit, not an audit, and a restart forgets it.
- **Somebody flooding the visitors' budget is what *Signed-in only* is for.** One visitor can use up the shared budget for every other visitor; the office answers that by closing the board to visitors.

## The page

- **Rendered with the first page in it, then polled from the browser every 10 seconds** while the tab is in view, like the Gate Board, and at once when the reader comes back to the tab. A failed poll keeps the board and says *Not updating — retrying*.
- **Fifty threads a page, pinned threads above them on the first.** Older pages are loaded by hand (`?before=`) and kept beneath the polled first page (`combineThreads`), so a thread pinned since is not shown twice.
- **Who the composer posts as is asked for on the first load only** (`with_viewer`), not on every poll.
- **Times print through `LocalTime`**, in the reader's own zone.
