// Globals are imported rather than declared ambiently: see `safe-next.test.ts`.
import { describe, expect, it } from '@jest/globals';
import {
  arrivesBeforeStallsOpen,
  defaultMoveIn,
  earlyMoveInPass,
  formatStallsOpen,
  formatWallClock,
} from './stalls-open';

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

describe('defaultMoveIn', () => {
  it('is the day before the show, at noon', () => {
    expect(defaultMoveIn('2026-05-14')).toEqual({ date: '2026-05-13', time: '12:00' });
  });

  it('rolls back across a month and a year', () => {
    expect(defaultMoveIn('2026-03-01')).toEqual({ date: '2026-02-28', time: '12:00' });
    expect(defaultMoveIn('2027-01-01')).toEqual({ date: '2026-12-31', time: '12:00' });
  });

  it('has nothing to offer without a start date', () => {
    expect(defaultMoveIn('')).toBeNull();
    expect(defaultMoveIn(null)).toBeNull();
  });
});

describe('earlyMoveInPass', () => {
  it('finds the row the Lodging step writes', () => {
    const fees = [{ code: 'stall' }, { code: 'early_move_in' }];
    expect(earlyMoveInPass(fees)).toEqual({ code: 'early_move_in' });
  });

  it('takes an early-arrival stall the show bill import or the seed made', () => {
    expect(earlyMoveInPass([{ code: 'stall' }, { code: 'early_arrival_stall' }])).toEqual({
      code: 'early_arrival_stall',
    });
  });

  it('prefers its own code when both are on file', () => {
    const fees = [{ code: 'early_arrival_stall', id: 'a' }, { code: 'early_move_in', id: 'b' }];
    expect(earlyMoveInPass(fees)?.id).toBe('b');
  });

  it('is nothing at a show that does not offer one', () => {
    expect(earlyMoveInPass([{ code: 'stall' }, { code: 'tack_stall' }])).toBeUndefined();
  });
});
