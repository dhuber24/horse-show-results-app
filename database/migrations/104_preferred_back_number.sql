-- Migration 104: let the exhibitor ask for a back number.
--
-- `show_entries.back_number` is the number the show issues, and until now the
-- only way to get one was to wait for the office to type it in. That is fine
-- for a stranger's first show and wrong for everybody else: at a ranch or
-- western show people ride the same number year after year, families keep a
-- block together, and "can I have 42 again" is one of the commonest questions
-- the office fields before a show. Answering it by email and then keying it in
-- by hand is the whole workflow this app exists to remove.
--
-- So the exhibitor states a preference during class registration, and the app
-- grants it outright when nothing else at that show holds it — a number nobody
-- else wants is not a decision anyone needs to make. The column is kept
-- alongside `back_number` rather than folded into it because the two answer
-- different questions: what was asked for, and what was issued. They diverge
-- the moment the office renumbers, and that divergence is exactly what the
-- desk wants to see ("asked for 42, has 87").
--
-- Deliberately NOT unique. Two people may both want 42; only one of them can
-- have it, and that is what the unique constraint on `back_number` is for.

BEGIN;

ALTER TABLE show_entries
    ADD COLUMN IF NOT EXISTS preferred_back_number INTEGER;

COMMENT ON COLUMN show_entries.preferred_back_number IS
    'The back number this exhibitor asked for. Granted into back_number when free at the time of asking; kept afterwards so the office can see what was requested even when it renumbered. Not unique — several people may want the same number.';

INSERT INTO _migrations (name) VALUES ('104_preferred_back_number.sql')
ON CONFLICT DO NOTHING;

COMMIT;
