-- Migration: add SHOW_ADMIN role support
-- - created_by_user_id on shows and venues
-- - show_admins join table (many show admins per show)
-- - show_scorekeepers join table (scorekeepers assigned per show)
--
-- Apply with:
--   docker compose exec backend python run_migration.py database/migrations/002_show_admin_role.sql

BEGIN;

-- 1) Track who created each venue
ALTER TABLE venues
    ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- 2) Track who created each show
ALTER TABLE shows
    ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- 3) Many-to-many: show admins per show (system ADMIN assigns)
CREATE TABLE IF NOT EXISTS show_admins (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id     UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (show_id, user_id)
);

-- 4) Many-to-many: scorekeepers assigned per show
--    Show Admin can create new scorekeepers; only system ADMIN assigns existing ones
CREATE TABLE IF NOT EXISTS show_scorekeepers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id     UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (show_id, user_id)
);

COMMIT;
