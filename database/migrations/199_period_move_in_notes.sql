-- 199: move-in notes by stall period.
--
-- What exhibitors should know about moving in -- WSCA: no unloading on the
-- paved lot while you wait in line, stall assignments posted at 4 PM and not
-- before -- that a day and an hour cannot say. A show selling stalls by period
-- can have different instructions for each one -- the full-show stalls unload
-- between the barns from Wednesday, the games stalls come in after 9 PM
-- Friday through the back gate -- and move-in is set only by period on the
-- Lodging step, so the notes go with the period:
-- `show_stall_periods.move_in_notes`, printed under that period wherever its
-- move-in and move-out are (Show Details, the show bill, the sign-up form).
--
-- (A draft of 195 kept one set of notes on the show; a dev database that ran
-- it had them carried into each show's first period and the column dropped
-- by this migration's draft. Neither draft was released, so production only
-- ever gains this column.)
--
-- A nullable column: idempotent and backward-compatible, production first.

BEGIN;

ALTER TABLE show_stall_periods ADD COLUMN IF NOT EXISTS move_in_notes TEXT;

COMMENT ON COLUMN show_stall_periods.move_in_notes IS
    'What exhibitors should know about moving in for this period: where to unload, where stall assignments are posted. Printed with the period.';

INSERT INTO _migrations (name) VALUES ('199_period_move_in_notes.sql')
ON CONFLICT DO NOTHING;

COMMIT;
