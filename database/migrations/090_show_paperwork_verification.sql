-- Migration 090: the show office signs off on paperwork it has physically seen.
--
-- Registration papers and membership cards are checked at the desk, on paper,
-- against the numbers the exhibitor typed into their profile. Until now the app
-- stored the numbers but kept no record that anyone had ever looked at the
-- document behind them, so "did we verify this horse's age?" was answerable only
-- by asking whoever was working the desk.
--
-- Three things get verified, and they are one table rather than three because
-- the question, the actor, and the staleness rule are identical for all of them:
--
--   * horse_age           — the foaling date on the registration papers.
--   * horse_registration  — one association's registration number on the papers.
--   * exhibitor_membership— one association's membership number on the card.
--
-- Scope is per show. A verification is a *show's* attestation that its office
-- saw the document, not a permanent property of the horse or the person: the
-- next show is responsible for its own gate, and a single bad sign-off must not
-- propagate to every future show. This mirrors coggins_override_audit, which is
-- also per show for the same reason.
--
-- verified_value is the snapshot of what was on file at sign-off, and it is what
-- makes the record honest. Staff verify a *value*, not a row — so when an
-- exhibitor later edits the number, the stored value no longer matches what is
-- on file and the check reads back as stale rather than silently staying green.
-- The backend derives this column itself and never accepts it from the client;
-- a caller that could name the value it "verified" could sign off on anything.
--
-- Uniqueness is three partial indexes rather than one composite UNIQUE: the
-- subject columns are deliberately nullable per kind, and in Postgres NULLs are
-- distinct, so a plain UNIQUE would not stop a horse's age being signed off
-- twice. Each index states the real shape of its kind.
--
-- horses.created_by_user_id is added alongside because migration 090 also opens
-- horse creation to show staff acting for an exhibitor at the desk (see
-- routers/show_office.py). created_by_exhibitor_id cannot carry that — staff
-- have no exhibitor record — and a horse appearing on someone's profile with no
-- trace of who put it there is exactly the surprise this column prevents.

BEGIN;

ALTER TABLE horses
    ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS show_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    -- Exactly which subject columns are populated is fixed by kind; see the
    -- CHECK below. All three CASCADE: a check about a deleted horse, person, or
    -- association is not a question anyone can still answer.
    horse_id UUID REFERENCES horses(id) ON DELETE CASCADE,
    exhibitor_id UUID REFERENCES exhibitors(id) ON DELETE CASCADE,
    association_id UUID REFERENCES associations(id) ON DELETE CASCADE,
    -- What was on file at sign-off. Derived server-side, never client-supplied.
    verified_value TEXT NOT NULL,
    note TEXT,
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Denormalized so the row stays readable after the staff account is removed,
    -- the same reason coggins_override_audit keeps overridden_by_name.
    verified_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_show_verifications_kind
        CHECK (kind IN ('horse_age', 'horse_registration', 'exhibitor_membership')),
    CONSTRAINT ck_show_verifications_subject CHECK (
        (kind = 'horse_age'
            AND horse_id IS NOT NULL AND exhibitor_id IS NULL AND association_id IS NULL)
        OR (kind = 'horse_registration'
            AND horse_id IS NOT NULL AND exhibitor_id IS NULL AND association_id IS NOT NULL)
        OR (kind = 'exhibitor_membership'
            AND exhibitor_id IS NOT NULL AND horse_id IS NULL AND association_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_show_verifications_horse_age
    ON show_verifications (show_id, horse_id) WHERE kind = 'horse_age';
CREATE UNIQUE INDEX IF NOT EXISTS uq_show_verifications_horse_registration
    ON show_verifications (show_id, horse_id, association_id) WHERE kind = 'horse_registration';
CREATE UNIQUE INDEX IF NOT EXISTS uq_show_verifications_exhibitor_membership
    ON show_verifications (show_id, exhibitor_id, association_id) WHERE kind = 'exhibitor_membership';

CREATE INDEX IF NOT EXISTS idx_show_verifications_show
    ON show_verifications (show_id);

COMMENT ON TABLE show_verifications IS
    'One row per document a show''s office physically inspected: horse age, horse registration, or exhibitor membership.';
COMMENT ON COLUMN show_verifications.verified_value IS
    'Snapshot of the on-file value at sign-off. A later edit makes the check read back as stale.';
COMMENT ON COLUMN show_verifications.kind IS
    'horse_age | horse_registration | exhibitor_membership. Fixes which subject columns are populated.';
COMMENT ON COLUMN horses.created_by_user_id IS
    'The account that created this horse. Set when show staff create a horse for an exhibitor at the desk.';

INSERT INTO _migrations (name) VALUES ('090_show_paperwork_verification.sql')
ON CONFLICT DO NOTHING;

COMMIT;
