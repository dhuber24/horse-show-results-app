-- 156: a show is run by a show company, and the company's staff work it.
--
-- A show was owned by the accounts in `show_managers` / `show_secretaries` and
-- nothing else, so a club's secretary could not open the club's own show until
-- somebody assigned them to it by hand, show by show -- and setup Step 1 offered
-- every show manager and secretary in the app to pick from. Migration 142 gave
-- the business that runs shows a name and a staff list; this points the show
-- at it.
--
-- **Everyone in the show's company works the show.** Access is the per-show
-- rows *or* membership of `shows.company_id` (`backend/show_access.py`), so
-- adding somebody to the company reaches every show it runs and removing them
-- takes them off every one. The per-show rows stay, for somebody from outside
-- the company who works one show -- a freelance secretary hired for the
-- weekend -- and for a show that has no company.
--
-- **Not backfilled.** Which company an existing show belongs to is a guess
-- from its creator's companies *today*, which is not the company they worked
-- for when they created it (an independent who has since joined a club would
-- hand every show they ran alone to the club's staff). And a guess here widens
-- who can open a show. So an existing show stays NULL -- reached exactly as
-- before -- until its office chooses a company on setup Step 1, which suggests
-- one. A new show gets its creator's company when it is created.
--
-- SET NULL, not CASCADE: deleting a company must not delete its shows.
-- `show_companies.pin_company_shows` writes per-show rows for the company's
-- staff first, so nobody loses a show they were working because an admin
-- tidied the company list.
--
-- A nullable column and an index: backward-compatible, so it goes to
-- production before the code.

BEGIN;

ALTER TABLE shows
    ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES show_companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS shows_company_idx ON shows (company_id);

COMMENT ON COLUMN shows.company_id IS
    'The show company that runs this show. Its managers and secretaries work the '
    'show without a per-show assignment; show_managers / show_secretaries remain '
    'for staff from outside the company. NULL: staffed by those rows alone.';

INSERT INTO _migrations (name) VALUES ('156_show_company_on_shows.sql')
ON CONFLICT DO NOTHING;

COMMIT;
