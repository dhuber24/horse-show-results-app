-- Migration 078: every class gets a ring.
--
-- The gate's one-class-in-progress-per-ring rule needs every class to have
-- a ring. Class-creation endpoints now default to the show's first ring,
-- creating a "Ring 1" for shows with no rings set up. This backfills
-- existing data the same way: shows that have ring-less classes and no
-- rings at all get a "Ring 1", then every ring-less class is assigned its
-- show's first ring.
--
-- classes.ring_id stays nullable at the schema level — assignment is
-- enforced by the application (creation defaults + the gate's start-class
-- fallback), keeping ring deletion semantics unchanged.

BEGIN;

INSERT INTO rings (id, show_id, name, sort_order)
SELECT gen_random_uuid(), c.show_id, 'Ring 1', 1
FROM (SELECT DISTINCT show_id FROM classes WHERE ring_id IS NULL) c
WHERE NOT EXISTS (SELECT 1 FROM rings r WHERE r.show_id = c.show_id);

UPDATE classes c
SET ring_id = (
    SELECT r.id FROM rings r
    WHERE r.show_id = c.show_id
    ORDER BY r.sort_order NULLS LAST, r.name
    LIMIT 1
)
WHERE c.ring_id IS NULL;

INSERT INTO _migrations (name) VALUES ('078_default_ring_backfill.sql')
ON CONFLICT DO NOTHING;

COMMIT;
