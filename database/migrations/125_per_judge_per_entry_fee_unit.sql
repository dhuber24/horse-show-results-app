-- Migration 125: a fee charged per class entry, per judge.
--
-- APHA SC-125.B: "Show Management must collect a fee per entry per show (Judge)
-- for single, two judge, special event shows, Paint-O-Ramas and Zone Shows and
-- forward to the APHA office in order for show results to be processed."
--
-- The app could not bill that. Its automatic units multiply by distinct horses
-- or by the exhibitor, and an assessment per *class entry* is neither: an
-- exhibitor with one horse in six classes owes six of these, and
-- `per_judge_per_horse` would charge them one. `per_entry` exists but sits in
-- the family that bills nobody, and it has to stay there -- that unit is the
-- class-fee vocabulary, and `classes.entry_fee_cents` is what charges per entry.
--
-- So this is a genuinely new unit rather than a repurposed one. It belongs to
-- the AUTOMATIC family: derived from what the exhibitor entered and the size of
-- the judge panel, booked by nobody, with nothing to tick.
--
-- Named per_judge_per_entry for the reason migration 112 split `per_judge` into
-- `per_judge_per_horse` and `per_judge_per_exhibitor`: "per judge" does not say
-- what it multiplies, `build_bill` multiplies rate x quantity and never reads
-- the unit, and nothing downstream can recover a unit that was wrong where it
-- was chosen.
--
-- Deliberately not association-specific. SC-125.B is APHA's version of a levy
-- every breed body collects, and a `show_fees` row priced by the show is how
-- this app already handles that; there is no `apha_assessment` column here.

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
        'percent_of_entry'
    ));

COMMENT ON COLUMN show_fees.unit IS
    'What one of this fee counts. Three families: RESERVED units '
    '(per_stall / per_bag / per_night / per_day / per_show) are quantities the '
    'exhibitor books at sign-up through show_entry_reservations, and are the '
    'only family that may carry an early-bird rate. AUTOMATIC units '
    '(per_exhibitor / per_horse / per_judge_per_horse / per_judge_per_exhibitor '
    '/ per_judge_per_entry) are charged to everyone who entered a class, derived '
    'from their entries, their distinct horses and the size of the judge panel. '
    'Everything else (flat / per_entry / per_class_per_horse / percent_of_entry) '
    'is published price-list text and bills nobody.';
