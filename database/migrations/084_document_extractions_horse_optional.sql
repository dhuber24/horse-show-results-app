-- 084_document_extractions_horse_optional.sql
--
-- Let an extraction exist before its horse does.
--
-- The add-a-horse wizard stages health documents in the browser and uploads
-- them only after the horse is created (`uploadQueuedDocs`), because the upload
-- endpoint needs a horse_id. That is exactly the moment an exhibitor first
-- files a Coggins, and it was the one upload path extraction could not reach:
-- there is no horse to analyze against yet.
--
-- So horse_id becomes nullable and is filled in when the queued document is
-- finally saved. A row with a NULL horse_id is a read taken against a horse
-- that did not exist yet — either still queued, or abandoned when the user
-- cancelled the wizard.
--
-- Idempotent: backend startup runs Base.metadata.create_all, which may have
-- already created or altered the table.

BEGIN;

ALTER TABLE document_extractions ALTER COLUMN horse_id DROP NOT NULL;

COMMENT ON COLUMN document_extractions.horse_id IS
    'NULL when the document was read before its horse existed (add-a-horse wizard); set when the queued document is saved.';

INSERT INTO _migrations (name) VALUES ('084_document_extractions_horse_optional.sql')
ON CONFLICT DO NOTHING;

COMMIT;
