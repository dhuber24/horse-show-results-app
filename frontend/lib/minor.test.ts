/**
 * The screen's half of the guardian rule. The thing worth pinning is that it
 * counts a birthday the way `backend/exhibitor_profile.py` does: a screen that
 * thinks somebody is 18 over a backend that thinks they are 17 lets them press
 * Save & continue into a refusal.
 */
// Globals are imported rather than declared ambiently: `tsconfig.json` includes
// `**/*.ts`, so these files are type-checked by `npm run type-check`.
import { describe, expect, it } from '@jest/globals';

import { ageOn, isMinorOn, todayIso } from './minor';

const SHOW_DAY = '2026-06-13';

describe('ageOn', () => {
  it('counts the birthday itself as the new age', () => {
    expect(ageOn('2008-06-13', SHOW_DAY)).toBe(18);
  });

  it('is a year younger the day before the birthday', () => {
    expect(ageOn('2008-06-14', SHOW_DAY)).toBe(17);
  });

  it('reads nothing into an empty or malformed date', () => {
    expect(ageOn('', SHOW_DAY)).toBeNull();
    expect(ageOn('06/13/2008', SHOW_DAY)).toBeNull();
  });
});

describe('isMinorOn', () => {
  it('asks for a guardian of a twelve-year-old', () => {
    expect(isMinorOn('2014-01-05', SHOW_DAY)).toBe(true);
  });

  it('lets somebody who turned 18 on the show day sign for themselves', () => {
    expect(isMinorOn('2008-06-13', SHOW_DAY)).toBe(false);
  });

  it('asks nothing while the date of birth is blank', () => {
    expect(isMinorOn('', SHOW_DAY)).toBe(false);
  });
});

describe('todayIso', () => {
  it('pads the month and day', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
