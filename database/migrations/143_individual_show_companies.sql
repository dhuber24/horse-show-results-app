-- Migration 143: every show manager and secretary belongs to a show company.
--
-- Migration 142 made the show company the thing a paid feature is switched on
-- for. But plenty of show managers and secretaries work for no club or firm --
-- an independent secretary hired show by show -- and a feature can only reach
-- an account through a company, so there was no way to sell one to them short
-- of inventing a company by hand.
--
-- So an independent person gets **a company of their own, named after them**,
-- created with their account. `owner_user_id` is what marks one: the person
-- the company *is*, as against the accounts that work for it. It carries two
-- rules the ordinary company does not:
--
--   * **Its name need not be unique.** Two people really can both be called
--     Sarah Johnson. The unique name index moves to organizations only, where
--     two rows of one name are one club typed twice.
--   * **It follows the person's name** until somebody gives it another one
--     (`show_companies.sync_personal_company_name`), and it goes when they do:
--     ON DELETE CASCADE, because a company that was one person is nothing once
--     the person has gone.
--
-- `show_company_join_requests` is the other half of the sign-up form's new
-- Company / Organization box. Typing a name nobody has used creates that
-- organization; typing one that exists does **not** join it -- a paid feature
-- reaches every account in a company, so joining by typing a name would sell
-- a club's subscription to anybody who knows what the club is called. The
-- request is recorded instead, for a GaitDesk admin to approve or decline.
--
-- Finally the backfill: every existing show manager and secretary in no
-- company gets their own, so the rule holds for accounts made before it.
--
-- Backward compatible throughout -- a nullable column, a new table, a relaxed
-- index and inserted rows -- so it is safe to apply before the code that reads it.

BEGIN;

ALTER TABLE show_companies
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- One company of their own per person.
CREATE UNIQUE INDEX IF NOT EXISTS uq_show_companies_owner
    ON show_companies (owner_user_id) WHERE owner_user_id IS NOT NULL;

-- Unique names among organizations only.
DROP INDEX IF EXISTS uq_show_companies_name;
CREATE UNIQUE INDEX uq_show_companies_name
    ON show_companies (lower(btrim(name))) WHERE owner_user_id IS NULL;

CREATE TABLE IF NOT EXISTS show_company_join_requests (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES show_companies(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_show_company_join_requests UNIQUE (company_id, user_id)
);

-- Stated apart from the CREATE TABLE, for the create_all race (migration 114).
ALTER TABLE show_company_join_requests ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_company_join_requests ALTER COLUMN created_at SET DEFAULT now();

COMMENT ON COLUMN show_companies.owner_user_id IS
    'Set on a company that is one independent person, named after them and created with their account. NULL on an organization. Only organizations need a unique name.';

COMMENT ON TABLE show_company_join_requests IS
    'Somebody who typed an existing organization''s name at sign-up. Not a membership: a GaitDesk admin approves it, because membership carries the company''s paid features.';

-- Backfill: every show manager and secretary in no company gets their own.
INSERT INTO show_companies (id, name, owner_user_id, created_by_user_id, created_at)
SELECT gen_random_uuid(), u.full_name, u.id, u.id, now()
FROM users u
WHERE u.role IN ('SHOW_MANAGER', 'SHOW_SECRETARY')
  AND NOT EXISTS (SELECT 1 FROM show_company_members m WHERE m.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM show_companies c WHERE c.owner_user_id = u.id);

INSERT INTO show_company_members (id, company_id, user_id, added_by_user_id, created_at)
SELECT gen_random_uuid(), c.id, c.owner_user_id, c.owner_user_id, now()
FROM show_companies c
WHERE c.owner_user_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM show_company_members m
      WHERE m.company_id = c.id AND m.user_id = c.owner_user_id
  );

INSERT INTO _migrations (name) VALUES ('143_individual_show_companies.sql')
ON CONFLICT DO NOTHING;

COMMIT;
