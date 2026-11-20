-- 206: "until when can exhibitors enter and scratch their own classes" takes a
-- date. `shows.self_entry_closes = 'on_date'` with the day in the new column
-- `shows.self_entry_closes_on` (inclusive -- the same reading the sign-up
-- deadline gets).
--
-- Migration 159 offered "until the show starts" (`show_start`), which shut the
-- class doors when the status turned ACTIVE. Show offices want to name the day
-- instead -- "class changes by Wednesday before the show" -- so Step 1 now asks
-- for a date in its place: `backend/self_entry.py` keeps the doors open while
-- the show is PUBLISHED or ACTIVE and today is on or before that day, with each
-- class's own rules on top, as for `class_start`.
--
-- The one or two existing `show_start` answers become `on_date` with the day
-- before the show's first day, which is what "until the show starts" meant, so
-- no show is left holding an answer Step 1 no longer offers. `show_start` stays
-- legal in the CHECK (and the code still reads it) for the release window, in
-- which the running build can still write it.
--
-- New nullable column, widened CHECK and a data change the old code reads as
-- `class_start` (only a show that has not started could tell, and production
-- has none): backward-compatible, so this goes to production before the code.

BEGIN;

ALTER TABLE shows ADD COLUMN IF NOT EXISTS self_entry_closes_on DATE;

ALTER TABLE shows DROP CONSTRAINT IF EXISTS ck_shows_self_entry_closes;
ALTER TABLE shows
    ADD CONSTRAINT ck_shows_self_entry_closes
    CHECK (self_entry_closes IN ('class_start', 'show_start', 'office_only', 'on_date'));

UPDATE shows
   SET self_entry_closes = 'on_date',
       self_entry_closes_on = start_date - 1
 WHERE self_entry_closes = 'show_start';

COMMENT ON COLUMN shows.self_entry_closes IS 'How late exhibitors may enter and scratch their own classes: class_start (until each class starts, while the show runs too), on_date (through self_entry_closes_on, migration 206), office_only (never -- the show office makes every class entry and scratch, migration 185), or show_start (until the show starts; no longer offered since migration 206). NULL: not answered, read as class_start. Required to publish (migration 159).';
COMMENT ON COLUMN shows.self_entry_closes_on IS 'The last day exhibitors may enter and scratch their own classes online, inclusive, when self_entry_closes = on_date (migration 206). No later than the show''s last day. NULL otherwise.';

INSERT INTO _migrations (name) VALUES ('206_self_entry_closes_on_date.sql')
ON CONFLICT DO NOTHING;

COMMIT;
