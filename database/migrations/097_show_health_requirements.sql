-- Migration 097: a show says which health papers it actually requires.
--
-- The app has accepted COGGINS, VACCINATION and HEALTH_CERTIFICATE uploads
-- since horse_documents existed, but only Coggins was ever looked at again. The
-- other two were stored and forgotten, so the office's paperwork sweep saw a
-- third of what staff physically check at the counter.
--
-- The reason the other two need a policy first, and Coggins never did, is that
-- Coggins is universal and they are not. A Certificate of Veterinary Inspection
-- is a function of crossing a state line; required vaccinations come from the
-- venue, not the breed association. Deriving a flat "no CVI on file" flag would
-- light up every in-state horse at every show, and staff would learn to ignore
-- the whole panel — the second feature would poison the first. So the show
-- states its rules and the derivation answers against them.
--
-- Validity is expressed in days from the document's issue_date because that is
-- how these papers are actually written: a CVI is "issued within 30 days", not
-- "expires on". horse_documents.expiry_date still wins where the document
-- carries one — see health_requirements() in backend/routers/horse_documents.py.
-- Both defaults are the common case (CVI 30 days, vaccinations annual) and both
-- are editable per show, since neither is a rule this app gets to set.
--
-- requires_coggins defaults true, matching the behaviour every existing show
-- already has. It is a column rather than an assumption because a schooling
-- show on a private farm is entitled to say no, and hard-coding "always" would
-- make that a code change.

BEGIN;

ALTER TABLE shows
    ADD COLUMN IF NOT EXISTS requires_coggins BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS requires_health_certificate BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS health_certificate_valid_days INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN IF NOT EXISTS requires_vaccination BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS vaccination_valid_days INTEGER NOT NULL DEFAULT 365,
    ADD COLUMN IF NOT EXISTS vaccination_notes TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_shows_health_windows'
    ) THEN
        ALTER TABLE shows ADD CONSTRAINT ck_shows_health_windows CHECK (
            health_certificate_valid_days BETWEEN 1 AND 3650
            AND vaccination_valid_days BETWEEN 1 AND 3650
        );
    END IF;
END $$;

COMMENT ON COLUMN shows.requires_coggins IS
    'Whether a negative Coggins (EIA) is required for horses at this show.';
COMMENT ON COLUMN shows.requires_health_certificate IS
    'Whether a Certificate of Veterinary Inspection is required — typically for out-of-state arrivals.';
COMMENT ON COLUMN shows.health_certificate_valid_days IS
    'How many days a CVI stays good from its issue date. Ignored when the document carries its own expiry.';
COMMENT ON COLUMN shows.requires_vaccination IS
    'Whether proof of vaccination is required. Which shots is a venue rule; see vaccination_notes.';
COMMENT ON COLUMN shows.vaccination_valid_days IS
    'How many days a vaccination record stays good from its issue date.';
COMMENT ON COLUMN shows.vaccination_notes IS
    'Which vaccinations this venue requires, in the show office''s own words. Shown to exhibitors.';

INSERT INTO _migrations (name) VALUES ('097_show_health_requirements.sql')
ON CONFLICT DO NOTHING;

COMMIT;
