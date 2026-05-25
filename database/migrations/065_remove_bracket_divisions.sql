-- Migration 065: Remove bracket-style entries from standard_divisions
-- "Walk-Trot" and "Lead Line" are age/skill brackets (sections), not disciplines.
-- They were seeded before the division/section split existed and now duplicate
-- entries in standard_sections (added in migration 064).

BEGIN;

DELETE FROM standard_divisions
WHERE lower(name) IN ('walk-trot', 'walk-trot-canter', 'lead line');

INSERT INTO _migrations (name) VALUES ('065_remove_bracket_divisions.sql') ON CONFLICT DO NOTHING;

COMMIT;
