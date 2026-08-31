-- Migration 119: which APHA zone a show is in.
--
-- Zones surfaced in five separate places while reading the 2026 rule book and
-- the app had no representation of them at all:
--
--   * Class procedure. In Zones 12, 13 and 14, equitation and horsemanship are
--     worked individually from the gate with no rail work and a required working
--     order (AM-115.C, YP-120.C, and the hunt-seat equitation class procedure).
--     That is a different class than the same class run in Zone 3.
--   * Green class eligibility. 25 points, or 10 in Zones 12-14.
--   * The loaded class-code catalog, where "(Zone 12-14)" appears in class names
--     as literal text because there was nowhere else to put it.
--   * Zone shows — one per zone per year, up to six judges.
--   * Zone year-end awards.
--
-- Only the first is actionable today, and it is the one a gate steward needs at
-- the rail. The rest need points, show categories, or award tracking the app
-- does not have; this is the column they will all read.
--
-- On `shows` rather than on a regional club, because the app has no regional
-- club table — `associations` holds national bodies. Nullable, because it is
-- an APHA concept and most shows are not APHA; a NULL zone means "not stated",
-- which is why nothing derives a default from the venue's state.

BEGIN;

ALTER TABLE shows
    ADD COLUMN IF NOT EXISTS apha_zone SMALLINT;

ALTER TABLE shows
    DROP CONSTRAINT IF EXISTS ck_shows_apha_zone;

ALTER TABLE shows
    ADD CONSTRAINT ck_shows_apha_zone
    CHECK (apha_zone IS NULL OR apha_zone BETWEEN 1 AND 14);

COMMENT ON COLUMN shows.apha_zone IS
    'APHA zone 1-14. NULL means not stated. Zones 12, 13 and 14 change class '
    'procedure for equitation and horsemanship (individually from the gate, no '
    'rail work) and lower the Green class point threshold to 10.';

INSERT INTO _migrations (name) VALUES ('119_show_apha_zone.sql')
ON CONFLICT DO NOTHING;

COMMIT;
