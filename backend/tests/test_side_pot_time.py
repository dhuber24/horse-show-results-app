"""A side pot paid on time, in D splits (migration 205): `side_pot_time`.

Worked against the WSCA Championship Show's barrel sidepot -- half-second
splits, places by the number of entries, added money -- with the show
company's call that unclaimed D money is spread over the Ds that have runners
in proportion to their shares.
"""

from decimal import Decimal

from side_pot_time import TimedRun, rank_runs, time_pot, to_ms

FIVE_D = [30, 25, 20, 15, 10]


def runs(*times):
    return [TimedRun(key=f"r{i}", time=None if t is None else Decimal(str(t))) for i, t in enumerate(times)]


def by_key(standings):
    return {s.key: s for s in standings}


def test_a_time_is_read_to_the_millisecond():
    assert to_ms(Decimal("16.482")) == 16482
    assert to_ms(16.4825) == 16483


def test_the_ds_are_measured_from_the_fastest_time():
    ranked = by_key(rank_runs(runs(16.0, 16.499, 16.5, 17.2, 19.0, 25.0), 5, 500))
    assert [ranked[f"r{i}"].d_number for i in range(6)] == [1, 1, 2, 3, 5, 5]
    assert ranked["r2"].behind_ms == 500


def test_a_time_exactly_on_a_line_is_in_the_slower_d():
    ranked = by_key(rank_runs(runs(15.0, 15.5, 16.0), 3, 500))
    assert ranked["r1"].d_number == 2
    assert ranked["r2"].d_number == 3


def test_places_restart_in_each_d_and_equal_times_tie():
    ranked = by_key(rank_runs(runs(15.0, 15.2, 15.2, 15.3, 15.6, 15.7), 2, 500))
    assert [(ranked[f"r{i}"].d_number, ranked[f"r{i}"].place) for i in range(6)] == [
        (1, 1),
        (1, 2),
        (1, 2),
        (1, 4),
        (2, 1),
        (2, 2),
    ]


def test_a_run_with_no_time_is_not_ranked():
    assert [s.key for s in rank_runs(runs(15.0, None), 5, 500)] == ["r0"]


def test_a_full_field_pays_each_d_its_share():
    # Two runners per D, two places paid per D at 60/40.
    times = [15.0, 15.1, 15.5, 15.6, 16.0, 16.1, 16.5, 16.6, 17.0, 17.1]
    result = time_pot(runs(*times), 100_000, 5, 500, FIVE_D, [60, 40])
    assert [line.amount_cents for line in result.d_lines] == [30_000, 25_000, 20_000, 15_000, 10_000]
    assert result.payouts["r0"] == 18_000 and result.payouts["r1"] == 12_000
    assert result.payouts["r8"] == 6_000 and result.payouts["r9"] == 4_000
    assert result.unawarded_cents == 0


def test_an_empty_d_is_shared_over_the_ds_with_runners_by_their_shares():
    # Nobody in the 3D: its 20% is spread over the other four in proportion
    # 30:25:15:10, which on a one-place schedule is the whole pool by shares.
    times = [15.0, 15.5, 16.5, 17.0]
    result = time_pot(runs(*times), 80_000, 5, 500, FIVE_D, [100])
    assert [line.amount_cents for line in result.d_lines] == [30_000, 25_000, 0, 15_000, 10_000]
    assert result.payouts == {"r0": 30_000, "r1": 25_000, "r2": 15_000, "r3": 10_000}
    assert result.unawarded_cents == 0


def test_a_d_short_of_paid_places_gives_up_the_places_it_cannot_fill():
    # 2D splits, 50/50, three places at 50/30/20. The 1D has three runners and
    # fills its places; the 2D has one runner and claims only first place's 50%
    # of its half. The unclaimed 25% of the pool is spread 50:50 over both Ds,
    # and inside each D over the places it filled.
    times = [15.0, 15.1, 15.2, 15.6]
    pool = 10_000
    result = time_pot(runs(*times), pool, 2, 500, [50, 50], [50, 30, 20])
    assert result.payouts["r3"] == 2_500 + 1_250  # own 25% + half the unclaimed 25%
    one_d = 5_000 + 1_250
    assert result.payouts["r0"] == one_d * 50 // 100
    assert result.payouts["r1"] == one_d * 30 // 100
    assert result.payouts["r2"] == one_d * 20 // 100
    assert sum(result.payouts.values()) == pool
    assert result.unawarded_cents == 0


def test_tied_runs_split_the_positions_they_occupy():
    result = time_pot(runs(15.0, 15.0, 15.4), 9_000, 1, 500, [100], [50, 30, 20])
    assert result.payouts["r0"] == result.payouts["r1"] == 3_600
    assert result.payouts["r2"] == 1_800


def test_the_odd_cents_go_to_the_fastest_run():
    result = time_pot(runs(15.0, 15.1, 15.2), 1_001, 1, 500, [100], [34, 33, 33])
    assert sum(result.payouts.values()) == 1_001
    assert result.payouts["r0"] == 341


def test_with_no_times_the_whole_pool_is_unawarded():
    result = time_pot(runs(None, None), 5_000, 5, 500, FIVE_D, [100])
    assert result.payouts == {} and result.unawarded_cents == 5_000


def test_a_schedule_under_100_percent_leaves_the_rest_unawarded():
    result = time_pot(runs(15.0, 15.1), 10_000, 1, 500, [100], [60, 30])
    assert sum(result.payouts.values()) == 9_000
    assert result.unawarded_cents == 1_000


def test_the_wsca_5d_barrels_sidepot():
    """$40 buy-in, 75% payout, $1,000 added, half-second splits: 40 runs."""
    times = [16.0 + 0.07 * i for i in range(40)]  # 16.00 .. 18.73: every D has runners
    buy_ins = 40 * 4_000
    pool = buy_ins * 75 // 100 + 100_000
    result = time_pot(runs(*times), pool, 5, 500, FIVE_D, [40, 25, 15, 12, 8])
    assert pool == 220_000
    assert [line.runners for line in result.d_lines] == [8, 7, 7, 7, 11]
    assert [line.amount_cents for line in result.d_lines] == [66_000, 55_000, 44_000, 33_000, 22_000]
    assert result.payouts["r0"] == 26_400  # 40% of the 1D's 30%
    assert sum(result.payouts.values()) == pool
