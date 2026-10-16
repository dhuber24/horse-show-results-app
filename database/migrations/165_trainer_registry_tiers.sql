-- Migration 165: Trainer Registry plans — Basic (free) and Pro.
--
-- The registry at /trainers listed every trainer who opted in the same way.
-- It now sells a Pro plan ($10 a month or $100 a year) on top of a free Basic
-- listing; the plans and what each shows are `backend/trainer_registry.py`.
--
-- **The app takes no payment**, as with a show company's GaitDesk Pro
-- (migration 142). A trainer asks for Pro (`trainer_pro_requests`), a GaitDesk
-- admin bills them outside the app and records how long they have paid for
-- (`trainers.pro_until`). **Pro is derived from that date** — on through the
-- day it names, Basic after — so a lapsed subscription needs nobody to switch
-- it off, and there is no tier column to disagree with it.
--
-- What it adds:
--
--   * trainers.zip_code — where the trainer works, for the near-me search.
--     Looked up in backend/data/us_zip_centroids.csv; never shown publicly.
--   * trainers.disciplines — what they train, from TRAINER_DISCIPLINES in
--     trainer_registry.py. No CHECK, for the reason gaitdesk_contact_messages
--     .topic has none: a discipline added to the list should not need a
--     migration.
--   * trainers.video_urls, trainers.rate_sheet — Pro listing content. Any
--     trainer may fill them in; the public listing shows them only on Pro.
--   * trainers.pro_until / pro_plan — what the admin recorded.
--   * trainer_documents gains LOGO and PHOTO beside HEADSHOT.
--   * trainer_pro_requests — one open request per trainer; switching Pro on
--     answers it, as switching a company's feature on answers its request.
--   * trainer_leads — what the Contact Trainer form sends. Stored, then emailed
--     to the trainer, because mailer.py does nothing without SMTP and a lead
--     that was only an email could be lost.
--
-- All of it is additive — nullable or defaulted columns, new tables, a widened
-- CHECK — so it is safe to apply before the code that reads it.

BEGIN;

ALTER TABLE trainers ADD COLUMN IF NOT EXISTS zip_code TEXT;
ALTER TABLE trainers ADD COLUMN IF NOT EXISTS disciplines TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE trainers ADD COLUMN IF NOT EXISTS video_urls TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE trainers ADD COLUMN IF NOT EXISTS rate_sheet JSONB NOT NULL DEFAULT '[]';
ALTER TABLE trainers ADD COLUMN IF NOT EXISTS pro_until DATE;
ALTER TABLE trainers ADD COLUMN IF NOT EXISTS pro_plan TEXT;

ALTER TABLE trainers DROP CONSTRAINT IF EXISTS ck_trainers_pro_plan;
ALTER TABLE trainers ADD CONSTRAINT ck_trainers_pro_plan
    CHECK (pro_plan IS NULL OR pro_plan IN ('monthly', 'annual'));

-- The registry filters on these.
CREATE INDEX IF NOT EXISTS idx_trainers_public ON trainers (is_public) WHERE is_public;

-- A logo (one, like the headshot) and a photo gallery.
ALTER TABLE trainer_documents DROP CONSTRAINT IF EXISTS trainer_documents_document_type_check;
ALTER TABLE trainer_documents ADD CONSTRAINT trainer_documents_document_type_check
    CHECK (document_type IN ('HEADSHOT', 'LOGO', 'PHOTO'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_documents_one_logo
    ON trainer_documents (trainer_id)
    WHERE document_type = 'LOGO';

CREATE TABLE IF NOT EXISTS trainer_pro_requests (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id            UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    plan                  TEXT NOT NULL,
    requested_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_trainer_pro_requests_trainer UNIQUE (trainer_id)
);

-- Stated apart from the CREATE TABLE, for the create_all race (migration 114).
ALTER TABLE trainer_pro_requests ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE trainer_pro_requests ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE trainer_pro_requests DROP CONSTRAINT IF EXISTS ck_trainer_pro_requests_plan;
ALTER TABLE trainer_pro_requests ADD CONSTRAINT ck_trainer_pro_requests_plan
    CHECK (plan IN ('monthly', 'annual'));

CREATE TABLE IF NOT EXISTS trainer_leads (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id    UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    -- Self-reported by whoever filled in the form. Untrusted.
    sender_name   TEXT NOT NULL,
    sender_email  TEXT NOT NULL,
    sender_phone  TEXT,
    message       TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE trainer_leads ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE trainer_leads ALTER COLUMN created_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_trainer_leads_trainer_created
    ON trainer_leads (trainer_id, created_at DESC);

COMMENT ON COLUMN trainers.pro_until IS
    'Trainer Registry Pro is on through this date, Basic after it. Set by a GaitDesk admin once paid.';
COMMENT ON TABLE trainer_leads IS
    'Messages sent to a Pro trainer from the Contact Trainer button on their registry listing.';

INSERT INTO _migrations (name) VALUES ('165_trainer_registry_tiers.sql')
ON CONFLICT DO NOTHING;

COMMIT;
