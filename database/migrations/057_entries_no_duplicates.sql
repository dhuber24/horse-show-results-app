-- Migration 057: prevent duplicate entries in the same class.
--
-- The old (class_id, exhibitor_id, horse_id) unique constraint only blocked
-- the exact same triple, so the same horse could be entered twice in a class
-- under different exhibitors, and the same exhibitor could enter twice on
-- different horses. The intent is one entry per horse per class and one
-- entry per exhibitor per class.
--
-- horse_id is nullable (set NULL when a horse is deleted to preserve entry
-- history), so the horse-uniqueness is a partial index that ignores NULLs.

CREATE UNIQUE INDEX entries_class_horse_uniq
    ON entries (class_id, horse_id)
    WHERE horse_id IS NOT NULL;

CREATE UNIQUE INDEX entries_class_exhibitor_uniq
    ON entries (class_id, exhibitor_id);

ALTER TABLE entries
    DROP CONSTRAINT IF EXISTS entries_class_id_exhibitor_id_horse_id_key;

INSERT INTO _migrations (name) VALUES ('057_entries_no_duplicates.sql');
