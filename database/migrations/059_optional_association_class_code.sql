-- Migration 059: allow class_associations.association_class_code to be NULL.
--
-- AQHA-style associations issue a fixed central code for every approved class,
-- so the app validates entries against aqha_standard_classes. WSCA and NSBA
-- don't work that way — secretaries just sanction the class without a code.
-- Forcing a code value made WSCA/NSBA setup awkward; making it nullable lets
-- the UI flag the class as sanctioned by the association without a code.
--
-- Uniqueness is (class_id, show_type_id) — the code itself was never part of
-- the unique constraint, so allowing NULL doesn't change duplicate semantics.

ALTER TABLE class_associations
    ALTER COLUMN association_class_code DROP NOT NULL;

INSERT INTO _migrations (name) VALUES ('059_optional_association_class_code.sql');
