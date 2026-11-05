-- 180: A show company shows who it is before it reaches people it has no link to.
--
-- Anybody can sign up as a Show Secretary or Manager, be approved at once, choose
-- a plan and set up a show. The office reads a person through a show it works, so
-- putting somebody on a roster was all it took to read their phone, home address,
-- emergency contact and guardian.
--
-- Until a GaitDesk admin verifies a company, or it pays GaitDesk for the first
-- time, it reaches only people who signed up to its shows and people it typed in
-- itself. The rule is `backend/company_verification.py`.
--
-- `verified_how` says how it came to be verified: 'admin', 'paid', or 'existing'
-- for a company this release found already running, set below.
-- `verification_removed_at` is an admin taking it away, which a later payment does
-- not undo. `verification_requested_at` is the company asking, from My Company.
--
-- `judges.created_by_user_id` is who typed a judge in, so an unverified company
-- still reads back the contact details it typed itself. NULL on every judge from
-- before now.
--
-- Nullable columns only: backward-compatible, so this goes to production before
-- the code.

BEGIN;

ALTER TABLE show_companies
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verified_how TEXT,
    ADD COLUMN IF NOT EXISTS verified_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS verification_removed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verification_requested_at TIMESTAMPTZ;

ALTER TABLE show_companies DROP CONSTRAINT IF EXISTS ck_show_companies_verified_how;
ALTER TABLE show_companies ADD CONSTRAINT ck_show_companies_verified_how
    CHECK (verified_how IS NULL OR verified_how IN ('existing', 'admin', 'paid'));

ALTER TABLE judges
    ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Every company already at work comes through as it was: one that has a show, has
-- paid GaitDesk, or that a GaitDesk admin made. A company that has only signed up
-- starts unverified, the same as a new one.
UPDATE show_companies c
   SET verified_at = now(),
       verified_how = 'existing'
 WHERE c.verified_at IS NULL
   AND (
        EXISTS (SELECT 1 FROM shows s WHERE s.company_id = c.id)
        -- A show from before shows had companies is on its managers' companies
        -- (`show_companies.show_company_ids`).
        OR EXISTS (
            SELECT 1
              FROM shows s
              JOIN show_managers sm ON sm.show_id = s.id
              JOIN show_company_members m ON m.user_id = sm.user_id
             WHERE s.company_id IS NULL
               AND m.company_id = c.id
        )
        OR EXISTS (
            SELECT 1
              FROM gaitdesk_invoices i
             WHERE i.company_id = c.id
               AND i.paid_on IS NOT NULL
               AND i.amount_cents > 0
        )
        OR EXISTS (
            SELECT 1
              FROM show_company_subscriptions y
             WHERE y.company_id = c.id
               AND y.payment_received_on IS NOT NULL
               AND y.price_cents > 0
        )
        OR EXISTS (
            SELECT 1
              FROM users u
             WHERE u.id = c.created_by_user_id
               AND u.role = 'ADMIN'
        )
   );

COMMIT;
