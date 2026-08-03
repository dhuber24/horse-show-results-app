-- 083_document_extractions.sql
-- Provenance for AI-assisted reads of uploaded horse documents.
--
-- A row is written every time a document is analyzed, BEFORE the document is
-- saved. The uploader reviews the suggestion, edits anything wrong, and the row
-- is linked to the resulting horse_documents row on save. That ordering is the
-- point: the model never writes to a compliance field on its own, and when a
-- date on a horse's record is later questioned we can say whether a human typed
-- it, accepted it, or corrected it.
--
-- Idempotent: backend startup runs Base.metadata.create_all, so the table may
-- already exist in Neon before this migration runs.

BEGIN;

CREATE TABLE IF NOT EXISTS document_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
    -- NULL until the uploader saves. An extraction with no document is a read
    -- the uploader abandoned; those are still worth keeping as a record of what
    -- the model produced.
    document_id UUID REFERENCES horse_documents(id) ON DELETE CASCADE,

    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,

    -- succeeded | unsupported_media | failed
    status TEXT NOT NULL,
    error_message TEXT,

    -- Everything the model returned, verbatim. Kept whole rather than split
    -- into columns so that widening the extraction schema doesn't need a
    -- migration and old rows stay readable against the schema of their day.
    extracted JSONB,
    -- The values actually saved, and which of the model's suggestions the human
    -- changed on the way there.
    accepted JSONB,
    overridden_fields TEXT[] NOT NULL DEFAULT '{}',

    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,

    requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    linked_at TIMESTAMPTZ
);

-- `CREATE TABLE IF NOT EXISTS` is not enough on its own here. Backend startup
-- runs Base.metadata.create_all, and when it wins the race the table already
-- exists, so the CREATE above is skipped along with its column defaults.
-- SQLAlchemy generates ids Python-side (`default=uuid.uuid4`) rather than as a
-- server default, so the table it creates has no DEFAULT on `id` — the app
-- still works, but raw SQL inserts fail and a database built from migrations
-- would not match one built by create_all. Restate it unconditionally.
ALTER TABLE document_extractions ALTER COLUMN id SET DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS idx_document_extractions_horse
    ON document_extractions (horse_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_extractions_document
    ON document_extractions (document_id);

COMMENT ON TABLE document_extractions IS
    'One row per AI read of an uploaded horse document, with what the model suggested and what the human saved.';
COMMENT ON COLUMN document_extractions.document_id IS
    'NULL until the uploader saves the document; NULL forever if they abandon the upload.';
COMMENT ON COLUMN document_extractions.extracted IS
    'Raw structured output from the model, stored whole so the schema can widen without a migration.';
COMMENT ON COLUMN document_extractions.overridden_fields IS
    'Suggested fields the human changed before saving. Empty means every suggestion was accepted as-is.';

INSERT INTO _migrations (name) VALUES ('083_document_extractions.sql')
ON CONFLICT DO NOTHING;

COMMIT;
