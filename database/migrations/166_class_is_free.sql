-- 166: a class the show office made free.
--
-- A class priced at $0 on purpose and a class nobody had priced yet looked the
-- same. The Class Fees box's default fill raises every class still at $0, so a
-- free class -- a leadline, a sponsor's class -- was priced the first time
-- somebody used it; and even left at $0, the show's per-class fees, its office
-- charge and a club's sanction fee went on billing an entry in a class that was
-- meant to cost nothing.
--
-- `classes.is_free` -- the office's word that entering this class costs
-- nothing. What it waives is decided once, in `backend/billing.py`:
--
--   * the class's own entry fee, which is held at 0 (the CHECK below), so
--     every screen that prints `entry_fee_cents` prints nothing to pay;
--   * the show's per-class fees and every other automatic charge -- an entry
--     in a free class counts toward no per-class, per-horse, per-exhibitor or
--     per-judge charge, so somebody entered only in free classes owes nothing;
--   * a club's sanction fee on it, per class or per horse.
--
-- A side pot buy-in is not waived: it is prize money the exhibitor puts up, not
-- a fee the show charges. A futurity class cannot be made free -- the
-- futurity's own categories price it (Step 6).
--
-- A defaulted column, and a CHECK every existing row passes: backward-
-- compatible, so it goes to production before the code. The default and the
-- CHECK in their own statements, the way 161 does it.

BEGIN;

ALTER TABLE classes ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE classes ALTER COLUMN is_free SET DEFAULT false;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_classes_free_has_no_fee'
    ) THEN
        ALTER TABLE classes
            ADD CONSTRAINT ck_classes_free_has_no_fee
            CHECK (NOT is_free OR entry_fee_cents = 0);
    END IF;
END $$;

INSERT INTO _migrations (name) VALUES ('166_class_is_free.sql')
ON CONFLICT DO NOTHING;

COMMIT;
