-- Migration 087: an owner's consent before a horse changes hands.
--
-- Two things could previously happen to a horse without the person responsible
-- for it ever hearing about it:
--
--   * anyone could link someone else's horse to their own profile with one
--     click (`POST /exhibitors/{id}/linked-horses`), which puts that horse in
--     their show-registration picker;
--   * nothing existed for handing a horse to its new owner at all, so a sale
--     meant the seller kept the record and the buyer built a duplicate.
--
-- Both are the same shape: a request that only takes effect when a specific
-- person says yes. One table serves both, distinguished by `kind`:
--
--   kind='link'      requester wants the horse on their profile;
--                    approver is the current owner.
--   kind='transfer'  requester (the current owner) is handing ownership over;
--                    approver is the person receiving it.
--
-- In both directions `approver_exhibitor_id` is "whoever must press the button",
-- so the accept/decline path is one code path rather than two.
--
-- The token IS the authorization, matching `user_invites`: it is mailed to the
-- approver and also shown to the requester for copy/paste, because SMTP is
-- optional in this deployment and an undelivered email must not be the reason
-- a sale can't be recorded. That is why the TTL is short and the token is
-- single-use — status leaves 'pending' the moment it is answered.
--
-- Horses CASCADE (a request about a deleted horse is meaningless) but the
-- exhibitors SET NULL: a horse's history should not disappear because someone
-- closed their account, and `requested_by_name` keeps the row readable.

BEGIN;

CREATE TABLE IF NOT EXISTS horse_access_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('link', 'transfer')),
    horse_id UUID NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
    -- Snapshot, so a decided request still reads correctly after a rename.
    horse_name TEXT NOT NULL,
    requester_exhibitor_id UUID REFERENCES exhibitors(id) ON DELETE SET NULL,
    requested_by_name TEXT NOT NULL,
    approver_exhibitor_id UUID REFERENCES exhibitors(id) ON DELETE SET NULL,
    approver_name TEXT NOT NULL,
    approver_email TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'declined', 'cancelled', 'expired')),
    message TEXT,
    -- Whether the notification email actually went out. NULL = never attempted
    -- (no SMTP configured); FALSE = attempted and failed. Either way the
    -- requester still has the copy/paste link.
    email_sent BOOLEAN,
    expires_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One outstanding ask at a time per (horse, requester, kind). Partial, so a
-- declined request doesn't block asking again after the situation changes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_horse_access_requests_pending
    ON horse_access_requests (horse_id, requester_exhibitor_id, kind)
    WHERE status = 'pending';

-- Drives the "waiting on you" / "you asked for" lists on the profile page.
CREATE INDEX IF NOT EXISTS idx_horse_access_requests_approver
    ON horse_access_requests (approver_exhibitor_id, status);
CREATE INDEX IF NOT EXISTS idx_horse_access_requests_requester
    ON horse_access_requests (requester_exhibitor_id, status);

COMMENT ON TABLE horse_access_requests IS
    'Pending consent for adding someone else''s horse to a profile (kind=link) or handing ownership over (kind=transfer).';
COMMENT ON COLUMN horse_access_requests.approver_exhibitor_id IS
    'Whoever must approve: the current owner for link, the recipient for transfer.';
COMMENT ON COLUMN horse_access_requests.token IS
    'The authorization for the approve/decline page. Single-use, short TTL, also shown to the requester for copy/paste.';

INSERT INTO _migrations (name) VALUES ('087_horse_access_requests.sql')
ON CONFLICT DO NOTHING;

COMMIT;
