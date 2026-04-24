-- Migration: link horse owner to an exhibitor record
-- Replaces the free-text owner_name field with a FK to exhibitors so that
-- ownership carries over automatically when an exhibitor is later linked to
-- a user account.

BEGIN;

ALTER TABLE horses
    ADD COLUMN IF NOT EXISTS owner_exhibitor_id UUID REFERENCES exhibitors(id) ON DELETE SET NULL;

INSERT INTO _migrations (name) VALUES ('008_horse_owner_exhibitor.sql') ON CONFLICT DO NOTHING;

COMMIT;
