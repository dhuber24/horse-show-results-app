-- Migration 108: camping and the electrical hook-up are one line item.
--
-- Migration 106 added the `per_show` unit for a hook-up sold as "$60 for the
-- weekend", and the Lodging & Boarding setup step grew a second slot to go
-- with it: Camping (per_night) alongside Electrical hook-up (per_show). That
-- was the wrong cut. A venue sells *one* camping spot and prices it one of two
-- ways — a nightly rate, or one charge for the whole show. Two slots asked the
-- show manager which product they were selling when the only real question is
-- how they charge for it, and a manager who filled in both created two camping
-- charges on the same bill with nothing to say so.
--
-- So the setup step now offers one camping line with a per-night / per-show
-- choice, and the `hookup` code folds back into `camping`. The unit still
-- carries the difference; only the number of rows changes.
--
-- Rows are renamed rather than merged. No show currently holds both codes, and
-- where one somehow does, the `hookup` row is left alone: it has its own price
-- and possibly its own reservations, and silently discarding either would be a
-- worse answer than leaving a duplicate visible for staff to resolve on the
-- full boarding editor.
--
-- Labels are deliberately untouched. `code` is the app's key; `label` is what
-- the exhibitor and the printed show bill read, and a show that wrote
-- "Electrical hook-up (per spot, whole show)" said what it meant.

BEGIN;

UPDATE show_fees AS f
SET code = 'camping'
WHERE f.code = 'hookup'
  AND NOT EXISTS (
      SELECT 1 FROM show_fees AS other
      WHERE other.show_id = f.show_id
        AND other.code = 'camping'
  );

COMMENT ON COLUMN show_entry_reservations.show_fee_id IS
    'The show_fees row being reserved. Reservable fees are those with unit per_stall / per_bag / per_night / per_show.';

INSERT INTO _migrations (name) VALUES ('108_consolidate_camping_fee.sql')
ON CONFLICT DO NOTHING;

COMMIT;
