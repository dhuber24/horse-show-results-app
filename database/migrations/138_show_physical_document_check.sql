-- Migration 138: does this show want the papers presented at the counter, or is
-- the upload enough?
--
-- Migration 097 let a show say *which* health papers it requires. It did not
-- let the show say whether an exhibitor has to bring the original — and the
-- desk assumed yes, unconditionally: every required document produced an
-- inspection sign-off that counted against the office's outstanding paperwork,
-- whether or not that show ever intended to look at paper.
--
-- The two questions are genuinely different, and the desk already knows it.
-- `horse_documents` answers "is the date still good"; a `show_verifications`
-- row of kind horse_health_document answers "did somebody at this counter hold
-- the paper and decide it describes this horse". A show that accepts the upload
-- as sufficient is not signing off on anything, so asking its staff to tick a
-- row per horse per document is a check nobody at that show can meaningfully
-- clear — which is the failure `show_associations` was written to stop on the
-- membership side of the same panel.
--
-- Defaults true because that is exactly what every existing show already does:
-- an inspection has always been owed on every required document. A show that
-- does not want it now says so, and its health rows stay visible and signable
-- (the office may still record a paper it was handed) but stop being counted.
--
-- Only meaningful where something is required. The setup screen asks it only
-- once a document is ticked; the column carries the answer regardless, so
-- turning a document back on does not silently lose what the show had said.

BEGIN;

ALTER TABLE shows
    ADD COLUMN IF NOT EXISTS requires_physical_document_check BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN shows.requires_physical_document_check IS
    'Whether exhibitors must present the required health documents physically at the show. True means the desk owes an inspection sign-off per required document; false means the documents on file are enough and the sign-off is optional.';

INSERT INTO _migrations (name) VALUES ('138_show_physical_document_check.sql')
ON CONFLICT DO NOTHING;

COMMIT;
