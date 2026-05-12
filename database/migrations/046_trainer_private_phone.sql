-- Trainer private contact details. Public trainer phone/email remain on
-- trainers.phone and trainers.email; the login email remains users.email.

ALTER TABLE trainers
    ADD COLUMN IF NOT EXISTS private_phone TEXT;

INSERT INTO _migrations (name) VALUES ('046_trainer_private_phone.sql');
