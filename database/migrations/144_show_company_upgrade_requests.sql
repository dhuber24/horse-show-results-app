-- Migration 144: a show company asking GaitDesk for a paid feature.
--
-- The locked show-bill button (migration 142) told somebody to "ask GaitDesk
-- about upgrading" and gave them no way to do it -- the app has no contact
-- form for GaitDesk itself, only for a show's own office. So the locked door
-- now carries a Request upgrade button, and this table is what it writes.
--
-- **Stored, and only then emailed.** `mailer.py` does nothing without SMTP, so
-- a request that was only an email would say "sent" and could be lost; the row
-- is what the admin's Show Companies screens read, and the email to GaitDesk's
-- admins is a courtesy on top -- the same reason a show's inbox is a table.
--
-- **Keyed on the company and the feature, not on the person.** A feature is
-- sold to the company and reaches every account in it, so two of a club's
-- staff pressing the button are one request, and the second is told the first
-- already asked. `requested_by_user_id` records who pressed it, so GaitDesk
-- knows whom to answer; SET NULL on their account going, because the company
-- still asked.
--
-- **Turning the feature on answers it**, in the same transaction -- the same
-- way adding a member answers a join request (migration 143). An admin may
-- also dismiss one, which deletes it.
--
-- `feature` carries no CHECK, for the reason `show_company_features.feature`
-- does not: the registry in `backend/show_companies.py` is the list.
--
-- A new table and nothing else, so the running release ignores it and this is
-- safe to apply before the code that reads it.

BEGIN;

CREATE TABLE IF NOT EXISTS show_company_upgrade_requests (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id           UUID NOT NULL REFERENCES show_companies(id) ON DELETE CASCADE,
    feature              TEXT NOT NULL,
    requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_show_company_upgrade_requests UNIQUE (company_id, feature)
);

-- Stated apart from the CREATE TABLE, for the create_all race (migration 114).
ALTER TABLE show_company_upgrade_requests ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_company_upgrade_requests ALTER COLUMN created_at SET DEFAULT now();

COMMENT ON TABLE show_company_upgrade_requests IS
    'A show company asking GaitDesk to switch a paid feature on. One per (company, feature); switching the feature on deletes it. See backend/show_companies.py.';

INSERT INTO _migrations (name) VALUES ('144_show_company_upgrade_requests.sql')
ON CONFLICT DO NOTHING;

COMMIT;
