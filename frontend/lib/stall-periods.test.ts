// Globals are imported rather than declared ambiently: see `safe-next.test.ts`.
import { describe, expect, it } from '@jest/globals';
import { listOf, periodWindow, shortDay, stallCheckText, type StallPeriod } from './stall-periods';

const pleasure: StallPeriod = {
  id: 'p',
  name: 'Pleasure',
  move_in_date: '2026-09-23',
  move_in_time: '16:00:00',
  move_out_date: '2026-09-25',
  move_out_time: null,
  move_out_note: '1 hour after your last class',
};

describe('periodWindow', () => {
  it('prints move-in with its hour and move-out with its note', () => {
    expect(periodWindow(pleasure)).toBe(
      'In Wednesday, September 23 at 4:00 PM · out Friday, September 25, 1 hour after your last class',
    );
  });

  it('prints a move-out hour when there is no note', () => {
    expect(
      periodWindow({ ...pleasure, move_out_note: null, move_out_time: '20:00' }),
    ).toBe('In Wednesday, September 23 at 4:00 PM · out Friday, September 25 at 8:00 PM');
  });
});

describe('shortDay and listOf', () => {
  it('reads the day as parts, not as a UTC instant', () => {
    expect(shortDay('2026-09-26')).toBe('Sat, Sep 26');
  });

  it('joins names the way a sentence does', () => {
    expect(listOf(['Buddy'])).toBe('Buddy');
    expect(listOf(['Buddy', 'Rio'])).toBe('Buddy and Rio');
    expect(listOf(['Buddy', 'Rio', 'Pepper'])).toBe('Buddy, Rio and Pepper');
  });
});

describe('stallCheckText', () => {
  const short = {
    code: 'HORSE_STALLS_SHORT' as const,
    dates: ['2026-09-26', '2026-09-27'],
    horses: ['Buddy', 'Rio'],
    stalls: 1,
  };

  it('tells the exhibitor which horses and days their stalls do not cover', () => {
    expect(stallCheckText(short, 'you')).toBe(
      'Buddy and Rio show Sat, Sep 26 and Sun, Sep 27, and only 1 of your horse stalls covers those days.',
    );
  });

  it('says none for a horse with no stall that day', () => {
    expect(
      stallCheckText({ ...short, horses: ['Buddy'], dates: ['2026-09-26'], stalls: 0 }, 'you'),
    ).toBe('Buddy shows Sat, Sep 26, and none of your horse stalls covers that day.');
  });

  it('tells the desk the same in the third person', () => {
    expect(stallCheckText(short, 'they')).toBe(
      'Buddy and Rio show Sat, Sep 26 and Sun, Sep 27 on 1 horse stall.',
    );
  });

  const tack = {
    code: 'TACK_STALL_HORSES' as const,
    show_fee_id: 'f',
    label: 'Tack stall - Games',
    period: 'Games',
    tack_stalls: 1,
    horses_per_tack_stall: 4,
    horse_stalls: 2,
  };

  it('says how many horse stalls a tack stall needs, and in which period', () => {
    expect(stallCheckText(tack, 'you')).toBe(
      'Tack stall - Games: each tack stall needs 4 horse stalls in the Games period. You have 2 for 1 tack stall.',
    );
    expect(stallCheckText(tack, 'they')).toBe(
      'Tack stall - Games: 1 tack stall on 2 horse stalls in the Games period; needs 4.',
    );
  });
});

describe('a pass without a stall (migration 196)', () => {
  const base = {
    code: 'PASS_WITHOUT_STALL' as const,
    show_fee_id: 'f',
    label: 'Early Move-In Pass — Pleasure',
    period: 'Pleasure',
  };

  it('counts passes against stalls when sold per stall', () => {
    expect(
      stallCheckText({ ...base, passes: 2, stalls: 1, one_per_exhibitor: false }, 'you'),
    ).toBe(
      'Early Move-In Pass — Pleasure: 2 passes for 1 stall in the Pleasure period — one pass moves one stall in early.',
    );
  });

  it('says there is no stall when sold per exhibitor', () => {
    expect(
      stallCheckText({ ...base, passes: 1, stalls: 0, one_per_exhibitor: true }, 'they'),
    ).toBe('Early Move-In Pass — Pleasure: booked with no stall in the Pleasure period.');
  });
});
