-- First name / last name split for users and trainers.
--
-- Adds first_name and last_name columns to both tables and backfills them from
-- the existing full_name (users) / name (trainers) values using a naive split
-- on the first space. Compound first names ("Mary Ann Smith") collapse last
-- name into "Ann Smith" — users can correct on next edit.
--
-- full_name and trainers.name stay in place as derived display compatibility
-- columns while reads are migrated to first_name + last_name.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS first_name TEXT,
    ADD COLUMN IF NOT EXISTS last_name TEXT;

UPDATE users SET
    first_name = CASE
        WHEN position(' ' IN full_name) > 0 THEN trim(split_part(full_name, ' ', 1))
        ELSE trim(full_name)
    END,
    last_name = CASE
        WHEN position(' ' IN full_name) > 0 THEN trim(substring(full_name FROM position(' ' IN full_name) + 1))
        ELSE ''
    END
WHERE first_name IS NULL OR last_name IS NULL;

ALTER TABLE users
    ALTER COLUMN first_name SET NOT NULL,
    ALTER COLUMN last_name SET NOT NULL;


ALTER TABLE trainers
    ADD COLUMN IF NOT EXISTS first_name TEXT,
    ADD COLUMN IF NOT EXISTS last_name TEXT;

UPDATE trainers SET
    first_name = CASE
        WHEN position(' ' IN name) > 0 THEN trim(split_part(name, ' ', 1))
        ELSE trim(name)
    END,
    last_name = CASE
        WHEN position(' ' IN name) > 0 THEN trim(substring(name FROM position(' ' IN name) + 1))
        ELSE ''
    END
WHERE first_name IS NULL OR last_name IS NULL;

ALTER TABLE trainers
    ALTER COLUMN first_name SET NOT NULL,
    ALTER COLUMN last_name SET NOT NULL;


INSERT INTO _migrations (name) VALUES ('050_first_last_name.sql') ON CONFLICT DO NOTHING;
