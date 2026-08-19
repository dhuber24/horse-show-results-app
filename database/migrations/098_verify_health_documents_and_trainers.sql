-- Migration 098: the office can sign off on health papers and trainer cards.
--
-- Migration 090 modelled three sign-offs — horse age, horse registration number,
-- exhibitor membership number — on the theory that health paperwork needed none.
-- The reasoning was that a Coggins is either current, in which case the file
-- says so, or lapsed, in which case no amount of signing off makes it current.
--
-- That collapses two different questions. The file answers "is the date still
-- good". Only a person at the counter answers "does this paper describe *this*
-- horse" — the markings and description matching the animal in the trailer, on
-- a document that is genuine and physically present. That second question is
-- the one a horse show secretary is actually doing when they check a Coggins,
-- and the app had no way to record that anyone had done it.
--
-- Two new kinds:
--
--   * horse_health_document — the office inspected this horse's Coggins, CVI,
--     or vaccination record. Subject is (horse, document_type), not a
--     horse_documents row, because the paperwork is frequently NOT in the app:
--     an exhibitor hands over a paper Coggins at the desk and there is no
--     upload to point at. A sign-off must be possible with nothing on file, or
--     it fails in the exact case it exists for.
--
--   * trainer_membership — a trainer's card for one association. Trainers are
--     credentialed separately from riders (a professional's card is what makes
--     an amateur class an amateur class) and trainer_registrations has held the
--     numbers since the trainer registry landed, with nothing checking them.
--
-- verified_value keeps doing the work it does for the other kinds. For a health
-- document it snapshots the *derived standing* at sign-off — "valid:2027-05-03",
-- or "missing:none" when the office signed off on paper the app has never seen.
-- Either way, the exhibitor later uploading or replacing a document moves the
-- snapshot and the check reads back as stale, which is the correct outcome: the
-- situation the office attested to is no longer the situation on file.

BEGIN;

ALTER TABLE show_verifications
    ADD COLUMN IF NOT EXISTS trainer_id UUID REFERENCES trainers(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS document_type TEXT;

ALTER TABLE show_verifications DROP CONSTRAINT IF EXISTS ck_show_verifications_kind;
ALTER TABLE show_verifications ADD CONSTRAINT ck_show_verifications_kind
    CHECK (kind IN (
        'horse_age',
        'horse_registration',
        'exhibitor_membership',
        'horse_health_document',
        'trainer_membership'
    ));

-- Restated in full rather than extended: the old CHECK asserted the unused
-- subject columns were NULL, and two new columns have to appear in every branch
-- or a horse_age row could quietly carry a trainer_id.
ALTER TABLE show_verifications DROP CONSTRAINT IF EXISTS ck_show_verifications_subject;
ALTER TABLE show_verifications ADD CONSTRAINT ck_show_verifications_subject CHECK (
    (kind = 'horse_age'
        AND horse_id IS NOT NULL AND exhibitor_id IS NULL AND association_id IS NULL
        AND trainer_id IS NULL AND document_type IS NULL)
    OR (kind = 'horse_registration'
        AND horse_id IS NOT NULL AND exhibitor_id IS NULL AND association_id IS NOT NULL
        AND trainer_id IS NULL AND document_type IS NULL)
    OR (kind = 'exhibitor_membership'
        AND exhibitor_id IS NOT NULL AND horse_id IS NULL AND association_id IS NOT NULL
        AND trainer_id IS NULL AND document_type IS NULL)
    OR (kind = 'horse_health_document'
        AND horse_id IS NOT NULL AND exhibitor_id IS NULL AND association_id IS NULL
        AND trainer_id IS NULL
        AND document_type IN ('COGGINS', 'VACCINATION', 'HEALTH_CERTIFICATE'))
    OR (kind = 'trainer_membership'
        AND trainer_id IS NOT NULL AND horse_id IS NULL AND exhibitor_id IS NULL
        AND association_id IS NOT NULL AND document_type IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_show_verifications_horse_health_document
    ON show_verifications (show_id, horse_id, document_type)
    WHERE kind = 'horse_health_document';
CREATE UNIQUE INDEX IF NOT EXISTS uq_show_verifications_trainer_membership
    ON show_verifications (show_id, trainer_id, association_id)
    WHERE kind = 'trainer_membership';

COMMENT ON COLUMN show_verifications.document_type IS
    'For horse_health_document: which paper was inspected (COGGINS | VACCINATION | HEALTH_CERTIFICATE).';
COMMENT ON COLUMN show_verifications.trainer_id IS
    'For trainer_membership: whose card was inspected.';
COMMENT ON COLUMN show_verifications.kind IS
    'horse_age | horse_registration | exhibitor_membership | horse_health_document | trainer_membership. Fixes which subject columns are populated.';

INSERT INTO _migrations (name) VALUES ('098_verify_health_documents_and_trainers.sql')
ON CONFLICT DO NOTHING;

COMMIT;
