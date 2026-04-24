-- Migration: horse document uploads
-- Stores horse health and registration documents as binary data in Postgres.
-- To migrate to S3 later: add a storage_key column, backfill it, then drop file_data.

BEGIN;

CREATE TABLE IF NOT EXISTS horse_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL CHECK (document_type IN (
        'COGGINS', 'VACCINATION', 'HEALTH_CERTIFICATE', 'REGISTRATION'
    )),
    original_filename TEXT NOT NULL,
    file_data BYTEA NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    issue_date DATE,
    expiry_date DATE,
    uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_horse_documents_horse_id ON horse_documents(horse_id);

INSERT INTO _migrations (name) VALUES ('009_horse_documents.sql') ON CONFLICT DO NOTHING;

COMMIT;
