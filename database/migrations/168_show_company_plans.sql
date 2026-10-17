-- 168: GaitDesk Basic and GaitDesk Pro -- the plan a show company is on.
--
-- Until now a company bought paid features one at a time: a
-- `show_company_features` row per feature, switched on by a GaitDesk admin.
-- GaitDesk now sells two plans, both charged per exhibitor registered to a
-- show:
--
--   * `basic` -- $2 an exhibitor. Running the show: registration, back
--     numbers, the gate, scribing, live results, and billing and payment
--     recording.
--   * `pro`   -- $4 an exhibitor. Everything in Basic, plus financial reports,
--     the show bill import, results exported in a breed association's format,
--     the Live Boards, and online card payments once they are built.
--
-- `show_companies.plan` -- which one the company is on. What each plan
-- includes and costs is the registry in `backend/show_companies.py` (`PLANS`),
-- not this column, for the same reason `show_company_features.feature` has no
-- CHECK: what a plan includes is decided where the gates read it. The CHECK
-- here is only on the two plan names.
--
-- **Every company that exists today is grandfathered onto Pro**, so nobody
-- loses a screen they use. The column is added with `pro` as its default so
-- the existing rows take it, and the default then becomes `basic` for every
-- company made after this.
--
-- A `show_company_features` row stays a switch: an add-on on top of the plan,
-- which is how a Basic company can be given one Pro feature.
--
-- A defaulted column: backward-compatible, so it goes to production before the
-- code. The running release never names the column and its inserts take the
-- default.

BEGIN;

ALTER TABLE show_companies ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'pro';
ALTER TABLE show_companies ALTER COLUMN plan SET DEFAULT 'basic';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_companies_plan') THEN
        ALTER TABLE show_companies
            ADD CONSTRAINT ck_show_companies_plan CHECK (plan IN ('basic', 'pro'));
    END IF;
END $$;

INSERT INTO _migrations (name) VALUES ('168_show_company_plans.sql')
ON CONFLICT DO NOTHING;

COMMIT;
