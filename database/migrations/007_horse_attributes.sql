-- Migration: horse attributes
-- Adds breeds and horse_colors lookup tables, new columns on horses,
-- and a horse_registrations table for association registration numbers.

BEGIN;

CREATE TABLE IF NOT EXISTS breeds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS horse_colors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE horses
    ADD COLUMN IF NOT EXISTS foaling_date DATE,
    ADD COLUMN IF NOT EXISTS sex TEXT CHECK (sex IN ('Mare', 'Gelding', 'Stallion')),
    ADD COLUMN IF NOT EXISTS breed_id UUID REFERENCES breeds(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS color_id UUID REFERENCES horse_colors(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS horse_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
    show_type_id UUID NOT NULL REFERENCES show_types(id) ON DELETE CASCADE,
    registration_number TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(horse_id, show_type_id)
);

INSERT INTO breeds (name, sort_order) VALUES
    ('American Quarter Horse', 1),
    ('American Paint Horse',   2),
    ('Appaloosa',              3),
    ('Arabian',                4),
    ('Morgan',                 5),
    ('Thoroughbred',           6),
    ('Pinto',                  7),
    ('Mustang',                8),
    ('Tennessee Walking Horse',9),
    ('Missouri Fox Trotter',  10),
    ('Rocky Mountain Horse',  11),
    ('American Saddlebred',   12),
    ('Standardbred',          13),
    ('Andalusian',            14),
    ('Friesian',              15),
    ('Warmblood',             16),
    ('Crossbred / Grade',     17)
ON CONFLICT (name) DO NOTHING;

INSERT INTO horse_colors (name, sort_order) VALUES
    ('Bay',                          1),
    ('Black',                        2),
    ('Brown',                        3),
    ('Chestnut',                     4),
    ('Sorrel',                       5),
    ('Grey',                         6),
    ('White',                        7),
    ('Palomino',                     8),
    ('Buckskin',                     9),
    ('Dun',                         10),
    ('Red Dun',                     11),
    ('Grullo',                      12),
    ('Cremello',                    13),
    ('Perlino',                     14),
    ('Bay Roan',                    15),
    ('Blue Roan',                   16),
    ('Red Roan',                    17),
    ('Tobiano',                     18),
    ('Overo',                       19),
    ('Tovero',                      20),
    ('Sabino',                      21),
    ('Appaloosa – Blanket',         22),
    ('Appaloosa – Blanket with Spots', 23),
    ('Appaloosa – Leopard',         24),
    ('Appaloosa – Few Spot Leopard',25),
    ('Appaloosa – Snowflake',       26),
    ('Appaloosa – Roan',            27)
ON CONFLICT (name) DO NOTHING;

INSERT INTO _migrations (name) VALUES ('007_horse_attributes.sql') ON CONFLICT DO NOTHING;

COMMIT;
