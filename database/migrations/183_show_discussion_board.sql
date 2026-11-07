-- 183: a discussion board for every show.
--
-- A show had two ways to talk: the office's marquee on the lobby TV (one line,
-- office only) and the Contact form (private, to the office only). Nothing let
-- the people at a show talk to each other -- "Is the warm-up pen open?", "Lost:
-- a grey halter near barn C", "Class 14 moved to Ring 2" -- where everybody at
-- the rail could read it on their phone.
--
-- `show_board_posts` is the board: anybody may post, an account or not, and a
-- signed-in poster may post anonymously. One level of replies (`parent_id`),
-- which the router enforces: a reply to a reply is refused, because a thread a
-- phone has to indent twice is one nobody at the rail can follow.
--
-- Who wrote a post is taken from the session on the server, never from the
-- body, the way the Contact form stamps its sender (migration 103):
--
--   author_user_id      the account, when there is one. Kept on an anonymous
--                       post so a GaitDesk admin can deal with abuse; the board
--                       shows nobody else, the show office included.
--   author_exhibitor_id the exhibitor record behind that account, so the board
--                       can print a back number beside an entrant's name.
--   author_kind         what the poster was *at this show* when they posted --
--                       visitor, member, exhibitor, trainer, office or gaitdesk.
--                       A snapshot, because "posted as the show office" is a
--                       fact about the moment: somebody who leaves the company
--                       must not take the badge off what they said for it.
--   author_name         the name printed, also a snapshot. NULL for a visitor.
--
-- Posts go up at once and the office moderates afterwards (the owner's call,
-- 2026-11-07): `hidden_at` takes a post off the board without deleting it, and
-- unhiding puts it back. A poster with an account may take their own post down
-- (`deleted_at`). Words the profanity filter refuses never reach this table.
--
-- `show_boards` is the office's one setting: open to anybody, open to signed-in
-- accounts only, or closed to new posts. No row is 'open'. Its own table, not a
-- column on `shows`, for migration 139's reason: it changes through the day,
-- setup never asks about it, and `_serialize` builds the show payload by hand.

BEGIN;

CREATE TABLE IF NOT EXISTS show_board_posts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id             UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    parent_id           UUID REFERENCES show_board_posts(id) ON DELETE CASCADE,
    category            TEXT NOT NULL,
    body                TEXT NOT NULL,
    is_anonymous        BOOLEAN NOT NULL,
    author_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    author_exhibitor_id UUID REFERENCES exhibitors(id) ON DELETE SET NULL,
    author_kind         TEXT NOT NULL,
    author_name         TEXT,
    pinned_at           TIMESTAMPTZ,
    pinned_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    hidden_at           TIMESTAMPTZ,
    hidden_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL
);

-- Stated apart from the CREATE TABLE: startup's `create_all` may build this
-- table from the model first, and then the CREATE above is skipped along with
-- anything written inside it (migration 114).
ALTER TABLE show_board_posts ALTER COLUMN category SET DEFAULT 'general';
ALTER TABLE show_board_posts ALTER COLUMN is_anonymous SET DEFAULT FALSE;
ALTER TABLE show_board_posts ALTER COLUMN created_at SET DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_board_posts_category') THEN
        ALTER TABLE show_board_posts
            ADD CONSTRAINT ck_show_board_posts_category
            CHECK (category IN ('general', 'question', 'callout', 'update', 'lost_found'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_board_posts_author_kind') THEN
        ALTER TABLE show_board_posts
            ADD CONSTRAINT ck_show_board_posts_author_kind
            CHECK (author_kind IN ('visitor', 'member', 'exhibitor', 'trainer', 'office', 'gaitdesk'));
    END IF;

    -- The router says so in words long before this fires.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_board_posts_body_length') THEN
        ALTER TABLE show_board_posts
            ADD CONSTRAINT ck_show_board_posts_body_length
            CHECK (char_length(body) BETWEEN 1 AND 2000);
    END IF;

    -- A visitor is already nameless; "anonymous" is a choice only somebody
    -- with a name to withhold can make.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_board_posts_visitor_not_anonymous') THEN
        ALTER TABLE show_board_posts
            ADD CONSTRAINT ck_show_board_posts_visitor_not_anonymous
            CHECK (author_kind <> 'visitor' OR NOT is_anonymous);
    END IF;
END $$;

-- The board reads a show's threads newest first, and each thread's replies.
CREATE INDEX IF NOT EXISTS idx_show_board_posts_threads
    ON show_board_posts (show_id, created_at DESC)
    WHERE parent_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_show_board_posts_parent
    ON show_board_posts (parent_id)
    WHERE parent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS show_boards (
    show_id            UUID PRIMARY KEY REFERENCES shows(id) ON DELETE CASCADE,
    mode               TEXT NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE show_boards ALTER COLUMN mode SET DEFAULT 'open';
ALTER TABLE show_boards ALTER COLUMN updated_at SET DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_boards_mode') THEN
        ALTER TABLE show_boards
            ADD CONSTRAINT ck_show_boards_mode
            CHECK (mode IN ('open', 'signed_in', 'closed'));
    END IF;
END $$;

COMMENT ON TABLE show_board_posts IS
    'A show''s public discussion board (migration 183): posts and one level of '
    'replies, by anybody, an account or not. Moderated after the fact by the show office.';
COMMENT ON COLUMN show_board_posts.author_user_id IS
    'The account that posted, from the session. Kept on an anonymous post for a '
    'GaitDesk admin only; never shown to the public or the show office.';
COMMENT ON COLUMN show_board_posts.author_kind IS
    'What the poster was at this show when they posted: visitor, member, exhibitor, '
    'trainer, office or gaitdesk. A snapshot, not re-derived.';
COMMENT ON TABLE show_boards IS
    'The show office''s setting for its board: open, signed_in (accounts only) or '
    'closed (read-only). No row means open.';

INSERT INTO _migrations (name) VALUES ('183_show_discussion_board.sql')
ON CONFLICT DO NOTHING;

COMMIT;
