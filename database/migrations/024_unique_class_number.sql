-- Migration 024: Enforce unique class numbers within a show
-- IMPORTANT: Will fail if any show has duplicate class_number values.
-- Resolve duplicates before applying.

BEGIN;

ALTER TABLE classes
  ADD CONSTRAINT uq_show_class_number UNIQUE (show_id, class_number);

INSERT INTO _migrations (name) VALUES ('024_unique_class_number');

COMMIT;
