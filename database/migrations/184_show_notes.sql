-- 184: general show notes, one for exhibitors and one for the show office.
--
-- Every show bill carries a paragraph nothing else in the app has a place for:
-- office hours, dogs on a leash, where to park the trailer, "no golf carts
-- in the warm-up pen". And every show office keeps reminders of its own --
-- who has the gate keys, which judge needs a ride from the airport -- that it
-- wants beside the show, not in a notebook, and never in front of exhibitors.
--
-- `public_notes` is printed on the public show page and the generated show
-- bill, so it is on the public show payload. `office_notes` is never on that
-- payload: GET /shows/{id} answers anybody, signed in or not, so the office's
-- notes are read only through GET /shows/{id}/office-notes, which asks
-- `show_access` first. Both are written on Step 1 (Basics & Staff).
--
-- Nullable columns only: backward-compatible, so this goes to production
-- before the code.

BEGIN;

ALTER TABLE shows
    ADD COLUMN IF NOT EXISTS public_notes TEXT,
    ADD COLUMN IF NOT EXISTS office_notes TEXT;

INSERT INTO _migrations (name) VALUES ('184_show_notes.sql')
ON CONFLICT DO NOTHING;

COMMIT;
