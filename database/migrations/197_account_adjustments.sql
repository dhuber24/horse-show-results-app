-- 197: office adjustments to what an exhibitor owes.
--
-- GaitDesk does not run the stall chart -- the show office assigns stalls
-- itself -- but what an exhibitor owes for stalls has to follow what the
-- office decided: box stalls ran out and they got a tie stall, a comped stall,
-- the $50 cleaning fee for a stall nobody checked out. The office can change
-- an exhibitor's stall bookings (no table needed: `show_entry_reservations`),
-- and for everything a booking cannot say it adds an adjustment here: a signed
-- amount and a reason. Positive is a charge, negative a credit. It is on the
-- exhibitor's bill, with its reason, everywhere the bill is shown, and it is
-- in `billing.build_bill`'s total like every other line -- never a second sum.
--
-- Not a payment. Money that moved is `show_payments`, a refund a negative
-- payment there, so the day's takings still reconcile against what actually
-- moved. An adjustment changes what is owed, not what was paid.
--
-- A new table: backward-compatible, so this goes to production before the
-- code.

BEGIN;

CREATE TABLE IF NOT EXISTS show_account_adjustments (
    id                UUID PRIMARY KEY,
    show_entry_id     UUID NOT NULL REFERENCES show_entries(id) ON DELETE CASCADE,
    amount_cents      INTEGER NOT NULL,
    reason            TEXT NOT NULL,
    recorded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    recorded_by_name  TEXT,
    created_at        TIMESTAMPTZ
);

-- Defaults and CHECKs stated on their own: `create_all` may have built the
-- table from the model before this ran.
ALTER TABLE show_account_adjustments ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_account_adjustments ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE show_account_adjustments DROP CONSTRAINT IF EXISTS ck_show_account_adjustments_amount_nonzero;
ALTER TABLE show_account_adjustments ADD CONSTRAINT ck_show_account_adjustments_amount_nonzero
    CHECK (amount_cents <> 0);

ALTER TABLE show_account_adjustments DROP CONSTRAINT IF EXISTS ck_show_account_adjustments_reason;
ALTER TABLE show_account_adjustments ADD CONSTRAINT ck_show_account_adjustments_reason
    CHECK (char_length(btrim(reason)) BETWEEN 1 AND 200);

CREATE INDEX IF NOT EXISTS show_account_adjustments_show_entry_idx
    ON show_account_adjustments (show_entry_id);

COMMENT ON TABLE show_account_adjustments IS
    'An office change to what an exhibitor owes at a show: positive a charge, negative a credit, with the reason the bill prints. Not a payment.';

INSERT INTO _migrations (name) VALUES ('197_account_adjustments.sql')
ON CONFLICT DO NOTHING;

COMMIT;
