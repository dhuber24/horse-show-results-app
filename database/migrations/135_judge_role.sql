-- 135: a judge may hold a login, and the registry row is what it belongs to.
--
-- `judges` has been the registry of people since migration 085 — the person,
-- their contact details, and the associations they are carded with — and shows
-- assign from it. What it could not do is let that person sign in. Every other
-- person this app knows about has a role and an account: an exhibitor, a
-- trainer, a scribe, a gate steward. A judge did not, so a judge existed in the
-- app only as a name somebody else typed.
--
-- Two halves, and they are deliberately the shape `trainers` already uses.
--
-- 1. A JUDGE role. Not SCRIBE by another name: the scribe is the person at the
--    judge's shoulder writing down what the judge calls, and the two are
--    different jobs done by different people standing next to each other. The
--    role is added here even though a JUDGE login has no screens of its own
--    yet — the account is what a screen would later hang off, and creating the
--    accounts under somebody else's role would have to be undone before that
--    could happen.
--
-- 2. `judges.user_id`, nullable, unique where present. Nullable because most of
--    the registry is judges the show office typed in from a card and who have
--    never logged in — an account is something a judge may have, not something
--    the registry requires. Unique because a login identifies one person, and
--    two registry rows pointing at one account is a duplicate somebody has to
--    merge rather than a fact.
--
-- ON DELETE SET NULL rather than CASCADE: deleting the account must not delete
-- the judge. The registry row is referenced by `show_judges` and, through it,
-- by every placing that judge has filed.

BEGIN;

-- 1. The role. Same shape as migration 093 — the constraint comes off and goes
--    back on with the new value; nothing existing changes role.
ALTER TABLE users DROP CONSTRAINT IF EXISTS check_user_role;
ALTER TABLE users ADD CONSTRAINT check_user_role
    CHECK (role IN ('ADMIN', 'SHOW_SECRETARY', 'SCRIBE', 'EXHIBITOR',
                    'SHOW_MANAGER', 'TRAINER', 'GATE_STEWARD', 'JUDGE'));

-- 2. The link. IF NOT EXISTS because backend startup runs create_all and may
--    have added the column from the model before this migration lands.
ALTER TABLE judges ADD COLUMN IF NOT EXISTS user_id UUID
    REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN judges.user_id IS
    'The login this judge signs in with, if they have one. NULL is the ordinary '
    'case: a judge the show office entered from a card who has never had an '
    'account. Unique where set — one account is one person.';

CREATE UNIQUE INDEX IF NOT EXISTS judges_user_id_uniq
    ON judges (user_id) WHERE user_id IS NOT NULL;

INSERT INTO _migrations (name) VALUES ('135_judge_role.sql')
ON CONFLICT DO NOTHING;

COMMIT;
