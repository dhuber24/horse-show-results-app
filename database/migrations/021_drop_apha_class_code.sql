-- Migration: drop legacy classes.apha_class_code column
--
-- Apply ONLY after the matching backend changes below have been deployed,
-- otherwise SQLAlchemy will raise on every Class read/write because the
-- mapped column no longer exists in the database.
--
-- Required code changes to ship in the same release:
--   1. backend/models.py       — remove the `apha_class_code = Column(...)` line on Class
--   2. backend/schemas.py      — remove `apha_class_code` from ClassCreate / ClassUpdate / ClassOut
--   3. backend/routers/shows.py (apha_export) — drop the
--        `if not code: code = cls.apha_class_code or ""`
--      fallback inside the `apha_code_by_class` builder; rely solely on class_associations
--   4. CLAUDE.md "Applied migrations" list — add a 021 entry
--
-- Pre-flight check (optional sanity audit before applying):
--   SELECT count(*) AS rows_with_value FROM classes WHERE apha_class_code IS NOT NULL AND apha_class_code <> '';
--   SELECT count(*) AS rows_in_assoc FROM class_associations
--     JOIN show_types st ON st.id = class_associations.show_type_id WHERE st.code = 'APHA';
--
-- If `rows_with_value > rows_in_assoc`, run the 020 backfill again or migrate
-- the missing classes manually before dropping the column.

BEGIN;

ALTER TABLE classes
    DROP COLUMN IF EXISTS apha_class_code;

INSERT INTO _migrations (name)
    VALUES ('021_drop_apha_class_code.sql') ON CONFLICT DO NOTHING;

COMMIT;
