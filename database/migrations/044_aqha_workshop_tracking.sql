-- Migration 044: AQHA show-management workshop tracking
-- AQHA SHW100.11 requires one designated show manager or show secretary to
-- have attended an AQHA show-management workshop within the preceding 3 years.

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS aqha_management_workshop_completed_at DATE;

INSERT INTO _migrations (name) VALUES ('044_aqha_workshop_tracking.sql') ON CONFLICT DO NOTHING;

COMMIT;
