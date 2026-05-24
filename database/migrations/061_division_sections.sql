-- Migration 061: Nest Sections under Divisions (many-to-many)
--
-- Sections become formally scoped to one or more Divisions via a new
-- `division_sections` join table. The classes table tightens to require
-- both `division_id` and `section_id`, and a composite foreign key
-- enforces that the `(division_id, section_id)` pair is a registered
-- membership.
--
-- Existing classes with NULL division_id or section_id are deleted; the
-- "I don't care about historical structure" decision was explicit at
-- design time. Valid (division_id, section_id) pairs already in use are
-- backfilled into `division_sections` so the surviving classes keep
-- working without manual cleanup.
--
-- Standard library tables get a mirrored `standard_division_sections`
-- join. No backfill is needed there because `standard_sections` is
-- currently empty.

BEGIN;

-- ── 1. division_sections join ────────────────────────────────────────────
-- PK ordering (division_id, section_id) is intentional: it matches the
-- composite FK on classes below so Postgres can satisfy the FK with the
-- PK's unique index — no extra index needed.

CREATE TABLE IF NOT EXISTS division_sections (
    division_id UUID NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
    section_id  UUID NOT NULL REFERENCES sections(id)  ON DELETE CASCADE,
    sort_order  INTEGER,
    PRIMARY KEY (division_id, section_id)
);

-- Reverse-direction lookups ("which divisions does this section belong to?")
CREATE INDEX IF NOT EXISTS idx_division_sections_section
    ON division_sections (section_id);

-- ── 2. Backfill memberships from existing classes ────────────────────────
INSERT INTO division_sections (division_id, section_id)
SELECT DISTINCT division_id, section_id
FROM classes
WHERE division_id IS NOT NULL AND section_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 3. Drop classes that can no longer satisfy the new constraint ────────
-- Cascades to entries and results via existing FKs.
DELETE FROM classes WHERE division_id IS NULL OR section_id IS NULL;

-- ── 4. Tighten classes.{division_id, section_id} to NOT NULL ─────────────
ALTER TABLE classes
    ALTER COLUMN division_id SET NOT NULL,
    ALTER COLUMN section_id  SET NOT NULL;

-- The legacy classes.section_id FK was created with ON DELETE SET NULL,
-- which conflicts with NOT NULL. Replace with RESTRICT so a section can't
-- be removed while classes still reference it. Look up the constraint by
-- column rather than hard-coding the name, since SQLAlchemy create_all may
-- have synthesized a different identifier.
DO $$
DECLARE fk_name TEXT;
BEGIN
    SELECT tc.constraint_name INTO fk_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema    = kcu.table_schema
    WHERE tc.table_name = 'classes'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'section_id'
      AND tc.constraint_name <> 'fk_classes_division_section_pair'
    LIMIT 1;
    IF fk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE classes DROP CONSTRAINT %I', fk_name);
    END IF;
END $$;

ALTER TABLE classes
    ADD CONSTRAINT fk_classes_section
    FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT;

-- ── 5. Composite FK: (division_id, section_id) must be a membership ──────
-- Postgres-native referential integrity, indexed by division_sections' PK.
-- Replaces what a trigger would do, with no per-write function-call cost.
DO $$
BEGIN
    ALTER TABLE classes
        ADD CONSTRAINT fk_classes_division_section_pair
        FOREIGN KEY (division_id, section_id)
        REFERENCES division_sections (division_id, section_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 6. Mirror for the standard library ───────────────────────────────────

CREATE TABLE IF NOT EXISTS standard_division_sections (
    standard_division_id UUID NOT NULL REFERENCES standard_divisions(id) ON DELETE CASCADE,
    standard_section_id  UUID NOT NULL REFERENCES standard_sections(id)  ON DELETE CASCADE,
    sort_order INTEGER,
    PRIMARY KEY (standard_division_id, standard_section_id)
);

CREATE INDEX IF NOT EXISTS idx_standard_division_sections_section
    ON standard_division_sections (standard_section_id);

INSERT INTO _migrations (name) VALUES ('061_division_sections.sql') ON CONFLICT DO NOTHING;

COMMIT;
