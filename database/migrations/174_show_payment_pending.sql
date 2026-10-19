-- 174: an exhibitor's bank payment on its way is held, like a company's.
--
-- An exhibitor paying their balance online by bank transfer is days from
-- paid: a bank linked by signing in is `processing` until it settles, and one
-- typed in by hand waits on its microdeposit first. Until Stripe's webhook
-- records it, their balance still read owed and *Pay online* was still
-- offered, so they could pay a second time. `show_entries` gains
-- `online_payment_intent_id` / `online_payment_pending_at`, set while such a
-- payment is on its way and cleared when it settles or fails -- the same pair
-- `show_companies` has for Pro+ (migration 173).
--
-- Nullable columns: backward-compatible, so this goes to production before
-- the code.

BEGIN;

ALTER TABLE show_entries ADD COLUMN IF NOT EXISTS online_payment_intent_id TEXT;
ALTER TABLE show_entries ADD COLUMN IF NOT EXISTS online_payment_pending_at TIMESTAMPTZ;

INSERT INTO _migrations (name) VALUES ('174_show_payment_pending.sql')
ON CONFLICT DO NOTHING;

COMMIT;
