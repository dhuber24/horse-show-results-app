-- Migration 099: signed entry blanks, liability releases, and who signed them.
--
-- The paperwork the desk checks was two thirds modelled. Registration papers,
-- membership cards and health documents all point at something the app stores.
-- The signed entry blank pointed at nothing at all: there was no table, no
-- column, and no way for a show to state that it wanted one, let alone record
-- that it had it.
--
-- Two tables, because a waiver is written once by the show and signed many
-- times by exhibitors:
--
--   * show_waivers — what this show asks people to agree to. Free text, because
--     a liability release is written by the venue's insurer or the state fair
--     board and this app has no business supplying the words. is_required
--     separates "you cannot compete without this" from a rule the show wants
--     read but does not gate on.
--
--   * show_waiver_signatures — one row per exhibitor per waiver.
--
-- Signatures arrive by two routes and this is one table rather than two because
-- the fact recorded is identical. An exhibitor types their name during show
-- sign-up, or they sign a paper blank at the counter and staff record it with
-- on_paper = true. A show that runs entirely on paper is a show where every row
-- here has on_paper set, and the desk's outstanding count still works.
--
-- Minors sign through a parent or guardian, which is not a footnote at a horse
-- show: youth classes are a third of a typical schedule and a release signed by
-- a 12-year-old is not a release. signed_by_guardian records that the name on
-- the line is not the competitor's, and guardian_relationship says who they are.
--
-- Emergency contacts deliberately get no table. exhibitors already carries
-- emergency_contact_name and emergency_contact_phone (migration 041); the desk
-- reads those columns directly and reports them missing. Copying them per show
-- would create a second, staler answer to "who do we call".

BEGIN;

CREATE TABLE IF NOT EXISTS show_waivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_show_waivers_show
    ON show_waivers (show_id, sort_order);

CREATE TABLE IF NOT EXISTS show_waiver_signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    waiver_id UUID NOT NULL REFERENCES show_waivers(id) ON DELETE CASCADE,
    exhibitor_id UUID NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
    -- Typed by the signer, or read off the paper blank by staff. This is the
    -- one value on the row that is not derived, because a signature is a claim
    -- someone makes rather than a fact the app holds.
    signed_name TEXT NOT NULL,
    signed_by_guardian BOOLEAN NOT NULL DEFAULT false,
    guardian_relationship TEXT,
    signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The paper route. NULL recorder means it came in through sign-up.
    on_paper BOOLEAN NOT NULL DEFAULT false,
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Denormalized so the row stays readable after the staff account is gone,
    -- the same reason show_verifications keeps verified_by_name.
    recorded_by_name TEXT,
    CONSTRAINT uq_show_waiver_signatures UNIQUE (waiver_id, exhibitor_id)
);

CREATE INDEX IF NOT EXISTS idx_show_waiver_signatures_exhibitor
    ON show_waiver_signatures (exhibitor_id);

COMMENT ON TABLE show_waivers IS
    'What a show asks exhibitors to sign: entry blank terms, liability release, venue rules.';
COMMENT ON COLUMN show_waivers.is_required IS
    'Required waivers count toward the desk''s outstanding paperwork; optional ones are shown but not chased.';
COMMENT ON TABLE show_waiver_signatures IS
    'One exhibitor''s signature on one waiver, typed at sign-up or recorded from a paper blank at the desk.';
COMMENT ON COLUMN show_waiver_signatures.on_paper IS
    'True when staff recorded a physical signature rather than the exhibitor typing one.';
COMMENT ON COLUMN show_waiver_signatures.signed_by_guardian IS
    'True when a parent or guardian signed for a minor. The name on signed_name is theirs, not the competitor''s.';

INSERT INTO _migrations (name) VALUES ('099_show_waivers.sql')
ON CONFLICT DO NOTHING;

COMMIT;
