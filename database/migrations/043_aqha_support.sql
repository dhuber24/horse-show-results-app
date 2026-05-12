-- Migration 043: AQHA show approval metadata and standard class catalog
-- AQHA requires show bills/class schedules to be submitted with approval.
-- The standard class table is intentionally empty until loaded from the
-- official AQHA Class Code List.

BEGIN;

ALTER TABLE shows ADD COLUMN IF NOT EXISTS aqha_show_number TEXT;
ALTER TABLE shows ADD COLUMN IF NOT EXISTS aqha_approval_status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED';
ALTER TABLE shows ADD COLUMN IF NOT EXISTS aqha_approval_submitted_at DATE;
ALTER TABLE shows ADD COLUMN IF NOT EXISTS aqha_approval_notes TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'shows_aqha_approval_status_check'
    ) THEN
        ALTER TABLE shows
            ADD CONSTRAINT shows_aqha_approval_status_check
            CHECK (aqha_approval_status IN ('NOT_SUBMITTED', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUIRED'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS aqha_standard_classes (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    division    TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    source_year INTEGER,
    notes       TEXT
);

CREATE INDEX IF NOT EXISTS idx_aqha_standard_classes_division
    ON aqha_standard_classes(division);

COMMIT;
