-- 182: a show's stall map and RV / camping map, for exhibitors.
--
-- Migration 127 made `show_documents` typed from the start so that "a venue map
-- or a club rules sheet has somewhere to go later". This is the venue map: the
-- show office uploads a stall chart and an RV map at setup (Lodging), and
-- exhibitors open them from Show Details. One of each per show, replaced on
-- upload -- the existing (show_id, document_type) unique index already says so.
--
-- Only the CHECK on `document_type` changes. It may exist under two names:
-- `ck_show_documents_type` from migration 127, and the name Postgres generated
-- for the model's inline CHECK where `create_all` made the table first. Every
-- CHECK on the table that names `document_type` is dropped, and the one below
-- put back.
--
-- Widening a CHECK is backward-compatible -- the running code never writes the
-- new values -- so this goes to production before the code.

BEGIN;

DO $$
DECLARE
    c record;
BEGIN
    FOR c IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'show_documents'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%document_type%'
    LOOP
        EXECUTE format('ALTER TABLE show_documents DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE show_documents
    ADD CONSTRAINT ck_show_documents_type
    CHECK (document_type IN ('SHOWBILL', 'STALL_MAP', 'RV_MAP'));

COMMENT ON TABLE show_documents IS
    'Files a show uploaded about itself. SHOWBILL is the show''s own prize list, rendered in place of the generated one when shows.showbill_source = ''uploaded''. STALL_MAP and RV_MAP are the stall chart and the RV / camping map exhibitors open from Show Details (migration 182).';

INSERT INTO _migrations (name) VALUES ('182_show_maps.sql')
ON CONFLICT DO NOTHING;

COMMIT;
