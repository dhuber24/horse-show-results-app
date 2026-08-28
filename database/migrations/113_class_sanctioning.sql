-- Migration 113: which classes a club actually sanctions.
--
-- A club sanction is not a property of the show. NSBA approves a list of
-- classes; so do WSCA and MNSPHC. A show carrying NSBA sanctioning runs plenty
-- of classes NSBA has nothing to do with — every halter class at a show whose
-- NSBA approval covers the pleasure and horsemanship classes — and the
-- exhibitor entering one of those does not owe a sanction fee on it.
--
-- The app has had nowhere to say that, and both halves of the money were wrong
-- in opposite directions:
--
--   * NSBA billed *every* class. `build_bill` read one show-wide boolean
--     (`show_is_nsba_sanctioned`) and added 6% of the entry fee, $3 minimum, to
--     every line on the bill. An exhibitor who entered eight classes at an NSBA
--     show paid eight sanction fees whether or not NSBA approved any of them.
--
--   * WSCA and MNSPHC billed *nothing*. `show_sanctioning.per_class_fee_cents`
--     is set in setup Step 3/5 and printed on the public show bill as "$2.00
--     per class" — and no code path has ever read it. The show published a
--     price and charged nobody.
--
-- One join table fixes both, because both are the same missing fact.
--
-- `association_id`, not `show_type_id`. Clubs are deliberately not show types
-- (migration 080) — an NSBA-approved show is an OPEN or breed show carrying
-- NSBA sanctioning — so this points at `associations` like `show_sanctioning`
-- does. `class_associations` is a different table answering a different
-- question: the association's *class code* for a breed catalog import.
--
-- Backfill designates every class for every association the show already
-- sanctions. For NSBA that is exactly what was being billed, so no open show's
-- bill moves on deploy and staff untick what their approval does not cover. For
-- WSCA and MNSPHC it starts billing a per-class fee that the show bill has been
-- publishing all along, which is the bug being fixed rather than a new charge.
-- Both cases are visible and reversible in the class setup screen; neither is
-- silent.

-- Written to converge the schema rather than to assume it creates the table.
-- The backend's startup `create_all` reflects `backend/models.py` and will have
-- raced ahead of this file on any environment where the code deployed first --
-- producing a `class_sanctioning` with no SQL-level default on `id`, because
-- SQLAlchemy generates that default in Python. The backfill below then fails on
-- a not-null violation. Every statement here is safe to run against a table
-- this migration made and against one `create_all` made.

BEGIN;

CREATE TABLE IF NOT EXISTS class_sanctioning (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id       UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT class_sanctioning_uniq UNIQUE (class_id, association_id)
);

-- Converge a table `create_all` may have built without these.
ALTER TABLE class_sanctioning ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE class_sanctioning ALTER COLUMN created_at SET DEFAULT now();
UPDATE class_sanctioning SET created_at = now() WHERE created_at IS NULL;
ALTER TABLE class_sanctioning ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_class_sanctioning_class
    ON class_sanctioning (class_id);
CREATE INDEX IF NOT EXISTS idx_class_sanctioning_association
    ON class_sanctioning (association_id);

COMMENT ON TABLE class_sanctioning IS
    'Which classes each sanctioning club approves at this show. A row means the '
    'class carries that club''s per-class sanction fee (show_sanctioning.'
    'per_class_fee_cents); no row means the club does not sanction the class '
    'and nobody is charged for it. Set during class setup.';

-- Existing shows: every sanctioned class, for every club the show carries.
INSERT INTO class_sanctioning (class_id, association_id)
SELECT c.id, ss.association_id
FROM classes c
JOIN show_sanctioning ss ON ss.show_id = c.show_id
ON CONFLICT (class_id, association_id) DO NOTHING;

INSERT INTO _migrations (name) VALUES ('113_class_sanctioning.sql')
ON CONFLICT DO NOTHING;

COMMIT;
