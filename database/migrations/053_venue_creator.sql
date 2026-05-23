-- Migration 053: Track venue creator so Show Managers can delete their own venues.
--
-- Show Managers may create venues for their shows. They can only delete venues they
-- created; admins can still delete any venue. Existing venues have NULL creator and
-- therefore cannot be deleted by managers.

ALTER TABLE venues
    ADD COLUMN created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_venues_created_by ON venues(created_by_user_id);

INSERT INTO _migrations (name) VALUES ('053_venue_creator.sql');
