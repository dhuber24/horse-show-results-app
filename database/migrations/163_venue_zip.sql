-- 163: a venue's zip code.
--
-- A venue carried a street address, city and state, and no zip. The pin beside
-- a show now opens the venue in a maps app, and a fairground's street address
-- is often a rural route or a county road that a maps search places in the
-- wrong town without one.
--
-- `venues.zip` is TEXT, like every other zip column in the schema: a ZIP+4 or a
-- Canadian postal code is not a number.
--
-- This release also stops mapping `venue_admins` (migration 003), the
-- secretaries-by-venue list on the Edit Venue screen. Nothing ever read it -- a
-- secretary works a show through `show_secretaries` or through the show's
-- company -- so the screen was a promise of access it never gave. The table is
-- NOT dropped here: the release still running maps it, and a DROP is the
-- contract half of an expand / contract pair, so it goes in a later migration
-- once this code is out.
--
-- A nullable column: backward-compatible, so it goes to production before the
-- code.

BEGIN;

ALTER TABLE venues ADD COLUMN IF NOT EXISTS zip TEXT;

INSERT INTO _migrations (name) VALUES ('163_venue_zip.sql')
ON CONFLICT DO NOTHING;

COMMIT;
