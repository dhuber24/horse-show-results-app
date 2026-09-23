-- Migration 140: the office's own record of a person who has never used the app.
--
-- Every exhibitor record in this database was made one of two ways: the person
-- created an account (`_ensure_role_profile` writes the row), or somebody
-- seeded test data. So `GET /exhibitors/names` filters to `user_id IS NOT NULL`
-- and calls what is left "orphaned/test records", and the registration desk's
-- add-somebody form says in as many words that an exhibitor needs an account
-- before they can be entered.
--
-- That is not how a show takes entries. A walk-up hands over a paper entry
-- blank with a name on it, and the office needs them on the roster now — with a
-- back number, their classes and their bill — not after talking them through
-- creating a login at the counter with a queue behind them. The row the office
-- writes for that person is a real record of a real exhibitor, and the only
-- thing that distinguishes it from the seed leftovers is that a member of staff
-- typed it in.
--
-- `created_by_user_id` is what records that, and it is the same column
-- `horses.created_by_user_id` already carries for the same reason: staff
-- filling a form in on somebody's behalf. It is what lets the pickers offer an
-- office-created person at the *next* show without also offering the orphans,
-- so the office types somebody in once rather than once a weekend.
--
-- `email` is the address the office took at the counter, and it exists because
-- `exhibitors` has nowhere else to put one: `phone` has always lived here, but
-- an email address lives on `users`, which an office record has none of. It is
-- a contact detail and never a login. Once a record is linked to an account,
-- that account's address is the authority and this one is what the office
-- happened to write down.
--
-- The second job it does is the one that matters later. When the exhibitor
-- eventually creates their own account, the app has two rows for one person —
-- the office's, carrying their entries and back numbers, and the new one,
-- carrying nothing. Matching them on name alone is a guess (a name is not proof
-- of identity, which is why the desk groups same-name records and refuses to
-- merge them on its own); an address the office wrote down that matches the one
-- somebody signed up with is a good enough reason to *ask*. Staff still press
-- the button.
--
-- Both columns are nullable and defaulted to nothing, so the running release
-- ignores them and this is safe to apply before the code that reads them.

BEGIN;

ALTER TABLE exhibitors
    ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE exhibitors
    ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN exhibitors.email IS
    'Contact email the office recorded for this person, never a login. When user_id is set, that account''s email is the authority; this is what somebody wrote on a paper entry blank. Also the strongest hint available when deciding whether an office record and a new account are the same person.';

COMMENT ON COLUMN exhibitors.created_by_user_id IS
    'The staff member who typed this exhibitor in at a registration desk. NULL means the row came from an account signing up, or predates migration 140. Distinguishes a real accountless person the office is working with from the accountless seed data the name pickers exclude.';

-- Finding the office's records, and finding a candidate to merge an account
-- with, are both queries over the accountless rows.
CREATE INDEX IF NOT EXISTS idx_exhibitors_created_by
    ON exhibitors (created_by_user_id)
    WHERE created_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exhibitors_email
    ON exhibitors (lower(email))
    WHERE email IS NOT NULL;

INSERT INTO _migrations (name) VALUES ('140_exhibitor_office_records.sql')
ON CONFLICT DO NOTHING;

COMMIT;
