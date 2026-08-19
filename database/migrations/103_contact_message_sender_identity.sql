-- Migration 103: say who sent it, when the app actually knows.
--
-- `show_contact_messages` was built for visitors with no account, so every
-- field about the sender is self-reported text joined to nothing (migration
-- 091). That is still right for a stranger asking about stall availability.
--
-- It is wrong for the exhibitor who is entered in nine classes and wants to
-- know whether their Coggins arrived. The secretary reading "Sarah Mitchell"
-- in a free-text field cannot tell whether that is the Sarah Mitchell holding
-- back number 42 or somebody who has never been to the show, and answering the
-- question depends on knowing. Asking the sender to type their back number
-- would be a self-reported answer to an identity question — which is the same
-- hole with an extra step.
--
-- So: two nullable columns, written by the backend from the session and never
-- from the request body. NULL means exactly what it meant before — an
-- unauthenticated sender, take the text at face value. Non-NULL means the app
-- watched them sign in.
--
-- SET NULL rather than CASCADE on both: a message is a record of a
-- conversation the show office had, and deleting an account should not quietly
-- remove the question they asked or the answer it got.

BEGIN;

ALTER TABLE show_contact_messages
    ADD COLUMN IF NOT EXISTS sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS sender_exhibitor_id UUID REFERENCES exhibitors(id) ON DELETE SET NULL;

-- The inbox reads these to badge a message as coming from a known entrant.
CREATE INDEX IF NOT EXISTS idx_show_contact_messages_sender_exhibitor
    ON show_contact_messages (sender_exhibitor_id)
    WHERE sender_exhibitor_id IS NOT NULL;

COMMENT ON COLUMN show_contact_messages.sender_user_id IS
    'The signed-in account that sent this, or NULL for an anonymous sender. Written from the session, never from the request body.';
COMMENT ON COLUMN show_contact_messages.sender_exhibitor_id IS
    'The sender''s exhibitor record when they had one. Lets the inbox tie a message to a back number without trusting typed-in text.';

INSERT INTO _migrations (name) VALUES ('103_contact_message_sender_identity.sql')
ON CONFLICT DO NOTHING;

COMMIT;
