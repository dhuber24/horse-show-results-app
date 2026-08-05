-- Migration 085: promote judges to a first-class registry.
--
-- Until now a judge existed only as a row on `show_judges`: name, email, phone
-- and affiliations were retyped into every show that hired them. The same
-- person ended up spelled three ways across three shows, and the affiliation
-- checkboxes were whatever the secretary happened to tick that day.
--
-- This makes the judge itself the record. `judges` holds the person, and
-- `judge_associations` holds who they are carded with — pointing at
-- `associations` (the registry of bodies a horse or person is affiliated with),
-- not at `show_types`, which is show configuration. Show setup now *picks* a
-- judge and reads their details rather than restating them.
--
-- `show_judges` becomes a pure assignment: which judge officiates which show,
-- in what order. The denormalized name/contact columns are dropped because a
-- second copy of a fact is a second chance to be wrong; judge_id RESTRICTs on
-- delete, so a judge who has officiated a show cannot vanish from history.

BEGIN;

CREATE TABLE IF NOT EXISTS judges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Identity is name + email: two "John Smith"s are the same judge unless they
-- carry different email addresses. Matches the dedupe the old "known judges"
-- dropdown did in Python, now enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS idx_judges_identity
    ON judges (lower(first_name), lower(last_name), lower(coalesce(email, '')));

CREATE TABLE IF NOT EXISTS judge_associations (
    judge_id UUID NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
    association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    PRIMARY KEY (judge_id, association_id)
);

ALTER TABLE show_judges
    ADD COLUMN IF NOT EXISTS judge_id UUID REFERENCES judges(id) ON DELETE RESTRICT;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Only runs while the old per-show columns still exist, so re-running the
-- migration after the drop below is a no-op rather than an error.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'show_judges' AND column_name = 'first_name'
    ) THEN
        INSERT INTO judges (first_name, last_name, email, phone)
        SELECT DISTINCT ON (
                   lower(btrim(first_name)),
                   lower(btrim(last_name)),
                   lower(coalesce(btrim(email), ''))
               )
               btrim(first_name), btrim(last_name), nullif(btrim(email), ''), nullif(btrim(phone), '')
        FROM show_judges
        WHERE btrim(first_name) <> '' AND btrim(last_name) <> ''
        ORDER BY lower(btrim(first_name)),
                 lower(btrim(last_name)),
                 lower(coalesce(btrim(email), '')),
                 created_at
        ON CONFLICT DO NOTHING;

        UPDATE show_judges sj
        SET judge_id = j.id
        FROM judges j
        WHERE sj.judge_id IS NULL
          AND lower(btrim(sj.first_name)) = lower(j.first_name)
          AND lower(btrim(sj.last_name)) = lower(j.last_name)
          AND lower(coalesce(btrim(sj.email), '')) = lower(coalesce(j.email, ''));
    END IF;

    -- Old affiliations pointed at show_types; carry across the ones that name a
    -- real association. OPEN has no associations row by design (migration 080)
    -- and is simply dropped — it never meant an affiliation.
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'show_judge_affiliations') THEN
        INSERT INTO judge_associations (judge_id, association_id)
        SELECT DISTINCT sj.judge_id, a.id
        FROM show_judge_affiliations sja
        JOIN show_judges sj ON sj.id = sja.judge_id
        JOIN show_types st ON st.id = sja.show_type_id
        JOIN associations a ON a.code = st.code
        WHERE sj.judge_id IS NOT NULL
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- A show can only hire a given judge once.
DELETE FROM show_judges a
USING show_judges b
WHERE a.judge_id IS NOT NULL
  AND a.judge_id = b.judge_id
  AND a.show_id = b.show_id
  AND a.ctid > b.ctid;

-- Any row that still has no judge (blank names — never valid through the API)
-- is unusable now that the name lives on the registry.
DELETE FROM show_judges WHERE judge_id IS NULL;

ALTER TABLE show_judges ALTER COLUMN judge_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_show_judges_show_judge
    ON show_judges (show_id, judge_id);

DROP TABLE IF EXISTS show_judge_affiliations;

ALTER TABLE show_judges DROP COLUMN IF EXISTS first_name;
ALTER TABLE show_judges DROP COLUMN IF EXISTS last_name;
ALTER TABLE show_judges DROP COLUMN IF EXISTS email;
ALTER TABLE show_judges DROP COLUMN IF EXISTS phone;

COMMENT ON TABLE judges IS
    'Registry of judges. Show setup picks from here rather than retyping details.';
COMMENT ON TABLE judge_associations IS
    'Associations a judge is carded with. References associations, not show_types.';
COMMENT ON COLUMN show_judges.judge_id IS
    'The registry judge officiating this show. RESTRICT — history outlives edits.';

INSERT INTO _migrations (name) VALUES ('085_judge_registry.sql')
ON CONFLICT DO NOTHING;

COMMIT;
