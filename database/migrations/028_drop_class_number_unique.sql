-- Migration 028: drop uq_show_class_number unique constraint
-- class_number is now auto-assigned from sort position and cannot be manually set,
-- so the constraint provides no value and blocks reorder operations.

ALTER TABLE classes DROP CONSTRAINT IF EXISTS uq_show_class_number;

INSERT INTO _migrations (name) VALUES ('028_drop_class_number_unique')
  ON CONFLICT DO NOTHING;
