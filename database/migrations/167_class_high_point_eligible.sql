-- 167: classes that do not count toward high point.
--
-- Every posted class added to the show's high-point standings. Shows run
-- classes that are not part of their high point -- a leadline, an open
-- jackpot, a fun class, a class run for another program -- and an exhibitor
-- who placed in one had those points added in with the classes that do count,
-- with nothing the office could do about it.
--
-- `classes.high_point_eligible` -- whether this class's placings earn
-- high-point points. TRUE by default, so every class counts as it always has
-- and no standing moves. Read by `high_point.load_cards`, which is what the
-- show's leaderboard, the live boards and a season circuit all add up, so a
-- class left out at its show is left out of the circuit too. The class's
-- results are untouched: it is still judged, posted and on the results pages.
--
-- A defaulted column: backward-compatible, so it goes to production before the
-- code. The default in its own statement as well, the way 161 does it.

BEGIN;

ALTER TABLE classes ADD COLUMN IF NOT EXISTS high_point_eligible BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE classes ALTER COLUMN high_point_eligible SET DEFAULT true;

INSERT INTO _migrations (name) VALUES ('167_class_high_point_eligible.sql')
ON CONFLICT DO NOTHING;

COMMIT;
