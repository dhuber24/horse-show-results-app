-- Add is_approved column to users table for show secretary approval workflow
ALTER TABLE users ADD COLUMN is_approved BOOLEAN NOT NULL DEFAULT TRUE;
