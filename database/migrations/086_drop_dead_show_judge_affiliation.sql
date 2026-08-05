-- Migration 086: drop the vestigial show_judges.affiliation_id.
--
-- Migration 067 replaced the single-affiliation column with a join table and
-- dropped it, but it is still present on the Neon database — somewhere in the
-- history the table was recreated from 066's shape. Nothing has read it since
-- 067: no model, no router, no query. Migration 085 moved affiliations onto
-- the judge registry, which leaves this column not merely unused but actively
-- misleading, so 067's intent is applied again.

BEGIN;

ALTER TABLE show_judges DROP COLUMN IF EXISTS affiliation_id;

INSERT INTO _migrations (name) VALUES ('086_drop_dead_show_judge_affiliation.sql')
ON CONFLICT DO NOTHING;

COMMIT;
