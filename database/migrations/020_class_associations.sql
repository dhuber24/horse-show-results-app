-- Migration: class_associations
-- Adds a join table between classes and show_types so a single class can
-- carry an association-specific class code per sanctioning body
-- (e.g. AQHA + NSBA dual-approved classes on the Lucky 7 Classic show bill).
-- The legacy classes.apha_class_code column is preserved for now and will
-- be dropped in a later migration once writers have been migrated.

BEGIN;

CREATE TABLE IF NOT EXISTS class_associations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    show_type_id UUID NOT NULL REFERENCES show_types(id) ON DELETE CASCADE,
    association_class_code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (class_id, show_type_id)
);

CREATE INDEX IF NOT EXISTS idx_class_associations_class_id
    ON class_associations(class_id);
CREATE INDEX IF NOT EXISTS idx_class_associations_show_type_id
    ON class_associations(show_type_id);

-- Backfill: every existing apha_class_code becomes an APHA association row.
-- Only applies to classes whose parent show is APHA-typed; non-APHA shows
-- with a stray apha_class_code (shouldn't exist, but guard anyway) are skipped.
INSERT INTO class_associations (class_id, show_type_id, association_class_code)
SELECT c.id, st.id, c.apha_class_code
FROM classes c
JOIN shows s ON s.id = c.show_id
JOIN show_types st ON st.id = s.show_type_id
WHERE c.apha_class_code IS NOT NULL
  AND c.apha_class_code <> ''
  AND st.code = 'APHA'
ON CONFLICT (class_id, show_type_id) DO NOTHING;

INSERT INTO _migrations (name)
    VALUES ('020_class_associations.sql') ON CONFLICT DO NOTHING;

COMMIT;
