-- Migration 027: Add NRHA, NCHA, NRCHA as additional sanctioning bodies
-- Common secondary affiliations at western pleasure and ranch horse shows.

BEGIN;

INSERT INTO show_types (id, code, name, config) VALUES
  (gen_random_uuid(), 'NRHA',  'National Reining Horse Association',       '{}'),
  (gen_random_uuid(), 'NCHA',  'National Cutting Horse Association',        '{}'),
  (gen_random_uuid(), 'NRCHA', 'National Reined Cow Horse Association',     '{}')
ON CONFLICT (code) DO NOTHING;

INSERT INTO _migrations (name) VALUES ('027_new_show_types');

COMMIT;
