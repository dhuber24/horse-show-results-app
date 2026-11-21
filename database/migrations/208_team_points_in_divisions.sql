-- 208: the show decides whether team-class points count toward individual high point.
--
-- Migration 192 gave team classes a standing of their own, Team High Point by
-- rider, and kept them out of the division standings altogether. That is one
-- show's rule, not every show's: some shows also add what a rider earns on a
-- team into their individual (division) high point. WSCA leaves high-point
-- rules to each show committee (rulebook, Show Committee rule 8).
--
-- `shows.team_points_in_divisions` is the show office's answer, set on the
-- Scoring step's class list (and the High Point page, the same component).
-- Off -- today's rule -- a team class earns Team High Point only. On, every
-- rider on a placed team also earns the placing's full points in the team
-- class's division, with the horse they rode (the team's own horse where they
-- brought none), exactly as if they had placed there alone; a rider on two
-- teams in one class keeps the better placing on each card. Team High Point is
-- kept either way. A circuit reads each show's own answer for its classes.
--
-- A NOT NULL column with its default: idempotent and backward-compatible --
-- older code never reads it, and every existing show keeps the rule it has.
-- Production first.

BEGIN;

ALTER TABLE shows ADD COLUMN IF NOT EXISTS team_points_in_divisions BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN shows.team_points_in_divisions IS
    'Whether team-class placings also count toward the division (individual) high point standings, each rider with the horse they rode (migration 208). False: team classes earn Team High Point only.';

INSERT INTO _migrations (name) VALUES ('208_team_points_in_divisions.sql')
ON CONFLICT DO NOTHING;

COMMIT;
