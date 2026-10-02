-- Migration 160: which papers the show office inspects at the counter.
--
-- Migration 138 let a show say whether it wants the health originals produced
-- at the desk. The other three things the desk signs off on -- an exhibitor's
-- membership card, a horse's foaling date, and its registration papers -- it
-- still asked of every show, and counted as outstanding until somebody ticked
-- them. Plenty of shows never look at registration papers during class
-- registration, so their staff were handed a red row per horse per association
-- that nobody working the show was ever going to clear. That is the failure
-- `show_associations` and migration 138 were each written to stop on their
-- half of the same panel.
--
-- One column per check, because they are separate choices: an Open show may
-- check foaling dates for its two-year-old classes and no papers at all, and a
-- breed show may check papers and leave membership to the association.
--
-- Default true, because that is exactly what every existing show already does;
-- defaulting the other way would silently empty a live show's chase list.
-- False drops the check from the desk entirely -- not built, not listed, not
-- counted. Unlike a health inspection, which clears the horse's health flag
-- even where the show did not ask for one, a sign-off on these does nothing but
-- record, so a row nobody is asked to do is only clutter. Sign-offs already
-- recorded stay in `show_verifications` and come back if the check is turned on
-- again.
--
-- Backward compatible (defaulted columns): production database first, then
-- the code.

BEGIN;

ALTER TABLE shows
    ADD COLUMN IF NOT EXISTS requires_membership_card_check BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE shows
    ADD COLUMN IF NOT EXISTS requires_horse_age_check BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE shows
    ADD COLUMN IF NOT EXISTS requires_registration_papers_check BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN shows.requires_membership_card_check IS
    'Whether the show office inspects each exhibitor''s membership card for the bodies the show runs under. False drops the membership sign-offs from the desk.';
COMMENT ON COLUMN shows.requires_horse_age_check IS
    'Whether the show office checks each entered horse''s foaling date against its papers. False drops the age sign-off from the desk.';
COMMENT ON COLUMN shows.requires_registration_papers_check IS
    'Whether the show office inspects each entered horse''s registration papers for the bodies the show runs under. False drops the registration sign-offs from the desk.';

INSERT INTO _migrations (name) VALUES ('160_show_desk_inspections.sql')
ON CONFLICT DO NOTHING;

COMMIT;
