-- Migration: rename show_admins table to show_secretaries

BEGIN;

ALTER TABLE show_admins RENAME TO show_secretaries;

COMMIT;
