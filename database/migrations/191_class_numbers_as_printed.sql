-- 191: a show read off its bill keeps the bill's class numbers.
--
-- Class numbers were positional: 1..N down the schedule, rewritten on every
-- add, move and delete. A show bill numbers its classes its own way -- "5" then
-- "5N", a Grand & Reserve class with no number at all -- so a show read off
-- one came out numbered differently from the bill exhibitors were holding.
--
-- `class_numbers_as_printed` says this show's numbers are the bill's: set by
-- the show bill import when the bill printed numbers, and from then on the app
-- stores a class's number rather than deriving it, and nothing renumbers. See
-- `backend/class_numbers.py`.
--
-- Existing shows stay on running-order numbering (false). An additive column
-- with a default: backward-compatible, so this goes to production before the
-- code.

BEGIN;

ALTER TABLE shows
    ADD COLUMN IF NOT EXISTS class_numbers_as_printed BOOLEAN NOT NULL DEFAULT false;

INSERT INTO _migrations (name) VALUES ('191_class_numbers_as_printed.sql')
ON CONFLICT DO NOTHING;

COMMIT;
