import { describe, expect, it } from '@jest/globals';

import {
  addChartBand,
  awardsFromChart,
  blankChart,
  chartDraftFrom,
  placeLimit,
  setChartCell,
  setChartTo,
  topStandings,
  type PointAward,
  type Standing,
} from './high-point';

// The grid editor is shared by the Points Systems library and a show's own
// chart (migration 153); these pin what a grid means, so the two screens and
// the backend's `place_limits` agree.

const APHA_START: PointAward[] = [
  { min_entries: 2, place: 1, points: 0.5 },
  { min_entries: 3, place: 1, points: 1 },
  { min_entries: 3, place: 2, points: 0.5 },
];

describe('chartDraftFrom / awardsFromChart', () => {
  it('round-trips a saved chart unchanged — what Use this template opens is what it saves', () => {
    const result = awardsFromChart(chartDraftFrom(APHA_START));
    expect(result).toEqual({ awards: APHA_START });
  });

  it('opens an empty chart (Custom) as the one row every chart has', () => {
    expect(chartDraftFrom([])).toEqual(blankChart());
  });

  it('refuses a row with no points, which would otherwise earn the row above', () => {
    const chart = addChartBand(setChartCell(blankChart(), 0, 0, '5'));
    expect(awardsFromChart(chart)).toEqual({
      error: 'Classes of 2 or more have no points. Give their row some, or remove it.',
    });
  });

  it('refuses a cell that is not a number', () => {
    const chart = setChartCell(blankChart(), 0, 0, 'six');
    expect('error' in awardsFromChart(chart)).toBe(true);
  });
});

describe('ranges', () => {
  it('typing where a row ends starts the next one higher', () => {
    const chart = setChartTo(chartDraftFrom(APHA_START), 0, '4');
    expect(chart.bands[1].minEntries).toBe('5');
  });

  it('a bounded row pays as many places as its largest class', () => {
    const chart = setChartTo(chartDraftFrom(APHA_START), 0, '9');
    // Row 1 is now 2–9, so it may pay down to 9th.
    expect(placeLimit(chart.bands, 0)).toBe(9);
  });
});

describe('topStandings', () => {
  // Standings as the backend ranks them: points high to low, 1, 2, 2, 4.
  const ranked = (...points: number[]): Standing[] =>
    points.map((p, i) => ({
      rank: points.indexOf(p) + 1,
      exhibitor_id: `e${i}`,
      exhibitor_name: `Exhibitor ${i}`,
      horse_id: `h${i}`,
      horse_name: `Horse ${i}`,
      points: p,
      class_count: 1,
      show_count: 1,
    }));
  const shape = (lines: ReturnType<typeof topStandings>) =>
    lines.map((l) => (l.kind === 'pair' ? l.standing.rank : `${l.count} tied for ${l.rank}`));

  it('stops at the fifth rank', () => {
    expect(shape(topStandings(ranked(9, 8, 7, 6, 5, 4, 3), 5, 6))).toEqual([1, 2, 3, 4, 5]);
  });

  it('shows both pairs in a tie for fifth, as a class card does', () => {
    expect(shape(topStandings(ranked(9, 8, 7, 6, 5, 5, 3), 5, 6))).toEqual([1, 2, 3, 4, 5, 5]);
  });

  it('never splits a tie that runs past the rows: it becomes one line', () => {
    const lines = topStandings(ranked(9, 8, 7, 6, 2, 2, 2, 1), 5, 6);
    expect(shape(lines)).toEqual([1, 2, 3, 4, '3 tied for 5']);
    expect(lines[4]).toMatchObject({ kind: 'tied', points: 2 });
  });

  it('collapses a long tie at the top the same way', () => {
    expect(shape(topStandings(ranked(6, 6, 6, 6, 6, 6, 6, 1), 5, 6))).toEqual(['7 tied for 1']);
  });

  it('lists a tie that fits, and ranks after it still stop at fifth', () => {
    expect(shape(topStandings(ranked(7, 6, 6, 6, 2, 1), 5, 6))).toEqual([1, 2, 2, 2, 5]);
  });

  it('is empty for a division with no standings', () => {
    expect(topStandings([], 5, 6)).toEqual([]);
  });
});
