-- Migration 038: link exhibitor documents to an association
--
--   Membership / amateur / youth cards are issued by a specific association
--   (AQHA, APHA, etc.). Without a tag we can't tell whether an exhibitor's
--   uploaded card covers their AQHA membership, their APHA membership, or
--   both. Adding a nullable show_type_id lets card-style documents be tagged
--   while leaving non-association docs (medical, ID, other) untouched.
--
--   ON DELETE SET NULL so removing a show type doesn't cascade-delete files.

ALTER TABLE exhibitor_documents
    ADD COLUMN show_type_id UUID NULL REFERENCES show_types(id) ON DELETE SET NULL;

CREATE INDEX idx_exhibitor_documents_show_type_id
    ON exhibitor_documents(show_type_id);

INSERT INTO _migrations (name) VALUES ('038_exhibitor_document_show_type');
