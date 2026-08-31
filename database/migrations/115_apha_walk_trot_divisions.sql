-- Migration 115: the APHA Walk-Trot divisions.
--
-- `entries.apha_division` has permitted six values since migration 010: Open,
-- Solid Paint-Bred, Amateur, Novice Amateur, Youth and Novice Youth. The rule
-- book has three more, and they are not edge cases — Amateur Walk-Trot (AM-300)
-- and the two Youth Walk-Trot divisions, 11-18 (YP-109) and 5-10 (YP-110), are
-- full divisions with their own class lists, their own eligibility, and their
-- own year-end awards. Most APHA shows run them.
--
-- Splitting Youth Walk-Trot by age rather than storing one YOUTH_WALK_TROT is
-- APHA's own split, and it is load-bearing: the two divisions have different
-- class lists and a horse shown in one is not shown in the other. Collapsing
-- them would have to be undone the moment either is reported on.
--
-- Two constraints have to go, not one. Migration 010 created the column with an
-- inline CHECK, which Postgres auto-named; migration 016 then added a second,
-- explicitly-named one saying almost the same thing. Both are still on the
-- table, so restating only the named one leaves the 010 constraint quietly
-- rejecting every new value. The DO block finds them by what they check rather
-- than by name, because the 010 name was never written down anywhere.

BEGIN;

DO $$
DECLARE
    con RECORD;
BEGIN
    FOR con IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'entries'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%apha_division%'
    LOOP
        EXECUTE format('ALTER TABLE entries DROP CONSTRAINT %I', con.conname);
    END LOOP;
END
$$;

ALTER TABLE entries
    ADD CONSTRAINT check_entries_apha_division CHECK (
        apha_division IS NULL OR apha_division IN (
            'OPEN',
            'SOLID_PAINT_BRED',
            'AMATEUR',
            'NOVICE_AMATEUR',
            'AMATEUR_WALK_TROT',
            'YOUTH',
            'NOVICE_YOUTH',
            'YOUTH_WALK_TROT_11_18',
            'YOUTH_WALK_TROT_5_10'
        )
    );

COMMENT ON COLUMN entries.apha_division IS
    'Which APHA division this entry is made in. Not derivable from the class — '
    'the same class runs for Open, Amateur and Youth — so it is stated per '
    'entry. The Walk-Trot divisions are AM-300, YP-109 and YP-110; Youth '
    'Walk-Trot is split by age because APHA runs them as separate divisions '
    'with separate class lists.';

INSERT INTO _migrations (name) VALUES ('115_apha_walk_trot_divisions.sql')
ON CONFLICT DO NOTHING;

COMMIT;
