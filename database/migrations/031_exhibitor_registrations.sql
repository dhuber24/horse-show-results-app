-- Migration 031: exhibitor_registrations
-- Stores association membership numbers per exhibitor (one per association).
-- Mirrors the horse_registrations pattern.

CREATE TABLE exhibitor_registrations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exhibitor_id UUID NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
    show_type_id UUID NOT NULL REFERENCES show_types(id) ON DELETE CASCADE,
    member_number TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (exhibitor_id, show_type_id)
);

CREATE INDEX idx_exhibitor_registrations_exhibitor ON exhibitor_registrations(exhibitor_id);

INSERT INTO _migrations (name) VALUES ('031_exhibitor_registrations');
