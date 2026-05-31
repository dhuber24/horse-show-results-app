-- Migration 074: Rename Section → Division, Division → Discipline
--
-- Adopts the consistent vocabulary used across AQHA / APHA / open shows:
--   * Discipline = overarching riding style (Western Pleasure, Hunter Under Saddle, Trail, ...)
--   * Division   = age / skill bracket (Youth 14-18, Novice Amateur, Walk-Trot, ...)
--   * Class      = the single event (e.g. "#102 Youth 14-18 Western Pleasure")
--
-- Up until this migration the codebase used "Division" for what is properly a
-- Discipline and "Section" for what is properly a Division. This migration
-- renames the per-show and standard-library tables, their joining tables, the
-- columns on `classes` and `standard_classes`, and the named constraints /
-- indexes that referenced the old vocabulary. SQLAlchemy models and the
-- backend / frontend follow in the same change.
--
-- Notes:
--   - The standard-library join uses prefixed columns (`standard_division_id`,
--     `standard_section_id`) while the per-show join uses bare names.
--   - Index renames are ordered so that `_divisions_*` renames vacate the name
--     before `_sections_*` renames claim it.
--   - AQHA / APHA std-class lookup tables are intentionally left alone — they
--     model the breed-specific catalogs, not the per-show vocabulary.

BEGIN;

-- Per-show tables ────────────────────────────────────────────────────────────

ALTER TABLE divisions RENAME TO disciplines;
ALTER TABLE sections  RENAME TO divisions;

ALTER TABLE division_sections RENAME TO discipline_divisions;
ALTER TABLE discipline_divisions RENAME COLUMN division_id TO discipline_id;
ALTER TABLE discipline_divisions RENAME COLUMN section_id  TO division_id;

ALTER TABLE divisions RENAME CONSTRAINT uq_sections_show_name TO uq_divisions_show_name;
ALTER TABLE disciplines RENAME CONSTRAINT ck_divisions_score_type TO ck_disciplines_score_type;

ALTER TABLE classes RENAME COLUMN division_id TO discipline_id;
ALTER TABLE classes RENAME COLUMN section_id  TO division_id;
ALTER TABLE classes RENAME CONSTRAINT fk_classes_division_section_pair TO fk_classes_discipline_division_pair;
ALTER TABLE classes RENAME CONSTRAINT fk_classes_section TO fk_classes_division;

-- Standard library tables ────────────────────────────────────────────────────

ALTER TABLE standard_divisions RENAME TO standard_disciplines;
ALTER TABLE standard_sections  RENAME TO standard_divisions;

ALTER TABLE standard_division_sections RENAME TO standard_discipline_divisions;
ALTER TABLE standard_discipline_divisions RENAME COLUMN standard_division_id TO standard_discipline_id;
ALTER TABLE standard_discipline_divisions RENAME COLUMN standard_section_id  TO standard_division_id;

ALTER TABLE standard_divisions
    RENAME CONSTRAINT uq_standard_sections_type_name TO uq_standard_divisions_type_name;
ALTER TABLE standard_disciplines
    RENAME CONSTRAINT ck_standard_divisions_score_type TO ck_standard_disciplines_score_type;

ALTER TABLE standard_classes RENAME COLUMN standard_division_id TO standard_discipline_id;
ALTER TABLE standard_classes RENAME COLUMN standard_section_id  TO standard_division_id;
ALTER TABLE standard_classes
    RENAME CONSTRAINT fk_standard_classes_division_section_pair
    TO fk_standard_classes_discipline_division_pair;

-- Indexes ─────────────────────────────────────────────────────────────────────
-- Vacate the `_divisions_*` names first so the `_sections_*` renames can claim
-- them on the second pass.

ALTER INDEX idx_divisions_show_sort           RENAME TO idx_disciplines_show_sort;
ALTER INDEX idx_sections_show_sort            RENAME TO idx_divisions_show_sort;
ALTER INDEX idx_standard_divisions_show_type  RENAME TO idx_standard_disciplines_show_type;
ALTER INDEX idx_standard_sections_show_type   RENAME TO idx_standard_divisions_show_type;

ALTER INDEX idx_classes_section                    RENAME TO idx_classes_division;
ALTER INDEX idx_division_sections_section          RENAME TO idx_discipline_divisions_division;
ALTER INDEX idx_standard_division_sections_section RENAME TO idx_standard_discipline_divisions_division;

INSERT INTO _migrations (name) VALUES ('074_rename_division_to_discipline.sql')
ON CONFLICT DO NOTHING;

COMMIT;
