ALTER TABLE horses DROP COLUMN IF EXISTS owner_name;
INSERT INTO _migrations (name) VALUES ('018_drop_legacy_owner_name_column.sql') ON CONFLICT DO NOTHING;
