-- Migration 022: Add SHOW_MANAGER role and show_managers join table

-- Update the role CHECK constraint to include SHOW_MANAGER
ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_role;
ALTER TABLE users ADD CONSTRAINT ck_users_role
    CHECK (role IN ('ADMIN', 'SHOW_SECRETARY', 'SCOREKEEPER', 'EXHIBITOR', 'SHOW_MANAGER'));

-- New show_managers join table (parallel to show_secretaries)
CREATE TABLE show_managers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id     UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (show_id, user_id)
);

CREATE INDEX idx_show_managers_show_id ON show_managers(show_id);
CREATE INDEX idx_show_managers_user_id ON show_managers(user_id);

INSERT INTO _migrations (name) VALUES ('022_show_manager_role.sql');
