-- Migration 124: what kind of APHA show this is, and the judge panel it allows.
--
-- SC-100 and SC-105 divide approved shows into four categories, and each carries
-- its own judge limit:
--
--   Single-Judge Show   one judge in the arena at any given time     (SC-100.A)
--   Two-Judge Show      two in the arena at any given time           (SC-105.C.1)
--   Paint-O-Rama        three or four judges, never more than four
--                       in the arena at once                         (SC-105.D.2)
--   Zone Show           at most six, over two or more days           (SC-105.E.2)
--
-- A lookup table rather than a CHECK constraint or a dict in Python, keyed on
-- `show_types` the way `judging_systems` is: which categories exist and what each
-- allows is the breed body's own taxonomy, and another association's would be
-- different values of the same idea. It also has to render as a picker during
-- show setup, which needs names and rule references in a list anyway.
--
-- **`judge_limit_basis` is the load-bearing column.** SC-100.A and SC-105.C.1
-- limit judges "in the arena at any given time" -- a concurrency limit. The app
-- records which judges are assigned to a show and nothing about who is in the
-- arena when, so for those two categories it cannot check the rule as written,
-- only notice that the assignment count looks wrong for the category. SC-105.D.2
-- and SC-105.E.2 bound the *total* ("limited to three (3) or four (4) judges",
-- "a maximum of six (6) judges"), and those the app can check. Storing which kind
-- of limit each category carries is what lets the finding say which claim it is
-- making instead of asserting a rule the data cannot support.
--
-- `min_judges` for the Zone Show is 2 rather than NULL, on the basis of SC-105.A
-- defining multiple-judge shows as "two-judge shows, Paint-O-Ramas or Zone
-- Shows" -- one judge is not multiple. SC-105.E.2 itself states only a maximum.
--
-- Deliberately NOT modeled: the per-year caps (two Paint-O-Ramas per regional
-- club, four in Zone 10, one Zone Show per zone), the APHA Regional Club
-- sponsorship requirement, and the ten-judge ceiling on shows held in
-- combination (SC-105.B). Every one of those is a fact about APHA's whole
-- calendar or about a club registry this app does not hold, and a limit it
-- cannot count is worse than one it does not claim to. They are reported as
-- text on the readiness panel instead.

