-- Migration 056: enforce case-insensitive uniqueness on users.email.
--
-- The Text email column has a case-sensitive UNIQUE constraint, so
-- Foo@bar.com and foo@bar.com were treated as two distinct accounts.
-- Application code already normalizes new and updated emails to lowercase;
-- this migration backfills existing rows and adds a unique functional index
-- so the database enforces the same invariant.
--
-- Rows whose lowercased form would collide with another row are left
-- as-is, and the index creation below will fail loudly. Resolve the
-- conflict (merge or delete the unwanted account) and re-run the migration.

UPDATE users
SET email = LOWER(email)
WHERE email <> LOWER(email)
  AND NOT EXISTS (
    SELECT 1 FROM users u2
    WHERE u2.id <> users.id
      AND LOWER(u2.email) = LOWER(users.email)
  );

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uniq ON users (LOWER(email));

INSERT INTO _migrations (name) VALUES ('056_user_email_case_insensitive.sql');
