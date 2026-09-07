-- Migration 133: a club's sanction fee gets a unit, the way every other fee has one.
--
-- `show_sanctioning.per_class_fee_cents` (migration 072) could say one thing:
-- this club charges $3 on every entry in every class it approves. That is one
-- of the ways a club actually charges, and the show bills that carry the other
-- ways are not rare -- an all-day fee per horse, a per-judge assessment per
-- horse, a flat card fee per exhibitor. A secretary meeting one of those had
-- the same two choices they had before migration 131 scoped the automatic
-- charges: work the arithmetic out by hand into a flat amount, or leave the
-- money off the app entirely.
--
-- So the club's fee carries a unit, drawn from the same vocabulary the show's
-- own automatic charges use (migrations 112, 125):
--
--   per_entry                -- the original, and the default: per class entered
--   per_exhibitor            -- once, however many horses they bring
--   per_horse                -- for each horse they enter
--   per_judge_per_horse      -- x the panel, for each horse
--   per_judge_per_exhibitor  -- x the panel, once per exhibitor
--
-- Every one of them is counted over *this club's approved classes only*
-- (`class_sanctioning`, migration 113) and nothing else -- which is the same
-- rule migration 131 settled for the breed body's own charges, read from the
-- other side. An exhibitor who entered nothing the club approves owes it
-- nothing whichever unit is chosen.
--
-- `per_judge_per_entry` is deliberately not offered. It is the breed body's own
-- per-entry assessment (APHA SC-125.B and its kin) and belongs to the show's
-- fee catalog, where migration 125 put it; a club that bills per class entered
-- is what `per_entry` already is.
--
-- The amount column is renamed with the same statement, because
-- `per_class_fee_cents` holding "$45 per judge, per horse" is exactly the trap
-- migration 112 split `per_judge` to close: the unit says what is multiplied,
-- and a column name that contradicts it is the reading everybody trusts.
--
-- Guarded on the column name rather than run bare: the rename is the one
-- statement here that cannot repeat, and a half-applied migration on Neon
-- should be re-runnable.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'show_sanctioning' AND column_name = 'per_class_fee_cents'
    ) THEN
        ALTER TABLE show_sanctioning RENAME COLUMN per_class_fee_cents TO fee_amount_cents;
    END IF;
END $$;

ALTER TABLE show_sanctioning
    ADD COLUMN IF NOT EXISTS fee_unit TEXT NOT NULL DEFAULT 'per_entry';

ALTER TABLE show_sanctioning DROP CONSTRAINT IF EXISTS show_sanctioning_fee_unit_check;

ALTER TABLE show_sanctioning
    ADD CONSTRAINT show_sanctioning_fee_unit_check CHECK (fee_unit IN (
        'per_entry',
        'per_exhibitor',
        'per_horse',
        'per_judge_per_horse',
        'per_judge_per_exhibitor'
    ));

COMMENT ON COLUMN show_sanctioning.fee_amount_cents IS
    'What this club charges, in the unit `fee_unit` names. Was '
    'per_class_fee_cents until migration 133, when the fee stopped being per '
    'class by definition.';

COMMENT ON COLUMN show_sanctioning.fee_unit IS
    'What one of this club''s fee counts: per_entry (per class entered, the '
    'original behaviour and the default), per_exhibitor, per_horse, '
    'per_judge_per_horse or per_judge_per_exhibitor. Every unit is counted over '
    'the classes this club approves (class_sanctioning) and no others. '
    'per_entry money rides on each class line of the bill; the rest is one '
    'charge per exhibitor -- see billing.sanction_charge_lines.';
