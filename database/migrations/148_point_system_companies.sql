-- 148: a points system belongs to a show company.
--
-- Migration 147 made points systems GaitDesk's to enter and every show's to
-- choose from. They belong to the business that runs the shows instead: a
-- club's managers and secretaries enter the charts their shows score by, and
-- only that club's people see them -- the same unit a paid feature is sold to
-- (migration 142). A GaitDesk admin sees and manages every one.
--
-- `company_id` NULL is a system no company owns: only admins see it, and only
-- admins can put it on a show. That is also what a company's systems become if
-- the company is deleted -- SET NULL rather than CASCADE, because a show still
-- scoring by the chart must not lose its standings to an admin tidying the
-- company list (and `show_point_systems` is RESTRICT, so a cascade would make
-- the company impossible to delete at all).
--
-- A name is unique within its owner now, not across the app: two clubs may
-- each keep an "APHA Open Show Points" of their own.
--
-- A nullable column and an index swap, so backward-compatible: it goes to
-- production before the code, with 147.

BEGIN;

ALTER TABLE point_systems
    ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES show_companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS point_systems_company_idx ON point_systems (company_id);

DROP INDEX IF EXISTS point_systems_name_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS point_systems_company_name_uniq
    ON point_systems (
        COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
        lower(btrim(name))
    );

COMMENT ON COLUMN point_systems.company_id IS
    'The show company that owns this points system. Only its members see or use '
    'it; GaitDesk admins see every one. NULL: admins only (and what a deleted '
    'company''s systems become).';

INSERT INTO _migrations (name) VALUES ('148_point_system_companies.sql')
ON CONFLICT DO NOTHING;

COMMIT;
