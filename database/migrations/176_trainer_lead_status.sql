-- 176: a trainer's messages get an inbox, with new / read / archived.
--
-- A Contact Trainer message (`trainer_leads`, migration 165) was emailed to
-- the trainer in full, Reply-To the sender, and listed at the foot of their
-- Trainer Registry page with nothing to say which had been dealt with. It now
-- lands in an inbox of the trainer's own (`/profile/registry/messages`), with
-- an unread count in their top bar, and the email is a notice linking to it.
-- `status` is the same three states a show's messages have (migration 091).
--
-- Every message already sent was emailed and read where it landed, so the
-- rows there now are `read`; a new message arrives `new`.
--
-- A column with a default: backward-compatible, so this goes to production
-- before the code.

BEGIN;

ALTER TABLE trainer_leads ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'read';
ALTER TABLE trainer_leads ALTER COLUMN status SET DEFAULT 'new';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_trainer_leads_status') THEN
        ALTER TABLE trainer_leads
            ADD CONSTRAINT ck_trainer_leads_status CHECK (status IN ('new', 'read', 'archived'));
    END IF;
END $$;

-- The top bar's count, on every page a trainer opens.
CREATE INDEX IF NOT EXISTS ix_trainer_leads_unread
    ON trainer_leads (trainer_id) WHERE status = 'new';

INSERT INTO _migrations (name) VALUES ('176_trainer_lead_status.sql')
ON CONFLICT DO NOTHING;

COMMIT;