CREATE TABLE IF NOT EXISTS show_categories (
    id UUID PRIMARY KEY,
    -- NULL means generic, offered whatever the show type. Points at `show_types`
    -- rather than `associations` for the reason `judging_systems` does: this is
    -- show configuration, not a property of a horse or a person.
    show_type_id UUID REFERENCES show_types(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    -- The panel this category permits. NULL means the rule states no bound.
    min_judges INTEGER,
    max_judges INTEGER,
    -- 'total' = the rule bounds how many judges the show may have.
    -- 'in_arena' = it bounds how many may judge at once, which the app does not
    -- model; the count is then a hint about the category, not a rule check.
    judge_limit_basis TEXT NOT NULL,
    -- SC-105.E.2's "two or more consecutive days". NULL means one day is fine.
    min_days INTEGER,
    rule_reference TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Stated separately from CREATE TABLE, and this is why: startup runs
-- `Base.metadata.create_all`, so on a database reached by the app before this
-- migration the table already exists and `IF NOT EXISTS` skips the whole
-- statement -- taking the defaults and the CHECK with it. Migration 114 learned
-- this the hard way.
ALTER TABLE show_categories ALTER COLUMN sort_order SET DEFAULT 0;
ALTER TABLE show_categories ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE show_categories ALTER COLUMN created_at SET DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_show_categories_limit_basis'
    ) THEN
        ALTER TABLE show_categories
            ADD CONSTRAINT ck_show_categories_limit_basis
            CHECK (judge_limit_basis IN ('total', 'in_arena'));
    END IF;
END $$;

-- One code per show type. The generic (NULL show_type_id) rows need their own
-- partial index: NULLs are distinct in a plain unique index, so two generic rows
-- sharing a code would both be accepted. Same shape as migration 122's
-- unattributed judge card.
CREATE UNIQUE INDEX IF NOT EXISTS show_categories_type_code_uniq
    ON show_categories (show_type_id, code) WHERE show_type_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS show_categories_generic_code_uniq
    ON show_categories (code) WHERE show_type_id IS NULL;

ALTER TABLE shows
    ADD COLUMN IF NOT EXISTS show_category_id UUID REFERENCES show_categories(id);

-- Whether a clinic runs alongside the show. One boolean, because it changes a
-- check: SC-105.C.3 exempts a two-judge show offered with a clinic from the
-- SC-095 minimum class requirements. The rest of what the rule says about
-- clinics -- that the clinician must be APHA-approved, and that the show may not
-- be held in conjunction with an approved Paint-O-Rama (SC-100.A.1, SC-105.C.2)
-- -- is not checkable here and rides on the panel as text.
ALTER TABLE shows ADD COLUMN IF NOT EXISTS offers_clinic BOOLEAN;
UPDATE shows SET offers_clinic = false WHERE offers_clinic IS NULL;
ALTER TABLE shows ALTER COLUMN offers_clinic SET DEFAULT false;
ALTER TABLE shows ALTER COLUMN offers_clinic SET NOT NULL;

-- The four APHA categories. `INSERT ... SELECT` against `show_types` rather than
-- a flat VALUES list, so a database with no APHA row inserts nothing instead of
-- failing the foreign key. Explicit ids because `id` has no server default --
-- the model applies `uuid.uuid4` in Python, and a create_all-made table would
-- otherwise reject these.
INSERT INTO show_categories (
    id, show_type_id, code, name, min_judges, max_judges,
    judge_limit_basis, min_days, rule_reference, sort_order
)
SELECT '5ca70000-0000-4000-8000-000000000001'::uuid, st.id,
       'single_judge', 'Single-Judge Show', 1, 1, 'in_arena', NULL, 'SC-100.A', 10
FROM show_types st
WHERE st.code = 'APHA'
  AND NOT EXISTS (
      SELECT 1 FROM show_categories c
      WHERE c.show_type_id = st.id AND c.code = 'single_judge'
  );

INSERT INTO show_categories (
    id, show_type_id, code, name, min_judges, max_judges,
    judge_limit_basis, min_days, rule_reference, sort_order
)
SELECT '5ca70000-0000-4000-8000-000000000002'::uuid, st.id,
       'two_judge', 'Two-Judge Show', 2, 2, 'in_arena', NULL, 'SC-105.C', 20
FROM show_types st
WHERE st.code = 'APHA'
  AND NOT EXISTS (
      SELECT 1 FROM show_categories c
      WHERE c.show_type_id = st.id AND c.code = 'two_judge'
  );

INSERT INTO show_categories (
    id, show_type_id, code, name, min_judges, max_judges,
    judge_limit_basis, min_days, rule_reference, sort_order
)
SELECT '5ca70000-0000-4000-8000-000000000003'::uuid, st.id,
       'paint_o_rama', 'Paint-O-Rama', 3, 4, 'total', NULL, 'SC-105.D', 30
FROM show_types st
WHERE st.code = 'APHA'
  AND NOT EXISTS (
      SELECT 1 FROM show_categories c
      WHERE c.show_type_id = st.id AND c.code = 'paint_o_rama'
  );

INSERT INTO show_categories (
    id, show_type_id, code, name, min_judges, max_judges,
    judge_limit_basis, min_days, rule_reference, sort_order
)
SELECT '5ca70000-0000-4000-8000-000000000004'::uuid, st.id,
       'zone_show', 'Zone Show', 2, 6, 'total', 2, 'SC-105.E', 40
FROM show_types st
WHERE st.code = 'APHA'
  AND NOT EXISTS (
      SELECT 1 FROM show_categories c
      WHERE c.show_type_id = st.id AND c.code = 'zone_show'
  );

COMMENT ON TABLE show_categories IS
    'What kind of show this is and the judge panel it permits (APHA SC-100, SC-105). Keyed on show_types like judging_systems: a category is the breed body taxonomy.';
COMMENT ON COLUMN show_categories.judge_limit_basis IS
    'total = the rule bounds how many judges the show may have, and the app can check it. in_arena = it bounds how many judge at once, which the app does not model, so the assignment count is a hint about the category rather than a rule check.';
COMMENT ON COLUMN shows.offers_clinic IS
    'A clinic runs alongside the show. Read by APHA SC-105.C.3, which exempts a two-judge show offered with a clinic from the SC-095 minimum class requirements.';
