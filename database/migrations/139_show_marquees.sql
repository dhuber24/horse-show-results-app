-- 139: what scrolls along the bottom of the show's live screens.
--
-- The results board's marquee has only ever carried the posted results. A show
-- office has other things to tell a room -- "Class 22 has moved to Ring 2",
-- "Lunch break until 1:00", "Full results are in the GaitDesk app" -- and the
-- only way to say any of them was to walk over to the TV and hold up a sign.
--
-- One row per show, written from the Live Screens page and read by the board on
-- the same 12-second poll that keeps its placings current, so a message typed
-- on a laptop in the office is on the lobby TV within a few seconds. No row is
-- the same as mode 'results' with no message, which is what every show did
-- before this.
--
-- A table rather than two columns on `shows`, because none of this is show
-- configuration: it changes through the day, nothing in setup asks about it,
-- and `routers/shows.py` builds the show payload by hand, so a column there
-- would ride on every show read in the app for the benefit of one screen.
--
-- `mode` is what the marquee carries:
--
--   results  the posted results, as it always has -- the default
--   message  the message alone, over and over
--   both     the message, repeated between the results
--
-- The message survives a switch back to 'results', so an announcement can be
-- taken down and put back up without retyping it. The router refuses 'message'
-- or 'both' with nothing to say; the read side falls back to results anyway,
-- since the one thing a marquee must not do is scroll a blank band.

BEGIN;

CREATE TABLE IF NOT EXISTS show_marquees (
    show_id            UUID PRIMARY KEY REFERENCES shows(id) ON DELETE CASCADE,
    mode               TEXT NOT NULL,
    message            TEXT,
    updated_at         TIMESTAMPTZ NOT NULL,
    updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Stated separately from the CREATE TABLE above: backend startup runs
-- `create_all`, which may have built this table from the model before the
-- migration lands, in which case `CREATE TABLE IF NOT EXISTS` skips and leaves
-- a table with none of what follows. Migration 114 learned this the hard way.
ALTER TABLE show_marquees ALTER COLUMN mode SET DEFAULT 'results';
ALTER TABLE show_marquees ALTER COLUMN updated_at SET DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_marquees_mode'
    ) THEN
        ALTER TABLE show_marquees
            ADD CONSTRAINT ck_show_marquees_mode
            CHECK (mode IN ('results', 'message', 'both'));
    END IF;

    -- A marquee line, not a notice board. The router says so in words before
    -- this ever fires.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_marquees_message_length'
    ) THEN
        ALTER TABLE show_marquees
            ADD CONSTRAINT ck_show_marquees_message_length
            CHECK (message IS NULL OR char_length(message) <= 500);
    END IF;
END $$;

COMMENT ON TABLE show_marquees IS
    'What the marquee along the bottom of the show''s live screens carries. One '
    'row per show; no row means the posted results, as before migration 139.';

COMMENT ON COLUMN show_marquees.mode IS
    'results = the posted results; message = the message alone; both = the '
    'message repeated between the results.';

COMMENT ON COLUMN show_marquees.message IS
    'One line of text typed by the show office. Kept when the mode goes back to '
    'results, so an announcement can be put back up without retyping it.';

INSERT INTO _migrations (name) VALUES ('139_show_marquees.sql')
ON CONFLICT DO NOTHING;

COMMIT;
