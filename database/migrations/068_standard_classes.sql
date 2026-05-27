-- Migration 068: standard_classes table — canonical per-show-type class catalog
--
-- Adds a single normalized table that supersedes the scattered association-
-- specific lookup tables (aqha_standard_classes, apha_standard_classes) as
-- the source of truth for the Standard Library matrix picker. Each row
-- pairs a class to a (standard_division, standard_section) cell so the
-- setup UI can show class counts per matrix cell and bulk-create per-show
-- divisions/sections/classes from picks.
--
-- The existing per-association tables stay in place for now; they remain
-- the authoritative source for class-code validation on AQHA entries and
-- the APHA bulk-import picker. A follow-up migration can consolidate them
-- once all callers are switched over.

BEGIN;

CREATE TABLE IF NOT EXISTS standard_classes (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_type_id             UUID NOT NULL REFERENCES show_types(id) ON DELETE CASCADE,
    standard_division_id     UUID NOT NULL,
    standard_section_id      UUID NOT NULL,
    class_code               TEXT,                       -- e.g. AQHA '147800'; NULL when no official code
    class_name               TEXT NOT NULL,
    default_score_type       TEXT NOT NULL DEFAULT 'placement'
        CHECK (default_score_type IN ('placement', 'pattern', 'time')),
    default_entry_fee_cents  INTEGER NOT NULL DEFAULT 0,
    sort_order               INTEGER NOT NULL DEFAULT 0,
    source_year              INTEGER,
    created_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

    -- Every standard_class must point at a valid (division, section) membership
    -- in standard_division_sections — same shape as classes ↔ division_sections.
    CONSTRAINT fk_standard_classes_division_section_pair
        FOREIGN KEY (standard_division_id, standard_section_id)
        REFERENCES standard_division_sections (standard_division_id, standard_section_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    -- A class code is unique within a show type when present. Multiple NULL
    -- codes are fine (different generic classes can share NULL).
    CONSTRAINT uq_standard_classes_type_code
        UNIQUE NULLS NOT DISTINCT (show_type_id, class_code)
);

CREATE INDEX IF NOT EXISTS idx_standard_classes_type_div_sec
    ON standard_classes (show_type_id, standard_division_id, standard_section_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_standard_classes_type_name
    ON standard_classes (show_type_id, class_name);

INSERT INTO _migrations (name) VALUES ('068_standard_classes.sql') ON CONFLICT DO NOTHING;

COMMIT;
