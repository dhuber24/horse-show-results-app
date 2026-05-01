-- Add indexes on foreign key columns for query performance
-- This prevents sequential scans on large tables during joins and cascading deletes

-- Shows table
CREATE INDEX IF NOT EXISTS idx_shows_show_type_id ON shows(show_type_id);

-- Rings table
CREATE INDEX IF NOT EXISTS idx_rings_show_id ON rings(show_id);

-- Divisions table
CREATE INDEX IF NOT EXISTS idx_divisions_show_id ON divisions(show_id);

-- Classes table
CREATE INDEX IF NOT EXISTS idx_classes_show_id ON classes(show_id);
CREATE INDEX IF NOT EXISTS idx_classes_ring_id ON classes(ring_id);
CREATE INDEX IF NOT EXISTS idx_classes_division_id ON classes(division_id);

-- Entries table
CREATE INDEX IF NOT EXISTS idx_entries_class_id ON entries(class_id);
CREATE INDEX IF NOT EXISTS idx_entries_exhibitor_id ON entries(exhibitor_id);
CREATE INDEX IF NOT EXISTS idx_entries_horse_id ON entries(horse_id);

-- Results table
CREATE INDEX IF NOT EXISTS idx_results_class_id ON results(class_id);
CREATE INDEX IF NOT EXISTS idx_results_entry_id ON results(entry_id);

-- Result audit table
CREATE INDEX IF NOT EXISTS idx_result_audit_result_id ON result_audit(result_id);
CREATE INDEX IF NOT EXISTS idx_result_audit_changed_by ON result_audit(changed_by);

-- ExhibitorHorse join table
CREATE INDEX IF NOT EXISTS idx_exhibitor_horses_exhibitor_id ON exhibitor_horses(exhibitor_id);
CREATE INDEX IF NOT EXISTS idx_exhibitor_horses_horse_id ON exhibitor_horses(horse_id);

-- ShowEntry table
CREATE INDEX IF NOT EXISTS idx_show_entries_show_id ON show_entries(show_id);
CREATE INDEX IF NOT EXISTS idx_show_entries_exhibitor_id ON show_entries(exhibitor_id);

-- Exhibitors table
CREATE INDEX IF NOT EXISTS idx_exhibitors_user_id ON exhibitors(user_id);

-- Horse attributes
CREATE INDEX IF NOT EXISTS idx_horses_breed_id ON horses(breed_id);
CREATE INDEX IF NOT EXISTS idx_horses_color_id ON horses(color_id);
CREATE INDEX IF NOT EXISTS idx_horses_owner_exhibitor_id ON horses(owner_exhibitor_id);

-- HorseRegistrations table
CREATE INDEX IF NOT EXISTS idx_horse_registrations_horse_id ON horse_registrations(horse_id);
CREATE INDEX IF NOT EXISTS idx_horse_registrations_show_type_id ON horse_registrations(show_type_id);

-- HorseDocuments table
CREATE INDEX IF NOT EXISTS idx_horse_documents_horse_id ON horse_documents(horse_id);
CREATE INDEX IF NOT EXISTS idx_horse_documents_uploaded_by_user_id ON horse_documents(uploaded_by_user_id);

-- Join tables
CREATE INDEX IF NOT EXISTS idx_show_secretaries_show_id ON show_secretaries(show_id);
CREATE INDEX IF NOT EXISTS idx_show_secretaries_user_id ON show_secretaries(user_id);

CREATE INDEX IF NOT EXISTS idx_show_scorekeepers_show_id ON show_scorekeepers(show_id);
CREATE INDEX IF NOT EXISTS idx_show_scorekeepers_user_id ON show_scorekeepers(user_id);

CREATE INDEX IF NOT EXISTS idx_venue_admins_venue_id ON venue_admins(venue_id);
CREATE INDEX IF NOT EXISTS idx_venue_admins_user_id ON venue_admins(user_id);

CREATE INDEX IF NOT EXISTS idx_show_secretary_certifications_user_id ON show_secretary_certifications(user_id);
CREATE INDEX IF NOT EXISTS idx_show_secretary_certifications_show_type_id ON show_secretary_certifications(show_type_id);
