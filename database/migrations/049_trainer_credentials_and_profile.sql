-- Trainer credentials and ad-ready public profile.
--   * Adds public/business profile columns (business_name, location, website, bio, socials, photo metadata).
--   * Adds compliance fields visible to the trainer themselves and admin/secretary only.
--     SafeSport completion + USEF/equivalent background-check expiry parallel
--     users.aqha_management_workshop_completed_at.
--   * Adds an opt-in has_liability_insurance flag (no carrier/policy details yet).
--   * Adds is_public toggle gating the future public/ad listing surface.
--   * New trainer_registrations table mirrors exhibitor_registrations and stores
--     per-association membership numbers plus a status (professional/non_pro/general)
--     and optional expiry.
--   * New trainer_documents table mirrors exhibitor_documents for headshot uploads.
--     document_type is currently limited to HEADSHOT but the CHECK is written so
--     future additions (COI, W-9 indicator, etc.) can be added with an ALTER.

ALTER TABLE trainers
    ADD COLUMN IF NOT EXISTS business_name TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT,
    ADD COLUMN IF NOT EXISTS state TEXT,
    ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'US',
    ADD COLUMN IF NOT EXISTS website TEXT,
    ADD COLUMN IF NOT EXISTS bio TEXT,
    ADD COLUMN IF NOT EXISTS social_facebook TEXT,
    ADD COLUMN IF NOT EXISTS social_instagram TEXT,
    ADD COLUMN IF NOT EXISTS social_tiktok TEXT,
    ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS safesport_completed_at DATE,
    ADD COLUMN IF NOT EXISTS background_check_expires_at DATE,
    ADD COLUMN IF NOT EXISTS has_liability_insurance BOOLEAN NOT NULL DEFAULT FALSE;


CREATE TABLE IF NOT EXISTS trainer_registrations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id    UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    show_type_id  UUID NOT NULL REFERENCES show_types(id) ON DELETE CASCADE,
    member_number TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'general'
                  CHECK (status IN ('professional', 'non_pro', 'general')),
    expires_at    DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (trainer_id, show_type_id)
);

CREATE INDEX IF NOT EXISTS idx_trainer_registrations_trainer
    ON trainer_registrations(trainer_id);


CREATE TABLE IF NOT EXISTS trainer_documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id          UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    document_type       TEXT NOT NULL
                        CHECK (document_type IN ('HEADSHOT')),
    original_filename   TEXT NOT NULL,
    file_data           BYTEA NOT NULL,
    mime_type           TEXT NOT NULL,
    file_size           INTEGER NOT NULL,
    uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trainer_documents_trainer
    ON trainer_documents(trainer_id);

-- One headshot per trainer keeps the API simple; later additions (COI, W-9 proof)
-- will be different document_type values and this partial unique becomes per-type.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_documents_one_headshot
    ON trainer_documents(trainer_id)
    WHERE document_type = 'HEADSHOT';


INSERT INTO _migrations (name) VALUES ('049_trainer_credentials_and_profile');
