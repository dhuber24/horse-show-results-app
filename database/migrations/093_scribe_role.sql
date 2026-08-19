-- Migration 093: SCOREKEEPER role → SCRIBE.
--
-- Renames the score-entry role to the term the horse show world actually
-- uses. A *scribe* is the person at the judge's shoulder who records the
-- scores and penalties the judge calls; that is what this role does.
--
-- Note for future work: a *ring steward* is NOT this job. A ring steward
-- works the arena floor — safety, halter lineup, calling gaits, carrying the
-- signed card to the office — which is much closer to GATE_STEWARD. Naming
-- this role RING_STEWARD would have produced two unrelated "stewards".
--
-- Three things move: the role value on users, the role on any pending
-- invites, and the per-show assignment table.

BEGIN;

-- 1. Role value on users. The check constraint has to come off first or the
--    UPDATE cannot land.
ALTER TABLE users DROP CONSTRAINT IF EXISTS check_user_role;
UPDATE users SET role = 'SCRIBE' WHERE role = 'SCOREKEEPER';
ALTER TABLE users ADD CONSTRAINT check_user_role
    CHECK (role IN ('ADMIN', 'SHOW_SECRETARY', 'SCRIBE', 'EXHIBITOR',
                    'SHOW_MANAGER', 'TRAINER', 'GATE_STEWARD'));

-- 2. Pending invites store the role as free text. Left alone, a pending
--    invite would accept into a role the constraint no longer permits.
UPDATE user_invites SET role = 'SCRIBE' WHERE role = 'SCOREKEEPER';

-- 3. Assignment table. Guarded because the backend's startup create_all may
--    already have created an empty show_scribes from the renamed ORM model
--    before this migration runs (same hazard noted in migration 075).
DO $$
BEGIN
    IF to_regclass('public.show_scorekeepers') IS NOT NULL
       AND to_regclass('public.show_scribes') IS NOT NULL THEN
        -- create_all raced us: move the real rows across, drop the old table.
        INSERT INTO show_scribes (id, show_id, user_id, created_at)
            SELECT id, show_id, user_id, created_at FROM show_scorekeepers
            ON CONFLICT DO NOTHING;
        DROP TABLE show_scorekeepers;
    ELSIF to_regclass('public.show_scorekeepers') IS NOT NULL THEN
        ALTER TABLE show_scorekeepers RENAME TO show_scribes;
        ALTER INDEX IF EXISTS idx_show_scorekeepers_show_id RENAME TO idx_show_scribes_show_id;
        ALTER INDEX IF EXISTS idx_show_scorekeepers_user_id RENAME TO idx_show_scribes_user_id;
    END IF;
END $$;

INSERT INTO _migrations (name) VALUES ('093_scribe_role.sql')
ON CONFLICT DO NOTHING;

COMMIT;
