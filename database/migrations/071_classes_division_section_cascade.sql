-- Migration 071: Switch the classes (division_id, section_id) composite FK
--                 to ON DELETE CASCADE
--
-- Migration 061 created the FK with ON DELETE RESTRICT to protect against
-- accidentally orphaning classes when a (division, section) pair was removed
-- from `division_sections`. That safety lives at the API layer instead:
-- `routers/sections.py` explicitly returns 409 when a user tries to remove
-- a membership a class still depends on.
--
-- The DB-level RESTRICT, however, breaks show deletion. `DELETE FROM shows`
-- cascades into `divisions` and `sections`, which in turn cascade into
-- `division_sections`. Postgres' non-deterministic delete ordering can try
-- to delete a `division_sections` row before its dependent `classes` rows,
-- tripping the RESTRICT and 500ing the request.
--
-- Switching the composite FK to CASCADE makes the bulk-cleanup path work
-- without changing the user-facing protection (the 409 in sections.py
-- still fires first).

BEGIN;

ALTER TABLE classes
    DROP CONSTRAINT IF EXISTS fk_classes_division_section_pair;

ALTER TABLE classes
    ADD CONSTRAINT fk_classes_division_section_pair
    FOREIGN KEY (division_id, section_id)
    REFERENCES division_sections (division_id, section_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE;

INSERT INTO _migrations (name) VALUES ('071_classes_division_section_cascade.sql') ON CONFLICT DO NOTHING;

COMMIT;
