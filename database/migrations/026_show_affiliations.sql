-- Migration 026: show_affiliations join table
-- Tracks secondary affiliations offered in some classes of a show
-- (e.g., an AQHA show that also offers NSBA and WSCA points in select classes).

BEGIN;

CREATE TABLE show_affiliations (
  show_id      UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  show_type_id UUID NOT NULL REFERENCES show_types(id) ON DELETE CASCADE,
  PRIMARY KEY (show_id, show_type_id)
);

CREATE INDEX idx_show_affiliations_show_id ON show_affiliations (show_id);

INSERT INTO _migrations (name) VALUES ('026_show_affiliations');

COMMIT;
