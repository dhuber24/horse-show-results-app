-- Add CHECK constraints to enum-like columns to enforce data integrity at the DB level

-- Shows status
ALTER TABLE shows ADD CONSTRAINT check_shows_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'ACTIVE', 'COMPLETED'));

-- Classes status
ALTER TABLE classes ADD CONSTRAINT check_classes_status CHECK (status IN ('OPEN', 'CLOSED'));

-- Entries status
ALTER TABLE entries ADD CONSTRAINT check_entries_status CHECK (status IN ('ENTERED', 'WITHDRAWN'));

-- Entries APHA division (only for APHA shows, but check is always safe)
ALTER TABLE entries ADD CONSTRAINT check_entries_apha_division CHECK (apha_division IS NULL OR apha_division IN ('OPEN', 'SOLID_PAINT_BRED', 'AMATEUR', 'NOVICE_AMATEUR', 'YOUTH', 'NOVICE_YOUTH'));

-- Horse sex
ALTER TABLE horses ADD CONSTRAINT check_horses_sex CHECK (sex IS NULL OR sex IN ('Mare', 'Gelding', 'Stallion'));

-- Result audit: at least one of result_id or entry_id must be non-null
ALTER TABLE result_audit ADD CONSTRAINT check_result_audit_not_null CHECK (result_id IS NOT NULL OR entry_id IS NOT NULL);

-- Shows: make created_at NOT NULL (was missing NOT NULL)
ALTER TABLE shows ALTER COLUMN created_at SET NOT NULL;
