-- Trainer accounts: allow trainers to self-register and link their login to
-- the trainer registry row used by horse profiles.

ALTER TABLE users DROP CONSTRAINT IF EXISTS check_user_role;
ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_role;
ALTER TABLE users ADD CONSTRAINT ck_users_role
    CHECK (role IN ('ADMIN', 'SHOW_SECRETARY', 'SCOREKEEPER', 'EXHIBITOR', 'SHOW_MANAGER', 'TRAINER'));

ALTER TABLE trainers
    ADD COLUMN IF NOT EXISTS user_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_trainers_user_id'
    ) THEN
        ALTER TABLE trainers
            ADD CONSTRAINT fk_trainers_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trainers_user_id_unique
    ON trainers(user_id)
    WHERE user_id IS NOT NULL;

INSERT INTO _migrations (name) VALUES ('045_trainer_accounts.sql');
