-- Migration 029: Remove ARHA, NRHA, NCHA, NRCHA show types
-- These associations are not supported by this application.
-- Cascades to show_affiliations, class_associations, show_secretary_certifications,
-- horse_registrations, and show_requests rows referencing these types.
-- Shows with these as their primary show_type_id are blocked by FK (shows.show_type_id
-- has no ON DELETE CASCADE), so this will fail if any such show exists.

DELETE FROM show_types
WHERE code IN ('ARHA', 'NRHA', 'NCHA', 'NRCHA');

INSERT INTO _migrations (name) VALUES ('029_remove_show_types');
