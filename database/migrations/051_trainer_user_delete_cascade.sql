-- Keep trainer account rows tied to their user accounts.
--
-- Deleting a linked TRAINER user should remove the trainer registry row rather
-- than leaving an unclaimed profile behind. Unclaimed trainer rows with NULL
-- user_id are unaffected.

ALTER TABLE trainers
    DROP CONSTRAINT IF EXISTS fk_trainers_user_id;

ALTER TABLE trainers
    ADD CONSTRAINT fk_trainers_user_id
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

INSERT INTO _migrations (name) VALUES ('051_trainer_user_delete_cascade.sql') ON CONFLICT DO NOTHING;
