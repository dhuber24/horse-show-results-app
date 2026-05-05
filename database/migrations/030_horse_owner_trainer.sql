-- Migration 030: Add free-text owner_name and trainer_name to horses
-- owner_name: real-world owner name (separate from the system owner_exhibitor_id FK)
-- trainer_name: horse's trainer (free text, trainer need not be in the system)
-- Backfills owner_name from the linked exhibitor so existing records don't lose the display value.

ALTER TABLE horses
  ADD COLUMN owner_name TEXT,
  ADD COLUMN trainer_name TEXT;

UPDATE horses h
SET owner_name = e.full_name
FROM exhibitors e
WHERE h.owner_exhibitor_id = e.id
  AND h.owner_exhibitor_id IS NOT NULL;

INSERT INTO _migrations (name) VALUES ('030_horse_owner_trainer');
