-- 161: a back number per horse, for the shows that number horses rather than
-- people.
--
-- Until now a back number was the exhibitor's: one per exhibitor per show, on
-- `show_entries.back_number`. That is how most open and ranch shows run, and it
-- stays the default. But APHA SC-160.D says entry numbers are assigned to
-- *horses*, and the exhibitor wears the number of the horse being shown -- so
-- somebody who brings three horses wears three numbers over the weekend, and a
-- horse shown by a youth and then an amateur keeps one number for both. A show
-- run that way could not be set up here: the desk had one box per person.
--
-- 1. `shows.back_number_per` -- which of the two this show does:
--      exhibitor -- one number per exhibitor (`show_entries.back_number`), as
--                   every show did before this migration;
--      horse     -- one number per horse (`show_horse_numbers.back_number`).
--    NOT NULL DEFAULT 'exhibitor', so no show changes under anybody.
--
-- 2. `show_horse_numbers` -- one row per horse per show. Keyed on the horse, not
--    on the exhibitor and horse together: the rule numbers the horse, and two
--    riders of one horse wearing two numbers is precisely what it forbids.
--    `preferred_back_number` mirrors the column on `show_entries` (migration
--    104): what was asked for, as against what the show issued.
--    Its own table rather than columns on `show_entries`, because that row is
--    the exhibitor's and a horse may be shown by several of them.
--
-- The two kinds of number are never compared with each other: a show reads one
-- or the other according to `back_number_per`, so each is unique only within
-- its own table. Switching a show from one to the other leaves the numbers of
-- the other kind where they are, unread, so switching back restores them.
--
-- A defaulted column and a new table: backward-compatible, so it goes to
-- production before the code. Written to survive `create_all` making the table
-- first -- IF NOT EXISTS throughout, the server default and the CHECK in their
-- own statements.

BEGIN;

ALTER TABLE shows ADD COLUMN IF NOT EXISTS back_number_per TEXT NOT NULL DEFAULT 'exhibitor';
ALTER TABLE shows ALTER COLUMN back_number_per SET DEFAULT 'exhibitor';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_shows_back_number_per'
    ) THEN
        ALTER TABLE shows
            ADD CONSTRAINT ck_shows_back_number_per
            CHECK (back_number_per IN ('exhibitor', 'horse'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS show_horse_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
    back_number INTEGER,
    preferred_back_number INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_show_horse_numbers_horse UNIQUE (show_id, horse_id),
    CONSTRAINT uq_show_horse_numbers_number UNIQUE (show_id, back_number)
);

ALTER TABLE show_horse_numbers ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_horse_numbers ALTER COLUMN created_at SET DEFAULT now();

COMMENT ON COLUMN shows.back_number_per IS 'Who a back number belongs to at this show: exhibitor (show_entries.back_number, one per person) or horse (show_horse_numbers, one per horse, as APHA SC-160.D requires). Migration 161.';

COMMENT ON TABLE show_horse_numbers IS 'A horse''s back number at one show, read when shows.back_number_per = ''horse''. One per horse whoever shows it. Migration 161.';

INSERT INTO _migrations (name) VALUES ('161_back_number_per_horse.sql')
ON CONFLICT DO NOTHING;

COMMIT;
