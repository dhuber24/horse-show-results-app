-- Migration 036: Class score_type and result raw_score
--   1. Add classes.score_type to distinguish how a class is judged:
--        'placement' — comparative ranking only (rail, halter, color, lead line).
--        'pattern'   — numerical judge score (showmanship, horsemanship,
--                      equitation, trail, reining, western/ranch riding).
--        'time'      — clocked event (barrels, poles, stake race).
--   2. Add results.raw_score to capture the numeric value for pattern/time
--      classes. For placement classes it stays NULL — the existing `place`
--      column is the source of truth as before.
--   3. Backfill existing classes to 'placement' so today's UX is unchanged
--      until secretaries tag classes that should be score-driven.

BEGIN;

ALTER TABLE classes
    ADD COLUMN IF NOT EXISTS score_type TEXT NOT NULL DEFAULT 'placement';

ALTER TABLE classes
    DROP CONSTRAINT IF EXISTS ck_classes_score_type;

ALTER TABLE classes
    ADD CONSTRAINT ck_classes_score_type
    CHECK (score_type IN ('placement', 'pattern', 'time'));

ALTER TABLE results
    ADD COLUMN IF NOT EXISTS raw_score NUMERIC(10, 3);

INSERT INTO _migrations (name) VALUES ('036_class_score_type') ON CONFLICT DO NOTHING;

COMMIT;
