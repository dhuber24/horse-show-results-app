-- Migration 100: trainers' cards are not desk paperwork after all.
--
-- Migration 098 added a `trainer_membership` verification kind on the reasoning
-- that a professional's card is what makes an amateur class an amateur class,
-- so the office would want to check it alongside the rider's. That is a real
-- rule, but it is not what a show secretary does at the counter: the trainer is
-- usually not standing there, has no entry and no back number, and their card
-- is the association's business rather than this show's. Asking the desk to
-- sign off on a document nobody has handed them produces a check that is
-- permanently unverified and quietly inflates every outstanding count.
--
-- Reversed rather than left in place. A kind nothing writes and a column
-- nothing populates is the `entries.back_number` trap — dead schema that reads
-- as live and eventually gets rendered. No rows were ever written to it.
--
-- `document_type` and the `horse_health_document` kind from 098 stay; those are
-- papers the exhibitor genuinely does hand across the counter.

BEGIN;

DELETE FROM show_verifications WHERE kind = 'trainer_membership';

DROP INDEX IF EXISTS uq_show_verifications_trainer_membership;

ALTER TABLE show_verifications DROP CONSTRAINT IF EXISTS ck_show_verifications_kind;
ALTER TABLE show_verifications ADD CONSTRAINT ck_show_verifications_kind
    CHECK (kind IN (
        'horse_age',
        'horse_registration',
        'exhibitor_membership',
        'horse_health_document'
    ));

-- Restated in full again: dropping trainer_id means every branch that named it
-- has to stop naming it, and a CHECK referencing a dropped column is an error.
ALTER TABLE show_verifications DROP CONSTRAINT IF EXISTS ck_show_verifications_subject;
ALTER TABLE show_verifications ADD CONSTRAINT ck_show_verifications_subject CHECK (
    (kind = 'horse_age'
        AND horse_id IS NOT NULL AND exhibitor_id IS NULL AND association_id IS NULL
        AND document_type IS NULL)
    OR (kind = 'horse_registration'
        AND horse_id IS NOT NULL AND exhibitor_id IS NULL AND association_id IS NOT NULL
        AND document_type IS NULL)
    OR (kind = 'exhibitor_membership'
        AND exhibitor_id IS NOT NULL AND horse_id IS NULL AND association_id IS NOT NULL
        AND document_type IS NULL)
    OR (kind = 'horse_health_document'
        AND horse_id IS NOT NULL AND exhibitor_id IS NULL AND association_id IS NULL
        AND document_type IN ('COGGINS', 'VACCINATION', 'HEALTH_CERTIFICATE'))
);

ALTER TABLE show_verifications DROP COLUMN IF EXISTS trainer_id;

COMMENT ON COLUMN show_verifications.kind IS
    'horse_age | horse_registration | exhibitor_membership | horse_health_document. Fixes which subject columns are populated.';

INSERT INTO _migrations (name) VALUES ('100_drop_trainer_membership_verification.sql')
ON CONFLICT DO NOTHING;

COMMIT;
