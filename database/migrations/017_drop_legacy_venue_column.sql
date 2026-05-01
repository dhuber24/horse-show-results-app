ALTER TABLE shows DROP COLUMN IF EXISTS venue;
INSERT INTO _migrations (name) VALUES ('017_drop_legacy_venue_column.sql') ON CONFLICT DO NOTHING;
