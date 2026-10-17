-- 169: GaitDesk Free and Pro+, a log of plan changes, and a company's own crew.
--
-- **Free** (`show_companies.plan = 'free'`): what every company made from now
-- on starts on. A Free company can sign up and staff itself -- managers,
-- secretaries, its list of scribes and gate stewards -- but cannot set up a
-- show until one of its managers or secretaries picks GaitDesk Basic or Pro.
-- Nothing is charged for picking one; a show is invoiced after it runs. The
-- CHECK is widened to take it, and the default becomes 'free'. Companies that
-- exist today keep the plan they are on.
--
-- **Pro+** is not a value of `plan`. It is a prepaid year
-- (`show_company_subscriptions`): $1,499 for unlimited shows and exhibitors,
-- with every Pro feature. While a year covers today the company is on Pro+;
-- `plan` is the per-exhibitor plan it is on otherwise, and returns to when a
-- year runs out unrenewed. `renewal_reminder_sent_at` marks the reminder sent
-- a month before the year ends, so a daily check sends it once.
--
-- `show_company_plan_changes`: every change of `plan`, with who made it. A
-- company now picks its own plan, so a show cannot be priced at whatever the
-- plan is on the day it is invoiced -- a company could move to Basic the night
-- the show closes. A show is priced at the highest plan the company was on
-- across the show's dates (`show_companies.show_billing_plan`). Seeded with one
-- row per existing company, dated 1970 so it covers every show it already ran.
--
-- `show_company_crew`: a company's own scribes and gate stewards. Until now
-- they were staffed one show at a time and belonged to nobody, so a company
-- with no show yet had nowhere to keep them. The list is the company's; the
-- office still assigns each person to the shows they work (`show_scribes`,
-- `show_gate_stewards`), and a crew member works nothing they are not
-- assigned to.
--
-- `user_invites.company_id`: an invite from My Company, which puts the new
-- account in the company (a manager or secretary) or on its crew (a scribe or
-- gate steward) rather than on one show.
--
-- New tables, a nullable column, a widened CHECK and a new default: all
-- backward-compatible, so this goes to production before the code.

BEGIN;

ALTER TABLE show_companies DROP CONSTRAINT IF EXISTS ck_show_companies_plan;
ALTER TABLE show_companies
    ADD CONSTRAINT ck_show_companies_plan CHECK (plan IN ('free', 'basic', 'pro'));
ALTER TABLE show_companies ALTER COLUMN plan SET DEFAULT 'free';

CREATE TABLE IF NOT EXISTS show_company_plan_changes (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id         UUID NOT NULL REFERENCES show_companies(id) ON DELETE CASCADE,
    plan               TEXT NOT NULL,
    changed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    changed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);
ALTER TABLE show_company_plan_changes ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_company_plan_changes ALTER COLUMN changed_at SET DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_show_company_plan_changes_company
    ON show_company_plan_changes (company_id, changed_at);

INSERT INTO show_company_plan_changes (company_id, plan, changed_at)
SELECT c.id, c.plan, TIMESTAMPTZ '1970-01-01 00:00:00+00'
FROM show_companies c
WHERE NOT EXISTS (SELECT 1 FROM show_company_plan_changes p WHERE p.company_id = c.id);

CREATE TABLE IF NOT EXISTS show_company_subscriptions (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id               UUID NOT NULL REFERENCES show_companies(id) ON DELETE CASCADE,
    plan                     TEXT NOT NULL DEFAULT 'pro_plus',
    starts_on                DATE NOT NULL,
    ends_on                  DATE NOT NULL,
    price_cents              INTEGER NOT NULL,
    payment_method           TEXT,
    payment_reference        TEXT,
    recorded_by_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at               TIMESTAMPTZ DEFAULT now(),
    renewal_reminder_sent_at TIMESTAMPTZ
);
ALTER TABLE show_company_subscriptions ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_company_subscriptions ALTER COLUMN plan SET DEFAULT 'pro_plus';
ALTER TABLE show_company_subscriptions ALTER COLUMN created_at SET DEFAULT now();
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_company_subscriptions_dates') THEN
        ALTER TABLE show_company_subscriptions
            ADD CONSTRAINT ck_show_company_subscriptions_dates CHECK (ends_on >= starts_on);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_company_subscriptions_plan') THEN
        ALTER TABLE show_company_subscriptions
            ADD CONSTRAINT ck_show_company_subscriptions_plan CHECK (plan IN ('pro_plus'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_company_subscriptions_price') THEN
        ALTER TABLE show_company_subscriptions
            ADD CONSTRAINT ck_show_company_subscriptions_price CHECK (price_cents >= 0);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_show_company_subscriptions_company
    ON show_company_subscriptions (company_id, ends_on);

CREATE TABLE IF NOT EXISTS show_company_crew (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id       UUID NOT NULL REFERENCES show_companies(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_show_company_crew UNIQUE (company_id, user_id)
);
ALTER TABLE show_company_crew ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_company_crew ALTER COLUMN created_at SET DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_show_company_crew_user ON show_company_crew (user_id);

ALTER TABLE user_invites
    ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES show_companies(id) ON DELETE CASCADE;

INSERT INTO _migrations (name) VALUES ('169_free_plan_pro_plus_company_crew.sql')
ON CONFLICT DO NOTHING;

COMMIT;
