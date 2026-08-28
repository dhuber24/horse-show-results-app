-- Migration 112: fee units a show manager can price their own charges by.
--
-- `show_fees` could hold a charge priced `per_horse` or `per_judge` since 060,
-- and the Entry Fees screen has let a secretary create both for just as long.
-- Neither has ever reached an exhibitor's account: `billing.build_bill` itemises
-- class entries, reservations and futurities, and the only non-class charge it
-- applies is `shows.office_charge_cents` — exactly one, hard-coded, on the show
-- row. So a $8 drug fee typed into the fee editor printed on the show bill's
-- price list and billed nobody. A show with a second such charge — and most
-- have several — had no way to say so.
--
-- Two changes, both about the *unit*, because the unit is the whole question:
--
-- 1. `per_exhibitor` is new. `shows.office_charge_basis = 'per_back_number'`
--    already means "once for the exhibitor, however many horses", but it is a
--    basis for one charge on the show row rather than a unit any fee can carry.
--    A show wanting an office fee *and* a gate fee both charged per back number
--    could set one of them.
--
--    Deliberately not `flat`. A flat fee is charged once however many you have
--    and its *occurrence* is not derivable — a stall cleanout penalty applies
--    to whoever left a mess, which no query can answer — so `flat` stays out of
--    the automatic set. `per_exhibitor` is derived from having entries, the
--    same test the office charge already makes.
--
-- 2. `per_judge` splits into `per_judge_per_horse` and
--    `per_judge_per_exhibitor`. "Per judge" alone does not say what it
--    multiplies, and the two readings differ by however many horses somebody
--    brings — three judges at $5 is $15 or $30 to an exhibitor with two horses.
--    This is the same trap `per_night` / `per_day` / `per_show` exist to close
--    (migrations 106, 111): `build_bill` multiplies rate x quantity and never
--    reads the unit, so nothing downstream can recover a unit that was wrong at
--    the point it was chosen.
--
--    Existing rows migrate to `per_judge_per_horse`, which is what the Entry
--    Fees editor has been telling secretaries it meant — it renders each row as
--    "x 3 = $15.00/horse".
--
-- `per_entry`, `per_class_per_horse` and `percent_of_entry` are left alone and
-- stay unbilled. They are the class-fee vocabulary, and `classes.entry_fee_cents`
-- is what charges per entry; billing a `standard_class` row on top of it would
-- double every class on every bill.
--
-- The whole CHECK is restated rather than amended because Postgres has no
-- "add a value to a CHECK", and 106 established the pattern.

BEGIN;

ALTER TABLE show_fees DROP CONSTRAINT IF EXISTS show_fees_unit_check;

UPDATE show_fees SET unit = 'per_judge_per_horse' WHERE unit = 'per_judge';

ALTER TABLE show_fees
    ADD CONSTRAINT show_fees_unit_check CHECK (unit IN (
        'flat',
        'per_entry',
        'per_exhibitor',
        'per_horse',
        'per_judge_per_horse',
        'per_judge_per_exhibitor',
        'per_class_per_horse',
        'per_night',
        'per_day',
        'per_stall',
        'per_bag',
        'per_show',
        'percent_of_entry'
    ));

COMMENT ON COLUMN show_fees.unit IS
    'What one of this fee counts. Three families: RESERVED units '
    '(per_stall / per_bag / per_night / per_day / per_show) are quantities the '
    'exhibitor books at sign-up and bill through show_entry_reservations; '
    'AUTOMATIC units (per_exhibitor / per_horse / per_judge_per_horse / '
    'per_judge_per_exhibitor) are charged to every exhibitor with entries, '
    'derived from what they entered and the size of the judge panel; the rest '
    '(flat / per_entry / per_class_per_horse / percent_of_entry) are published '
    'price-list text only and bill nobody. See billing.py.';

INSERT INTO _migrations (name) VALUES ('112_show_charge_fee_units.sql')
ON CONFLICT DO NOTHING;

COMMIT;
