-- Migration 077: richer class gate progression.
--
-- classes.gate_status gains two states:
--   'ready'       — every exhibitor has checked in with the gate steward
--                   (set automatically by the check-in endpoint).
--   'in_progress' — the steward saw the first exhibitor enter the ring and
--                   started the class explicitly.
-- Full lifecycle: pending → ready → in_progress → done.

BEGIN;

ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_gate_status_check;
ALTER TABLE classes ADD CONSTRAINT classes_gate_status_check
    CHECK (gate_status IN ('pending', 'ready', 'in_progress', 'done'));

INSERT INTO _migrations (name) VALUES ('077_gate_ready_in_progress.sql')
ON CONFLICT DO NOTHING;

COMMIT;
