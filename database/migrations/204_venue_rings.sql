-- 204: the rings and arenas a venue has, kept for the next show there.
--
-- A show's rings were the show's alone (`rings.show_id`), and nothing on any
-- screen created one: every show ran in the "Ring 1" the first class created
-- (migration 078). The rings at a fairground do not change from one show to
-- the next, so a show office that sets them up once should not set them up
-- again. `venue_rings` is that list: one row per ring or arena at a venue, in
-- the order the venue's shows list them.
--
-- A show still has rings of its own. Classes point at `rings`, the gate runs
-- one class at a time per show ring, and a show's ring keeps the name it ran
-- under even if the venue's list is tidied later. `rings.venue_ring_id` is
-- which venue ring a show ring is: set when a ring is taken from the venue's
-- list or added at a show with a venue, NULL for a ring this show alone runs.
-- SET NULL, so taking a ring off the venue's list never touches a show.
--
-- One name once per venue, compared as `lower(btrim(name))`, the same
-- comparison the app makes before it creates one.
--
-- A new table and a nullable column: backward-compatible, so this goes to
-- production before the code.

BEGIN;

CREATE TABLE IF NOT EXISTS venue_rings (
    id         UUID PRIMARY KEY,
    venue_id   UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    sort_order INTEGER,
    created_at TIMESTAMPTZ
);

-- Stated on its own: startup `create_all` may build the table from the model
-- first, and a default inside CREATE TABLE would be skipped with it.
ALTER TABLE venue_rings ALTER COLUMN created_at SET DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS venue_rings_venue_name_uniq
    ON venue_rings (venue_id, lower(btrim(name)));

COMMENT ON TABLE venue_rings IS
    'The rings and arenas at a venue, offered to every show held there. A show copies them into its own rings.';

ALTER TABLE rings ADD COLUMN IF NOT EXISTS venue_ring_id UUID;

ALTER TABLE rings DROP CONSTRAINT IF EXISTS rings_venue_ring_id_fkey;
ALTER TABLE rings ADD CONSTRAINT rings_venue_ring_id_fkey
    FOREIGN KEY (venue_ring_id) REFERENCES venue_rings(id) ON DELETE SET NULL;

-- "Does any show still run this venue ring" -- asked before one is removed.
CREATE INDEX IF NOT EXISTS rings_venue_ring_idx ON rings (venue_ring_id);

COMMENT ON COLUMN rings.venue_ring_id IS
    'The venue ring this show ring is. NULL: a ring this show alone runs.';

INSERT INTO _migrations (name) VALUES ('204_venue_rings.sql')
ON CONFLICT DO NOTHING;

COMMIT;
