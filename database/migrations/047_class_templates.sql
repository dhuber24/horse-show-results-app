-- Migration 047: Class templates for the Schedule Builder, plus OPEN-specific
-- age/skill divisions.
--
-- The Schedule Builder lets a secretary lay out a show as a matrix:
-- rows = class templates (discipline), columns = divisions (age/skill).
-- Open shows almost universally follow this shape (Showmanship 10 & Under,
-- Showmanship 11-17, etc.), and today they have no bulk-creation path.
--
-- Migration 035 seeded discipline-style divisions as the OPEN fallback set
-- (show_type_id NULL). Those remain as a fallback. Here we add a curated set
-- of age/skill divisions tagged with show_type_id = OPEN's id so they become
-- the natural division axis for OPEN shows in the builder.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. class_templates table ──────────────────────────────────────────────────
-- is_seed=TRUE rows with show_id NULL are global library entries.
-- Custom templates carry show_id and are scoped to that show.

CREATE TABLE IF NOT EXISTS class_templates (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id            UUID REFERENCES shows(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    default_score_type TEXT NOT NULL DEFAULT 'placement',
    category           TEXT NOT NULL DEFAULT 'rail',
    sort_order         INTEGER NOT NULL DEFAULT 0,
    is_seed            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_class_templates_show_name UNIQUE NULLS NOT DISTINCT (show_id, name),
    CONSTRAINT ck_class_templates_score_type
        CHECK (default_score_type IN ('placement','pattern','time')),
    CONSTRAINT ck_class_templates_category
        CHECK (category IN ('halter','showmanship','rail','pattern','speed','other'))
);

CREATE INDEX IF NOT EXISTS idx_class_templates_show_sort
    ON class_templates(show_id, sort_order);

-- ── 2. Seed canonical open-show class templates ────────────────────────────────

INSERT INTO class_templates (show_id, name, default_score_type, category, sort_order, is_seed)
VALUES
    (NULL, 'Halter',                    'placement', 'halter',       10, TRUE),
    (NULL, 'Showmanship',               'pattern',   'showmanship',  20, TRUE),
    (NULL, 'Hunt Seat Pleasure',        'placement', 'rail',         30, TRUE),
    (NULL, 'Hunt Seat Equitation',      'pattern',   'pattern',      40, TRUE),
    (NULL, 'Hunter Hack',               'placement', 'pattern',      50, TRUE),
    (NULL, 'Western Pleasure',          'placement', 'rail',         60, TRUE),
    (NULL, 'Western Horsemanship',      'pattern',   'pattern',      70, TRUE),
    (NULL, 'Trail',                     'pattern',   'pattern',      80, TRUE),
    (NULL, 'Ranch Riding',              'pattern',   'pattern',      90, TRUE),
    (NULL, 'Ranch Trail',               'pattern',   'pattern',     100, TRUE),
    (NULL, 'Reining',                   'pattern',   'pattern',     110, TRUE),
    (NULL, 'Barrel Racing',             'time',      'speed',       120, TRUE),
    (NULL, 'Pole Bending',              'time',      'speed',       130, TRUE),
    (NULL, 'Stake Race',                'time',      'speed',       140, TRUE),
    (NULL, 'Lead Line',                 'placement', 'other',       150, TRUE)
ON CONFLICT ON CONSTRAINT uq_class_templates_show_name DO NOTHING;

-- ── 3. Seed OPEN-specific age/skill divisions ─────────────────────────────────
-- Migration 035's NULL-show_type_id seeds (discipline-based) are kept as a
-- fallback the secretary can still pick from. These OPEN-tagged ones surface
-- first in the Schedule Builder's division axis.

INSERT INTO standard_divisions (show_type_id, name, sort_order)
SELECT st.id, d.name, d.sort_order
FROM show_types st
CROSS JOIN (VALUES
    ('Lead Line (8 & Under)',  10),
    ('10 & Under',             20),
    ('11-13',                  30),
    ('14-17',                  40),
    ('18 & Over',              50),
    ('Walk-Trot',              60),
    ('Walk-Trot-Canter',       70),
    ('Novice/Green Horse',     80),
    ('Open',                   90)
) AS d(name, sort_order)
WHERE st.code = 'OPEN'
ON CONFLICT (show_type_id, name) DO NOTHING;

INSERT INTO _migrations (name) VALUES ('047_class_templates.sql') ON CONFLICT DO NOTHING;

COMMIT;
