-- 195: when Early Move-In Pass holders may move in.
--
-- (Move-in notes for exhibitors were drafted here as `shows.move_in_notes`;
-- before either was released they became each stall period's own, migration
-- 199, so production never has the show-level column. A dev database that
-- ran the draft had it carried over and dropped by 199's draft.)
--
-- The Early Move-In Pass (a `show_fees` row, code `early_move_in`) said
-- only "move in before stalls open". A pass moves you in at a time of its own
-- -- MNSPHC: "Thursday after 6:00 PM instead of 9:00 AM Friday" --
-- so `show_fees.move_in_date` / `move_in_time` are that day and optional hour:
-- wall-clock at the venue, printed as typed, like `stalls_open_*`. Read on a
-- per-stall line only; the pass is the one the Lodging step writes. A time
-- with no day means nothing, so the CHECK refuses it. They go with the row
-- when the pass is unticked.
--
-- Nullable columns and an additive CHECK: backward-compatible, so this goes to
-- production before the code.

BEGIN;

ALTER TABLE show_fees ADD COLUMN IF NOT EXISTS move_in_date DATE;
ALTER TABLE show_fees ADD COLUMN IF NOT EXISTS move_in_time TIME;

ALTER TABLE show_fees DROP CONSTRAINT IF EXISTS ck_show_fees_move_in_time_has_date;
ALTER TABLE show_fees ADD CONSTRAINT ck_show_fees_move_in_time_has_date
    CHECK (move_in_time IS NULL OR move_in_date IS NOT NULL);

COMMENT ON COLUMN show_fees.move_in_date IS
    'On a per-stall line such as the Early Move-In Pass: the day its holders may move in. Venue wall-clock.';
COMMENT ON COLUMN show_fees.move_in_time IS
    'The hour on move_in_date, optional, printed as typed.';

INSERT INTO _migrations (name) VALUES ('195_move_in_details.sql')
ON CONFLICT DO NOTHING;

COMMIT;
