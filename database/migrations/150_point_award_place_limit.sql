-- 150: a points chart's row can award no more places than its class size.
--
-- A row of `point_system_awards` reads "from a class of `min_entries` horses
-- up, `place` earns `points`". A class of at least N horses is sure of N places
-- and no more, so a row paying an (N+1)th place was paying a place its smallest
-- class does not have. The editor greys those cells out and the router refuses
-- them; this states the rule where no caller can go round it.
--
-- A flat scale is now a row per class size up to the last place it pays --
-- 6-5-4-3-2-1 is rows for classes of 1 through 6 -- rather than one row at 1.
--
-- Written before any production chart exists (147-150 ship together), so no row
-- can fail it there. On a database that already holds charts it would refuse to
-- add the constraint while any row breaks the rule, which is the correct
-- outcome: those rows need correcting before this goes on.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_point_system_awards_place_within_class'
    ) THEN
        ALTER TABLE point_system_awards
            ADD CONSTRAINT ck_point_system_awards_place_within_class
            CHECK (place <= min_entries);
    END IF;
END $$;

INSERT INTO _migrations (name) VALUES ('150_point_award_place_limit.sql')
ON CONFLICT DO NOTHING;

COMMIT;
