-- 190: an hour on an early rate's "reserve by" date.
--
-- A show bill says "reserve stalls by May 1 at 5:00 PM", and the Lodging step
-- could only hold the May 1. `early_deadline_time` is that hour, optional.
--
-- A wall-clock value at the venue, printed as the office typed it -- a TIME,
-- not a TIMESTAMPTZ, the same call migration 181 made for move-in: the office
-- states the hour in local time and there is no instant to convert. It is
-- display precision only, like `futurities.entry_deadline_time` (109): which
-- rate a booking pays is still decided by `reserved_at` against
-- `early_deadline`, a day. A time with no day means nothing, so the CHECK
-- refuses it.
--
-- A nullable column and an additive CHECK: backward-compatible, so this goes to
-- production before the code.

BEGIN;

ALTER TABLE show_fees
    ADD COLUMN IF NOT EXISTS early_deadline_time TIME;

ALTER TABLE show_fees DROP CONSTRAINT IF EXISTS ck_show_fees_early_deadline_time_has_date;
ALTER TABLE show_fees ADD CONSTRAINT ck_show_fees_early_deadline_time_has_date
    CHECK (early_deadline_time IS NULL OR early_deadline IS NOT NULL);

INSERT INTO _migrations (name) VALUES ('190_show_fee_early_deadline_time.sql')
ON CONFLICT DO NOTHING;

COMMIT;
