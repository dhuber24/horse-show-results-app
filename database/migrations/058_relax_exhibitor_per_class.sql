-- Migration 058: relax exhibitor-per-class uniqueness.
--
-- Some shows let the same exhibitor show multiple horses in pattern classes
-- (showmanship, horsemanship, trail), where each horse runs separately.
-- Rail classes (e.g. western pleasure) still physically can't accommodate
-- the same rider twice. The horse-per-class uniqueness from migration 057
-- still applies because entry numbers are assigned to horses (APHA SC-160.D).
--
-- A Postgres partial index can only reference columns of its own table,
-- so we can't gate the constraint on classes.score_type. Application code
-- (entries router + show registration router) now enforces the rule for
-- non-pattern classes and the entries list UI flags any exhibitor with
-- multiple entries in the same class so the secretary can spot mistakes.

DROP INDEX IF EXISTS entries_class_exhibitor_uniq;

INSERT INTO _migrations (name) VALUES ('058_relax_exhibitor_per_class.sql');
