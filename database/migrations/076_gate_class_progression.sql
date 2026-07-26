-- Migration 076: Gate progression moves to the class level.
--
-- Feedback on the first gate-steward pass: waiting / on-deck are properties
-- of the CLASS (which class is up next at the gate), not of individual
-- exhibitors. The per-exhibitor action is a simple check-in with the gate
-- steward. So:
--
--   classes.gate_status      — 'pending' | 'done'. The current (in progress)
--                              class is derived: first non-done class in
--                              show order; the one after it is on deck.
--   entries.gate_checked_in  — exhibitor has checked in with the steward.
--
-- Replaces entries.gate_status from migration 075, which was applied but
-- never used in production.

BEGIN;

ALTER TABLE classes ADD COLUMN IF NOT EXISTS gate_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (gate_status IN ('pending', 'done'));

ALTER TABLE entries ADD COLUMN IF NOT EXISTS gate_checked_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE entries DROP COLUMN IF EXISTS gate_status;

INSERT INTO _migrations (name) VALUES ('076_gate_class_progression.sql')
ON CONFLICT DO NOTHING;

COMMIT;
