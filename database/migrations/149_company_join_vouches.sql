-- 149: a company's staff vouch for a new colleague; GaitDesk approves.
--
-- My Company Staff let a company's managers and secretaries add colleagues
-- themselves. Membership carries the company's paid features, so an addition
-- made by the company is now a **request** a GaitDesk admin approves -- the
-- same `show_company_join_requests` row a sign-up leaves, answered from the
-- same place on the company's page, rather than a second queue.
--
-- Two facts are added to the row:
--
--   * `source` -- who started it. `signup`: the person typed the company's
--     name when they signed up (every row before this). `company`: somebody in
--     the company asked for them to be added, and the person did not ask.
--   * `vouched_by_user_id` / `vouched_at` -- the company member who stands
--     behind it. Always set on a `company` row; set on a `signup` row once the
--     company approves it on its side. What the admin weighs before adding.
--
-- New columns only; `source` is NOT NULL with a default, so rows written by the
-- running release (which does not map it) still land. Backward-compatible.

BEGIN;

ALTER TABLE show_company_join_requests
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'signup';

ALTER TABLE show_company_join_requests
    ADD COLUMN IF NOT EXISTS vouched_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE show_company_join_requests
    ADD COLUMN IF NOT EXISTS vouched_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_company_join_requests_source'
    ) THEN
        ALTER TABLE show_company_join_requests
            ADD CONSTRAINT ck_show_company_join_requests_source
            CHECK (source IN ('signup', 'company'));
    END IF;
END $$;

COMMENT ON COLUMN show_company_join_requests.source IS
    'signup: the person typed the company''s name at sign-up. company: a member '
    'of the company asked for them to be added (My Company Staff).';

COMMENT ON COLUMN show_company_join_requests.vouched_by_user_id IS
    'The company member who stands behind the request. A GaitDesk admin still '
    'approves it: membership carries the company''s paid features.';

INSERT INTO _migrations (name) VALUES ('149_company_join_vouches.sql')
ON CONFLICT DO NOTHING;

COMMIT;
