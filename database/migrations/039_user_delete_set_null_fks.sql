-- Migration 039: relax FK constraints that block user deletion
--
--   Two foreign keys to users(id) were created without an ON DELETE clause,
--   so they default to NO ACTION/RESTRICT. As a result, the admin "Delete
--   User" flow throws a 500 with a ForeignKeyViolationError whenever the
--   user is linked to an exhibitor row (always true for EXHIBITOR accounts)
--   or has ever been recorded as the editor of a placing in result_audit.
--
--   Switching both to ON DELETE SET NULL preserves the dependent rows —
--   the exhibitor profile (with its entries, horses, results) stays intact
--   but un-claimed; audit history is preserved with a null changed_by.
--   This matches the pattern already used for horses.owner_exhibitor_id,
--   horse_documents.uploaded_by_user_id, and exhibitor_documents.uploaded_by_user_id.

ALTER TABLE exhibitors
    DROP CONSTRAINT IF EXISTS exhibitors_user_id_fkey;
ALTER TABLE exhibitors
    ADD CONSTRAINT exhibitors_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE result_audit
    DROP CONSTRAINT IF EXISTS result_audit_changed_by_fkey;
ALTER TABLE result_audit
    ADD CONSTRAINT result_audit_changed_by_fkey
        FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL;

INSERT INTO _migrations (name) VALUES ('039_user_delete_set_null_fks');
