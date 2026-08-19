-- Migration 094: per-class publish gate for results.
--
-- The scribe screens now autosave. Results publish straight to the public
-- /live and /results screens, and a placement card is full of gaps until the
-- last horse is entered — so autosaving one would broadcast wrong placings at
-- the rail and write an audit row per intermediate state.
--
-- `results_published_at` splits the two: results rows are written freely as a
-- draft only show staff can read, and the class goes public when a human
-- presses the button. NULL = draft, timestamp = live.
--
-- Related rule (in backend/routers/results.py, not enforceable here): audit
-- rows are only written once a class is published. Before that there is no
-- published value for an edit to have changed.

BEGIN;

ALTER TABLE classes ADD COLUMN IF NOT EXISTS results_published_at TIMESTAMPTZ;

-- Every result that exists today is already public and must stay that way.
-- Without this backfill the migration silently un-publishes every result in
-- every show that has ever run.
UPDATE classes c
SET results_published_at = now()
WHERE c.results_published_at IS NULL
  AND EXISTS (SELECT 1 FROM results r WHERE r.class_id = c.id);

-- The public read paths filter on this column (results-index joins every
-- class in a show), so index the published case.
CREATE INDEX IF NOT EXISTS idx_classes_results_published_at
    ON classes (results_published_at)
    WHERE results_published_at IS NOT NULL;

INSERT INTO _migrations (name) VALUES ('094_class_results_publish_gate.sql')
ON CONFLICT DO NOTHING;

COMMIT;
