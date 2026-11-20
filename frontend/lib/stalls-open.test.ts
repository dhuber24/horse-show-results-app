// Globals are imported rather than declared ambiently: see `safe-next.test.ts`.
import { describe, expect, it } from '@jest/globals';
import {
  arrivesBeforeStallsOpen,
  defaultMoveIn,
  defaultPassMoveIn,
  earlyMoveInPass,
  formatStallsOpen,
  formatWallClock,
  isEarlyMoveInPass,
  passBasisLabel,
  passMoveIn,
  passMovesInFirst,
  periodPass,
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


describe('the Early Move-In Pass move-in (migration 195)', () => {
  it('prints the day and hour the way stalls opening is printed', () => {
    expect(passMoveIn({ move_in_date: '2026-05-13', move_in_time: '18:00:00' })).toBe(
      'Wednesday, May 13 at 6:00 PM',
    );
    expect(passMoveIn({ move_in_date: null, move_in_time: null })).toBeNull();
    expect(passMoveIn(undefined)).toBeNull();
  });

  it('says when the window ends (migration 203), naming the day only when it is another', () => {
    const start = { move_in_date: '2026-09-23', move_in_time: '14:00:00' };
    expect(passMoveIn({ ...start, move_in_end_date: '2026-09-23', move_in_end_time: '16:00:00' })).toBe(
      'Wednesday, September 23 at 2:00 PM until 4:00 PM',
    );
    expect(passMoveIn({ ...start, move_in_end_date: '2026-09-24', move_in_end_time: '08:00' })).toBe(
      'Wednesday, September 23 at 2:00 PM until Thursday, September 24 at 8:00 AM',
    );
    expect(passMoveIn({ ...start, move_in_end_date: '2026-09-24', move_in_end_time: null })).toBe(
      'Wednesday, September 23 at 2:00 PM until Thursday, September 24',
    );
    // The same day with no hour says nothing more; an end with no start is not printed.
    expect(passMoveIn({ ...start, move_in_end_date: '2026-09-23', move_in_end_time: null })).toBe(
      'Wednesday, September 23 at 2:00 PM',
    );
    expect(passMoveIn({ move_in_date: null, move_in_end_date: '2026-09-23' })).toBeNull();
  });

  it('must come before stalls open', () => {
    expect(passMovesInFirst('2026-05-13', '18:00', '2026-05-14', '09:00')).toBe(true);
    expect(passMovesInFirst('2026-05-14', null, '2026-05-14', '16:00')).toBe(false);
    expect(passMovesInFirst('2026-05-14', '08:00', '2026-05-14', '16:00:00')).toBe(true);
    expect(passMovesInFirst('2026-05-14', '16:00', '2026-05-14', '16:00')).toBe(false);
    expect(passMovesInFirst('2026-05-15', '08:00', '2026-05-14', '16:00')).toBe(false);
  });

  it('has nothing to compare when either day is missing', () => {
    expect(passMovesInFirst('', '', '2026-05-14', '16:00')).toBe(true);
    expect(passMovesInFirst('2026-05-13', '', '', '')).toBe(true);
  });
});

describe('the Early Move-In Pass default (migration 195)', () => {
  it('is the day before stalls open, at the hour they open', () => {
    expect(defaultPassMoveIn('2027-09-22', '16:00:00')).toEqual({ date: '2027-09-21', time: '16:00' });
  });

  it('is noon when stalls open on a day with no hour', () => {
    expect(defaultPassMoveIn('2027-09-22', '')).toEqual({ date: '2027-09-21', time: '12:00' });
  });

  it('rolls back over a month and a year end', () => {
    expect(defaultPassMoveIn('2027-10-01', '09:00')).toEqual({ date: '2027-09-30', time: '09:00' });
    expect(defaultPassMoveIn('2027-01-01', null)).toEqual({ date: '2026-12-31', time: '12:00' });
  });

  it('is nothing when stalls open on no day', () => {
    expect(defaultPassMoveIn('', '16:00')).toBeNull();
    expect(defaultPassMoveIn(null, null)).toBeNull();
  });

  it('always comes before stalls open', () => {
    const pass = defaultPassMoveIn('2027-09-22', '16:00')!;
    expect(passMovesInFirst(pass.date, pass.time, '2027-09-22', '16:00')).toBe(true);
  });
});

describe('a pass per stall period (migration 196)', () => {
  const fees = [
    { code: 'stall', stall_period_id: 'p1' },
    { code: 'early_move_in_ab12cd34', stall_period_id: 'p1' },
    { code: 'early_move_in', stall_period_id: null },
  ];

  it('knows a period pass by its code', () => {
    expect(isEarlyMoveInPass({ code: 'early_move_in_ab12cd34' })).toBe(true);
    expect(isEarlyMoveInPass({ code: 'early_arrival_stall' })).toBe(true);
    expect(isEarlyMoveInPass({ code: 'stall_box_stall' })).toBe(false);
  });

  it('finds a period its own pass, and the whole show its own', () => {
    expect(periodPass(fees, 'p1')?.code).toBe('early_move_in_ab12cd34');
    expect(periodPass(fees, 'p2')).toBeUndefined();
    expect(earlyMoveInPass(fees)?.code).toBe('early_move_in');
  });

  it('says how the pass is priced', () => {
    expect(passBasisLabel({ unit: 'per_stall' })).toBe('per stall');
    expect(passBasisLabel({ unit: 'per_stall', one_per_exhibitor: true })).toBe('per exhibitor');
  });
});
