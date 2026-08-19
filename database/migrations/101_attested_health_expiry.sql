-- Migration 101: the office can record the date it read off the paper.
--
-- Migration 098 let the desk sign off that it physically inspected a horse's
-- Coggins even when nothing was uploaded — which is the ordinary case, since
-- exhibitors hand paper across the counter. But the sign-off recorded only that
-- somebody looked. The horse kept reading "No Coggins on file — needed before
-- the show" and stayed on the office's own chase list, so a secretary who had
-- just held a valid negative test in their hands was still being told to go
-- find it. The flag was chasing paperwork the office already had.
--
-- Clearing it on the click alone was the tempting fix and the wrong one: "I
-- looked at this" and "this is valid" are different claims, and collapsing them
-- would let one click clear a flag on a document that had expired in 2019. It
-- is the same conflation migration 098 exists to undo, run backwards.
--
-- So the sign-off carries what was read: attested_expiry, the expiration date
-- printed on the document in the secretary's hand. Optional — staff can still
-- record that they inspected something illegible or genuinely lapsed, and the
-- horse stays flagged, which is correct. When it is given and it covers the
-- show, the horse's standing reads valid on the strength of the office having
-- seen it.
--
-- This is a staff-entered value, like show_waiver_signatures.signed_name and
-- unlike every other column in this table. That is not a hole: the app cannot
-- derive a date off a document it has never been shown, and the alternative is
-- an office that knows about uploads and is blind to paper.
--
-- Scoped to horse_health_document, and to one show, for the same reason the
-- rest of the table is: this show's office saw this paper. The next show runs
-- its own sweep, and a horse whose Coggins only ever existed on paper is
-- flagged again there — correctly, because that show has not seen it.
--
-- verified_value keeps meaning what it meant: a snapshot of the *documents on
-- file*, which is what makes a check go stale when the exhibitor uploads or
-- replaces one. The attestation is an overlay on the derived standing, never an
-- input to it, so the two cannot chase each other in a circle.

BEGIN;

ALTER TABLE show_verifications
    ADD COLUMN IF NOT EXISTS attested_expiry DATE;

ALTER TABLE show_verifications DROP CONSTRAINT IF EXISTS ck_show_verifications_attested_expiry;
ALTER TABLE show_verifications ADD CONSTRAINT ck_show_verifications_attested_expiry
    CHECK (attested_expiry IS NULL OR kind = 'horse_health_document');

COMMENT ON COLUMN show_verifications.attested_expiry IS
    'Expiry date read off the physical document at the desk. Staff-entered, because the app cannot derive it from a paper it has never been shown. Clears the health flag when it covers the show.';

INSERT INTO _migrations (name) VALUES ('101_attested_health_expiry.sql')
ON CONFLICT DO NOTHING;

COMMIT;
