-- Allow horses to be deleted even when they have class entries.
-- The entry record is preserved for historical show data; horse_id becomes NULL.
ALTER TABLE entries ALTER COLUMN horse_id DROP NOT NULL;
ALTER TABLE entries DROP CONSTRAINT IF EXISTS entries_horse_id_fkey;
ALTER TABLE entries ADD CONSTRAINT entries_horse_id_fkey
    FOREIGN KEY (horse_id) REFERENCES horses(id) ON DELETE SET NULL;
