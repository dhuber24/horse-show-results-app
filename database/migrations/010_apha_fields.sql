BEGIN;

ALTER TABLE shows
    ADD COLUMN IF NOT EXISTS apha_show_number TEXT;

ALTER TABLE horses
    ADD COLUMN IF NOT EXISTS is_solid_paint_bred BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE exhibitors
    ADD COLUMN IF NOT EXISTS apha_member_number    TEXT,
    ADD COLUMN IF NOT EXISTS apha_member_expiry    DATE,
    ADD COLUMN IF NOT EXISTS amateur_card_number   TEXT,
    ADD COLUMN IF NOT EXISTS amateur_card_expiry   DATE,
    ADD COLUMN IF NOT EXISTS amateur_novice_codes  TEXT,
    ADD COLUMN IF NOT EXISTS date_of_birth         DATE;

ALTER TABLE entries
    ADD COLUMN IF NOT EXISTS apha_division TEXT
        CHECK (apha_division IN (
            'OPEN','SOLID_PAINT_BRED','AMATEUR','NOVICE_AMATEUR','YOUTH','NOVICE_YOUTH'
        )),
    ADD COLUMN IF NOT EXISTS relationship_to_owner TEXT,
    ADD COLUMN IF NOT EXISTS is_disqualified       BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE classes
    ADD COLUMN IF NOT EXISTS apha_class_code TEXT;

INSERT INTO _migrations (name)
    VALUES ('010_apha_fields.sql') ON CONFLICT DO NOTHING;

COMMIT;
