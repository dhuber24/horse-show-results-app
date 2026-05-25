-- Migration 065: Seed standard_division_sections for generic disciplines
--
-- standard_division_sections was created in migration 061 but left empty because
-- standard_sections did not exist yet. Migration 064 seeded the sections. This
-- migration populates the join table so the Standard Library picker shows only
-- valid (discipline × bracket) combinations rather than the full cartesian product.
--
-- Strategy: start with all generic division × generic section pairs, then delete
-- the combinations that make no sense in practice.

BEGIN;

-- ── 1. Full cartesian product as baseline ────────────────────────────────────
INSERT INTO standard_division_sections (standard_division_id, standard_section_id)
SELECT d.id, s.id
FROM standard_divisions d
CROSS JOIN standard_sections s
WHERE d.show_type_id IS NULL
  AND s.show_type_id IS NULL
ON CONFLICT DO NOTHING;

-- ── 2. Prune invalid pairs ───────────────────────────────────────────────────

-- Halter is judged standing still. Walk-Trot and Lead Line brackets don't apply.
DELETE FROM standard_division_sections sds
USING standard_divisions d, standard_sections s
WHERE sds.standard_division_id = d.id
  AND sds.standard_section_id = s.id
  AND d.show_type_id IS NULL AND d.name = 'Halter'
  AND s.show_type_id IS NULL AND s.name IN ('Walk-Trot', 'Walk-Trot-Canter', 'Lead Line');

-- Timed speed events. No Walk-Trot, Lead Line, or Novice/Green Horse brackets.
DELETE FROM standard_division_sections sds
USING standard_divisions d, standard_sections s
WHERE sds.standard_division_id = d.id
  AND sds.standard_section_id = s.id
  AND d.show_type_id IS NULL AND d.name IN ('Barrel Racing', 'Pole Bending')
  AND s.show_type_id IS NULL AND s.name IN ('Walk-Trot', 'Walk-Trot-Canter', 'Lead Line', 'Novice/Green Horse');

-- Ranch and pattern events with no Walk-Trot or Lead Line variants.
DELETE FROM standard_division_sections sds
USING standard_divisions d, standard_sections s
WHERE sds.standard_division_id = d.id
  AND sds.standard_section_id = s.id
  AND d.show_type_id IS NULL AND d.name IN ('Ranch Riding', 'Reining')
  AND s.show_type_id IS NULL AND s.name IN ('Walk-Trot', 'Walk-Trot-Canter', 'Lead Line');

-- Walk-Trot division is already a beginner/limited-gait discipline.
-- Only basic age brackets apply; higher-skill brackets don't make sense.
DELETE FROM standard_division_sections sds
USING standard_divisions d, standard_sections s
WHERE sds.standard_division_id = d.id
  AND sds.standard_section_id = s.id
  AND d.show_type_id IS NULL AND d.name = 'Walk-Trot'
  AND s.show_type_id IS NULL AND s.name NOT IN ('Open', 'Youth', '10 & Under', '11-13');

-- Lead Line division is a single all-inclusive beginner class.
DELETE FROM standard_division_sections sds
USING standard_divisions d, standard_sections s
WHERE sds.standard_division_id = d.id
  AND sds.standard_section_id = s.id
  AND d.show_type_id IS NULL AND d.name = 'Lead Line'
  AND s.show_type_id IS NULL AND s.name NOT IN ('Open', 'Youth');

INSERT INTO _migrations (name) VALUES ('065_seed_standard_division_sections.sql') ON CONFLICT DO NOTHING;

COMMIT;
