-- 170: no more per-feature switches -- a company has a feature through its plan.
--
-- `show_company_features` rows were how a paid feature was sold one at a time
-- (migration 142), and from 168 an add-on on top of a plan. Every paid feature
-- is now part of GaitDesk Pro and Pro+, so nothing is sold on its own: a
-- company that wants the show bill import, the reports, the exports or the
-- Live Boards moves to Pro, which it does itself from My Company.
--
-- The rows are deleted here, so a company on Free or Basic that had one
-- switched on loses that feature until it moves to Pro. A company already on
-- Pro, or in a Pro+ year, loses nothing -- the plan included it already.
--
-- **The table stays for now.** The release this replaces still reads it, and
-- reads no rows as no switches, so emptying it is backward-compatible and goes
-- to production before the code. Dropping it is a contract step for a later
-- release, once no running code names it.

BEGIN;

DELETE FROM show_company_features;

INSERT INTO _migrations (name) VALUES ('170_retire_feature_switches.sql')
ON CONFLICT DO NOTHING;

COMMIT;
