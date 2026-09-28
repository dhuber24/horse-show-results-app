import { describe, expect, it } from '@jest/globals';

import {
  addChartBand,
  awardsFromChart,
  blankChart,
  chartDraftFrom,
  placeLimit,
  setChartCell,
  setChartTo,
  type PointAward,
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
