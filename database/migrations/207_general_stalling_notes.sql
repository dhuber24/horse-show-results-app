-- 207: general stalling notes, for everybody who stalls at the show.
--
-- Migration 199 gave each stall period its own move-in notes, and the show
-- bill reader put the rules every period shares -- unloading, no switching
-- stalls, barn office hours, bedding, cleaning and checking out -- at the top
-- of the FIRST period's notes, since there was nowhere else for them. On the
-- Lodging step that read as though they were the full-show stalls' rules, and
-- an office that deleted or reordered that period took them with it.
--
-- `shows.stalling_notes` is their own place: typed in the *General stalling
-- notes* card at the top of the Lodging step, and printed above the periods
-- wherever exhibitors read about moving in (Show Details, the show bill, the
-- sign-up form's stalls). A period's own `move_in_notes` keep what only that
-- period's exhibitors need. Line breaks kept; blank is NULL.
--
-- A nullable column: idempotent and backward-compatible, production first.

BEGIN;

ALTER TABLE shows ADD COLUMN IF NOT EXISTS stalling_notes TEXT;

COMMENT ON COLUMN shows.stalling_notes IS
    'Stall rules every exhibitor who stalls must know, whatever stall period they book: unloading, stall assignments, barn office hours, bedding, cleaning and checking out (migration 207). Printed above the stall periods. A period''s own instructions are show_stall_periods.move_in_notes.';

INSERT INTO _migrations (name) VALUES ('207_general_stalling_notes.sql')
ON CONFLICT DO NOTHING;

COMMIT;
