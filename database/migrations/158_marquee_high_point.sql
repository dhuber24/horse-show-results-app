-- 158: the marquee can scroll the high point standings.
--
-- Migration 139 gave the live screens' marquee three things to carry: the
-- posted results, the show office's message, or the message between the
-- results. A show keeping high point has a fourth -- the standings, which a
-- room watches move as each class is posted -- and the only screen that showed
-- them was the Results & High Point board's right half, two tables at a time.
--
--   high_point  the high point standings, a line per division within a
--               discipline, top five each
--
-- One more value on the CHECK and nothing else. The router refuses it at a
-- show with no points chart, and the read side falls back to the results if
-- the chart is taken away afterwards: a marquee must never scroll a blank band.
--
-- Backward-compatible: a wider CHECK, and the release running before this
-- never writes the new value. So it goes to production before the code.

BEGIN;

ALTER TABLE show_marquees DROP CONSTRAINT IF EXISTS ck_show_marquees_mode;
ALTER TABLE show_marquees
    ADD CONSTRAINT ck_show_marquees_mode
    CHECK (mode IN ('results', 'message', 'both', 'high_point'));

COMMENT ON COLUMN show_marquees.mode IS
    'results = the posted results; message = the message alone; both = the '
    'message repeated between the results; high_point = the high point '
    'standings (migration 158).';

INSERT INTO _migrations (name) VALUES ('158_marquee_high_point.sql')
ON CONFLICT DO NOTHING;

COMMIT;
