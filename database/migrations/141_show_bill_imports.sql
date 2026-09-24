-- Migration 141: a show built from its own printed show bill.
--
-- Every show in this app is keyed in by hand through the setup wizard, and a
-- real one is a lot of keying: the MNSPHC Paint-O-Rama is 172 classes over two
-- days, four judges, two sanctioning clubs and a fee catalogue, and the club had
-- already laid all of that out once -- in the show bill it sent to the printer.
-- `scripts/seed_mnsphc_paint_o_rama.py` is a hand transcription of exactly that
-- bill, and it took a day.
--
-- This table is the record of the model reading a bill instead. It is shaped
-- after `document_extractions` (migration 083) and for the same reason: **the
-- model suggests and a person saves.** Nothing read off the file reaches a show
-- until somebody has looked at the review screen and pressed Create, and the
-- row is what makes the resulting show answerable afterwards -- what the model
-- read (`extracted`), what the person created (`accepted`), and which show that
-- became (`show_id`).
--
-- Two differences from `document_extractions`, both forced by the size of the
-- job:
--
--   * **The read runs in the background.** A horse document is one page and
--     comes back while the uploader waits; a show bill is ten or twenty pages
--     and a structured transcription of every class on it, which takes minutes.
--     So the row is written `pending` before the read starts and the review
--     screen polls it. A read the process never finished (a deploy mid-read) is
--     reported as failed once it is old enough, by the reader rather than by a
--     sweeper, so there is no job to forget to run.
--   * **The file is kept.** `file_data` is the uploaded bill, because creating
--     the show also puts it on file as that show's SHOWBILL document
--     (`show_documents`, migration 127) -- the club's own copy, on record,
--     while the Show Bill button stays on the generated one.
--
-- A new table and nothing else, so the running release ignores it and this is
-- safe to apply before the code that reads it.

BEGIN;

CREATE TABLE IF NOT EXISTS show_bill_imports (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    original_filename  TEXT NOT NULL,
    mime_type          TEXT NOT NULL,
    file_size          INTEGER NOT NULL,
    file_data          BYTEA NOT NULL,
    status             TEXT NOT NULL DEFAULT 'pending',
    error_message      TEXT,
    extracted          JSONB,
    accepted           JSONB,
    show_id            UUID REFERENCES shows(id) ON DELETE SET NULL,
    model              TEXT,
    input_tokens       INTEGER,
    output_tokens      INTEGER,
    created_at         TIMESTAMPTZ DEFAULT now(),
    completed_at       TIMESTAMPTZ,
    applied_at         TIMESTAMPTZ
);

-- Stated apart from the CREATE TABLE: startup's `create_all` may have made the
-- table from the model before this ran, in which case the IF NOT EXISTS above
-- skipped and neither the default nor the CHECK would exist (see the migration
-- 114 note in CLAUDE.md).
ALTER TABLE show_bill_imports ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_bill_imports ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE show_bill_imports DROP CONSTRAINT IF EXISTS show_bill_imports_status_check;
ALTER TABLE show_bill_imports ADD CONSTRAINT show_bill_imports_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'unsupported_media'));

COMMENT ON TABLE show_bill_imports IS
    'One AI read of an uploaded show bill, and the show a person created from it after review. The model only suggests: extracted is what it read, accepted is what the reviewer submitted, show_id is what that became. See docs/showbill-import.md.';

COMMENT ON COLUMN show_bill_imports.status IS
    'pending while the background read runs; succeeded, failed or unsupported_media once it has finished. A pending row older than the read timeout is reported as failed by the reader -- the process that owned it is gone.';

COMMENT ON COLUMN show_bill_imports.file_data IS
    'The uploaded bill. Kept so creating the show can put it on file as that show''s SHOWBILL document (show_documents); showbill_source is left on generated.';

-- "My recent imports", and the lookup the review screen polls.
CREATE INDEX IF NOT EXISTS idx_show_bill_imports_creator
    ON show_bill_imports (created_by_user_id, created_at DESC);

INSERT INTO _migrations (name) VALUES ('141_show_bill_imports.sql')
ON CONFLICT DO NOTHING;

COMMIT;
