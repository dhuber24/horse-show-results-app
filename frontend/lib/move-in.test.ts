// Globals are imported rather than declared ambiently: see `safe-next.test.ts`.
import { describe, expect, it } from '@jest/globals';
import { arrivalNote, departureNote, passLineText, type MoveInLine } from './move-in';
import type { StallPeriod } from './stall-periods';

// WSCA-style: stalls open Wednesday 4 PM; pleasure stalls out Friday after the
// last class; games stalls in Friday 9 PM, out Monday.
const pleasure: StallPeriod = {
  id: 'pl', name: 'Pleasure', move_in_date: '2027-09-22', move_in_time: '16:00:00',
  move_out_date: '2027-09-24', move_out_time: null, move_out_note: '1 hour after your last class',
};
const games: StallPeriod = {
  id: 'ga', name: 'Games', move_in_date: '2027-09-24', move_in_time: '21:00:00',
  move_out_date: '2027-09-27', move_out_time: null, move_out_note: null,
};
const periods = [pleasure, games];
const line = (id: string, period: string | null, extra: Partial<MoveInLine> = {}): MoveInLine => ({
  id, code: id, label: id, unit: 'per_stall', stall_kind: 'horse', stall_period_id: period, ...extra,
});
const plBox = line('plBox', 'pl');
const gaBox = line('gaBox', 'ga');
const plPass = line('early_move_in_pl', 'pl', {
  stall_kind: 'add_on', label: 'Early Move-In Pass — Pleasure',
  move_in_date: '2027-09-21', move_in_time: '16:00:00',
});
const lines = [plBox, gaBox, plPass];
const ctx = (quantities: Record<string, number>) => ({
  lines, quantities, periods, stallsOpenDate: '2027-09-22', stallsOpenTime: '16:00:00',
});

describe('arrivalNote', () => {
  it('says when stalls open before anything is booked', () => {
    expect(arrivalNote('', ctx({}))).toEqual({ text: 'Stalls open Wednesday, September 22 at 4:00 PM.', warn: false });
  });

  it('holds a games-only exhibitor to the games move-in', () => {
    expect(arrivalNote('2027-09-23', ctx({ gaBox: 1 }))).toEqual({
      text: "That's before your Games stall opens (Friday, September 24 at 9:00 PM). Check with the show office first.",
      warn: true,
    });
  });

  it('points a pleasure exhibitor arriving early at the period pass', () => {
    expect(arrivalNote('2027-09-21', ctx({ plBox: 1 }))?.text).toBe(
      "That's before your Pleasure stall opens (Wednesday, September 22 at 4:00 PM). Add the Early Move-In Pass above (move in from Tuesday, September 21 at 4:00 PM), or check with the show office.",
    );
  });

  it('moves the earliest day to the pass once it is booked', () => {
    expect(arrivalNote('2027-09-21', ctx({ plBox: 1, early_move_in_pl: 1 }))).toEqual({
      text: 'Your Early Move-In Pass moves you in from Tuesday, September 21 at 4:00 PM.',
      warn: false,
    });
    expect(arrivalNote('2027-09-20', ctx({ plBox: 1, early_move_in_pl: 1 }))?.warn).toBe(true);
  });

  it('takes the earliest of several booked periods', () => {
    expect(arrivalNote('2027-09-22', ctx({ plBox: 1, gaBox: 1 }))).toEqual({
      text: 'Your Pleasure stall opens Wednesday, September 22 at 4:00 PM.',
      warn: false,
    });
  });
});

describe('departureNote', () => {
  it('says when the last booked period must be out, with its note', () => {
    expect(departureNote('', ctx({ plBox: 1 }))).toEqual({
      text: 'Your Pleasure stall must be out Friday, September 24, 1 hour after your last class.',
      warn: false,
    });
  });

  it('flags leaving after the stall must be out', () => {
    expect(departureNote('2027-09-26', ctx({ plBox: 1 }))?.warn).toBe(true);
    expect(departureNote('2027-09-27', ctx({ plBox: 1, gaBox: 1 }))?.warn).toBe(false);
  });

  it('says nothing for a show without periods', () => {
    const whole = line('box', null);
    expect(departureNote('2027-09-30', { lines: [whole], quantities: { box: 1 }, periods: [] })).toBeNull();
  });
});

describe('passLineText', () => {
  it('says when the pass moves you in, and what it beats', () => {
    expect(passLineText(plPass, periods)).toBe(
      'Move in from Tuesday, September 21 at 4:00 PM, before Pleasure stalls open (Wednesday, September 22 at 4:00 PM).',
    );
  });
});
