-- 152: a points chart's row is a range of class sizes, and may pay as many
-- places as the largest class in it.
--
-- Migration 150 limited a row to its *first* class size: the row for classes
-- of 5 could pay five places. But charts are printed as ranges -- 3-4, 5-9,
-- 10-14 -- and a 5-9 row is used by a class of nine, which has a 9th place. So
-- a row now runs from its own size to one below the next row's, and may pay as
-- many places as the top of that range. The last row is open-ended ("45 or
-- more") and has only its first size to go by, so it may pay that many.
--
-- The top of a row's range is the next row's start, which a CHECK cannot see,
-- so the rule moves to the router (`high_point.place_limits`) and the CHECK
-- goes. Every row 150 allowed is still allowed, so nothing on file breaks.
-- Dropping a constraint is backward-compatible: safe before the code.

BEGIN;

ALTER TABLE point_system_awards
    DROP CONSTRAINT IF EXISTS ck_point_system_awards_place_within_class;

INSERT INTO _migrations (name) VALUES ('152_point_award_ranges.sql')
ON CONFLICT DO NOTHING;

COMMIT;
