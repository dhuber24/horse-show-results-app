-- 181: when exhibitors may arrive and move into their stalls.
--
-- Every show bill says it -- "Stalls open Thursday at noon" -- and exhibitors
-- plan the haul around it. The app asked each exhibitor for an arrival date
-- (`show_entries.arrival_date`, the office's stall-chart planning) but never
-- said when the barn opens, so the answer was a phone call to the office.
--
-- `stalls_open_date` is the day; `stalls_open_time` the hour on it, optional,
-- since some shows only say "Thursday". Both are wall-clock values at the
-- venue, printed as the office typed them -- a TIME rather than a TIMESTAMPTZ,
-- because the show office states the hour in the venue's own time and there
-- is no instant to convert into the reader's zone. A time with no day means
-- nothing, so the CHECK refuses it.
--
-- Nullable columns and an additive CHECK only: backward-compatible, so this
-- goes to production before the code.

BEGIN;

ALTER TABLE shows
    ADD COLUMN IF NOT EXISTS stalls_open_date DATE,
    ADD COLUMN IF NOT EXISTS stalls_open_time TIME;

ALTER TABLE shows DROP CONSTRAINT IF EXISTS ck_shows_stalls_open_time_has_date;
ALTER TABLE shows ADD CONSTRAINT ck_shows_stalls_open_time_has_date
    CHECK (stalls_open_time IS NULL OR stalls_open_date IS NOT NULL);

INSERT INTO _migrations (name) VALUES ('181_stall_move_in.sql')
ON CONFLICT DO NOTHING;

COMMIT;
