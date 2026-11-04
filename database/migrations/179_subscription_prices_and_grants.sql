-- 179: GaitDesk's prices become data, and a GaitDesk admin can give a plan away.
--
-- Until now every price was a constant in the code: `show_companies.PLANS` for
-- show companies and `trainer_registry.PRO_PRICE_CENTS` for trainers.
--
-- `subscription_prices` is a history, not a setting. A row is a price from a
-- day on, and the price of anything is the latest row on or before its day. A
-- show is priced on its first day, so changing a price never re-prices a show
-- that has already started -- the Terms promise that (section 6). Rows are only
-- ever added, apart from a scheduled change cancelled before its day comes.
--
-- `show_company_grants` is a plan given to a company for free: a comp, or a
-- trial. It is Basic or Pro only -- Pro at no charge already has everything
-- Pro+ has. `ends_on` NULL is a comp with no end; a trial always has an end.
-- While one covers a day the company is on its plan, and a show whose first day
-- it covers costs nothing per exhibitor. The company's own `plan` is untouched,
-- and is what it is on when the grant ends.
--
-- A trainer's comp or trial is on the trainer, as Pro already is: `pro_until` is
-- the date (9999-12-31 for no end, `trainer_registry.PRO_NO_END`), and
-- `pro_grant` says it was given rather than paid for.
--
-- New tables and nullable columns: backward-compatible, so this goes to
-- production before the code.

BEGIN;

CREATE TABLE IF NOT EXISTS subscription_prices (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key               TEXT NOT NULL,
    amount_cents      INTEGER NOT NULL,
    effective_on      DATE NOT NULL,
    set_by_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT ck_subscription_prices_key CHECK (
        key IN ('basic_rate', 'pro_rate', 'pro_plus_annual', 'trainer_monthly', 'trainer_annual')
    ),
    CONSTRAINT ck_subscription_prices_amount CHECK (amount_cents >= 0)
);

-- In its own statement: `create_all` may have made the table first, with no
-- default on `id`, and the seed below would then fail.
ALTER TABLE subscription_prices ALTER COLUMN id SET DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS ix_subscription_prices_key_effective
    ON subscription_prices (key, effective_on);

-- Today's prices, from the beginning of time, so every show already run keeps
-- the price it has always had.
INSERT INTO subscription_prices (key, amount_cents, effective_on)
SELECT seed.key, seed.amount_cents, DATE '1970-01-01'
  FROM (VALUES
        ('basic_rate', 200),
        ('pro_rate', 400),
        ('pro_plus_annual', 149900),
        ('trainer_monthly', 1000),
        ('trainer_annual', 10000)
       ) AS seed(key, amount_cents)
 WHERE NOT EXISTS (SELECT 1 FROM subscription_prices p WHERE p.key = seed.key);

CREATE TABLE IF NOT EXISTS show_company_grants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID NOT NULL REFERENCES show_companies(id) ON DELETE CASCADE,
    plan                TEXT NOT NULL,
    kind                TEXT NOT NULL,
    starts_on           DATE NOT NULL,
    ends_on             DATE,
    note                TEXT,
    granted_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ DEFAULT now(),
    reminder_sent_at    TIMESTAMPTZ,
    CONSTRAINT ck_show_company_grants_plan CHECK (plan IN ('basic', 'pro')),
    CONSTRAINT ck_show_company_grants_kind CHECK (kind IN ('comp', 'trial')),
    CONSTRAINT ck_show_company_grants_dates CHECK (ends_on IS NULL OR ends_on >= starts_on),
    CONSTRAINT ck_show_company_grants_trial_ends CHECK (kind <> 'trial' OR ends_on IS NOT NULL)
);

ALTER TABLE show_company_grants ALTER COLUMN id SET DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS ix_show_company_grants_company
    ON show_company_grants (company_id);

ALTER TABLE trainers ADD COLUMN IF NOT EXISTS pro_grant TEXT;
ALTER TABLE trainers ADD COLUMN IF NOT EXISTS pro_grant_note TEXT;
ALTER TABLE trainers ADD COLUMN IF NOT EXISTS pro_grant_reminder_sent_at TIMESTAMPTZ;

ALTER TABLE trainers DROP CONSTRAINT IF EXISTS ck_trainers_pro_grant;
ALTER TABLE trainers ADD CONSTRAINT ck_trainers_pro_grant
    CHECK (pro_grant IS NULL OR pro_grant IN ('comp', 'trial'));

COMMIT;
