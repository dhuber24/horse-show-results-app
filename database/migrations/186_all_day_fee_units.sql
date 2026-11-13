-- Migration 186: an All Day fee caps class entry fees.
--
-- A show office prices an All Day fee by working out what an exhibitor owes per
-- class and, when that comes to more than the All Day fee, charging the All Day
-- fee instead. The app could not say that. An All Day fee was `flat` -- price-list
-- text that bills nobody -- on the grounds that the exhibitor elects it and
-- nothing stored says whether they did. Read the way the office actually works it,
-- there is no election: the bill is whichever is lower, and that is derivable from
-- the entries.
--
-- So the All Day fee is a fourth billing family, a CAP: it replaces the class
-- entry fees (`classes.entry_fee_cents`) of the classes it covers when their sum
-- is higher than it, and charges nothing extra when it is not. Only class entry
-- fees -- an association's assessment, a club's sanction fee, the show's own
-- per-class charges, side pots and futurities are charged in full on top.
--
-- What one cap covers is the unit, the same way `per_judge_per_horse` and
-- `per_judge_per_exhibitor` were split (migration 112) rather than given a basis
-- flag: one horse or one exhibitor, and each show day or the whole show. Shows
-- price it every one of those ways. Which classes it covers is the fee's class
-- list (`show_fee_classes`, migration 137) -- a show runs one for its breed
-- classes and another for its All-Breed classes.
--
-- Backward compatible: widens a CHECK. No existing row changes unit.

ALTER TABLE show_fees DROP CONSTRAINT IF EXISTS show_fees_unit_check;

ALTER TABLE show_fees
    ADD CONSTRAINT show_fees_unit_check CHECK (unit IN (
        'flat',
        'per_entry',
        'per_exhibitor',
        'per_horse',
        'per_judge_per_horse',
        'per_judge_per_exhibitor',
        'per_judge_per_entry',
        'per_class_per_horse',
        'per_night',
        'per_day',
        'per_stall',
        'per_bag',
        'per_show',
        'percent_of_entry',
        'all_day_per_horse',
        'all_day_per_exhibitor',
        'all_show_per_horse',
        'all_show_per_exhibitor'
    ));

COMMENT ON COLUMN show_fees.unit IS
    'What one of this fee counts. Four families: RESERVED units '
    '(per_stall / per_bag / per_night / per_day / per_show) are quantities the '
    'exhibitor books at sign-up through show_entry_reservations, and are the '
    'only family that may carry an early-bird rate. AUTOMATIC units '
    '(per_exhibitor / per_horse / per_judge_per_horse / per_judge_per_exhibitor '
    '/ per_judge_per_entry / per_entry) are charged to everyone who entered a '
    'class, derived from their entries, their distinct horses and the size of '
    'the judge panel. CAP units (all_day_per_horse / all_day_per_exhibitor / '
    'all_show_per_horse / all_show_per_exhibitor) are an All Day fee: they '
    'replace the class entry fees of the classes they cover, per horse or per '
    'exhibitor and per show day or for the whole show, whenever those come to '
    'more. Everything else (flat / per_class_per_horse / percent_of_entry) is '
    'published price-list text and bills nobody.';

INSERT INTO _migrations (name) VALUES ('186_all_day_fee_units.sql')
ON CONFLICT DO NOTHING;
