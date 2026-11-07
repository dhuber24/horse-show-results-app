// Globals are imported rather than declared ambiently: see `safe-next.test.ts`.
import { describe, expect, it } from '@jest/globals';
import { arrivesBeforeStallsOpen, formatStallsOpen, formatWallClock } from './stalls-open';

describe('formatStallsOpen', () => {
  it('prints the day and the hour', () => {
    expect(formatStallsOpen('2026-05-14', '12:00:00')).toBe('Thursday, May 14 at 12:00 PM');
  });

  it('prints the day alone when there is no hour', () => {
    expect(formatStallsOpen('2026-05-14', null)).toBe('Thursday, May 14');
  });

  it('says nothing when the show has not set a day', () => {
    expect(formatStallsOpen(null, null)).toBeNull();
    expect(formatStallsOpen(undefined, '08:00:00')).toBeNull();
  });
});

describe('formatWallClock', () => {
  it('reads midnight, morning, noon and evening', () => {
    expect(formatWallClock('00:00:00')).toBe('12:00 AM');
    expect(formatWallClock('08:30:00')).toBe('8:30 AM');
    expect(formatWallClock('12:00')).toBe('12:00 PM');
    expect(formatWallClock('19:15:00')).toBe('7:15 PM');
  });
});

describe('arrivesBeforeStallsOpen', () => {
  it('flags a day before the barn opens', () => {
    expect(arrivesBeforeStallsOpen('2026-05-13', '2026-05-14')).toBe(true);
  });

  it('does not flag the opening day or later', () => {
    expect(arrivesBeforeStallsOpen('2026-05-14', '2026-05-14')).toBe(false);
    expect(arrivesBeforeStallsOpen('2026-05-15', '2026-05-14')).toBe(false);
  });

  it('does not flag when either is unset', () => {
    expect(arrivesBeforeStallsOpen('', '2026-05-14')).toBe(false);
    expect(arrivesBeforeStallsOpen('2026-05-13', null)).toBe(false);
  });
});
