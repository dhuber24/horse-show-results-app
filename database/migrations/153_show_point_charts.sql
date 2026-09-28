-- 153: a show may keep a points chart of its own.
--
-- A show's high point picked one system from a dropdown and that was all: the
-- office could not see the chart it was choosing, and could not change a
-- number in it without leaving for the Points Systems library, copying the
-- chart into their company's list, and coming back to pick the copy. What the
-- office actually does is start from an association's chart (or from nothing)
-- and adjust it for this show. So a show now keeps its **own** chart: a
-- `point_systems` row with `show_id` set, copied from a template when the office
-- presses *Use this template*, edited on the show's High Point page, and read by
-- that show's leaderboard exactly as any other system is.
--
-- A show's chart is not part of any library. It has no company (the CHECK), it
-- is never listed as a template, never offered to another show or a circuit,
-- and it goes when its show does (ON DELETE CASCADE). One per show, which the
-- partial unique index states: using another template replaces it in place.
--
-- Names were unique per company (migration 148); they are now unique per owner,
-- and a show is an owner -- so a show's copy of "APHA Points (SC-060)" may keep
-- the template's name.
--
-- `show_point_systems.point_system_id` goes from RESTRICT to NO ACTION. Deleting
-- a show now deletes both the row choosing its chart and the chart, in one
-- statement; RESTRICT is checked as each row goes, so whether that worked would
-- depend on which cascade Postgres happened to run first. NO ACTION is checked
-- at the end of the statement, and refuses exactly what RESTRICT refused
-- otherwise.
--
-- A nullable column, a looser index, a CHECK no existing row can fail and an
-- equivalent foreign key: backward-compatible, so it goes to production before
-- the code.

BEGIN;

ALTER TABLE point_systems
    ADD COLUMN IF NOT EXISTS show_id UUID REFERENCES shows(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS point_systems_one_per_show
    ON point_systems (show_id) WHERE show_id IS NOT NULL;

DROP INDEX IF EXISTS point_systems_company_name_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS point_systems_owner_name_uniq
    ON point_systems (
        COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(show_id, '00000000-0000-0000-0000-000000000000'::uuid),
        lower(btrim(name))
    );

DO $$
DECLARE
    fk_name TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_point_systems_one_owner') THEN
        ALTER TABLE point_systems
            ADD CONSTRAINT ck_point_systems_one_owner
            CHECK (show_id IS NULL OR company_id IS NULL);
    END IF;

    -- Found by what it joins rather than by name: `create_all` may have built
    -- the table before migration 147 ran, and named nothing.
    SELECT conname INTO fk_name
    FROM pg_constraint
    WHERE conrelid = 'show_point_systems'::regclass
      AND confrelid = 'point_systems'::regclass
      AND contype = 'f'
      AND confdeltype = 'r';
    IF fk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE show_point_systems DROP CONSTRAINT %I', fk_name);
        ALTER TABLE show_point_systems
            ADD CONSTRAINT show_point_systems_point_system_id_fkey
            FOREIGN KEY (point_system_id) REFERENCES point_systems(id) ON DELETE NO ACTION;
    END IF;
END $$;

COMMENT ON COLUMN point_systems.show_id IS
    'The show whose own chart this is (migration 153): copied from a template or '
    'built from scratch on the show''s High Point page. Never listed as a '
    'template or offered elsewhere; deleted with the show. NULL for a library '
    'system (a company''s, or a GaitDesk standard one).';

INSERT INTO _migrations (name) VALUES ('153_show_point_charts.sql')
ON CONFLICT DO NOTHING;

COMMIT;
