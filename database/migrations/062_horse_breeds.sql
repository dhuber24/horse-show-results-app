-- Migration 062: Allow horses to be associated with multiple breeds.

BEGIN;

CREATE TABLE IF NOT EXISTS horse_breeds (
    horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
    breed_id UUID NOT NULL REFERENCES breeds(id) ON DELETE CASCADE,
    PRIMARY KEY (horse_id, breed_id)
);

INSERT INTO horse_breeds (horse_id, breed_id)
SELECT id, breed_id
FROM horses
WHERE breed_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_horse_breeds_breed_id ON horse_breeds(breed_id);

INSERT INTO _migrations (name) VALUES ('062_horse_breeds.sql') ON CONFLICT DO NOTHING;

COMMIT;
