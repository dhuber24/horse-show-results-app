-- 185: a third answer to "until when can exhibitors enter and scratch their own
-- classes" -- never. `shows.self_entry_closes = 'office_only'`.
--
-- Migration 159 gave the show office two answers: until each class starts
-- (`class_start`) or until the show starts (`show_start`). Some show companies
-- take every class entry and scratch at the office themselves, from the day
-- the show is published to the last class: exhibitors still sign up online --
-- details, horses, stalls -- but the class picker is never theirs.
-- `backend/self_entry.py` reads `office_only` as the class doors shut in every
-- status; the office's own entry screens never read the column.
--
-- Widens the CHECK only. Backward-compatible: goes to production before the
-- code, since the old code's schemas never accept the new value.

BEGIN;

ALTER TABLE shows DROP CONSTRAINT IF EXISTS ck_shows_self_entry_closes;

ALTER TABLE shows
    ADD CONSTRAINT ck_shows_self_entry_closes
    CHECK (self_entry_closes IN ('class_start', 'show_start', 'office_only'));

COMMENT ON COLUMN shows.self_entry_closes IS 'How late exhibitors may enter and scratch their own classes: class_start (until each class starts, while the show runs too), show_start (until the show starts) or office_only (never -- the show office makes every class entry and scratch, migration 185). NULL: not answered, read as class_start. Required to publish (migration 159).';

INSERT INTO _migrations (name) VALUES ('185_self_entry_office_only.sql')
ON CONFLICT DO NOTHING;

COMMIT;
