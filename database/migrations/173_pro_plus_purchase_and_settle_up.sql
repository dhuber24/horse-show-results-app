-- 173: Pro+ is bought up front, and a show is settled before the next one.
--
-- **Pro+ is paid for when it is bought.** A show company buys its $1,499 year
-- on My Company -- by credit card (processing fee added) or bank transfer --
-- and the year starts once the payment succeeds. `show_company_subscriptions`
-- gains `stripe_payment_intent_id` (unique where set: one year per payment,
-- however many times Stripe reports it) and `card_fee_cents`, the fee paid on
-- top. While a bank payment is on its way, `show_companies.pro_plus_payment_
-- intent_id` / `pro_plus_payment_pending_at` hold it, so it is not bought
-- twice.
--
-- **A finished show is paid for before the company sets up another.** Basic
-- and Pro are billed per exhibitor after each show; a company with a show
-- that has finished and is not paid for -- online, or by check that a
-- GaitDesk admin marks paid -- cannot set up its next show. Paying lifts it.
-- `show_companies.settle_shows_from` is the first show end date that counts:
-- today for every company that exists now, so shows already run are never
-- suddenly owed, and a new company's own creation day.
--
-- Nullable or defaulted columns and an index: backward-compatible, so this
-- goes to production before the code.

BEGIN;

ALTER TABLE show_company_subscriptions ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;
ALTER TABLE show_company_subscriptions ADD COLUMN IF NOT EXISTS card_fee_cents INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_show_company_subscriptions_payment_intent
    ON show_company_subscriptions (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

ALTER TABLE show_companies ADD COLUMN IF NOT EXISTS pro_plus_payment_intent_id TEXT;
ALTER TABLE show_companies ADD COLUMN IF NOT EXISTS pro_plus_payment_pending_at TIMESTAMPTZ;

-- Added with its default in one statement: every existing company takes the
-- day this runs, and a new one its own creation day.
ALTER TABLE show_companies ADD COLUMN IF NOT EXISTS settle_shows_from DATE NOT NULL DEFAULT CURRENT_DATE;

INSERT INTO _migrations (name) VALUES ('173_pro_plus_purchase_and_settle_up.sql')
ON CONFLICT DO NOTHING;

COMMIT;
