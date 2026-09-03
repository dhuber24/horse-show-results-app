-- 132: Convert shows.office_charge_cents / office_charge_basis into an
-- ordinary `show_fees` row, and drop the columns.
--
-- The office charge was the app's only non-class charge when migration 055
-- added it, so it was stored as a column on the show and hard-coded into
-- `build_bill`. Migration 112 then added `per_exhibitor` to `show_fees.unit`
-- and said in as many words why: `office_charge_basis = 'per_back_number'` is
-- "a basis for *that one* charge rather than a unit any fee can carry." That
-- generalisation is now complete and the column has nothing left to say --
-- `per_back_number` is `per_exhibitor` and `per_horse` is `per_horse`, both of
-- which `billing.charge_lines` already bills correctly.
--
-- What this buys is not tidiness. A column can only ever be edited by its own
-- bespoke control, so the office charge had its own box, its own state, its
-- own save button and its own line in every bill payload -- while being, to
-- an exhibitor reading the bill, one more automatic charge next to a drug fee.
-- As a fee row it is renamable, removable, and set up the same way as every
-- other class fee.
--
-- One behaviour moves with it: every automatic charge counts only the breed
-- association's own classes (migration 131), so the converted office charge
-- now does too. An exhibitor entered solely in a club's All Breed classes
-- previously owed the office charge and now does not. That is the same single
-- rule applying to one more row rather than a new exception -- a show wanting
-- it charged to everybody should say so the same way it would for any other
-- automatic fee.
--
-- sort_order -1 so the converted row sorts above the manager's own fees,
-- which is where the office charge has always rendered.

INSERT INTO show_fees (id, show_id, code, label, amount_cents, unit, sort_order)
SELECT
    gen_random_uuid(),
    s.id,
    'office_charge',
    'Office charge',
    s.office_charge_cents,
    CASE WHEN s.office_charge_basis = 'per_horse' THEN 'per_horse' ELSE 'per_exhibitor' END,
    -1
FROM shows s
WHERE s.office_charge_cents > 0
  AND NOT EXISTS (
      SELECT 1 FROM show_fees f WHERE f.show_id = s.id AND f.code = 'office_charge'
  );

ALTER TABLE shows DROP COLUMN IF EXISTS office_charge_cents;
ALTER TABLE shows DROP COLUMN IF EXISTS office_charge_basis;
