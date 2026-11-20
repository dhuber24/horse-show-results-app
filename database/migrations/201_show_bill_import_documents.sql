-- 201: a show bill read together with the show's other papers.
--
-- A show bill rarely holds everything. Clubs print a separate rules and
-- information sheet (refund and scratch policy, health papers, arrival and
-- grounds rules, high-point awards), a futurity entry sheet, a stall
-- reservation form -- and what the reader cannot see it can only leave blank or
-- guess at. So an upload may now carry supporting documents beside the bill,
-- and the model reads them all as one show.
--
-- The bill itself stays on `show_bill_imports` (`file_data` and its columns),
-- unchanged: it is still the one document that is the show's schedule, the one
-- creating the show puts on file as its SHOWBILL document, and the one every
-- read before this migration has. This table is only the extras, in the order
-- they were chosen. They are not put on file with the show -- `show_documents`
-- has no type for a rules sheet yet -- so they are kept for the read and as the
-- record of what the read saw.
--
-- A new table and nothing else, so the running release ignores it: idempotent
-- and backward-compatible, production first.

BEGIN;

CREATE TABLE IF NOT EXISTS show_bill_import_documents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id         UUID NOT NULL REFERENCES show_bill_imports(id) ON DELETE CASCADE,
    position          SMALLINT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type         TEXT NOT NULL,
    file_size         INTEGER NOT NULL,
    file_data         BYTEA NOT NULL,
    created_at        TIMESTAMPTZ DEFAULT now()
);

-- Stated apart from the CREATE TABLE: startup's `create_all` may have made the
-- table from the model before this ran (the migration 114 note in Claude.md).
ALTER TABLE show_bill_import_documents ALTER COLUMN id SET DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS uq_show_bill_import_documents_position
    ON show_bill_import_documents (import_id, position);

COMMENT ON TABLE show_bill_import_documents IS
    'Supporting documents read together with a show bill (a rules and information sheet, a futurity or stall form), in the order chosen. The bill itself stays on show_bill_imports. See docs/showbill-import.md.';

INSERT INTO _migrations (name) VALUES ('201_show_bill_import_documents.sql')
ON CONFLICT DO NOTHING;

COMMIT;
