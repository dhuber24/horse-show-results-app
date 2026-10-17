-- 171: a Pro+ year can start before it is paid for.
--
-- Until now a Pro+ year was recorded only as a payment received, so a GaitDesk
-- admin starting one for a company that would pay later -- or giving one away
-- -- had to pretend the money had arrived. Starting the year and being paid for
-- it are now two facts:
--
--   * `show_company_subscriptions.payment_received_on` -- the day GaitDesk was
--     paid for the year, or NULL while it is still owed. A year is in force
--     from `starts_on` either way; the admin marks it paid when the money
--     comes. A complimentary year is a `price_cents` of 0, with nothing owed.
--
-- Every year already recorded was recorded as a payment, so it is backfilled
-- as paid on the day it was recorded.
--
-- A nullable column: backward-compatible, so it goes to production before the
-- code. The running release never names it, and its inserts leave it NULL --
-- which reads as unpaid only to the code that knows the column, so a year
-- recorded by the old release between the two steps shows as owed until an
-- admin marks it.

BEGIN;

ALTER TABLE show_company_subscriptions ADD COLUMN IF NOT EXISTS payment_received_on DATE;

UPDATE show_company_subscriptions
SET payment_received_on = COALESCE(created_at::date, starts_on)
WHERE payment_received_on IS NULL;

INSERT INTO _migrations (name) VALUES ('171_pro_plus_payment_received.sql')
ON CONFLICT DO NOTHING;

COMMIT;
