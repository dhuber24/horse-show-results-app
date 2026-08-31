-- Migration 121: five outcomes, and a tie somebody broke.
--
-- `results.place` was NOT NULL and every row therefore had to claim a placing.
-- The rule book needs more states than that, and they report differently:
--
--   placed       — ranked. The only state that carries a place, normally.
--   disqualified — the judge's call under the class's own disqualification
--                  list. Flat equitation words it as "should not be placed".
--   eliminated   — went off course, fell, exceeded the time allowed. Over
--                  Fences (AM-111.D) keeps a rider eliminated *during a
--                  ride-off* in the placings, last among that group, which is
--                  why `place` stays writable on a non-placed outcome rather
--                  than being forced to NULL.
--   zero_score   — a score of zero. A real, comparable number in cow work
--                  (SC-265.E.4-6): the run happened and scored nothing.
--   no_score     — no score at all. Not the same as zero, and the distinction
--                  is the association's, not a nicety.
--
-- Two columns beyond that:
--
--   outcome_note   — why, in the scribe's words. There is no vocabulary here
--                    the app can supply: the reason is whatever the judge said.
--   tiebreak_rank  — how the judge broke a tie, without touching either score.
--                    Every pattern class in the rule book leaves ties to the
--                    judge's discretion, and the app used to flag equal scores
--                    `is_tie` and publish them as a shared place. The only way
--                    to record the judge's answer was to edit one of the scores
--                    they called, which falsifies the card. A separate rank
--                    orders equal scores and leaves both numbers alone.
--
-- `place` becomes nullable, which is the load-bearing change: every read path
-- that ordered or compared placings has to tolerate a row that has none.

BEGIN;

ALTER TABLE results ALTER COLUMN place DROP NOT NULL;

ALTER TABLE results
    ADD COLUMN IF NOT EXISTS outcome TEXT,
    ADD COLUMN IF NOT EXISTS outcome_note TEXT,
    ADD COLUMN IF NOT EXISTS tiebreak_rank INTEGER;

-- Stated separately from the ADD: backend startup runs create_all, so on a
-- database where the models landed first these columns already exist without
-- the default the model applies in Python.
UPDATE results SET outcome = 'placed' WHERE outcome IS NULL;
ALTER TABLE results ALTER COLUMN outcome SET DEFAULT 'placed';
ALTER TABLE results ALTER COLUMN outcome SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'results'::regclass AND conname = 'ck_results_outcome'
    ) THEN
        ALTER TABLE results ADD CONSTRAINT ck_results_outcome CHECK (
            outcome IN ('placed', 'disqualified', 'eliminated', 'zero_score', 'no_score')
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'results'::regclass AND conname = 'ck_results_placed_has_place'
    ) THEN
        ALTER TABLE results ADD CONSTRAINT ck_results_placed_has_place CHECK (
            outcome <> 'placed' OR place IS NOT NULL
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'results'::regclass AND conname = 'ck_results_tiebreak_rank'
    ) THEN
        ALTER TABLE results ADD CONSTRAINT ck_results_tiebreak_rank CHECK (
            tiebreak_rank IS NULL OR tiebreak_rank > 0
        );
    END IF;
END
$$;

COMMENT ON COLUMN results.outcome IS
    'What happened to this entry on this judge''s card: placed, disqualified, '
    'eliminated, zero_score or no_score. A zero score and no score are '
    'different results, and only ''placed'' is required to carry a place — an '
    'elimination during an Over Fences ride-off (AM-111.D) is still placed.';

COMMENT ON COLUMN results.outcome_note IS
    'Why, in the scribe''s words. Free text: the reason is whatever the judge '
    'called, and the app has no vocabulary to offer for it.';

COMMENT ON COLUMN results.tiebreak_rank IS
    'How the judge broke a tie between equal scores, lowest first. Kept apart '
    'from raw_score so recording the decision never alters the number the judge '
    'called. NULL on both sides of an equal pair means the tie is unbroken, '
    'which is what blocks the class from being posted.';

INSERT INTO _migrations (name) VALUES ('121_result_outcomes.sql')
ON CONFLICT DO NOTHING;

COMMIT;
