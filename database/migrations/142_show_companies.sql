-- Migration 142: show companies, and the paid features GaitDesk turns on for them.
--
-- Starting a show from its printed show bill (migration 141) is the first thing
-- in this app a customer pays for: every read spends model tokens on a document
-- tens of pages long, and it is sold to the business that runs the shows, not
-- to one of its staff and not to one show. Nothing in the schema named that
-- business. A show is owned by the accounts in `show_managers`, and nothing
-- groups those accounts into anything larger -- so there was nowhere to put
-- "this club has paid" that would reach all three people who work its office.
--
-- Three tables:
--
--   * `show_companies` -- the business: a club, an association affiliate, a
--     management firm. A name, and notes only a GaitDesk admin reads (the
--     billing arrangement lives there while the app collects no payment).
--   * `show_company_members` -- the accounts that work for it. Many to many: a
--     freelance secretary may work for three clubs in a season, and each of
--     them may have paid for something different.
--   * `show_company_features` -- what the company has paid for. **A row is the
--     switch**: present means on, and turning a feature off deletes it. A
--     caller has a feature when any company they belong to has it; an ADMIN
--     has every feature, because GaitDesk staff support every customer.
--
-- `feature` carries no CHECK on purpose. The list of paid features is the
-- registry in `backend/show_companies.py`, because a feature is only a feature
-- once code gates on it -- and a CHECK here would make adding the second one a
-- migration as well as a code change, for a column that no reader trusts
-- without asking the registry first.
--
-- New tables and nothing else, so the running release ignores them and this is
-- safe to apply before the code that reads it.

BEGIN;

CREATE TABLE IF NOT EXISTS show_companies (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name               TEXT NOT NULL,
    notes              TEXT,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS show_company_members (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id       UUID NOT NULL REFERENCES show_companies(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_show_company_members UNIQUE (company_id, user_id)
);

CREATE TABLE IF NOT EXISTS show_company_features (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id         UUID NOT NULL REFERENCES show_companies(id) ON DELETE CASCADE,
    feature            TEXT NOT NULL,
    enabled_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    enabled_at         TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_show_company_features UNIQUE (company_id, feature)
);

-- Stated apart from the CREATE TABLEs: startup's `create_all` may have made
-- these tables from the models before this ran, in which case IF NOT EXISTS
-- skipped and the defaults would be missing (see the migration 114 note in
-- CLAUDE.md).
ALTER TABLE show_companies ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_companies ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE show_company_members ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_company_members ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE show_company_features ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_company_features ALTER COLUMN enabled_at SET DEFAULT now();

-- Two companies of one name are one company typed twice; the admin screen
-- would list both and nobody could tell which one had paid.
CREATE UNIQUE INDEX IF NOT EXISTS uq_show_companies_name
    ON show_companies (lower(btrim(name)));

-- "Which features does this caller have?" runs on every show-bill request.
CREATE INDEX IF NOT EXISTS idx_show_company_members_user
    ON show_company_members (user_id);

COMMENT ON TABLE show_companies IS
    'The business that runs shows -- a club or management firm -- and the unit a paid feature is switched on for. See backend/show_companies.py.';

COMMENT ON COLUMN show_companies.notes IS
    'GaitDesk admin only. The billing arrangement while the app collects no payment.';

COMMENT ON TABLE show_company_features IS
    'Paid features switched on for a company. A row is the switch: present is on, and turning a feature off deletes it. feature is checked against the registry in backend/show_companies.py, not by a CHECK.';

INSERT INTO _migrations (name) VALUES ('142_show_companies.sql')
ON CONFLICT DO NOTHING;

COMMIT;
