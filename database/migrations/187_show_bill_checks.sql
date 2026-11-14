-- 187: what a show set up from its show bill still has to have checked.
--
-- A show read off its printed bill used to be reviewed on one long screen
-- before anything was created, and the reader's doubts were a list of
-- sentences at the top of it, tied to nothing. Now the show is created as a
-- DRAFT straight from the read and the office walks the ordinary setup steps;
-- each doubt -- the reader's own, or one of the app's (a judge matched on the
-- name alone, a club the registry does not hold, a fee that bills everybody) --
-- is a row here, shown on the step and against the field it is about.
--
-- **A show cannot leave DRAFT while one is open** (`routers/shows.py`). A
-- check is closed by somebody accepting it, or -- decided on read, never
-- stored -- by its field being changed since the read, or its row being
-- deleted: somebody who edited the value has looked at it.
--
-- `target_type` / `target_id` / `field` name the record and column a check is
-- about (`show`, `class`, `fee`, `judge`, `sanctioning`); all three are NULL for
-- one about the step as a whole. `value` is that column as the read created it,
-- for the changed-since test. `action` carries what a one-press fix needs (the
-- judge or venue the bill named), never anything applied without a press.
--
-- A new table: backward-compatible, so it goes to production before the code.

BEGIN;

CREATE TABLE IF NOT EXISTS show_bill_checks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id             UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    import_id           UUID REFERENCES show_bill_imports(id) ON DELETE SET NULL,
    step                TEXT NOT NULL,
    target_type         TEXT,
    target_id           UUID,
    field               TEXT,
    value               JSONB,
    message             TEXT NOT NULL,
    source              TEXT NOT NULL,
    action              JSONB,
    sort_order          INTEGER NOT NULL,
    accepted_at         TIMESTAMPTZ,
    accepted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ
);

-- Stated separately: backend startup may have built the table from the model
-- before this ran, and then CREATE TABLE IF NOT EXISTS skips (migration 114).
ALTER TABLE show_bill_checks ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE show_bill_checks ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE show_bill_checks DROP CONSTRAINT IF EXISTS show_bill_checks_source_check;
ALTER TABLE show_bill_checks ADD CONSTRAINT show_bill_checks_source_check
    CHECK (source IN ('bill', 'app'));

ALTER TABLE show_bill_checks DROP CONSTRAINT IF EXISTS show_bill_checks_target_check;
ALTER TABLE show_bill_checks ADD CONSTRAINT show_bill_checks_target_check
    CHECK (target_type IS NULL OR target_type IN ('show', 'class', 'fee', 'judge', 'sanctioning'));

CREATE INDEX IF NOT EXISTS ix_show_bill_checks_show ON show_bill_checks (show_id, sort_order);

COMMENT ON TABLE show_bill_checks IS
    'What a show created from its show bill still has to have checked, one row '
    'per doubt, shown on its setup step and field. Open until accepted, or until '
    'its field changes or its row is deleted (decided on read). A show cannot '
    'leave DRAFT while one is open.';

INSERT INTO _migrations (name) VALUES ('187_show_bill_checks.sql')
ON CONFLICT DO NOTHING;

COMMIT;
