-- Migration 048: Consolidate Divisions / Sections / Classes
--
-- This migration aligns the data model with industry vocabulary
-- (USEF GR1, AQHA, APHA): a Division is a discipline (Halter,
-- Showmanship, Western Pleasure, Trail, Barrels). Age/skill brackets
-- (10 & Under, Walk-Trot, Amateur) are not Divisions — they are
-- Sections within a Division. The Schedule Builder's class_templates
-- table was a parallel name for the same "discipline" concept and is
-- folded into divisions; its category column is dropped.
--
-- End-state model:
--   Division   - per-show discipline. Has default_score_type.
--                (Replaces class_templates as the discipline source of truth.)
--   Section    - per-show age/skill bracket. NEW table. Optional.
--                (Replaces bracket-style rows previously in
--                standard_divisions / divisions.)
--   Class      - now has nullable section_id. score_type continues to live
--                on classes (per-class authoritative), seeded from the
--                division's default_score_type when the class is created.
--
-- Existing per-show rows in `divisions` are NOT auto-classified into
-- sections (no reliable string-level distinction between a discipline
-- and a bracket). Existing classes keep their current score_type;
-- only newly-created classes derive from division.default_score_type.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Sections + Standard Sections ───────────────────────────────────────────
-- Note: the backend's SQLAlchemy lifespan calls Base.metadata.create_all() on
-- startup, which may have already created these tables (without the inline
-- constraints) before this migration ran. We add the constraints separately
-- via DO blocks so re-runs heal any partial state.

CREATE TABLE IF NOT EXISTS sections (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id     UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    sort_order  INTEGER
);

DO $$
BEGIN
    ALTER TABLE sections
        ADD CONSTRAINT uq_sections_show_name UNIQUE (show_id, name);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_sections_show_sort ON sections(show_id, sort_order);

CREATE TABLE IF NOT EXISTS standard_sections (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_type_id  UUID REFERENCES show_types(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    sort_order    INTEGER NOT NULL DEFAULT 0
);

DO $$
BEGIN
    ALTER TABLE standard_sections
        ADD CONSTRAINT uq_standard_sections_type_name UNIQUE NULLS NOT DISTINCT (show_type_id, name);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_standard_sections_show_type
    ON standard_sections (show_type_id, sort_order);

-- ── 2. divisions.default_score_type ───────────────────────────────────────────

ALTER TABLE divisions
    ADD COLUMN IF NOT EXISTS default_score_type TEXT NOT NULL DEFAULT 'placement';

DO $$
BEGIN
    ALTER TABLE divisions
        ADD CONSTRAINT ck_divisions_score_type
        CHECK (default_score_type IN ('placement','pattern','time'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE standard_divisions
    ADD COLUMN IF NOT EXISTS default_score_type TEXT NOT NULL DEFAULT 'placement';

DO $$
BEGIN
    ALTER TABLE standard_divisions
        ADD CONSTRAINT ck_standard_divisions_score_type
        CHECK (default_score_type IN ('placement','pattern','time'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 3. classes.section_id ─────────────────────────────────────────────────────

ALTER TABLE classes
    ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES sections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_classes_section ON classes(section_id);

-- ── 4. Move bracket-style OPEN rows from standard_divisions → standard_sections
-- Migration 047 seeded these as "divisions" for OPEN shows; they were always
-- age/skill brackets in disguise. Migrate them to standard_sections.

WITH bracket_rows AS (
    SELECT sd.id, sd.show_type_id, sd.name, sd.sort_order
    FROM standard_divisions sd
    JOIN show_types st ON st.id = sd.show_type_id
    WHERE st.code = 'OPEN'
      AND sd.name IN (
          'Lead Line (8 & Under)',
          '10 & Under',
          '11-13',
          '14-17',
          '18 & Over',
          'Walk-Trot',
          'Walk-Trot-Canter',
          'Novice/Green Horse',
          'Open'
      )
)
INSERT INTO standard_sections (show_type_id, name, sort_order)
SELECT show_type_id, name, sort_order FROM bracket_rows
ON CONFLICT (show_type_id, name) DO NOTHING;

DELETE FROM standard_divisions sd
USING show_types st
WHERE st.id = sd.show_type_id
  AND st.code = 'OPEN'
  AND sd.name IN (
      'Lead Line (8 & Under)',
      '10 & Under',
      '11-13',
      '14-17',
      '18 & Over',
      'Walk-Trot',
      'Walk-Trot-Canter',
      'Novice/Green Horse',
      'Open'
  );

-- ── 5. Promote seed class_templates into standard_divisions ───────────────────
-- Seeds (show_id NULL, is_seed=TRUE) become the generic discipline seed list
-- shown to all show types. Upsert so existing rows pick up default_score_type.

INSERT INTO standard_divisions (show_type_id, name, sort_order, default_score_type)
SELECT NULL, ct.name, ct.sort_order, ct.default_score_type
FROM class_templates ct
WHERE ct.is_seed = TRUE AND ct.show_id IS NULL
ON CONFLICT (show_type_id, name) DO UPDATE
    SET default_score_type = EXCLUDED.default_score_type,
        sort_order = EXCLUDED.sort_order;

-- ── 6. Backfill divisions.default_score_type ──────────────────────────────────
-- Pass 1: exact name match against the class_templates seed library.
UPDATE divisions d
SET default_score_type = ct.default_score_type
FROM class_templates ct
WHERE ct.is_seed = TRUE
  AND ct.show_id IS NULL
  AND lower(d.name) = lower(ct.name)
  AND d.default_score_type = 'placement';

-- Pass 2: heuristic fallback on common discipline names. Only updates rows
-- still left at the 'placement' default — won't clobber pass 1 results.
UPDATE divisions
SET default_score_type = 'time'
WHERE default_score_type = 'placement'
  AND (
      lower(name) LIKE '%barrel%'
      OR lower(name) LIKE '%pole%'
      OR lower(name) LIKE '%stake%'
  );

UPDATE divisions
SET default_score_type = 'pattern'
WHERE default_score_type = 'placement'
  AND (
      lower(name) LIKE '%showmanship%'
      OR lower(name) LIKE '%horsemanship%'
      OR lower(name) LIKE '%equitation%'
      OR lower(name) LIKE '%reining%'
      OR lower(name) LIKE '%ranch riding%'
      OR lower(name) LIKE '%ranch trail%'
      OR lower(name) LIKE '%hunter hack%'
      OR lower(name) LIKE 'trail%'
      OR lower(name) = 'trail'
  );

-- ── 7. Promote per-show custom templates into that show's divisions ───────────
-- Skip rows whose names already exist in the show's divisions (case-insensitive).

INSERT INTO divisions (show_id, name, sort_order, default_score_type)
SELECT ct.show_id, ct.name, ct.sort_order + 1000, ct.default_score_type
FROM class_templates ct
WHERE ct.show_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM divisions d
      WHERE d.show_id = ct.show_id
        AND lower(d.name) = lower(ct.name)
  );

-- ── 8. Drop legacy table ──────────────────────────────────────────────────────

DROP TABLE IF EXISTS class_templates;

INSERT INTO _migrations (name) VALUES ('048_consolidate_divisions.sql') ON CONFLICT DO NOTHING;

COMMIT;
