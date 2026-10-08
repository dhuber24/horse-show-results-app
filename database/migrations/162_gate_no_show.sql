-- 162: a no-show at the gate.
--
-- The gate steward checks each rider in, and a class is ready to start once
-- every rider has. A rider who never came to the gate held the class at
-- pending for good: the start button only appears on a ready class, so the
-- steward's choices were to check in somebody who was not there or to reset
-- the class.
--
-- `entries.gate_no_show` -- the steward called for this rider and they did not
-- come. It is not a scratch: the entry stays ENTERED, on the bill and in the
-- class, because scratching is the office's or the exhibitor's call and never
-- the gate's. What it changes is who is in the class that ran:
--
--   * the class is ready once every rider is checked in or a no-show;
--   * the scribe screens do not list a no-show (unless one somehow already has
--     a placing, which the screen keeps rather than let an autosave drop);
--   * the APHA placing-depth check before posting does not count them;
--   * a high-point chart's class size does not count them -- a horse that
--     never entered the ring was not shown.
--
-- Mutually exclusive with `gate_checked_in`, which the gate endpoint keeps.
--
-- A defaulted column: backward-compatible, so it goes to production before the
-- code. The default in its own statement as well, the way 161 does it.

BEGIN;

ALTER TABLE entries ADD COLUMN IF NOT EXISTS gate_no_show BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE entries ALTER COLUMN gate_no_show SET DEFAULT false;

INSERT INTO _migrations (name) VALUES ('162_gate_no_show.sql')
ON CONFLICT DO NOTHING;

COMMIT;
