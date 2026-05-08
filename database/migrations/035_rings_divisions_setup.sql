-- Migration 035: Ring & Division setup management
--   1. Add sort_order to per-show rings and divisions for stable display order.
--   2. Add standard_rings and standard_divisions lookup tables to power the
--      "Add from standards" picker on the show setup page.
--   3. Seed common ring names and association-specific division lists
--      (APHA, AQHA). standard_divisions.show_type_id NULL means "applies to
--      any show type" — used by OPEN/unaffiliated and other show types as a
--      fallback set.

BEGIN;

-- gen_random_uuid() requires pgcrypto on older PostgreSQL versions; safe no-op on newer ones.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Add sort_order to existing per-show tables ──────────────────────────────

ALTER TABLE rings ADD COLUMN IF NOT EXISTS sort_order INTEGER;
ALTER TABLE divisions ADD COLUMN IF NOT EXISTS sort_order INTEGER;

UPDATE rings
SET sort_order = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY show_id ORDER BY name) AS rn
  FROM rings
) sub
WHERE rings.id = sub.id AND rings.sort_order IS NULL;

UPDATE divisions
SET sort_order = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY show_id ORDER BY name) AS rn
  FROM divisions
) sub
WHERE divisions.id = sub.id AND divisions.sort_order IS NULL;

CREATE INDEX IF NOT EXISTS idx_rings_show_sort ON rings (show_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_divisions_show_sort ON divisions (show_id, sort_order);

-- ── 2. Standard lookup tables ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS standard_rings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS standard_divisions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_type_id  UUID REFERENCES show_types(id) ON DELETE CASCADE,  -- NULL = generic fallback
    name          TEXT NOT NULL,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    UNIQUE NULLS NOT DISTINCT (show_type_id, name)
);

CREATE INDEX IF NOT EXISTS idx_standard_divisions_show_type
    ON standard_divisions (show_type_id, sort_order);

-- ── 3. Seed standard rings (universal — same names work across associations) ──

INSERT INTO standard_rings (name, sort_order) VALUES
    ('Ring 1',         10),
    ('Ring 2',         20),
    ('Ring 3',         30),
    ('Ring 4',         40),
    ('Indoor Arena',   50),
    ('Outdoor Arena',  60),
    ('Covered Arena',  70),
    ('Main Arena',     80),
    ('Warm-Up Arena',  90)
ON CONFLICT (name) DO NOTHING;

-- ── 4. Seed APHA standard divisions ────────────────────────────────────────────
-- Discipline-based grouping (demographic split — Open/Amateur/Youth/SPB —
-- is captured per-entry via entries.apha_division, not at the division level).

INSERT INTO standard_divisions (show_type_id, name, sort_order)
SELECT st.id, d.name, d.sort_order
FROM show_types st
CROSS JOIN (VALUES
    ('Halter',                  10),
    ('Color',                   20),
    ('Showmanship',             30),
    ('Hunter Under Saddle',     40),
    ('Hunt Seat Equitation',    50),
    ('Hunter Hack',             60),
    ('Working Hunter',          70),
    ('Jumping',                 80),
    ('Western Pleasure',        90),
    ('Western Horsemanship',   100),
    ('Western Riding',         110),
    ('Trail',                  120),
    ('Ranch Riding',           130),
    ('Ranch Trail',            140),
    ('Ranch Pleasure',         150),
    ('Ranch Rail Pleasure',    160),
    ('Ranch Reining',          170),
    ('Reining',                180),
    ('Working Cow Horse',      190),
    ('Cutting',                200),
    ('Barrel Racing',          210),
    ('Pole Bending',           220),
    ('Stake Race',             230),
    ('Breakaway Roping',       240),
    ('Tie-Down Roping',        250),
    ('Team Roping',            260),
    ('Walk-Trot',              270),
    ('Lead Line',              280)
) AS d(name, sort_order)
WHERE st.code = 'APHA'
ON CONFLICT (show_type_id, name) DO NOTHING;

-- ── 5. Seed AQHA standard divisions ────────────────────────────────────────────

INSERT INTO standard_divisions (show_type_id, name, sort_order)
SELECT st.id, d.name, d.sort_order
FROM show_types st
CROSS JOIN (VALUES
    ('Halter',                  10),
    ('Performance Halter',      20),
    ('Showmanship',             30),
    ('Hunter Under Saddle',     40),
    ('Hunt Seat Equitation',    50),
    ('Hunter Hack',             60),
    ('Working Hunter',          70),
    ('Equitation Over Fences',  80),
    ('Jumping',                 90),
    ('Western Pleasure',       100),
    ('Western Horsemanship',   110),
    ('Western Riding',         120),
    ('Trail',                  130),
    ('Ranch Riding',           140),
    ('Ranch Trail',            150),
    ('Ranch Pleasure',         160),
    ('Ranch Rail Pleasure',    170),
    ('Ranch Reining',          180),
    ('Ranch Cow Work',         190),
    ('Reining',                200),
    ('Working Cow Horse',      210),
    ('Cutting',                220),
    ('Barrel Racing',          230),
    ('Pole Bending',           240),
    ('Stake Race',             250),
    ('Breakaway Roping',       260),
    ('Tie-Down Roping',        270),
    ('Heading',                280),
    ('Heeling',                290),
    ('Dally Team Roping',      300),
    ('Walk-Trot',              310),
    ('Lead Line',              320)
) AS d(name, sort_order)
WHERE st.code = 'AQHA'
ON CONFLICT (show_type_id, name) DO NOTHING;

-- ── 6. Seed generic fallback divisions (show_type_id NULL) ─────────────────────
-- Used by OPEN and any other show type that has no curated list.

INSERT INTO standard_divisions (show_type_id, name, sort_order)
VALUES
    (NULL, 'Halter',                10),
    (NULL, 'Showmanship',           20),
    (NULL, 'Hunter Under Saddle',   30),
    (NULL, 'Hunt Seat Equitation',  40),
    (NULL, 'Western Pleasure',      50),
    (NULL, 'Western Horsemanship',  60),
    (NULL, 'Trail',                 70),
    (NULL, 'Ranch Riding',          80),
    (NULL, 'Reining',               90),
    (NULL, 'Barrel Racing',        100),
    (NULL, 'Pole Bending',         110),
    (NULL, 'Walk-Trot',            120),
    (NULL, 'Lead Line',            130)
ON CONFLICT (show_type_id, name) DO NOTHING;

INSERT INTO _migrations (name) VALUES ('035_rings_divisions_setup') ON CONFLICT DO NOTHING;

COMMIT;
