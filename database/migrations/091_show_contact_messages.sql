-- Migration 091: an inbox for "how do I ask the show office a question?"
--
-- A visitor who has not made an account has no way to reach a show. The show
-- page now offers them one, and this is where what they write lands.
--
-- Deliberately an inbox rather than an email relay. `backend/mailer.py` is
-- best-effort by design and returns None with no SMTP configured, so a
-- forward-only contact form would accept a message, tell the visitor it was
-- sent, and drop it — the one failure a contact form must not have. Staff read
-- these on the show's own Messages screen; wiring a notification on top later
-- is additive and changes nothing here.
--
-- The sender is untrusted and unauthenticated: everything about them is
-- self-reported text, and nothing in this table is joined back to `users`.
-- That is the point — the whole feature exists for people who have no account.
--
-- CASCADE on the show: these are questions about one show, so they retire with
-- it and the table stays bounded.

BEGIN;

CREATE TABLE IF NOT EXISTS show_contact_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    -- Self-reported contact details. Untrusted, never matched to an account.
    sender_name TEXT NOT NULL,
    sender_email TEXT NOT NULL,
    sender_phone TEXT,
    subject TEXT,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'read', 'archived')),
    -- Who on staff dealt with it, for shows run by more than one person.
    handled_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    handled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The inbox reads newest-first and badges the unread count.
CREATE INDEX IF NOT EXISTS idx_show_contact_messages_show
    ON show_contact_messages (show_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_show_contact_messages_unread
    ON show_contact_messages (show_id) WHERE status = 'new';

COMMENT ON TABLE show_contact_messages IS
    'Messages sent to a show from its public page, including by visitors with no account. Read on the show Messages screen.';
COMMENT ON COLUMN show_contact_messages.sender_email IS
    'Self-reported and unverified — the sender has no account by definition. Never treat as an identity.';

INSERT INTO _migrations (name) VALUES ('091_show_contact_messages.sql')
ON CONFLICT DO NOTHING;

COMMIT;
