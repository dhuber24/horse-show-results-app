-- 193: saddle clubs, and saddle-club high point.
--
-- WSCA's members are saddle clubs, and its Championship Show awards high point
-- "to the Saddle Club and Individuals". A rider's club is a membership on their
-- profile, like any other body's -- so the saddle clubs go into the shared
-- `associations` registry as their own type, `saddle_club`, which keeps them out
-- of every list that means a sanctioning body (those read `club`). The show
-- office adds one that is not listed, and it stays for every later show.
--
-- A saddle club issues no member numbers (WSCA lists riders by name, zip and
-- birth year), so a membership's number becomes optional; the app still asks
-- for one on a breed membership.
--
-- What counts at a show is the show office's to set up (`show_club_points`):
-- whether the show keeps saddle-club standings at all, which clubs compete, how
-- many clubs one rider may ride for, and how a team class credits clubs. Each
-- rider's club(s) for the show are `show_entry_clubs`, one primary -- the club
-- an individual placing counts for, so no placing is split or counted twice --
-- and a team seat may name the rider's other club (`entry_rider_clubs`).
--
-- New tables, a widened CHECK, nullable columns and a dropped NOT NULL nothing
-- old writes a NULL into: backward-compatible, so production first.

BEGIN;

ALTER TABLE associations DROP CONSTRAINT IF EXISTS associations_association_type_check;
ALTER TABLE associations DROP CONSTRAINT IF EXISTS ck_associations_type;
ALTER TABLE associations
    ADD CONSTRAINT ck_associations_type CHECK (association_type IN ('breed', 'club', 'saddle_club'));
ALTER TABLE associations ADD COLUMN IF NOT EXISTS member_of_association_id UUID
    REFERENCES associations(id) ON DELETE SET NULL;
ALTER TABLE associations ADD COLUMN IF NOT EXISTS created_by_user_id UUID
    REFERENCES users(id) ON DELETE SET NULL;
COMMENT ON COLUMN associations.member_of_association_id IS
    'The body a saddle club belongs to (WSCA). NULL for everything else.';
COMMENT ON COLUMN associations.created_by_user_id IS
    'Who added it, where a show office added a saddle club; NULL for the registry''s own rows.';

ALTER TABLE exhibitor_registrations ALTER COLUMN member_number DROP NOT NULL;
ALTER TABLE show_registration_memberships ALTER COLUMN member_number DROP NOT NULL;

CREATE TABLE IF NOT EXISTS show_club_points (
    show_id          UUID PRIMARY KEY REFERENCES shows(id) ON DELETE CASCADE,
    clubs_per_rider  SMALLINT NOT NULL,
    team_rule        TEXT NOT NULL,
    created_at       TIMESTAMPTZ
);
ALTER TABLE show_club_points ALTER COLUMN clubs_per_rider SET DEFAULT 1;
ALTER TABLE show_club_points ALTER COLUMN team_rule SET DEFAULT 'each_rider';
ALTER TABLE show_club_points ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE show_club_points DROP CONSTRAINT IF EXISTS ck_show_club_points_clubs_per_rider;
ALTER TABLE show_club_points
    ADD CONSTRAINT ck_show_club_points_clubs_per_rider CHECK (clubs_per_rider BETWEEN 1 AND 5);
ALTER TABLE show_club_points DROP CONSTRAINT IF EXISTS ck_show_club_points_team_rule;
ALTER TABLE show_club_points
    ADD CONSTRAINT ck_show_club_points_team_rule CHECK (team_rule IN ('each_rider', 'entrant', 'none'));
COMMENT ON TABLE show_club_points IS
    'This show keeps saddle-club high point standings, and how. No row: it does not.';

CREATE TABLE IF NOT EXISTS show_club_point_clubs (
    show_id        UUID NOT NULL REFERENCES show_club_points(show_id) ON DELETE CASCADE,
    association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    PRIMARY KEY (show_id, association_id)
);
COMMENT ON TABLE show_club_point_clubs IS 'The saddle clubs competing for club high point at this show.';

CREATE TABLE IF NOT EXISTS show_entry_clubs (
    show_entry_id  UUID NOT NULL REFERENCES show_entries(id) ON DELETE CASCADE,
    association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    is_primary     BOOLEAN NOT NULL,
    PRIMARY KEY (show_entry_id, association_id)
);
ALTER TABLE show_entry_clubs ALTER COLUMN is_primary SET DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS show_entry_clubs_one_primary
    ON show_entry_clubs (show_entry_id) WHERE is_primary;
COMMENT ON TABLE show_entry_clubs IS
    'The club(s) a rider rides for at this show; the primary one is what an individual placing counts for.';

CREATE TABLE IF NOT EXISTS entry_rider_clubs (
    entry_id       UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    exhibitor_id   UUID NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
    association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    PRIMARY KEY (entry_id, exhibitor_id)
);
COMMENT ON TABLE entry_rider_clubs IS
    'A rider on a team riding for one of their other declared clubs, not their primary.';

INSERT INTO _migrations (name) VALUES ('193_saddle_club_high_point.sql')
ON CONFLICT DO NOTHING;

COMMIT;
