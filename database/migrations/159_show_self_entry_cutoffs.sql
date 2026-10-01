-- 159: two questions the show office answers for every show, about what an
-- exhibitor may do online and until when.
--
-- 1. **The last day to sign up online.** This is `shows.entry_deadline`, which
--    already existed (migration 123) and which this migration gives a job. It
--    was "records only": the day entries close, used to count APHA SC-090's
--    approval deadline back from, and deliberately wired to nothing else. The
--    show office now answers it as the day online sign-up closes -- after it,
--    somebody not yet signed up is entered by the office at the desk -- which is
--    what a show bill's "entries close" has always meant, and what the show bill
--    import already reads into this column. One column rather than a second
--    date beside it, because two days that could disagree about when entries
--    close is one too many. It still bills nothing: the post-entry fee is not
--    tied to it.
--
-- 2. **How late an exhibitor may enter and scratch their own classes**:
--    `self_entry_closes`.
--      class_start -- until each class starts, while the show runs too (what
--                     every show did before this; a horse can still be
--                     scratched from a class under way until it has run).
--      show_start  -- until the show starts; once it is under way, entries and
--                     scratches are the show office's.
--    NULL is not answered yet, and reads as class_start -- what the app did the
--    day before this column -- so no show that is already taking entries
--    changes under anybody.
--
-- Neither is required by a constraint: a show is built over several sittings,
-- and the show bill import creates one before anybody has been asked. Both are
-- required to **publish** (`routers/shows.update_show`), which is when either
-- starts to mean anything.
--
-- Per show, unlike the self-cancel cut-off on the company (migration 157): the
-- sign-up deadline is a date, which only a show has, and whether exhibitors
-- manage their own classes while the show runs is a call about that weekend's
-- office.
--
-- A nullable column, a CHECK and comments: backward-compatible, so it goes to
-- production before the code.

BEGIN;

ALTER TABLE shows ADD COLUMN IF NOT EXISTS self_entry_closes TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_shows_self_entry_closes'
    ) THEN
        ALTER TABLE shows
            ADD CONSTRAINT ck_shows_self_entry_closes
            CHECK (self_entry_closes IN ('class_start', 'show_start'));
    END IF;
END $$;

COMMENT ON COLUMN shows.entry_deadline IS 'The last day exhibitors may sign up for the show online (inclusive); after it the show office signs them up at the desk. Also what APHA SC-090.C counts the approval deadline back from. NULL: not answered -- sign-up stays open until the show starts. Required to publish (migration 159).';

COMMENT ON COLUMN shows.self_entry_closes IS 'How late exhibitors may enter and scratch their own classes: class_start (until each class starts, while the show runs too) or show_start (until the show starts). NULL: not answered, read as class_start. Required to publish (migration 159).';

INSERT INTO _migrations (name) VALUES ('159_show_self_entry_cutoffs.sql')
ON CONFLICT DO NOTHING;

COMMIT;
