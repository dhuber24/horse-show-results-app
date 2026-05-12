-- Add contact, emergency contact, and youth/guardian fields to exhibitors
ALTER TABLE exhibitors
    ADD COLUMN phone                   TEXT NULL,
    ADD COLUMN address                 TEXT NULL,
    ADD COLUMN city                    TEXT NULL,
    ADD COLUMN state                   TEXT NULL,
    ADD COLUMN zip                     TEXT NULL,
    ADD COLUMN emergency_contact_name  TEXT NULL,
    ADD COLUMN emergency_contact_phone TEXT NULL,
    ADD COLUMN parent_guardian_name    TEXT NULL,
    ADD COLUMN parent_guardian_phone   TEXT NULL;

INSERT INTO _migrations (name) VALUES ('041_exhibitor_contact_youth');
