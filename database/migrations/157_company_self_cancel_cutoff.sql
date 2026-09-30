-- 157: how late an exhibitor may cancel their own registration is the show
-- company's to choose.
--
-- It was one rule for every show: a fortnight before the first day, then (for a
-- short while) for as long as registration is open. Neither is right for
-- everybody -- a club that draws its stall chart a fortnight out needs the
-- fortnight, and a small open show that takes day-haul entries does not -- and
-- which it is belongs to the business running the show, not to GaitDesk.
--
-- `self_cancel_days_before` is how many days before the show's first day an
-- exhibitor stops being able to cancel themselves. **0 means until the show
-- starts** -- while registration is open, the same window sign-up has -- and is
-- the default, because it is what every show did the day before this column.
-- From the cut-off on, the show office cancels from the desk, which is never
-- on a clock. Read through `cancellations.self_cancel_days_before`; a show with
-- no company (`shows.company_id` NULL, migration 156) reads 0.
--
-- On the company rather than the show: a club's policy is the same for every
-- show it runs, and a per-show setting is one more thing to remember in setup.
--
-- Capped at 90 days: a cut-off further out than that is a policy of not taking
-- online cancellations at all, and nothing here offers that yet.
--
-- A defaulted NOT NULL column and a CHECK: backward-compatible, so it goes to
-- production before the code.

BEGIN;

ALTER TABLE show_companies
    ADD COLUMN IF NOT EXISTS self_cancel_days_before INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_companies_self_cancel_days_before'
    ) THEN
        ALTER TABLE show_companies
            ADD CONSTRAINT ck_show_companies_self_cancel_days_before
            CHECK (self_cancel_days_before BETWEEN 0 AND 90);
    END IF;
END $$;

COMMENT ON COLUMN show_companies.self_cancel_days_before IS 'Days before the first day of a show that exhibitors stop being able to cancel their own registration; the show office cancels from then on. 0: until the show starts (while registration is open).';

INSERT INTO _migrations (name) VALUES ('157_company_self_cancel_cutoff.sql')
ON CONFLICT DO NOTHING;

COMMIT;
