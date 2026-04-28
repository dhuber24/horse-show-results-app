-- Allow result_audit to record cleared placings (result deleted, no new result_id)
-- and add entry_id so we know which entry was affected even after result deletion.

ALTER TABLE result_audit
    ALTER COLUMN result_id DROP NOT NULL;

ALTER TABLE result_audit
    ADD COLUMN IF NOT EXISTS entry_id UUID REFERENCES entries(id) ON DELETE SET NULL;
