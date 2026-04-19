-- Migration: introduce show_types, wipe existing show/class/horse/exhibitor data,
-- and require every show to have a show_type.
--
-- Apply with:
--   docker compose exec -T db psql -U postgres -d horseshow < database/migrations/001_show_types.sql

BEGIN;

-- 1) Truncate data as requested (cascade clears dependents: entries, results, etc.)
TRUNCATE TABLE
    shows,
    classes,
    horses,
    exhibitors,
    exhibitor_horses,
    entries,
    results,
    result_audit,
    show_entries,
    rings,
    divisions
RESTART IDENTITY CASCADE;

-- 2) Create show_types
CREATE TABLE IF NOT EXISTS show_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3) Seed default types
INSERT INTO show_types (code, name) VALUES
    ('APHA', 'American Paint Horse Association'),
    ('AQHA', 'American Quarter Horse Association'),
    ('OPEN', 'Open / Unaffiliated')
ON CONFLICT (code) DO NOTHING;

-- 4) Add required FK on shows
ALTER TABLE shows
    ADD COLUMN IF NOT EXISTS show_type_id UUID REFERENCES show_types(id);

-- Since shows was truncated, no backfill needed. Enforce NOT NULL.
ALTER TABLE shows
    ALTER COLUMN show_type_id SET NOT NULL;

COMMIT;
