-- 175: GaitDesk Pro+ renews as Pro+, and an unpaid renewal freezes the shows.
--
-- Until now a Pro+ year that ran out unrenewed dropped the company onto its
-- per-exhibitor plan (`show_companies.plan`, moved from Free to Pro when the
-- year was bought), and it carried on setting up and running shows, billed
-- per exhibitor. Now a company on Pro+ stays on Pro+: the plan it renews to is
-- the plan it has. From the day after its year ends until it pays the renewal
-- or picks Basic or Pro, it sets up no show and every show of its that had
-- not finished by then -- one running when the year ran out included -- is
-- frozen for its office, scribes and gate (`show_companies.pro_plus_lapse`).
--
-- `renews_pro_plus` says which: set when a year is started, cleared when the
-- company (or a GaitDesk admin) picks Basic, Pro or Free -- which is how a
-- company on Pro+ chooses what follows it instead. Every company with a year
-- in force or still to come renews it. None is on Pro+ in production today.
--
-- A defaulted column: backward-compatible, so this goes to production before
-- the code.

BEGIN;

ALTER TABLE show_companies ADD COLUMN IF NOT EXISTS renews_pro_plus BOOLEAN NOT NULL DEFAULT false;

UPDATE show_companies c
   SET renews_pro_plus = true
 WHERE EXISTS (
       SELECT 1 FROM show_company_subscriptions s
        WHERE s.company_id = c.id AND s.ends_on >= CURRENT_DATE
 );

-- The plan log a show is priced from now records Pro+ as a choice too, so a
-- show that starts while a renewal is unpaid is priced by what the company
-- picks to come out of it, not by the plan it held before Pro+.
INSERT INTO show_company_plan_changes (company_id, plan, changed_at)
SELECT c.id, 'pro_plus', now()
  FROM show_companies c
 WHERE c.renews_pro_plus
   AND NOT EXISTS (
       SELECT 1 FROM show_company_plan_changes p
        WHERE p.company_id = c.id AND p.plan = 'pro_plus'
   );

INSERT INTO _migrations (name) VALUES ('175_pro_plus_renews.sql')
ON CONFLICT DO NOTHING;

COMMIT;
