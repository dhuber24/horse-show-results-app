-- Migration: decouple venue ownership from Show Admin
-- - Replace created_by_user_id on venues with a venue_admins join table
-- - Venues are now ADMIN-only for create/edit/delete
-- - Show Admins are assigned to venues by system Admin

BEGIN;

CREATE TABLE IF NOT EXISTS venue_admins (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id   UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (venue_id, user_id)
);

ALTER TABLE venues DROP COLUMN IF EXISTS created_by_user_id;

COMMIT;
