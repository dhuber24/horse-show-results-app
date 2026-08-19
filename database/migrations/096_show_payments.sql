-- Migration 096: what the show office collected, so a balance can be owed.
--
-- Until now the app could say what an exhibitor owed and nothing else.
-- `billing.build_bill` itemizes class fees, NSBA sanction fees, the office
-- charge, and the stalls/shavings/camping reserved at sign-up — and that is the
-- whole story. Nobody recorded the check handed over at the desk, so "who still
-- owes us money?" was answerable only from the secretary's own paper list, and
-- any attempt to report an outstanding balance would have read as the full bill
-- for every exhibitor, forever.
--
-- **This records a payment; it does not process one.** No card is handled, no
-- processor is called, nothing is charged. The office takes cash or a check at
-- the desk and writes down that it happened — the same "report back what the
-- office did" shape as show_verifications, which records a document a human
-- physically inspected. The app still does not collect payment.
--
-- Scope is the exhibitor's account at one show (`show_entries`), not the
-- individual charge. A horse show office takes one check for the whole bill;
-- allocating tenders against specific line items would be a full
-- accounts-receivable ledger and nobody at the desk works that way. Balance is
-- therefore bill total − payments recorded, per exhibitor per show.
--
-- ON DELETE CASCADE from show_entries: the payment is a fact about that
-- exhibitor's account at that show. Remove the account and there is no balance
-- for the row to belong to.
--
-- amount_cents is deliberately signed — a negative row is a refund. A show that
-- gives money back (scratched class, cancelled stall) records it here rather
-- than editing or deleting the original payment, so the day's takings still
-- reconcile against what actually moved. The CHECK only excludes zero, which is
-- never a payment anyone needs a row for.
--
-- recorded_by_name is denormalized alongside the FK for the same reason
-- show_verifications.verified_by_name is: the row must stay readable after a
-- seasonal staff account is removed, and "who took this $600" is exactly the
-- question asked when the drawer does not balance.

BEGIN;

CREATE TABLE IF NOT EXISTS show_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_entry_id UUID NOT NULL REFERENCES show_entries(id) ON DELETE CASCADE,
    -- Signed: positive is money taken in, negative is a refund paid back out.
    amount_cents INTEGER NOT NULL,
    method TEXT NOT NULL,
    -- Check number, last four, transfer note — whatever identifies the tender
    -- on the office's own paperwork. Free text on purpose; every show tracks
    -- this differently and none of it is joined to anything.
    reference TEXT,
    -- The day the money changed hands, which is not always the day it was
    -- typed in — mail-in entries get opened and recorded in a batch.
    received_on DATE NOT NULL DEFAULT CURRENT_DATE,
    note TEXT,
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    recorded_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_show_payments_method
        CHECK (method IN ('cash', 'check', 'card', 'transfer', 'other')),
    CONSTRAINT ck_show_payments_amount_nonzero
        CHECK (amount_cents <> 0)
);

-- Every read is "all payments for this show's exhibitors", driven by the
-- financials rollup, so the account is the index that matters.
CREATE INDEX IF NOT EXISTS idx_show_payments_show_entry
    ON show_payments (show_entry_id);
CREATE INDEX IF NOT EXISTS idx_show_payments_received_on
    ON show_payments (received_on);

COMMENT ON TABLE show_payments IS
    'Money the show office recorded collecting against an exhibitor''s account at one show. Recording only — the app processes no payments.';
COMMENT ON COLUMN show_payments.amount_cents IS
    'Signed. Positive is a payment taken in; negative is a refund paid back out. Never zero.';
COMMENT ON COLUMN show_payments.method IS
    'cash | check | card | transfer | other. How the tender arrived at the desk.';
COMMENT ON COLUMN show_payments.reference IS
    'Free-text tender identifier (check number, last four). Joined to nothing.';
COMMENT ON COLUMN show_payments.received_on IS
    'The day the money changed hands, which may precede the day it was recorded.';
COMMENT ON COLUMN show_payments.recorded_by_name IS
    'Denormalized staff name so the row stays readable after the account is removed.';

INSERT INTO _migrations (name) VALUES ('096_show_payments.sql')
ON CONFLICT DO NOTHING;

COMMIT;
