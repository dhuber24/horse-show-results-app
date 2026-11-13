-- 188: a third kind of plan given to a show company -- a free upgrade.
--
-- Migration 179 gave a company a plan for free two ways, a comp and a trial,
-- and both cost nothing: a show starting while one runs is $0 per exhibitor.
-- An upgrade is the other half: the company gets GaitDesk Pro's features and
-- **still pays for the plan it chose** -- a company on Basic is billed
-- Basic's rate per exhibitor and has every Pro screen. So it is always to Pro
-- (Pro+ has the same features; what it adds is a way of paying), and it lifts
-- only a plan that sets up shows: a company on Free has chosen no price to pay,
-- and an unpaid Pro+ renewal stays frozen. Read through
-- `show_companies.effective_plan`; `usage_statement` prices the show at the
-- company's own plan as if the upgrade were not there.
--
-- Widens the kind CHECK and adds one pinning an upgrade to Pro. No row changes.
-- Backward-compatible: goes to production before the code, since the old
-- code's schemas never accept the new value.

BEGIN;

ALTER TABLE show_company_grants DROP CONSTRAINT IF EXISTS ck_show_company_grants_kind;

ALTER TABLE show_company_grants
    ADD CONSTRAINT ck_show_company_grants_kind
    CHECK (kind IN ('comp', 'trial', 'upgrade'));

ALTER TABLE show_company_grants DROP CONSTRAINT IF EXISTS ck_show_company_grants_upgrade_plan;

ALTER TABLE show_company_grants
    ADD CONSTRAINT ck_show_company_grants_upgrade_plan
    CHECK (kind <> 'upgrade' OR plan = 'pro');

COMMENT ON COLUMN show_company_grants.kind IS 'comp (complimentary, may have no end), trial (always ends) -- both make a show starting while it runs $0 per exhibitor -- or upgrade (migration 188: GaitDesk Pro''s features while the company still pays for its own plan; Pro only, and only on a plan that sets up shows).';

INSERT INTO _migrations (name) VALUES ('188_company_plan_upgrades.sql')
ON CONFLICT DO NOTHING;

COMMIT;
