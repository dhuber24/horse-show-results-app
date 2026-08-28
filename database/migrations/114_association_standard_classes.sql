-- Migration 114: one versioned home for every association's class-code catalog.
--
-- APHA and AQHA each had their own table (`apha_standard_classes`,
-- `aqha_standard_classes`), identical but for two columns, and ApHC and FQHR
-- had none at all. That shape cannot answer "let an admin upload the new file
-- for association X" — every new association is a migration — so this folds
-- both into one table keyed on the show type whose catalog it is.
--
-- `show_type_id`, not `association_id`. A class *code* is the breed body's
-- catalog identifier for a class, which is the question `class_associations`
-- and `standard_classes` already answer, and both point at `show_types`. An
-- `associations` row answers a different question (this horse is registered
-- with AQHA). Same code, two lists, on purpose — see Claude.md.
--
-- ── Why a Type 2 dimension rather than a plain table ─────────────────────────
--
-- The associations publish a new list every year and the app is asked to load
-- it over the old one. A plain UPDATE loses the thing the office actually
-- needs later: a show run in 2026 under a code APHA retired in 2027 still has
-- to render its own program. So every row is a *version* — `effective_date`
-- when it became current, `inactive_date` when it stopped — and nothing is
-- ever updated in place or deleted. A changed name closes the old version and
-- opens a new one; a code missing from the new file just closes.
--
-- The partial unique index is what makes it a Type 2 rather than an append-only
-- log: at most one open version per (show type, code), enforced by Postgres
-- rather than by the importer remembering to close the old row first.
--
-- ── Idempotent against a create_all-made table ───────────────────────────────
--
-- The backend runs Base.metadata.create_all on every start, so between the
-- model landing and this migration running, startup may already have created
-- these two tables from the models. What it makes is *almost* right and
-- missing exactly the parts SQLAlchemy keeps on the Python side: `id` gets no
-- DEFAULT (the model's default=uuid.uuid4 is applied in Python), and a CHECK
-- declared only in SQL is not there at all. So CREATE TABLE IF NOT EXISTS
-- silently leaves a table this migration's INSERT then fails against.
--
-- Everything below therefore states the defaults and the constraint separately
-- rather than relying on the CREATE, and the INSERT supplies its own ids.
--
-- Everything that *reads* the catalog reads the `association_standard_classes`
-- view, which is the open versions only. Callers never write the filter
-- themselves, so a screen cannot accidentally offer a retired code.

BEGIN;

-- ── 1. Upload audit ──────────────────────────────────────────────────────────
-- One row per applied import, so "where did this row come from" has an answer.
CREATE TABLE IF NOT EXISTS association_class_imports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_type_id    UUID NOT NULL REFERENCES show_types(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    source_year     INTEGER,
    uploaded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    added_count     INTEGER NOT NULL DEFAULT 0,
    changed_count   INTEGER NOT NULL DEFAULT 0,
    retired_count   INTEGER NOT NULL DEFAULT 0,
    unchanged_count INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE association_class_imports
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS idx_association_class_imports_show_type
    ON association_class_imports (show_type_id, uploaded_at DESC);

-- ── 2. The versioned catalog ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS association_standard_class_versions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_type_id   UUID NOT NULL REFERENCES show_types(id) ON DELETE CASCADE,
    code           TEXT NOT NULL,
    name           TEXT NOT NULL,
    division       TEXT NOT NULL,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    source_year    INTEGER,
    notes          TEXT,
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    inactive_date  DATE,
    import_id      UUID REFERENCES association_class_imports(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT association_standard_class_versions_dates_chk
        CHECK (inactive_date IS NULL OR inactive_date >= effective_date)
);

ALTER TABLE association_standard_class_versions
    ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE association_standard_class_versions
    ALTER COLUMN effective_date SET DEFAULT CURRENT_DATE;

-- A version cannot stop being current before it started. Stated here rather
-- than left to the CREATE, which is skipped when the table already exists.
DO $$
BEGIN
    ALTER TABLE association_standard_class_versions
        ADD CONSTRAINT association_standard_class_versions_dates_chk
        CHECK (inactive_date IS NULL OR inactive_date >= effective_date);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- At most one open version per code. Closing the old row is therefore not
-- something the importer can forget to do — the insert fails if it does.
CREATE UNIQUE INDEX IF NOT EXISTS association_standard_class_current_uniq
    ON association_standard_class_versions (show_type_id, code)
    WHERE inactive_date IS NULL;

-- The read path is always "the open rows for one show type, in catalog order".
CREATE INDEX IF NOT EXISTS idx_association_standard_class_current
    ON association_standard_class_versions (show_type_id, division, sort_order)
    WHERE inactive_date IS NULL;

-- History lookups: every version of one code, oldest first.
CREATE INDEX IF NOT EXISTS idx_association_standard_class_history
    ON association_standard_class_versions (show_type_id, code, effective_date);

-- ── 3. Carry the two existing catalogs in ────────────────────────────────────
-- Both were loaded by hand from the associations' published lists and have
-- been tidied since (APHA's own "Performace Halter" typo is fixed in ours),
-- so they come across as the currently-open version rather than being
-- re-derived from a file.
INSERT INTO association_standard_class_versions
    (id, show_type_id, code, name, division, sort_order, effective_date)
SELECT gen_random_uuid(), st.id, a.code, a.name, a.division, a.sort_order,
       DATE '2026-01-01'
FROM apha_standard_classes a
CROSS JOIN show_types st
WHERE st.code = 'APHA'
ON CONFLICT DO NOTHING;

INSERT INTO association_standard_class_versions
    (id, show_type_id, code, name, division, sort_order, source_year, notes,
     effective_date)
SELECT gen_random_uuid(), st.id, a.code, a.name, a.division, a.sort_order,
       a.source_year, a.notes, DATE '2026-01-01'
FROM aqha_standard_classes a
CROSS JOIN show_types st
WHERE st.code = 'AQHA'
ON CONFLICT DO NOTHING;

-- ── 4. The read surface ──────────────────────────────────────────────────────
CREATE OR REPLACE VIEW association_standard_classes AS
SELECT id, show_type_id, code, name, division, sort_order, source_year, notes,
       effective_date
FROM association_standard_class_versions
WHERE inactive_date IS NULL;

COMMENT ON VIEW association_standard_classes IS
    'Currently-approved class codes per breed show type. Read this, never the '
    'versions table directly — the filter is what keeps a retired code off the '
    'pickers. History (including retired codes) lives in '
    'association_standard_class_versions.';

-- ── 5. Retire the per-association tables ─────────────────────────────────────
-- Two sources of truth for the same list is how they drift. Everything that
-- read these now reads the view through backend/standard_classes.py.
DROP TABLE IF EXISTS apha_standard_classes;
DROP TABLE IF EXISTS aqha_standard_classes;

COMMIT;
