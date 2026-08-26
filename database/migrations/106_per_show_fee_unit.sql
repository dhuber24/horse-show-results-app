-- Migration 106: add a `per_show` fee unit.
--
-- The reservable units were per_stall / per_bag / per_night, which between them
-- cannot price the commonest camping arrangement at a weekend show: an
-- electrical hook-up sold as one flat charge per spot for the whole event.
-- MNSPHC sells exactly that — "$60 for the weekend" per hook-up — and the only
-- reservable unit close enough was per_night, which bills a two-day show twice.
--
-- `flat` already exists and is wrong here for a different reason: a flat fee is
-- charged once, full stop, so it cannot express "two hook-ups". The exhibitor
-- reserves a quantity and each one costs the same whatever the length of the
-- show, which is its own unit.
--
-- Reservable, so it can carry an early-bird rate and appear on the sign-up
-- screen. Kept out of `flat`'s way rather than widening `flat`'s meaning: the
-- distinction between "one charge" and "one charge per thing reserved" is the
-- whole point.
--
-- This also repairs drift the rewrite exposed: `per_judge` has been in the
-- application's FeeUnit enum since 060 but was never in the database CHECK, so
-- a show fee priced per judge — which is how every rate on an APHA show bill is
-- quoted — would pass Pydantic and then fail on INSERT. Since the whole list is
-- being restated here anyway, it goes back in.

BEGIN;

ALTER TABLE show_fees DROP CONSTRAINT IF EXISTS show_fees_unit_check;

ALTER TABLE show_fees
    ADD CONSTRAINT show_fees_unit_check CHECK (unit IN (
        'flat',
        'per_entry',
        'per_horse',
        'per_judge',
        'per_class_per_horse',
        'per_night',
        'per_stall',
        'per_bag',
        'per_show',
        'percent_of_entry'
    ));

COMMENT ON COLUMN show_entry_reservations.show_fee_id IS
    'The show_fees row being reserved. Reservable fees are those with unit '
    'per_stall / per_bag / per_night / per_show.';

INSERT INTO _migrations (name) VALUES ('106_per_show_fee_unit.sql')
ON CONFLICT DO NOTHING;

COMMIT;
