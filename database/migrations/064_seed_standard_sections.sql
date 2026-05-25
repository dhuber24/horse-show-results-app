-- Migration 064: Seed standard_sections
-- The table was created in migration 048 but never populated.
-- Seed generic (NULL show_type_id) brackets for all show types,
-- plus APHA- and AQHA-specific brackets.

BEGIN;

-- Generic brackets (NULL show_type_id) - shown for every show type.
INSERT INTO standard_sections (id, show_type_id, name, sort_order) VALUES
    (gen_random_uuid(), NULL, 'Open',                 10),
    (gen_random_uuid(), NULL, 'Amateur',               20),
    (gen_random_uuid(), NULL, 'Youth',                 30),
    (gen_random_uuid(), NULL, 'Lead Line',             40),
    (gen_random_uuid(), NULL, 'Walk-Trot',             50),
    (gen_random_uuid(), NULL, 'Walk-Trot-Canter',      60),
    (gen_random_uuid(), NULL, '10 & Under',            70),
    (gen_random_uuid(), NULL, '11-13',                 80),
    (gen_random_uuid(), NULL, '14-17',                 90),
    (gen_random_uuid(), NULL, '18 & Over',            100),
    (gen_random_uuid(), NULL, 'Novice/Green Horse',   110)
ON CONFLICT (show_type_id, name) DO NOTHING;

-- APHA-specific brackets.
INSERT INTO standard_sections (id, show_type_id, name, sort_order)
SELECT gen_random_uuid(), st.id, v.name, v.sort_order
FROM show_types st,
(VALUES
    ('Open',             10),
    ('Amateur',          20),
    ('Amateur 18-35',    25),
    ('Amateur 36+',      27),
    ('Youth 13 & Under', 30),
    ('Youth 14-18',      35),
    ('SPB Open',         40),
    ('SPB Amateur',      50),
    ('SPB Youth',        60),
    ('Lead Line',        70),
    ('Walk-Trot',        80),
    ('Walk-Trot-Canter', 90),
    ('10 & Under',      100),
    ('11-13',           110),
    ('14-17',           120),
    ('18 & Over',       130)
) AS v(name, sort_order)
WHERE st.code = 'APHA'
ON CONFLICT (show_type_id, name) DO NOTHING;

-- AQHA-specific brackets.
INSERT INTO standard_sections (id, show_type_id, name, sort_order)
SELECT gen_random_uuid(), st.id, v.name, v.sort_order
FROM show_types st,
(VALUES
    ('Open',                 10),
    ('Select (50+)',         20),
    ('Amateur',              30),
    ('Novice Amateur',       40),
    ('Youth 13 & Under',     50),
    ('Youth 14-18',          60),
    ('Walk-Trot 13 & Under', 70),
    ('Walk-Trot 14-18',      80),
    ('Level 1',              90)
) AS v(name, sort_order)
WHERE st.code = 'AQHA'
ON CONFLICT (show_type_id, name) DO NOTHING;

INSERT INTO _migrations (name) VALUES ('064_seed_standard_sections.sql') ON CONFLICT DO NOTHING;

COMMIT;
