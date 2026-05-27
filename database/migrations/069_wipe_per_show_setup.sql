-- Migration 069: Wipe per-show setup data (dev-only reset)
--
-- Phase 1 of the Setup redesign. The Standard Library matrix picker requires
-- a clean per-show slate to make the "Apply picks → create divisions/sections/
-- classes" flow idempotent. This migration drops every per-show ring,
-- division, section, and class (cascading into entries, results, side pots,
-- and class associations).
--
-- This is destructive and assumes no production data exists yet — the
-- decision was explicit at design time. If real shows have been created,
-- they will need to be rebuilt through the new setup UI after this runs.

BEGIN;

-- classes cascade-deletes its dependents (entries, results, side_pot_classes,
-- class_associations). Side pots themselves are show-scoped — wipe them too
-- so no orphan side pot survives without classes.
DELETE FROM side_pot_entries;
DELETE FROM side_pot_payouts;
DELETE FROM side_pot_classes;
DELETE FROM side_pots;

DELETE FROM classes;
DELETE FROM division_sections;
DELETE FROM divisions;
DELETE FROM sections;
DELETE FROM rings;

INSERT INTO _migrations (name) VALUES ('069_wipe_per_show_setup.sql') ON CONFLICT DO NOTHING;

COMMIT;
