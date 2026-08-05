-- Migration 089: restore the CHECK constraints migrations 087/088 couldn't add.
--
-- Backend startup runs `Base.metadata.create_all`, which races the migration
-- runner: on a database where the app booted first, `horse_access_requests`
-- and `show_entry_reservations` already existed, so the `CREATE TABLE IF NOT
-- EXISTS` in 087/088 was skipped in full — including the CHECK constraints,
-- which lived only in the SQL and not in the SQLAlchemy models. Indexes and
-- comments still applied (they are separate statements), which is why the
-- shortfall was exactly the checks and nothing else.
--
-- The durable half of this fix is in `backend/models.py`, where the same three
-- constraints are now declared with these names, so a create_all-first
-- database gets them too. This migration is the catch-up for databases already
-- past that point, and is a no-op wherever they exist.
--
-- Named explicitly rather than left to Postgres so the existence check has
-- something stable to look for, and so the model and the migration agree on
-- what "already there" means.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_horse_access_requests_kind'
    ) THEN
        ALTER TABLE horse_access_requests
            ADD CONSTRAINT ck_horse_access_requests_kind
            CHECK (kind IN ('link', 'transfer'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_horse_access_requests_status'
    ) THEN
        ALTER TABLE horse_access_requests
            ADD CONSTRAINT ck_horse_access_requests_status
            CHECK (status IN ('pending', 'approved', 'declined', 'cancelled', 'expired'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_entry_reservations_quantity'
    ) THEN
        ALTER TABLE show_entry_reservations
            ADD CONSTRAINT ck_show_entry_reservations_quantity
            CHECK (quantity >= 0);
    END IF;
END $$;

INSERT INTO _migrations (name) VALUES ('089_horse_access_reservation_checks.sql')
ON CONFLICT DO NOTHING;

COMMIT;
