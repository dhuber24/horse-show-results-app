-- Trainer registry: a curated list of trainers that exhibitors and admins can
-- select when registering horses. trainer_name on horses remains as a free-text
-- fallback for trainers not yet in the registry.

CREATE TABLE trainers (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name    TEXT NOT NULL,
    phone   TEXT,
    email   TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE horses
    ADD COLUMN trainer_id UUID REFERENCES trainers(id) ON DELETE SET NULL;

INSERT INTO _migrations (name) VALUES ('042_trainer_registry');
