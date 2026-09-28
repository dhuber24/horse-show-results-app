-- 147: high-point standings -- the points systems, the show's choice of one,
-- and the season circuits that add several shows together.
--
-- The public Leaderboard was a "coming soon" card: nothing turned a posted
-- placing into points, so nothing ever appeared on it however many classes were
-- judged. Two facts were missing, and neither is the app's to invent.
--
--   * **How a placing becomes points.** Every association has its own chart,
--     and most of them scale with the size of the class -- first of three is not
--     worth what first of twenty is. So a points system is data a GaitDesk admin
--     enters from the association's own rules, one system at a time, and nothing
--     here is seeded: a chart typed from memory under APHA's name would be read
--     at the rail as APHA's.
--
--   * **What the points add up across.** A show's own high point is that show.
--     A season circuit -- a club's year of shows, say -- is several shows added
--     together under the circuit's own chart, which need not be the one any of
--     its shows uses for its own awards.
--
-- Five tables.
--
-- `point_systems` is the named chart; `association_id` says whose rules it
-- follows (NULL for a club or show's own scale), for the picker's sake only.
--
-- `point_system_awards` is the chart itself: from a class of `min_entries`
-- horses up, `place` earns `points`. A flat scale ("6-5-4-3-2-1 whatever the
-- class size") is one band at `min_entries = 1`; an association chart is one
-- band per class size it names, and the largest band covers every bigger class,
-- which is how the printed charts read ("11 or more horses"). Points are
-- NUMERIC because association charts award half points.
--
-- `show_point_systems` is the show's choice, keyed on the show -- a table rather
-- than `shows.point_system_id` for migration 146's reason: `shows` is read on
-- nearly every path, and a column the running release does not map there is how
-- migration 133 took the site down. No row means no high point at that show.
--
-- `circuits` and `circuit_shows` are the season and its shows. A circuit is
-- managed by whoever created it (or a GaitDesk admin), and a show is added only
-- by somebody who works that show -- the router enforces both, since they are
-- about accounts rather than rows.

BEGIN;

CREATE TABLE IF NOT EXISTS point_systems (
    id                 UUID PRIMARY KEY,
    name               TEXT NOT NULL,
    association_id     UUID REFERENCES associations(id) ON DELETE SET NULL,
    notes              TEXT,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ
);

-- Stated separately from the CREATE TABLE: backend startup runs `create_all`,
-- which may have built these tables from the models before the migration
-- lands, and then `CREATE TABLE IF NOT EXISTS` skips (migration 114's lesson).
ALTER TABLE point_systems ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE point_systems ALTER COLUMN updated_at SET DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS point_systems_name_uniq
    ON point_systems (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS point_system_awards (
    point_system_id UUID NOT NULL REFERENCES point_systems(id) ON DELETE CASCADE,
    min_entries     INTEGER NOT NULL,
    place           INTEGER NOT NULL,
    points          NUMERIC(7, 2) NOT NULL,
    PRIMARY KEY (point_system_id, min_entries, place)
);

CREATE TABLE IF NOT EXISTS show_point_systems (
    show_id            UUID PRIMARY KEY REFERENCES shows(id) ON DELETE CASCADE,
    point_system_id    UUID NOT NULL REFERENCES point_systems(id) ON DELETE RESTRICT,
    chosen_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    chosen_at          TIMESTAMPTZ
);

ALTER TABLE show_point_systems ALTER COLUMN chosen_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS circuits (
    id                 UUID PRIMARY KEY,
    name               TEXT NOT NULL,
    season             TEXT,
    point_system_id    UUID REFERENCES point_systems(id) ON DELETE RESTRICT,
    notes              TEXT,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ
);

ALTER TABLE circuits ALTER COLUMN created_at SET DEFAULT now();

CREATE TABLE IF NOT EXISTS circuit_shows (
    circuit_id       UUID NOT NULL REFERENCES circuits(id) ON DELETE CASCADE,
    show_id          UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    added_at         TIMESTAMPTZ,
    PRIMARY KEY (circuit_id, show_id)
);

ALTER TABLE circuit_shows ALTER COLUMN added_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS circuit_shows_show_idx ON circuit_shows (show_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_point_systems_name') THEN
        ALTER TABLE point_systems
            ADD CONSTRAINT ck_point_systems_name
            CHECK (char_length(btrim(name)) BETWEEN 1 AND 200);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_point_system_awards_values') THEN
        ALTER TABLE point_system_awards
            ADD CONSTRAINT ck_point_system_awards_values
            CHECK (min_entries >= 1 AND place >= 1 AND points > 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_circuits_name') THEN
        ALTER TABLE circuits
            ADD CONSTRAINT ck_circuits_name
            CHECK (char_length(btrim(name)) BETWEEN 1 AND 200);
    END IF;
END $$;

COMMENT ON TABLE point_systems IS
    'A named high-point chart, entered by a GaitDesk admin from an association''s '
    'own rules. Nothing is seeded: a chart the app invented would be read as the '
    'association''s.';

COMMENT ON TABLE point_system_awards IS
    'The chart: from a class of min_entries horses up, place earns points. The '
    'largest band at or below the class size applies; a flat scale is one band '
    'at min_entries = 1.';

COMMENT ON TABLE show_point_systems IS
    'Which points system the show''s own high point uses. No row, no leaderboard.';

COMMENT ON TABLE circuits IS
    'A season circuit: several shows whose posted placings add up under the '
    'circuit''s own points system. Managed by its creator or a GaitDesk admin.';

INSERT INTO _migrations (name) VALUES ('147_high_point.sql')
ON CONFLICT DO NOTHING;

COMMIT;
