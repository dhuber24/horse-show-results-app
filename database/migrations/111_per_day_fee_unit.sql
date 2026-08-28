-- Migration 111: add a `per_day` fee unit.
--
-- Migration 106 added `per_show` for a hook-up sold as one charge for the whole
-- event, and 108 folded camping and the electrical hook-up into one line item
-- priced two ways. Two ways is one short. Some venues sell the hook-up **by the
-- day**, and a day is not a night: a Friday-to-Sunday show is three days and
-- two nights, so charging a per-day rate against a count of nights under-bills
-- every camper by a day, and the reverse over-bills them by one.
--
-- This is the same distinction `per_show` exists for and it is settled the same
-- way — a separate unit, so the number the exhibitor types has a noun against
-- it and the bill multiplies the right count by the right rate. `build_bill`
-- reads rate x quantity and never the unit, which is exactly why the unit has
-- to be right at the point the quantity is entered; nothing downstream can
-- recover the difference.
--
-- Reservable, like the other three, so it can carry an early-bird rate and
-- appear on the sign-up screen.
--
-- The whole CHECK is restated rather than amended because Postgres has no
-- "add a value to a CHECK", and 106 established the pattern.

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
        'per_day',
        'per_stall',
        'per_bag',
        'per_show',
        'percent_of_entry'
    ));

COMMENT ON COLUMN show_entry_reservations.show_fee_id IS
    'The show_fees row being reserved. Reservable fees are those with unit '
    'per_stall / per_bag / per_night / per_day / per_show.';

INSERT INTO _migrations (name) VALUES ('111_per_day_fee_unit.sql')
ON CONFLICT DO NOTHING;

COMMIT;
