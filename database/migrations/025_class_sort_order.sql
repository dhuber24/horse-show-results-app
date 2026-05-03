-- Migration 025: Add sort_order to classes for manual schedule/show-bill ordering
-- Existing classes get an initial sort_order derived from class_number order within each show.

BEGIN;

ALTER TABLE classes ADD COLUMN sort_order INTEGER;

UPDATE classes
SET sort_order = sub.rn
FROM (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY show_id ORDER BY class_number) AS rn
  FROM classes
) sub
WHERE classes.id = sub.id;

CREATE INDEX idx_classes_sort_order ON classes (show_id, sort_order);

INSERT INTO _migrations (name) VALUES ('025_class_sort_order');

COMMIT;
