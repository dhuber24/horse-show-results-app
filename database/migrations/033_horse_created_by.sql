ALTER TABLE horses
    ADD COLUMN IF NOT EXISTS created_by_exhibitor_id UUID REFERENCES exhibitors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_horses_created_by_exhibitor_id ON horses(created_by_exhibitor_id);
