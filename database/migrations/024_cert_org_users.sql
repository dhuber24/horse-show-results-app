-- Migration 024: cert_org_users
-- Stores certified show manager records imported from the certifying organization.
-- Used to validate Show Secretary registration credentials.

CREATE TABLE IF NOT EXISTS cert_org_users (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name       TEXT        NOT NULL,
    last_name        TEXT        NOT NULL,
    email            TEXT,
    state_province   TEXT,
    country          TEXT,
    completion_date  DATE,
    expiration       DATE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cert_org_users_email      ON cert_org_users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_cert_org_users_expiration ON cert_org_users (expiration);

INSERT INTO _migrations (name) VALUES ('024_cert_org_users.sql');
