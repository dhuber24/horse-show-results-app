-- 203: when an Early Move-In Pass's move-in window ends.
--
-- Migration 195 gave the pass the day and hour its holders may move in from.
-- A pass is often a window, not just a start: WSCA's 2026 Priority Move-In
-- Pass moves trailers in "Wednesday, September 23rd from 2 PM to 4 PM", after
-- which the pass is no use -- stalls open to everybody at 4. So
-- `show_fees.move_in_end_date` / `move_in_end_time` are the day and optional
-- hour the window closes: wall-clock at the venue, printed as typed, like
-- `move_in_*`. The pass's own wording (limited, first come first served, one
-- trailer per permit) is the row's existing `notes`, which the Lodging step
-- now edits for the pass.
--
-- A time needs its day, an end needs a start, and an end day can't be before
-- the start day (the hours on one day are checked by the router, which says
-- why). Nullable columns and additive CHECKs: backward-compatible, so this goes
-- to production before the code.

BEGIN;

ALTER TABLE show_fees ADD COLUMN IF NOT EXISTS move_in_end_date DATE;
ALTER TABLE show_fees ADD COLUMN IF NOT EXISTS move_in_end_time TIME;

ALTER TABLE show_fees DROP CONSTRAINT IF EXISTS ck_show_fees_move_in_end_time_has_date;
ALTER TABLE show_fees ADD CONSTRAINT ck_show_fees_move_in_end_time_has_date
    CHECK (move_in_end_time IS NULL OR move_in_end_date IS NOT NULL);

ALTER TABLE show_fees DROP CONSTRAINT IF EXISTS ck_show_fees_move_in_end_after_start;
ALTER TABLE show_fees ADD CONSTRAINT ck_show_fees_move_in_end_after_start
    CHECK (move_in_end_date IS NULL OR (move_in_date IS NOT NULL AND move_in_end_date >= move_in_date));

COMMENT ON COLUMN show_fees.move_in_end_date IS
    'On a per-stall line such as the Early Move-In Pass: the day its move-in window closes. Venue wall-clock.';
COMMENT ON COLUMN show_fees.move_in_end_time IS
    'The hour on move_in_end_date, optional, printed as typed.';

INSERT INTO _migrations (name) VALUES ('203_pass_move_in_end.sql')
ON CONFLICT DO NOTHING;

COMMIT;
