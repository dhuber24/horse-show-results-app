-- 205: a side pot paid on time, in D splits, bought into one run at a time.
--
-- A barrel sidepot ("$1,000 Added SIDEPOT 5D Barrels") has no run of its own.
-- It takes each entered run's time from the class it was run in, splits the
-- field into Ds by how far behind the fastest time each run was (half-second
-- splits on the WSCA Championship Show bill), shares the pool between the Ds,
-- and pays places inside each D. Side pots could only add up placings or
-- scores, where higher scores win, so the show bill reader turned these into
-- classes nobody runs.
--
--   * `scoring_method = 'fastest_time'`: one time per buy-in, lower wins.
--   * `d_count` / `d_split_ms` / `d_percents`: how many Ds, how far apart
--     their lines are, and each D's share of the pool (sums to 100). A pot
--     that is not paid on time keeps `d_count = 1` and ignores the rest.
--   * `added_money_cents`: money the show adds to the pool on top of the
--     buy-ins' payback ("$1,000 Added ... 75% payout"). Any pot may have it.
--   * `side_pot_entries.entry_id`: the run a buy-in is for. A time pot's
--     buy-in is a run, not a person: a rider on two horses can buy both in,
--     and the futurity pot must pay on the futurity horse's time. NULL for
--     the placings and scores pots, which stay one buy-in per exhibitor.
--     CASCADE: scratching the run takes its buy-in with it, which is the
--     scratch-releases-the-buy-in rule (`side_pot_membership`) for free.
--   * `side_pot_payouts.entry_id` / `d_number`: which run a settled payout
--     paid and in which D. SET NULL on the run, because a settled payout is
--     a record of money paid and outlives a scratched entry.
--
-- The one-row-per-exhibitor UNIQUEs, on buy-ins and on payouts, become
-- partial indexes over the per-exhibitor rows, and a run is unique per pot.
--
-- Widened CHECK, defaulted columns, nullable columns, and a uniqueness rule
-- relaxed only for rows the old code never writes: backward-compatible, so
-- this goes to production before the code.

BEGIN;

ALTER TABLE side_pots DROP CONSTRAINT IF EXISTS ck_side_pots_scoring_method;
ALTER TABLE side_pots ADD CONSTRAINT ck_side_pots_scoring_method
    CHECK (scoring_method IN ('sum_placings', 'sum_scores', 'fastest_time'));

ALTER TABLE side_pots ADD COLUMN IF NOT EXISTS added_money_cents INTEGER;
ALTER TABLE side_pots ADD COLUMN IF NOT EXISTS d_count INTEGER;
ALTER TABLE side_pots ADD COLUMN IF NOT EXISTS d_split_ms INTEGER;
ALTER TABLE side_pots ADD COLUMN IF NOT EXISTS d_percents JSONB;

-- Stated on their own: startup `create_all` may add the columns from the
-- model first, and defaults inside ADD COLUMN would be skipped with it.
ALTER TABLE side_pots ALTER COLUMN added_money_cents SET DEFAULT 0;
ALTER TABLE side_pots ALTER COLUMN d_count SET DEFAULT 1;
ALTER TABLE side_pots ALTER COLUMN d_split_ms SET DEFAULT 500;
UPDATE side_pots SET added_money_cents = 0 WHERE added_money_cents IS NULL;
UPDATE side_pots SET d_count = 1 WHERE d_count IS NULL;
UPDATE side_pots SET d_split_ms = 500 WHERE d_split_ms IS NULL;
ALTER TABLE side_pots ALTER COLUMN added_money_cents SET NOT NULL;
ALTER TABLE side_pots ALTER COLUMN d_count SET NOT NULL;
ALTER TABLE side_pots ALTER COLUMN d_split_ms SET NOT NULL;

ALTER TABLE side_pots DROP CONSTRAINT IF EXISTS ck_side_pots_added_money_nonneg;
ALTER TABLE side_pots ADD CONSTRAINT ck_side_pots_added_money_nonneg
    CHECK (added_money_cents >= 0);
ALTER TABLE side_pots DROP CONSTRAINT IF EXISTS ck_side_pots_d_count_range;
ALTER TABLE side_pots ADD CONSTRAINT ck_side_pots_d_count_range
    CHECK (d_count BETWEEN 1 AND 10);
ALTER TABLE side_pots DROP CONSTRAINT IF EXISTS ck_side_pots_d_split_positive;
ALTER TABLE side_pots ADD CONSTRAINT ck_side_pots_d_split_positive
    CHECK (d_split_ms > 0);

ALTER TABLE side_pot_entries
    ADD COLUMN IF NOT EXISTS entry_id UUID REFERENCES entries(id) ON DELETE CASCADE;

ALTER TABLE side_pot_entries
    DROP CONSTRAINT IF EXISTS side_pot_entries_side_pot_id_show_entry_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS side_pot_entries_pot_show_entry_uniq
    ON side_pot_entries (side_pot_id, show_entry_id) WHERE entry_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS side_pot_entries_pot_run_uniq
    ON side_pot_entries (side_pot_id, entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_side_pot_entries_entry
    ON side_pot_entries (entry_id) WHERE entry_id IS NOT NULL;

ALTER TABLE side_pot_payouts
    ADD COLUMN IF NOT EXISTS entry_id UUID REFERENCES entries(id) ON DELETE SET NULL;
ALTER TABLE side_pot_payouts ADD COLUMN IF NOT EXISTS d_number INTEGER;

-- A rider can win in two Ds on two horses, so a time pot's payouts are one per
-- run, not one per exhibitor. Keyed on `d_number`, which every time-pot payout
-- carries, rather than on `entry_id`, which a scratched run sets NULL.
ALTER TABLE side_pot_payouts
    DROP CONSTRAINT IF EXISTS side_pot_payouts_side_pot_id_show_entry_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS side_pot_payouts_pot_show_entry_uniq
    ON side_pot_payouts (side_pot_id, show_entry_id) WHERE d_number IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS side_pot_payouts_pot_run_uniq
    ON side_pot_payouts (side_pot_id, entry_id) WHERE entry_id IS NOT NULL;

COMMENT ON COLUMN side_pots.scoring_method IS
    'sum_placings (lowest sum wins), sum_scores (highest sum wins), or fastest_time: one time per run bought in, lower wins, paid in D splits (migration 205).';
COMMENT ON COLUMN side_pots.added_money_cents IS
    'Money the show adds to the pool on top of the buy-ins'' payback (migration 205).';
COMMENT ON COLUMN side_pots.d_count IS
    'How many Ds a fastest_time pot pays (1 = one field, fastest wins). Ignored by the other methods (migration 205).';
COMMENT ON COLUMN side_pots.d_split_ms IS
    'How far apart the D lines are, in milliseconds behind the fastest time: 500 is half-second splits (migration 205).';
COMMENT ON COLUMN side_pots.d_percents IS
    'Each D''s share of the pool, fastest D first, summing to 100 (migration 205). Unclaimed D money is spread over the Ds with runners in proportion to these.';
COMMENT ON COLUMN side_pot_entries.entry_id IS
    'The run a fastest_time pot''s buy-in is for; NULL for a per-exhibitor pot. Deleting the run deletes the buy-in (migration 205).';
COMMENT ON COLUMN side_pot_payouts.entry_id IS
    'The run this payout paid, for a fastest_time pot (migration 205).';
COMMENT ON COLUMN side_pot_payouts.d_number IS
    'The D this payout was won in, 1 = fastest, for a fastest_time pot; place is the place inside it (migration 205).';

COMMIT;
