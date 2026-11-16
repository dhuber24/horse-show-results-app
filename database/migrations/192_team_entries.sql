-- 192: team classes, and the riders on a team.
--
-- Some classes are ridden by a team, not one rider on one horse: Tandem
-- Bareback and Rescue Race are two riders on one horse, Ribbon Race two riders
-- on two horses, 4-In-A-Line four riders each on their own horse. WSCA's
-- Championship Show takes the entry from one team member, who pays, and asks
-- for the rest of the team on a separate form.
--
-- `classes.team_size` says a class is ridden by a team of that many riders.
-- NULL is an ordinary class. It is seeded from the class name when a class is
-- created (`rules.disciplines.team_size`) and is the office's to correct after,
-- the same derive-then-store shape as `entered_by_qualification` (migration
-- 129). Existing classes are not backfilled: a show already taking entries
-- keeps what it has, and the office sets it on the Class Builder.
--
-- The entry stays the team's: the rider who entered it, their horse, their
-- back number and the one entry fee, so billing, the gate, the scribe screens
-- and posting work per entry exactly as before. `entry_team_members` is the
-- rest of the team -- one row per other rider, each with the horse they ride,
-- or NULL where they ride the team's horse (Tandem Bareback, Rescue Race).
-- Every teammate is on the show's roster (the app checks it), so a team never
-- reaches anybody the show did not already have.
--
-- A new table and a nullable column: backward-compatible, so this goes to
-- production before the code.

BEGIN;

ALTER TABLE classes ADD COLUMN IF NOT EXISTS team_size SMALLINT;

-- Stated on its own: `create_all` may have built `classes` from the model
-- first (it never adds a column, so on an existing table this is the only
-- writer), and a CHECK stated inside ADD COLUMN would be skipped with it.
ALTER TABLE classes DROP CONSTRAINT IF EXISTS ck_classes_team_size;
ALTER TABLE classes
    ADD CONSTRAINT ck_classes_team_size CHECK (team_size IS NULL OR team_size BETWEEN 2 AND 12);

COMMENT ON COLUMN classes.team_size IS
    'Ridden by a team of this many riders (Tandem Bareback 2, 4-In-A-Line 4). NULL is an ordinary class.';

CREATE TABLE IF NOT EXISTS entry_team_members (
    id           UUID PRIMARY KEY,
    entry_id     UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    exhibitor_id UUID NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
    horse_id     UUID REFERENCES horses(id) ON DELETE SET NULL,
    position     SMALLINT NOT NULL,
    created_at   TIMESTAMPTZ
);

ALTER TABLE entry_team_members ALTER COLUMN created_at SET DEFAULT now();

-- One seat each on a team, and nobody on it twice.
CREATE UNIQUE INDEX IF NOT EXISTS entry_team_members_entry_exhibitor_uniq
    ON entry_team_members (entry_id, exhibitor_id);
CREATE UNIQUE INDEX IF NOT EXISTS entry_team_members_entry_position_uniq
    ON entry_team_members (entry_id, position);
-- "Which teams is this person on" -- the desk, cancelling, merging.
CREATE INDEX IF NOT EXISTS entry_team_members_exhibitor_idx
    ON entry_team_members (exhibitor_id);

COMMENT ON TABLE entry_team_members IS
    'The riders on a team entry other than the one who entered it. The entry''s own exhibitor and horse are the team''s first rider.';
COMMENT ON COLUMN entry_team_members.horse_id IS
    'The horse this rider rides. NULL: they ride the team''s horse, the entry''s own (Tandem Bareback, Rescue Race).';
COMMENT ON COLUMN entry_team_members.position IS
    'Their place in the team''s name, from 2: the rider who entered is 1.';

INSERT INTO _migrations (name) VALUES ('192_team_entries.sql')
ON CONFLICT DO NOTHING;

COMMIT;
