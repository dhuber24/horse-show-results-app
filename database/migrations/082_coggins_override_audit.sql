-- Migration 082: audit Coggins gate overrides.
--
-- A horse may only be entered with a Coggins carrying an unexpired expiration
-- date. Show staff can bypass that gate (`skip_coggins_check`) when they have
-- physically inspected the paper document — the escape hatch that keeps a thin
-- record from stranding an exhibitor whose paperwork is genuinely fine.
--
-- Until now the bypass left no trace. This records each one, so a show can
-- answer "who entered this horse without valid Coggins on file, and what was
-- wrong with it" after the fact.
--
-- Only *effective* overrides are recorded. Passing skip_coggins_check for a
-- horse that already holds a valid Coggins overrides nothing and writes no row,
-- so the table counts real bypasses rather than flag usage.
--
-- FK behaviour is deliberately mixed:
--   * show_id CASCADEs — the audit answers a question about a show, so if the
--     show is deleted the question goes with it and the table stays bounded.
--   * everything else SET NULLs, and horse_name / overridden_by_name are
--     denormalized alongside, so a row stays readable after a horse is deleted
--     or a staff account is removed. An audit that becomes anonymous when a
--     user is deleted is not much of an audit.

BEGIN;

CREATE TABLE IF NOT EXISTS coggins_override_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    entry_id UUID REFERENCES entries(id) ON DELETE SET NULL,
    class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
    horse_id UUID REFERENCES horses(id) ON DELETE SET NULL,
    -- Snapshot of the horse's registered name at override time.
    horse_name TEXT NOT NULL,
    -- Which failure was bypassed: 'missing', 'undated', or 'expired'.
    coggins_status TEXT NOT NULL,
    overridden_by UUID REFERENCES users(id) ON DELETE SET NULL,
    overridden_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coggins_override_audit_show
    ON coggins_override_audit(show_id, created_at DESC);

COMMENT ON TABLE coggins_override_audit IS
    'One row per effective show-staff bypass of the Coggins entry gate.';
COMMENT ON COLUMN coggins_override_audit.coggins_status IS
    'The status that was bypassed: missing, undated, or expired.';
COMMENT ON COLUMN coggins_override_audit.horse_name IS
    'Registered name snapshot, so the row survives deletion of the horse.';

INSERT INTO _migrations (name) VALUES ('082_coggins_override_audit.sql')
ON CONFLICT DO NOTHING;

COMMIT;
