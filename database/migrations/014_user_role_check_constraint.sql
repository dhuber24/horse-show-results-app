-- Add CHECK constraint to users.role to restrict to valid role values
ALTER TABLE users ADD CONSTRAINT check_user_role CHECK (role IN ('ADMIN', 'SHOW_SECRETARY', 'SCOREKEEPER', 'EXHIBITOR'));
