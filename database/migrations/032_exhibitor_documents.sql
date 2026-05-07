CREATE TABLE IF NOT EXISTS exhibitor_documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exhibitor_id UUID NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL
        CHECK (document_type IN ('MEMBERSHIP_CARD','AMATEUR_CARD','YOUTH_CARD','MEDICAL','IDENTIFICATION','OTHER')),
    original_filename TEXT NOT NULL,
    file_data   BYTEA NOT NULL,
    mime_type   TEXT NOT NULL,
    file_size   INTEGER NOT NULL,
    issue_date  DATE,
    expiry_date DATE,
    uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exhibitor_documents_exhibitor_id ON exhibitor_documents(exhibitor_id);
