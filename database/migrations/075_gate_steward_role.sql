-- Migration 075: GATE_STEWARD role + gate management state.
--
-- Adds a new staff role responsible for the warm-up side of the in-gate:
-- deciding who enters the ring next and when. Mirrors the scorekeeper
-- staffing pattern (per-show assignment table + invite flow) and adds the
-- per-entry state the gate screen manages:
--
--   entries.gate_order  — 1-based order-of-go within the class (NULL = not
--                         yet ordered; falls back to back-number order).
--   entries.gate_status — waiting | on_deck | in_ring | done.

BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS check_user_role;
ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_role;  -- stale duplicate from migration 016
ALTER TABLE users ADD CONSTRAINT check_user_role
    CHECK (role IN ('ADMIN', 'SHOW_SECRETARY', 'SCOREKEEPER', 'EXHIBITOR', 'SHOW_MANAGER', 'TRAINER', 'GATE_STEWARD'));

-- IF NOT EXISTS guards: the backend's startup create_all may have already
-- created the table from the ORM models before this migration ran.
CREATE TABLE IF NOT EXISTS show_gate_stewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (show_id, user_id)
);

ALTER TABLE entries ADD COLUMN IF NOT EXISTS gate_order INTEGER;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS gate_status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (gate_status IN ('waiting', 'on_deck', 'in_ring', 'done'));

INSERT INTO _migrations (name) VALUES ('075_gate_steward_role.sql')
ON CONFLICT DO NOTHING;

COMMIT;
