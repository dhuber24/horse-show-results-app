-- Migration 073: User invite tokens for the Scorekeeper invite flow.
--
-- Replaces the inline-password "create scorekeeper" form on the Show Staff
-- page. A Show Manager / Show Secretary now enters first name, last name,
-- and email; the backend stores a `user_invites` row with a URL-safe token
-- and a 14-day expiry, and the manager shares the resulting accept URL
-- with the invitee (email delivery itself is a follow-up).
--
-- On accept, the public endpoint creates a User account with the password
-- the invitee chooses, optionally assigns them to the show that issued the
-- invite (for scorekeepers), and marks the invite `accepted`.
--
-- Scoped to SCOREKEEPER for now (per the current product ask) but the
-- `role` column is intentionally general so the same machinery can be
-- pointed at Secretary / Manager invites later without a schema change.

BEGIN;

CREATE TABLE user_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    role TEXT NOT NULL,
    show_id UUID REFERENCES shows(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    invited_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    accepted_at TIMESTAMPTZ,
    accepted_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX user_invites_show_id_status_idx
    ON user_invites (show_id, status, created_at DESC);
CREATE INDEX user_invites_email_status_idx
    ON user_invites (lower(email), status);

INSERT INTO _migrations (name) VALUES ('073_scorekeeper_invites.sql')
ON CONFLICT DO NOTHING;

COMMIT;
