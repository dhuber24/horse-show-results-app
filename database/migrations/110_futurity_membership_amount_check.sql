-- Migration 110: the CHECK migration 109 wrote and the database did not get.
--
-- `futurity_membership_options` is declared in 109 with
-- `amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0)`, matching
-- every other money column in the futurity tables. On any database where the
-- backend had already started against the new `models.py`, SQLAlchemy's
-- `create_all` got there first and created the table from the ORM model — which
-- carries the columns and the unique constraint but not the CHECK, because the
-- model never declared one. `CREATE TABLE IF NOT EXISTS` then correctly did
-- nothing, and the constraint was silently absent.
--
-- This is the standing hazard with a new table in this repo: `create_all` runs
-- at startup and only ever creates whole tables, so whichever of the two runs
-- first decides what the table looks like, and the migration cannot tell. The
-- answer is not to stop writing `IF NOT EXISTS` — it is that anything a
-- migration adds *inside* a CREATE TABLE has to be re-asserted separately if it
-- matters, which for a CHECK is one guarded ALTER.
--
-- Idempotent by name, so a database that got the constraint from 109 skips it.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_futurity_membership_options_amount'
    ) AND NOT EXISTS (
        -- The inline form in 109 is auto-named by Postgres, so a database that
        -- applied 109 before the backend restarted already has an equivalent
        -- constraint under a generated name. Adding a second one would be
        -- harmless but confusing.
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'futurity_membership_options' AND c.contype = 'c'
    ) THEN
        ALTER TABLE futurity_membership_options
            ADD CONSTRAINT ck_futurity_membership_options_amount
            CHECK (amount_cents >= 0);
    END IF;
END $$;

INSERT INTO _migrations (name) VALUES ('110_futurity_membership_amount_check.sql')
ON CONFLICT DO NOTHING;

COMMIT;
