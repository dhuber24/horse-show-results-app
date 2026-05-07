-- A given association registration number can only belong to ONE horse.
-- Prevents two horse profiles claiming the same APHA #1234567.
ALTER TABLE horse_registrations
    ADD CONSTRAINT uq_horse_registrations_show_type_number
    UNIQUE (show_type_id, registration_number);
