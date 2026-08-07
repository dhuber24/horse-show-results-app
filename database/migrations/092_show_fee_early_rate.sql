-- Migration 092: an early-bird rate on a show fee.
--
-- Show bills price stalls, shavings and camping two ways — one number if you
-- reserve by a date, a higher one after — because the office needs to know how
-- much of the barn to hold before it can plan the grounds. The app could only
-- store one number, so a show running early pricing had to collect stall
-- reservations off-app and retype them.
--
-- `early_amount_cents` + `early_deadline` are a pair: a discount is live only
-- when the secretary set both. Either one alone is an unfinished edit, not a
-- price, and is ignored. `amount_cents` stays the standard (post-deadline)
-- rate, so every existing fee keeps billing exactly as it does today.
--
-- The columns sit on `show_fees` generally, but only reservations consume them
-- (billing.py). Class entry fees live on `classes.entry_fee_cents` and are not
-- reserved, so an early rate on a per_entry row would have nothing to apply to.
--
-- `show_entry_reservations.reserved_at` is the date the exhibitor booked that
-- line, and is what decides the rate — never "today". Repricing a booking the
-- moment a deadline passes would change a bill the exhibitor already agreed
-- to, which is the whole thing an early rate promises not to do. It is set
-- once when the line is first created and preserved when the exhibitor later
-- amends it, so someone who reserved before the deadline keeps their rate.
--
-- Backfill uses created_at so existing reservations are dated when they were
-- actually made, not when this migration ran.

BEGIN;

ALTER TABLE show_fees
    ADD COLUMN IF NOT EXISTS early_amount_cents INTEGER,
    ADD COLUMN IF NOT EXISTS early_deadline DATE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_fees_early_amount_nonneg'
    ) THEN
        ALTER TABLE show_fees
            ADD CONSTRAINT ck_show_fees_early_amount_nonneg
            CHECK (early_amount_cents IS NULL OR early_amount_cents >= 0);
    END IF;
END $$;

ALTER TABLE show_entry_reservations
    ADD COLUMN IF NOT EXISTS reserved_at DATE;

UPDATE show_entry_reservations
SET reserved_at = COALESCE(created_at::date, CURRENT_DATE)
WHERE reserved_at IS NULL;

ALTER TABLE show_entry_reservations
    ALTER COLUMN reserved_at SET DEFAULT CURRENT_DATE;

ALTER TABLE show_entry_reservations
    ALTER COLUMN reserved_at SET NOT NULL;

COMMENT ON COLUMN show_fees.early_amount_cents IS
    'Discounted per-unit price for reservations made on or before early_deadline. NULL (or a NULL deadline) means no early rate.';
COMMENT ON COLUMN show_fees.early_deadline IS
    'Last day the early rate is available, inclusive. Paired with early_amount_cents; either alone is ignored.';
COMMENT ON COLUMN show_entry_reservations.reserved_at IS
    'Date this line was first booked. Decides which of the fee''s two rates applies, and survives later amendments.';

INSERT INTO _migrations (name) VALUES ('092_show_fee_early_rate.sql')
ON CONFLICT DO NOTHING;

COMMIT;
