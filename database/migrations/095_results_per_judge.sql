-- Migration 095: placings are per judge.
--
-- Until now `results` held one set of placings per class, so a show where four
-- judges each place the same class independently could not be recorded — the
-- second judge's card overwrote the first. `judge_id` adds the missing
-- dimension, pointing at the *assignment* (`show_judges`) rather than at the
-- registry judge, because "who placed this class" is a fact about this show.
--
-- NULL means unattributed: results that pre-date this migration on a
-- multi-judge show, and any class placed before judges were assigned. The
-- read paths render those as a single "Placing" column, so nothing disappears.
--
-- The old UNIQUE (class_id, place, entry_id) has to go, and not merely because
-- it is superseded: two judges awarding the same horse the same place produce
-- the identical triple, so leaving it in place would reject the second card.

BEGIN;

ALTER TABLE results
    ADD COLUMN IF NOT EXISTS judge_id UUID REFERENCES show_judges(id) ON DELETE RESTRICT;

-- RESTRICT rather than CASCADE: unassigning a judge from a show must not
-- silently delete placings they already handed in. The API turns the resulting
-- FK violation into a 409 explaining which show to clear first.

-- Drop the old triple. Matched by column set rather than by name so this works
-- against databases built from schema.sql as well as ones grown by migration.
DO $$
DECLARE
    target_name text;
BEGIN
    SELECT c.conname INTO target_name
    FROM pg_constraint c
    WHERE c.conrelid = 'results'::regclass
      AND c.contype = 'u'
      AND (
          -- ::text on attname: it is a `name`, and `name[] = text[]` has no
          -- operator, so the comparison errors rather than returning false.
          SELECT array_agg(a.attname::text ORDER BY a.attname::text)
          FROM unnest(c.conkey) k
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
      ) = ARRAY['class_id', 'entry_id', 'place']
    LIMIT 1;

    IF target_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE results DROP CONSTRAINT %I', target_name);
    END IF;
END $$;

-- One row per entry per judge per class. Two partial indexes rather than one
-- constraint with NULLS NOT DISTINCT: NULLs compare as distinct in a plain
-- unique index, which would let an unattributed entry be inserted twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_results_class_judge_entry
    ON results (class_id, judge_id, entry_id)
    WHERE judge_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_results_class_entry_no_judge
    ON results (class_id, entry_id)
    WHERE judge_id IS NULL;

-- Every read is "this class, this judge's card"; the writes delete by the same
-- key before reinserting.
CREATE INDEX IF NOT EXISTS idx_results_class_judge
    ON results (class_id, judge_id);

-- Backfill: where a show has exactly one judge assigned, the single set of
-- placings on file is unambiguously that judge's card, so attribute it. Shows
-- with two or more judges are left NULL — there is no way to tell from here
-- whose card was entered, and guessing would put a name against placings that
-- judge may not have given.
UPDATE results r
SET judge_id = sj.id
FROM classes c
JOIN show_judges sj ON sj.show_id = c.show_id
WHERE r.class_id = c.id
  AND r.judge_id IS NULL
  AND (SELECT count(*) FROM show_judges s2 WHERE s2.show_id = c.show_id) = 1;

INSERT INTO _migrations (name) VALUES ('095_results_per_judge.sql')
ON CONFLICT DO NOTHING;

COMMIT;
