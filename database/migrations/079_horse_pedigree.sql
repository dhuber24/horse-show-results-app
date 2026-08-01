-- Migration 079: horse pedigree (sire / dam).
--
-- Printed show programs and the in-app class schedule list each entry with
-- the horse's owner, sire, and dam. Owner was already covered by
-- horses.owner_name / horses.owner_exhibitor_id; pedigree had nowhere to live.
--
-- Free text, both nullable: sires and dams are frequently horses that are not
-- (and never will be) records in this app, and exhibitors routinely know the
-- registered name without any other detail. Same modelling choice already made
-- for horses.owner_name and horses.trainer_name.

BEGIN;

ALTER TABLE horses ADD COLUMN IF NOT EXISTS sire_name TEXT;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS dam_name TEXT;

INSERT INTO _migrations (name) VALUES ('079_horse_pedigree.sql')
ON CONFLICT DO NOTHING;

COMMIT;
