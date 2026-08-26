-- Migration 105: register the Minnesota North Star Paint Horse Club.
--
-- MNSPHC is the club that puts on the Splash of Color / Paint-O-Rama shows.
-- Its own "All Breed" classes sit on an APHA show bill beside the WSCA ones
-- and are priced on their own scale ($8 per judge rather than $5), so a show
-- needs to be able to say it is MNSPHC-sanctioned through `show_sanctioning`
-- — and an exhibitor needs somewhere to record the membership the club's
-- futurity office fee is priced against ($10 member vs $20 non-member).
--
-- A club, not a breed: nobody registers a horse with MNSPHC, they hold a
-- membership in it. See the show_types / associations split in
-- docs/database.md — this is emphatically not a new show type. An
-- MNSPHC-sanctioned show is an APHA (or OPEN) show carrying the club overlay.
--
-- Idempotent: ON CONFLICT on the unique `code`, so a re-run against a database
-- where backend startup create_all already made the row is a no-op.

BEGIN;

INSERT INTO associations (code, name, association_type)
VALUES ('MNSPHC', 'Minnesota North Star Paint Horse Club', 'club')
ON CONFLICT (code) DO NOTHING;

INSERT INTO _migrations (name) VALUES ('105_mnsphc_association.sql')
ON CONFLICT DO NOTHING;

COMMIT;
