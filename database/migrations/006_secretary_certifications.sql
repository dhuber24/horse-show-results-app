-- Migration: add show_secretary_certifications table
-- Stores which show types a Show Secretary is certified for, along with their
-- association-issued Secretary ID number.

BEGIN;

CREATE TABLE IF NOT EXISTS show_secretary_certifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    show_type_id UUID NOT NULL REFERENCES show_types(id) ON DELETE CASCADE,
    secretary_id_number TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, show_type_id)
);

INSERT INTO _migrations (name) VALUES ('006_secretary_certifications.sql') ON CONFLICT DO NOTHING;

COMMIT;
