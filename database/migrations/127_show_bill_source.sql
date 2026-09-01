-- Migration 127: whose show bill the Show Bill button opens.
--
-- Until now there was one answer: the app drew the bill from the show's own
-- classes, judges, fees and policies, and that was the whole argument for
-- building it rather than accepting an upload -- a PDF cannot fall out of date
-- with a schedule it is generated from, and a stale one is worse than none
-- because people trust the copy they printed.
--
-- Shows asked for the other option anyway, and the reason is not laziness. A
-- club's show bill is a designed document -- sponsor logos, the club's own
-- wording, the entry blank on the back, an award list this app has no table for
-- -- and it usually goes to the printer before the schedule is keyed in here.
-- Refusing the upload did not make those shows use the generated bill; it made
-- them e-mail a PDF that this app never saw.
--
-- So the choice is recorded rather than assumed, and the hazard is re-homed
-- instead of dismissed:
--
--   * The choice and the file are two separate facts. `showbill_source` may
--     only read 'uploaded' while a SHOWBILL document is on record -- enforced in
--     the router, since a CHECK cannot see another table -- and deleting the
--     document puts the show back on the generated bill in the same
--     transaction. A button pointing at a file nobody uploaded is the failure
--     this column would otherwise introduce.
--   * An uploaded bill never hides the app's own data. Show Details goes on
--     rendering the generated document, because that is the price list
--     `GET /shows/{id}/fees/public` charges from, and the class schedule is
--     always one link away. The show chooses what the *button* shows; it does
--     not get to make the live schedule unreachable.
--
-- There is deliberately no staleness check. It would need `updated_at` on
-- classes, fees and judges -- none of which carry one -- so the honest
-- substitute is to stamp the upload with its date and print it next to the
-- document.

ALTER TABLE shows ADD COLUMN IF NOT EXISTS showbill_source TEXT NOT NULL DEFAULT 'generated';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_shows_showbill_source'
    ) THEN
        ALTER TABLE shows
            ADD CONSTRAINT ck_shows_showbill_source
            CHECK (showbill_source IN ('generated', 'uploaded'));
    END IF;
END $$;

COMMENT ON COLUMN shows.showbill_source IS
    'Which show bill /shows/{id}/showbill renders: ''generated'' (drawn from this show''s classes, judges and fees) or ''uploaded'' (the show''s own file in show_documents). Only ever ''uploaded'' while a SHOWBILL document exists -- the router enforces the pair, and deleting the document resets this.';

-- The show's own uploaded documents. Shaped after `horse_documents` and
-- `trainer_documents` -- bytes in the row, MIME sniffed from the magic bytes and
-- never taken from the client, one uploader recorded. Typed from the start even
-- though SHOWBILL is the only kind today: a show has other documents an office
-- would want on file (a venue map, the club's own rules sheet), and the
-- alternative is a `shows.showbill_file` column that no second document can use.
CREATE TABLE IF NOT EXISTS show_documents (
    id UUID PRIMARY KEY,
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    file_data BYTEA NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Stated separately from the CREATE TABLE for the reason migration 124 spells
-- out: startup runs `Base.metadata.create_all`, so on a database the app reached
-- before this file ran the table already exists and `IF NOT EXISTS` skips the
-- statement -- along with the default and the constraints inside it.
ALTER TABLE show_documents ALTER COLUMN created_at SET DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_documents_type'
    ) THEN
        ALTER TABLE show_documents
            ADD CONSTRAINT ck_show_documents_type
            CHECK (document_type IN ('SHOWBILL'));
    END IF;
END $$;

-- One document of each kind per show. The upload endpoint replaces rather than
-- appends -- a show bill has no history worth keeping here, and two rows would
-- leave the reader picking one.
CREATE UNIQUE INDEX IF NOT EXISTS show_documents_show_type_uniq
    ON show_documents (show_id, document_type);

COMMENT ON TABLE show_documents IS
    'Files a show uploaded about itself. SHOWBILL is the show''s own prize list, rendered in place of the generated one when shows.showbill_source = ''uploaded''.';
