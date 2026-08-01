-- Migration 081: horse barn name.
--
-- horses.name has always been the name a horse is entered and published under,
-- which for a registered horse is its registered (association) name. The add-a-
-- horse form muddied that by prompting for "registered or barn name", so some
-- rows hold a stable call name instead.
--
-- This splits the two: horses.name stays the REGISTERED name and remains
-- required; barn_name is the optional stable/call name. Deliberately NOT a
-- rename of horses.name to registered_name — that column is referenced across
-- entries, results, the public schedule, search and exports, and the rename
-- would buy nothing beyond the label the UI already shows.
--
-- Nullable free text, matching horses.owner_name / trainer_name / sire_name:
-- plenty of horses have no barn name worth recording.

BEGIN;

ALTER TABLE horses ADD COLUMN IF NOT EXISTS barn_name TEXT;

COMMENT ON COLUMN horses.name IS 'Registered (association) name. Required; what the horse is entered and published under.';
COMMENT ON COLUMN horses.barn_name IS 'Optional stable/call name.';

INSERT INTO _migrations (name) VALUES ('081_horse_barn_name.sql')
ON CONFLICT DO NOTHING;

COMMIT;
