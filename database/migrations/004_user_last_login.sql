-- Migration: track last login timestamp per user

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

COMMIT;
