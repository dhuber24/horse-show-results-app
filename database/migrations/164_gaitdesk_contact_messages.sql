-- Migration 164: an inbox for people who want to reach GaitDesk itself.
--
-- The app had a contact form for every show's own office (migration 091) and
-- none for GaitDesk -- migration 144 says as much. A club thinking about running
-- its shows here, somebody locked out of an account, a bug report: each had no
-- door at all. `/contact` is that door, and this table is where it lands.
--
-- **Stored, and only then emailed** -- the same reason a show's inbox is a
-- table and an upgrade request is a row. `mailer.py` does nothing without SMTP,
-- so a form that only sent an email could say "sent" and lose the message.
-- GaitDesk's admins read these at /admin/contact-messages, with an unread count
-- on the admin home; each admin is also emailed, best-effort.
--
-- **The sender is untrusted.** Everything they type is self-reported text.
-- `sender_user_id` is the one exception: written by the backend from the
-- session, never from the body, so "signed in as" can be believed.
--
-- `topic` carries no CHECK, for the reason `show_company_features.feature`
-- does not: the list is `TOPICS` in `backend/routers/gaitdesk_contact.py`, and
-- a new topic should not need a migration. `status` does, and the model
-- declares it under the same name, for the create_all race (migration 089).
--
-- A new table and nothing else, so the running release ignores it and this is
-- safe to apply before the code that reads it.

BEGIN;

CREATE TABLE IF NOT EXISTS gaitdesk_contact_messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic               TEXT NOT NULL,
    -- Self-reported contact details. Untrusted, never matched to an account.
    sender_name         TEXT NOT NULL,
    sender_email        TEXT NOT NULL,
    sender_phone        TEXT,
    organization        TEXT,
    subject             TEXT,
    message             TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'new',
    -- Who sent it, when they were signed in. From the session, never the body.
    sender_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Which admin dealt with it.
    handled_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    handled_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_gaitdesk_contact_messages_status
        CHECK (status IN ('new', 'read', 'archived'))
);

-- Stated apart from the CREATE TABLE, for the create_all race (migration 114).
ALTER TABLE gaitdesk_contact_messages ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE gaitdesk_contact_messages ALTER COLUMN status SET DEFAULT 'new';
ALTER TABLE gaitdesk_contact_messages ALTER COLUMN created_at SET DEFAULT now();

-- The inbox reads newest first and the admin home counts what is unread.
CREATE INDEX IF NOT EXISTS idx_gaitdesk_contact_messages_created
    ON gaitdesk_contact_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gaitdesk_contact_messages_unread
    ON gaitdesk_contact_messages (created_at) WHERE status = 'new';

COMMENT ON TABLE gaitdesk_contact_messages IS
    'Messages to GaitDesk itself from /contact, including from people with no account. Read by ADMINs at /admin/contact-messages.';
COMMENT ON COLUMN gaitdesk_contact_messages.sender_email IS
    'Self-reported and unverified. Never treat as an identity; sender_user_id is the session''s.';

INSERT INTO _migrations (name) VALUES ('164_gaitdesk_contact_messages.sql')
ON CONFLICT DO NOTHING;

COMMIT;
