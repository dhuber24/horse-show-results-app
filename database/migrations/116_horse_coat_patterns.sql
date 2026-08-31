-- Migration 116: a coat pattern is not a coat color.
--
-- `horse_colors` has held both since migration 007 — Tobiano, Overo, Tovero and
-- Sabino sat in the same list as Bay and Buckskin, along with six Appaloosa
-- patterns. Those are two independent axes, and APHA says so outright: the rule
-- book describes the spotting patterns (tobiano, frame overo, sabino, splashed
-- white, dominant white, and tovero for combinations) in one place and lists its
-- recognized *colors* — Black, Brown, Bay, Bay Roan, Blue Roan, Buckskin and the
-- rest — in another. A Paint is a color AND a pattern, and "Bay Tobiano" is the
-- ordinary answer on a registration certificate.
--
-- One column forced whoever entered the horse to drop half of what the papers
-- said, and the half they dropped could not be reported back to the association.
--
-- The Appaloosa rows move too. They are ApHC patterns, not colors, and leaving
-- them behind would keep exactly the confusion this migration removes.
--
-- The move is by name so nothing is invented: the Appaloosa pattern rows are
-- copied out of `horse_colors` with whatever names are actually stored (they
-- contain an en dash), and the backfill joins on name. After it, no horse points
-- at a pattern row in `horse_colors`, so those rows are removed from the color
-- list — which is the whole point. `horses.color_id` is ON DELETE SET NULL, so a
-- row the backfill somehow missed nulls out rather than failing.
--
-- Defaults are stated separately from CREATE TABLE for the reason migration 114
-- learned the hard way: the backend's startup `create_all` may have already made
-- this table from the model, in which case CREATE TABLE IF NOT EXISTS skips and
-- leaves an `id` with no SQL default, because the model applies its default in
-- Python.

BEGIN;

CREATE TABLE IF NOT EXISTS horse_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE horse_patterns
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE horse_patterns
    ALTER COLUMN sort_order SET DEFAULT 0;

ALTER TABLE horse_patterns
    ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE horses
    ADD COLUMN IF NOT EXISTS pattern_id UUID
        REFERENCES horse_patterns(id) ON DELETE SET NULL;

-- APHA's own taxonomy. "Overo" stays as the umbrella term alongside the three
-- named overo patterns, because a certificate that says only "overo" is common
-- and recording it as frame would be inventing a fact about the horse.
INSERT INTO horse_patterns (name, sort_order) VALUES
    ('Tobiano',        1),
    ('Overo',          2),
    ('Frame Overo',    3),
    ('Sabino',         4),
    ('Splashed White', 5),
    ('Dominant White', 6),
    ('Tovero',         7)
ON CONFLICT (name) DO NOTHING;

-- The Appaloosa rows are copied rather than typed, so the stored names — which
-- carry an en dash — survive the move exactly.
INSERT INTO horse_patterns (name, sort_order)
SELECT name, 100 + sort_order FROM horse_colors WHERE name LIKE 'Appaloosa%'
ON CONFLICT (name) DO NOTHING;

-- Move every horse recorded against a pattern onto the new column.
UPDATE horses h
SET pattern_id = p.id,
    color_id = NULL
FROM horse_colors c
JOIN horse_patterns p ON p.name = c.name
WHERE h.color_id = c.id;

-- Nothing points at them now, and a pattern in the color list is the bug.
DELETE FROM horse_colors c
WHERE EXISTS (SELECT 1 FROM horse_patterns p WHERE p.name = c.name);

COMMENT ON TABLE horse_patterns IS
    'Spotting patterns — the second axis of a horse''s coat, independent of its '
    'color. APHA patterns (tobiano, overo and its named forms, tovero) and ApHC '
    'patterns live here together, the same way horse_colors is shared.';

COMMENT ON COLUMN horses.pattern_id IS
    'Coat pattern, independent of color_id. A Paint is a color and a pattern — '
    '"Bay Tobiano" — and before migration 116 the two shared one column, so '
    'recording one meant losing the other.';

INSERT INTO _migrations (name) VALUES ('116_horse_coat_patterns.sql')
ON CONFLICT DO NOTHING;

COMMIT;
